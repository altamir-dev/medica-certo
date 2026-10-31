import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { config } from '../config.mjs';
import { getPool } from '../db.mjs';
import {
  createMedication,
  parseMedicationBody,
  saveMedicationPhoto,
} from '../medications.mjs';
import { createTreatment, parseTreatmentBody } from '../treatments.mjs';
import { stripJpegMetadata } from './exif.mjs';
import { ROUTE_SET } from './extract.mjs';
import { readWithOneRetry } from './openrouter.mjs';
import { interpretReading } from './reading.mjs';
import { assessUsage, estimateCostUsd, readAiSettings } from './settings.mjs';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * @param {string} relativePath
 */
export function resolveIntakeAbsolutePath(relativePath) {
  const root = resolve(config.dataDir, 'intake-photos');
  const absolute = resolve(root, relativePath);
  if (!absolute.startsWith(`${root}/`)) {
    throw new Error('Invalid intake path');
  }
  return absolute;
}

/**
 * @param {{ id: string, status: string, document_kind: string | null, error_code: string | null, extracted: unknown, patient_id: string | null, expires_at: Date | string, created_at: Date | string, model_name: string | null }} row
 */
export function mapDraft(row) {
  return {
    id: row.id,
    status: row.status,
    documentKind: row.document_kind,
    errorCode: row.error_code,
    extracted: row.extracted ?? null,
    patientId: row.patient_id,
    expiresAt:
      row.expires_at instanceof Date
        ? row.expires_at.toISOString()
        : String(row.expires_at),
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
    model: row.model_name,
  };
}

/**
 * @param {string} caregiverId
 * @param {string} draftId
 */
async function loadOwned(caregiverId, draftId) {
  const result = await getPool().query(
    `SELECT * FROM medication_drafts
     WHERE id = $1 AND caregiver_id = $2`,
    [draftId, caregiverId],
  );
  return result.rows[0] ?? null;
}

/**
 * @param {import('./settings.mjs').readAiSettings extends Function ? ReturnType<import('./settings.mjs').readAiSettings> : never} settings
 * @param {string} caregiverId
 */
async function usageSnapshot(settings, caregiverId) {
  const pool = getPool();
  const hourly = await pool.query(
    `SELECT COUNT(*)::int AS n
     FROM medication_ai_events
     WHERE caregiver_id = $1
       AND created_at > now() - interval '1 hour'
       AND outcome <> 'pending'`,
    [caregiverId],
  );
  const daily = await pool.query(
    `SELECT COALESCE(SUM(request_count), 0)::int AS n,
            COALESCE(SUM(estimated_cost_usd), 0)::float AS cost
     FROM ai_usage_daily
     WHERE caregiver_id = $1
       AND usage_date = CURRENT_DATE`,
    [caregiverId],
  );
  const month = await pool.query(
    `SELECT COALESCE(SUM(estimated_cost_usd), 0)::float AS cost
     FROM ai_usage_daily
     WHERE caregiver_id = $1
       AND usage_date >= date_trunc('month', CURRENT_DATE)::date`,
    [caregiverId],
  );
  return assessUsage({
    hourlyCount: hourly.rows[0]?.n ?? 0,
    dailyCount: daily.rows[0]?.n ?? 0,
    monthCostUsd: Number(month.rows[0]?.cost ?? 0),
    dailyLimit: settings.dailyLimit,
    hourlyLimit: settings.hourlyLimit,
    monthlyBudgetUsd: settings.monthlyBudgetUsd,
  });
}

/**
 * @param {string} caregiverId
 * @param {string} model
 * @param {string} providerName
 */
export async function hasAiConsent(caregiverId, providerName, model) {
  const result = await getPool().query(
    `SELECT ai_image_consent_at
     FROM caregivers
     WHERE id = $1
       AND ai_image_consent_provider = $2
       AND ai_image_consent_model = $3
       AND ai_image_consent_at IS NOT NULL`,
    [caregiverId, providerName, model],
  );
  return Boolean(result.rows[0]);
}

/**
 * @param {string} caregiverId
 * @param {string} providerName
 * @param {string} model
 */
export async function recordAiConsent(caregiverId, providerName, model) {
  await getPool().query(
    `UPDATE caregivers
     SET ai_image_consent_at = now(),
         ai_image_consent_provider = $2,
         ai_image_consent_model = $3
     WHERE id = $1`,
    [caregiverId, providerName, model],
  );
}

/**
 * @param {string} caregiverId
 * @param {{ buffer: Buffer, mimetype: string, patientId: string | null }} file
 * @param {{ log?: { error: Function, info?: Function }, fetchImpl?: typeof fetch }} [deps]
 */
export async function createDraft(caregiverId, file, deps = {}) {
  const settings = readAiSettings();
  if (!settings.enabled) return { ok: false, code: 'AI_DISABLED' };
  if (!(await hasAiConsent(caregiverId, settings.providerName, settings.model))) {
    return { ok: false, code: 'CONSENT_REQUIRED' };
  }
  const gate = await usageSnapshot(settings, caregiverId);
  if (!gate.ok) return { ok: false, code: gate.code };

  const ext =
    file.mimetype === 'image/png'
      ? '.png'
      : file.mimetype === 'image/webp'
        ? '.webp'
        : '.jpg';
  const stored =
    ext === '.jpg' ? stripJpegMetadata(file.buffer) : file.buffer;
  const id = randomUUID();
  const relative = `${caregiverId}/${id}${ext}`;
  const absolute = resolveIntakeAbsolutePath(relative);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, stored);
  const sha = createHash('sha256').update(stored).digest('hex');

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const processing = await client.query(
      `SELECT 1 FROM medication_drafts
       WHERE caregiver_id = $1 AND status = 'processing'
       LIMIT 1`,
      [caregiverId],
    );
    if ((processing.rowCount ?? 0) > 0) {
      await client.query('ROLLBACK');
      await unlink(absolute).catch(() => {});
      return { ok: false, code: 'CONFLICT' };
    }
    const inserted = await client.query(
      `INSERT INTO medication_drafts (
         id, caregiver_id, patient_id, status, image_path, image_sha256,
         mime_type, model_provider, model_name, prompt_version, expires_at
       ) VALUES (
         $1, $2, $3, 'processing', $4, $5, $6, $7, $8, $9, now() + interval '24 hours'
       )
       RETURNING *`,
      [
        id,
        caregiverId,
        file.patientId,
        relative,
        sha,
        file.mimetype,
        settings.providerName,
        settings.model,
        settings.promptVersion,
      ],
    );
    await client.query(
      `INSERT INTO ai_usage_daily (caregiver_id, usage_date, request_count, estimated_cost_usd)
       VALUES ($1, CURRENT_DATE, 1, 0)
       ON CONFLICT (caregiver_id, usage_date)
       DO UPDATE SET request_count = ai_usage_daily.request_count + 1`,
      [caregiverId],
    );
    await client.query(
      `INSERT INTO medication_ai_events (
         caregiver_id, draft_id, provider, model, prompt_version, outcome
       ) VALUES ($1, $2, $3, $4, $5, 'pending')`,
      [
        caregiverId,
        id,
        settings.providerName,
        settings.model,
        settings.promptVersion,
      ],
    );
    await client.query('COMMIT');
    const draft = inserted.rows[0];
    setImmediate(() => {
      processDraft(caregiverId, id, deps).catch((err) => {
        deps.log?.error?.({ err, draftId: id }, 'medication draft failed');
      });
    });
    return { ok: true, draft: mapDraft(draft) };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    await unlink(absolute).catch(() => {});
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      /** @type {{ code?: string }} */ (err).code === '23505'
    ) {
      return { ok: false, code: 'CONFLICT' };
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * @param {string} caregiverId
 * @param {string} draftId
 * @param {{ log?: { error: Function, info?: Function }, fetchImpl?: typeof fetch }} [deps]
 */
export async function processDraft(caregiverId, draftId, deps = {}) {
  const settings = readAiSettings();
  const row = await loadOwned(caregiverId, draftId);
  if (!row || row.status !== 'processing') return;
  const absolute = resolveIntakeAbsolutePath(row.image_path);
  const image = await readFile(absolute);
  const vision = await readWithOneRetry({
    settings,
    image,
    mimeType: row.mime_type,
    fetchImpl: deps.fetchImpl,
  });
  const result = vision.result;
  const tokensIn = result.usage?.prompt_tokens ?? null;
  const tokensOut = result.usage?.completion_tokens ?? null;
  const cost = estimateCostUsd({
    inputTokens: tokensIn,
    outputTokens: tokensOut,
    fallback: !result.usage,
    priceInputPerMillion: settings.priceInputPerMillion,
    priceOutputPerMillion: settings.priceOutputPerMillion,
  });

  /** @type {unknown} */
  let extracted = null;
  let status = 'failed';
  let errorCode = result.ok ? null : result.outcome === 'timeout' ? 'AI_TIMEOUT' : result.outcome === 'invalid_output' ? 'AI_INVALID_OUTPUT' : 'AI_UNAVAILABLE';
  let documentKind = null;

  if (result.ok) {
    const interpreted = await interpretReading(
      result.raw,
      new Date().toISOString(),
      (item) => lookupAnvisa(item.name),
    );
    if (!interpreted.ok) {
      errorCode = 'AI_INVALID_OUTPUT';
    } else {
      extracted = interpreted.reading;
      documentKind = interpreted.reading.documentKind;
      status = 'ready';
      errorCode = null;
    }
  }

  await getPool().query(
    `UPDATE medication_drafts
     SET status = $3,
         document_kind = $4,
         error_code = $5,
         extracted = $6,
         model_name = $7,
         updated_at = now()
     WHERE id = $1 AND caregiver_id = $2 AND status = 'processing'`,
    [draftId, caregiverId, status, documentKind, errorCode, extracted, result.model],
  );
  await getPool().query(
    `UPDATE medication_ai_events
     SET outcome = $3,
         input_tokens = $4,
         output_tokens = $5,
         estimated_cost_usd = $6,
         latency_ms = $7,
         http_status = $8
     WHERE draft_id = $1
       AND caregiver_id = $2
       AND outcome = 'pending'`,
    [
      draftId,
      caregiverId,
      result.outcome === 'ok' && status === 'ready' ? 'ok' : result.outcome,
      tokensIn ?? 3000,
      tokensOut ?? 800,
      cost,
      result.latencyMs,
      result.httpStatus || null,
    ],
  );
  await getPool().query(
    `UPDATE ai_usage_daily
     SET estimated_cost_usd = estimated_cost_usd + $3
     WHERE caregiver_id = $1 AND usage_date = CURRENT_DATE`,
    [caregiverId, cost],
  );
  void cost;
}

/**
 * @param {string} name
 */
async function lookupAnvisa(name) {
  const { normalizeDrugText } = await import('./anvisa.mjs');
  const q = normalizeDrugText(name);
  if (!q) return [];
  try {
    const result = await getPool().query(
      `SELECT registro, produto, substancia, apresentacao, laboratorio,
              classe_terapeutica
       FROM anvisa_presentations
       WHERE produto_norm % $1 OR substancia_norm % $1
       ORDER BY GREATEST(
         similarity(produto_norm, $1),
         similarity(substancia_norm, $1)
       ) DESC
       LIMIT 8`,
      [q],
    );
    return result.rows;
  } catch {
    return [];
  }
}

/**
 * @param {string} caregiverId
 * @param {string} draftId
 */
export async function getDraft(caregiverId, draftId) {
  const row = await loadOwned(caregiverId, draftId);
  return row ? mapDraft(row) : null;
}

/**
 * @param {string} caregiverId
 * @param {string} draftId
 */
export async function getDraftImage(caregiverId, draftId) {
  const row = await loadOwned(caregiverId, draftId);
  if (!row?.image_path) return null;
  let absolute;
  try {
    absolute = resolveIntakeAbsolutePath(row.image_path);
  } catch {
    return null;
  }
  if (!existsSync(absolute)) return null;
  const ext = row.image_path.toLowerCase();
  const contentType = ext.endsWith('.png')
    ? 'image/png'
    : ext.endsWith('.webp')
      ? 'image/webp'
      : 'image/jpeg';
  return { stream: createReadStream(absolute), contentType };
}

/**
 * @param {string} caregiverId
 * @param {string} draftId
 */
export async function discardDraft(caregiverId, draftId) {
  const row = await loadOwned(caregiverId, draftId);
  if (!row) return false;
  if (row.image_path) {
    await unlink(resolveIntakeAbsolutePath(row.image_path)).catch(() => {});
  }
  await getPool().query(
    `UPDATE medication_drafts
     SET status = 'discarded',
         image_path = '',
         extracted = NULL,
         updated_at = now()
     WHERE id = $1 AND caregiver_id = $2`,
    [draftId, caregiverId],
  );
  return true;
}

/**
 * @param {Record<string, unknown>} item
 * @param {Record<string, unknown> | null} extractedItem
 */
function posologyOrigin(item, extractedItem) {
  const schedule =
    extractedItem &&
    typeof extractedItem.schedule === 'object' &&
    extractedItem.schedule
      ? /** @type {Record<string, unknown>} */ (extractedItem.schedule)
      : null;
  if (!schedule) return 'manual';
  const same =
    String(schedule.doseQuantity ?? '') === String(item.doseQuantity ?? '') &&
    String(schedule.route ?? '') === String(item.route ?? '') &&
    String(schedule.mode ?? '') === String(item.scheduleMode ?? '') &&
    Number(schedule.intervalHours ?? 0) === Number(item.intervalHours ?? 0);
  return same ? 'prescription_confirmed' : 'manual';
}

/**
 * @param {string} caregiverId
 * @param {string} draftId
 * @param {{ items?: unknown }} body
 */
export async function confirmDraft(caregiverId, draftId, body) {
  const row = await loadOwned(caregiverId, draftId);
  if (!row) return { ok: false, code: 'NOT_FOUND' };
  if (row.status === 'confirmed') {
    return {
      ok: true,
      already: true,
      medicationIds: row.confirmed_medication_ids ?? [],
      treatmentIds: row.confirmed_treatment_ids ?? [],
    };
  }
  if (row.status !== 'ready') return { ok: false, code: 'CONFLICT' };
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { ok: false, code: 'CONFLICT' };
  }

  const items = Array.isArray(body.items) ? body.items : [];
  const included = items.filter(
    (item) =>
      item &&
      typeof item === 'object' &&
      /** @type {{ include?: boolean }} */ (item).include !== false,
  );
  if (included.length === 0) {
    return { ok: false, code: 'VALIDATION', message: 'Selecione um medicamento.' };
  }

  /** @type {string[]} */
  const createdMedicationIds = [];
  /** @type {string[]} */
  const medicationIds = [];
  /** @type {string[]} */
  const createdTreatmentIds = [];
  /** @type {{ id: string }[]} */
  const photoTargets = [];

  const extractedItems = Array.isArray(row.extracted?.items)
    ? row.extracted.items
    : [];

  try {
    for (let index = 0; index < items.length; index += 1) {
      const item = /** @type {Record<string, unknown>} */ (items[index]);
      if (!item || typeof item !== 'object' || item.include === false) continue;
      const parsed = parseMedicationBody({
        name: item.name,
        activeIngredient: item.activeIngredient,
        indication: '',
        referencePosology: '',
        concentration: item.concentration,
        presentation: item.presentation,
        anvisaRegistry: item.anvisaRegistry,
        catalogOrigin: 'ai_confirmed',
      });
      if (!parsed.ok) {
        await rollbackCreated(caregiverId, createdTreatmentIds, createdMedicationIds);
        return { ok: false, code: 'VALIDATION', fields: parsed.fields, index };
      }

      let medicationId = '';
      const reuse = typeof item.reuseExistingId === 'string' ? item.reuseExistingId : '';
      if (reuse) {
        if (!UUID_RE.test(reuse)) {
          await rollbackCreated(caregiverId, createdTreatmentIds, createdMedicationIds);
          return { ok: false, code: 'VALIDATION', message: 'Medicamento inválido.' };
        }
        const existing = await getPool().query(
          `SELECT id FROM medications WHERE id = $1 AND caregiver_id = $2`,
          [reuse, caregiverId],
        );
        if (!existing.rows[0]) {
          await rollbackCreated(caregiverId, createdTreatmentIds, createdMedicationIds);
          return { ok: false, code: 'NOT_FOUND' };
        }
        medicationId = reuse;
      } else {
        const created = await createMedication(caregiverId, parsed.value);
        if (!created.ok) {
          await rollbackCreated(caregiverId, createdTreatmentIds, createdMedicationIds);
          return {
            ok: false,
            code: 'DUPLICATE_NAME',
            existingId: created.existingId,
            index,
          };
        }
        medicationId = created.medication.id;
        createdMedicationIds.push(medicationId);
        if (row.document_kind === 'package') {
          photoTargets.push({ id: medicationId });
        }
      }
      medicationIds.push(medicationId);

      if (item.createTreatment === true) {
        if (!row.patient_id) {
          await rollbackCreated(caregiverId, createdTreatmentIds, createdMedicationIds);
          return {
            ok: false,
            code: 'VALIDATION',
            message: 'Tratamento exige um paciente.',
          };
        }
        if (!ROUTE_SET.has(String(item.route ?? ''))) {
          await rollbackCreated(caregiverId, createdTreatmentIds, createdMedicationIds);
          return {
            ok: false,
            code: 'VALIDATION',
            fields: { route: 'Escolha a via.' },
            index,
          };
        }
        const treatmentBody = {
          patientId: row.patient_id,
          medicationId,
          doseQuantity: item.doseQuantity,
          route: item.route,
          scheduleMode: item.scheduleMode,
          intervalHours: item.intervalHours,
          timesOfDay: item.timesOfDay,
          startsAt: item.startsAt,
          endsOn: item.endsOn || null,
          alarmsEnabled: item.alarmsEnabled !== false,
        };
        const treatmentParsed = parseTreatmentBody(treatmentBody);
        if (!treatmentParsed.ok) {
          await rollbackCreated(caregiverId, createdTreatmentIds, createdMedicationIds);
          return {
            ok: false,
            code: 'VALIDATION',
            fields: treatmentParsed.fields,
            index,
          };
        }
        const treatment = await createTreatment(caregiverId, treatmentParsed.value);
        if (!treatment.ok) {
          await rollbackCreated(caregiverId, createdTreatmentIds, createdMedicationIds);
          return { ok: false, code: 'VALIDATION', message: 'Não foi possível criar o tratamento.' };
        }
        const raw = typeof item.posologyRaw === 'string' ? item.posologyRaw.slice(0, 500) : '';
        const origin = posologyOrigin(item, extractedItems[index] ?? null);
        await getPool().query(
          `UPDATE treatments
           SET posology_origin = $3,
               posology_raw = NULLIF($4, '')
           WHERE id = $1 AND caregiver_id = $2`,
          [treatment.treatment.id, caregiverId, origin, raw],
        );
        createdTreatmentIds.push(treatment.treatment.id);
      }
    }

    const settings = readAiSettings();
    const purge =
      row.document_kind === 'prescription'
        ? settings.prescriptionRetainDays <= 0
          ? new Date()
          : new Date(Date.now() + settings.prescriptionRetainDays * 24 * 60 * 60 * 1000)
        : new Date();
    await getPool().query(
      `UPDATE medication_drafts
       SET status = 'confirmed',
           confirmed_medication_ids = $3,
           confirmed_treatment_ids = $4,
           image_purge_at = $5,
           updated_at = now()
       WHERE id = $1 AND caregiver_id = $2 AND status = 'ready'`,
      [
        draftId,
        caregiverId,
        medicationIds,
        createdTreatmentIds,
        purge,
      ],
    );

    if (row.document_kind === 'package' && row.image_path) {
      const absolute = resolveIntakeAbsolutePath(row.image_path);
      const buffer = await readFile(absolute);
      for (const target of photoTargets) {
        await saveMedicationPhoto(caregiverId, target.id, {
          buffer,
          mimetype: row.mime_type,
        });
      }
    }

    if (row.document_kind !== 'prescription' || settings.prescriptionRetainDays <= 0) {
      if (row.image_path) {
        await unlink(resolveIntakeAbsolutePath(row.image_path)).catch(() => {});
      }
      await getPool().query(
        `UPDATE medication_drafts
         SET image_path = ''
         WHERE id = $1 AND caregiver_id = $2`,
        [draftId, caregiverId],
      );
    }

    return {
      ok: true,
      already: false,
      medicationIds,
      treatmentIds: createdTreatmentIds,
    };
  } catch (err) {
    await rollbackCreated(caregiverId, createdTreatmentIds, createdMedicationIds);
    throw err;
  }
}

/**
 * @param {string} caregiverId
 * @param {string[]} treatmentIds
 * @param {string[]} medicationIds
 */
async function rollbackCreated(caregiverId, treatmentIds, medicationIds) {
  const pool = getPool();
  for (const id of treatmentIds) {
    await pool.query(
      `DELETE FROM treatments WHERE id = $1 AND caregiver_id = $2`,
      [id, caregiverId],
    );
  }
  for (const id of medicationIds) {
    await pool.query(
      `DELETE FROM medications WHERE id = $1 AND caregiver_id = $2`,
      [id, caregiverId],
    );
  }
}

let lastPurge = 0;

export async function purgeExpiredIntakes() {
  const now = Date.now();
  if (now - lastPurge < 15 * 60 * 1000) return { purged: 0 };
  const pool = getPool();
  await pool.query(
    `UPDATE medication_drafts
     SET status = 'failed',
         error_code = 'AI_TIMEOUT',
         updated_at = now()
     WHERE status = 'processing'
       AND updated_at < now() - interval '2 minutes'`,
  );
  const due = await pool.query(
    `SELECT id, caregiver_id, image_path
     FROM medication_drafts
     WHERE image_path <> ''
       AND (
         (status IN ('ready', 'failed', 'discarded') AND expires_at < now())
         OR (status = 'confirmed' AND image_purge_at IS NOT NULL AND image_purge_at < now())
       )`,
  );
  for (const row of due.rows) {
    if (row.image_path) {
      await unlink(resolveIntakeAbsolutePath(row.image_path)).catch(() => {});
    }
    await pool.query(
      `UPDATE medication_drafts
       SET image_path = '',
           extracted = NULL,
           status = CASE WHEN status = 'confirmed' THEN 'confirmed' ELSE 'expired' END,
           updated_at = now()
       WHERE id = $1`,
      [row.id],
    );
  }
  lastPurge = Date.now();
  return { purged: due.rowCount ?? 0 };
}

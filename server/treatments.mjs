import { getPool } from './db.mjs';
import { asString, isValidTime } from './patients.mjs';
import {
  alarmAtFor,
  computeRange,
  courseTooLong,
  formatZonedIso,
  generateDoses,
  needsExtension,
  nextRollingEnd,
  parseTimesOfDay,
  suggestFirstDose,
  toZoned,
} from './domain/schedule.mjs';
import {
  civilDate,
  endOfDaySaoPaulo,
  zonedToDate,
} from './domain/timezone.mjs';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ROUTES = new Set([
  'VO',
  'SL',
  'IM',
  'EV',
  'SC',
  'tópica',
  'inalatória',
  'retal',
  'ocular',
  'nasal',
  'outra',
]);

/**
 * @param {unknown} value
 */
function formatTimePg(value) {
  if (value instanceof Date) {
    return `${String(value.getUTCHours()).padStart(2, '0')}:${String(value.getUTCMinutes()).padStart(2, '0')}`;
  }
  const s = String(value);
  return s.slice(0, 5);
}

/**
 * @param {{
 *   id: string,
 *   caregiver_id: string,
 *   patient_id: string,
 *   medication_id: string,
 *   starts_at: Date | string,
 *   ends_on: string | Date | null,
 *   ended_at: Date | string | null,
 *   end_reason?: string | null,
 *   status: string,
 *   dose_quantity: string,
 *   route: string,
 *   schedule_mode: string,
 *   interval_hours: number | null,
 *   times_of_day: unknown,
 *   alarms_enabled: boolean,
 *   generated_until: Date | string | null,
 *   created_at: Date | string,
 *   updated_at: Date | string,
 *   patient_name?: string,
 *   medication_name?: string,
 * }} row
 */
export function mapTreatment(row) {
  const endsOn =
    row.ends_on == null
      ? null
      : row.ends_on instanceof Date
        ? row.ends_on.toISOString().slice(0, 10)
        : String(row.ends_on).slice(0, 10);

  /** @type {string[] | null} */
  let timesOfDay = null;
  if (Array.isArray(row.times_of_day)) {
    timesOfDay = row.times_of_day.map((t) => formatTimePg(t));
  }

  return {
    id: row.id,
    caregiverId: row.caregiver_id,
    patientId: row.patient_id,
    medicationId: row.medication_id,
    startsAt: formatZonedIso(toZoned(row.starts_at)),
    endsOn,
    endedAt: row.ended_at
      ? formatZonedIso(toZoned(row.ended_at))
      : null,
    endReason: row.end_reason ?? null,
    status: row.status,
    doseQuantity: row.dose_quantity,
    route: row.route,
    scheduleMode: row.schedule_mode,
    intervalHours: row.interval_hours,
    timesOfDay,
    alarmsEnabled: row.alarms_enabled,
    generatedUntil: row.generated_until
      ? formatZonedIso(toZoned(row.generated_until))
      : null,
    createdAt: formatZonedIso(toZoned(row.created_at)),
    updatedAt: formatZonedIso(toZoned(row.updated_at)),
    patientName: row.patient_name ?? undefined,
    medicationName: row.medication_name ?? undefined,
  };
}

/**
 * @param {{
 *   id: string,
 *   treatment_id: string,
 *   caregiver_id: string,
 *   scheduled_at: Date | string,
 *   status: string,
 *   administered_at: Date | string | null,
 *   alarm_at: Date | string | null,
 * }} row
 */
export function mapDose(row) {
  return {
    id: row.id,
    treatmentId: row.treatment_id,
    caregiverId: row.caregiver_id,
    scheduledAt: formatZonedIso(toZoned(row.scheduled_at)),
    status: row.status,
    administeredAt: row.administered_at
      ? formatZonedIso(toZoned(row.administered_at))
      : null,
    alarmAt: row.alarm_at ? formatZonedIso(toZoned(row.alarm_at)) : null,
  };
}

const SELECT_TREATMENT = `
  t.id, t.caregiver_id, t.patient_id, t.medication_id,
  t.starts_at, t.ends_on, t.ended_at, t.end_reason, t.status,
  t.dose_quantity, t.route, t.schedule_mode, t.interval_hours,
  t.times_of_day, t.alarms_enabled, t.generated_until,
  t.created_at, t.updated_at,
  p.name AS patient_name,
  p.caregiver_id AS patient_caregiver_id,
  m.name AS medication_name
`;

/**
 * @param {string} caregiverId
 * @param {string} patientId
 */
export async function listTreatmentsForPatient(caregiverId, patientId) {
  const result = await getPool().query(
    `SELECT ${SELECT_TREATMENT}
     FROM treatments t
     JOIN patients p ON p.id = t.patient_id
     JOIN medications m ON m.id = t.medication_id
     WHERE t.caregiver_id = $1 AND t.patient_id = $2
     ORDER BY t.status ASC, t.starts_at DESC`,
    [caregiverId, patientId],
  );
  return result.rows.map(mapTreatment);
}

/**
 * @param {string} caregiverId
 * @param {string} treatmentId
 */
export async function getTreatment(caregiverId, treatmentId) {
  const result = await getPool().query(
    `SELECT ${SELECT_TREATMENT}
     FROM treatments t
     JOIN patients p ON p.id = t.patient_id
     JOIN medications m ON m.id = t.medication_id
     WHERE t.caregiver_id = $1 AND t.id = $2`,
    [caregiverId, treatmentId],
  );
  return result.rows[0] ? mapTreatment(result.rows[0]) : null;
}

/**
 * @param {Record<string, unknown>} body
 * @param {{ requireIds?: boolean }} [opts]
 */
export function parseTreatmentBody(body, opts = { requireIds: true }) {
  /** @type {Record<string, string>} */
  const fields = {};

  const patientId = asString(body.patientId).trim();
  const medicationId = asString(body.medicationId).trim();
  if (opts.requireIds !== false) {
    if (!UUID_RE.test(patientId)) fields.patientId = 'Paciente inválido.';
    if (!UUID_RE.test(medicationId))
      fields.medicationId = 'Medicamento inválido.';
  }

  const doseQuantity = asString(body.doseQuantity).trim();
  if (!doseQuantity) fields.doseQuantity = 'Informe a quantidade da dose.';
  else if (doseQuantity.length > 120)
    fields.doseQuantity = 'Quantidade muito longa.';

  const route = asString(body.route).trim();
  if (!route) fields.route = 'Informe a via.';
  else if (!ROUTES.has(route) && route.length > 40)
    fields.route = 'Via inválida.';

  const scheduleMode = asString(body.scheduleMode).trim();
  if (
    scheduleMode !== 'regular_interval' &&
    scheduleMode !== 'custom_times'
  ) {
    fields.scheduleMode = 'Escolha o modo de esquema.';
  }

  let startsAt = /** @type {Date | null} */ (null);
  const startsAtRaw = asString(body.startsAt).trim();
  if (!startsAtRaw) {
    fields.startsAt = 'Informe data/hora de início.';
  } else {
    const parsed = Date.parse(startsAtRaw);
    if (Number.isNaN(parsed)) fields.startsAt = 'Início inválido.';
    else startsAt = new Date(parsed);
  }

  /** @type {string | null} */
  let endsOn = null;
  if (body.endsOn != null && body.endsOn !== '') {
    const raw = asString(body.endsOn).trim();
    if (!DATE_RE.test(raw)) fields.endsOn = 'Data de fim inválida.';
    else endsOn = raw;
  }

  /** @type {number | null} */
  let intervalHours = null;
  /** @type {string[] | null} */
  let timesOfDay = null;

  if (scheduleMode === 'regular_interval') {
    const n = Number(body.intervalHours);
    if (!Number.isInteger(n) || n <= 0) {
      fields.intervalHours = 'Informe o intervalo em horas (> 0).';
    } else if (n > 24 * 14) {
      fields.intervalHours = 'Intervalo muito grande.';
    } else {
      intervalHours = n;
    }
  }

  if (scheduleMode === 'custom_times') {
    const rawTimes = Array.isArray(body.timesOfDay) ? body.timesOfDay : [];
    const parsed = parseTimesOfDay(
      rawTimes.map((t) => asString(t).trim()),
    );
    if (!parsed.ok) {
      if (parsed.code === 'DUPLICATE_TIME') {
        fields.timesOfDay = 'Horários duplicados.';
      } else if (parsed.code === 'EMPTY_TIMES') {
        fields.timesOfDay = 'Informe ao menos um horário.';
      } else {
        fields.timesOfDay = 'Horário inválido (use HH:MM).';
      }
    } else {
      timesOfDay = parsed.times;
    }
  }

  const alarmsEnabled =
    body.alarmsEnabled === undefined ? true : Boolean(body.alarmsEnabled);

  if (startsAt && endsOn && courseTooLong(startsAt, endsOn)) {
    fields.endsOn = 'Curso maior que 366 dias.';
  }

  if (Object.keys(fields).length > 0) {
    return { ok: false, fields };
  }

  return {
    ok: true,
    value: {
      patientId,
      medicationId,
      doseQuantity,
      route: ROUTES.has(route) ? route : route,
      scheduleMode: /** @type {'regular_interval'|'custom_times'} */ (
        scheduleMode
      ),
      startsAt: /** @type {Date} */ (startsAt),
      endsOn,
      intervalHours,
      timesOfDay,
      alarmsEnabled,
    },
  };
}

/**
 * Build preview without persisting.
 * @param {{
 *   scheduleMode: 'regular_interval' | 'custom_times',
 *   startsAt: Date,
 *   endsOn: string | null,
 *   intervalHours: number | null,
 *   timesOfDay: string[] | null,
 * }} input
 * @param {Date} [now]
 */
export function buildPreview(input, now = new Date()) {
  const range = computeRange(input.startsAt, input.endsOn, now);
  const doses = generateDoses(
    {
      scheduleMode: input.scheduleMode,
      startsAt: input.startsAt,
      endsOn: input.endsOn,
      intervalHours: input.intervalHours,
      timesOfDay: input.timesOfDay,
    },
    range.rangeStart,
    range.rangeEnd,
  );
  return {
    doses: doses.map((d) => ({
      scheduledAt: formatZonedIso(toZoned(d.scheduledAt)),
    })),
    rangeStart: range.rangeStartIso,
    rangeEnd: range.rangeEndIso,
    truncatedBackfill: range.truncatedBackfill,
    doseCount: doses.length,
  };
}

/**
 * @param {string} caregiverId
 * @param {ReturnType<typeof parseTreatmentBody> extends { ok: true, value: infer V } ? V : never} input
 */
export async function createTreatment(caregiverId, input) {
  const pool = getPool();

  const patient = await pool.query(
    `SELECT id, sleep_start, sleep_end FROM patients
     WHERE id = $1 AND caregiver_id = $2`,
    [input.patientId, caregiverId],
  );
  if (!patient.rows[0]) return { ok: false, code: 'PATIENT_NOT_FOUND' };

  const medication = await pool.query(
    `SELECT id FROM medications WHERE id = $1 AND caregiver_id = $2`,
    [input.medicationId, caregiverId],
  );
  if (!medication.rows[0]) return { ok: false, code: 'MEDICATION_NOT_FOUND' };

  const range = computeRange(input.startsAt, input.endsOn);
  const drafts = generateDoses(
    {
      scheduleMode: input.scheduleMode,
      startsAt: input.startsAt,
      endsOn: input.endsOn,
      intervalHours: input.intervalHours,
      timesOfDay: input.timesOfDay,
    },
    range.rangeStart,
    range.rangeEnd,
  );

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inserted = await client.query(
      `INSERT INTO treatments (
         caregiver_id, patient_id, medication_id,
         starts_at, ends_on, status,
         dose_quantity, route, schedule_mode,
         interval_hours, times_of_day, alarms_enabled,
         generated_until
       ) VALUES (
         $1,$2,$3,$4,$5,'active',$6,$7,$8,$9,$10,$11,$12
       )
       RETURNING id`,
      [
        caregiverId,
        input.patientId,
        input.medicationId,
        input.startsAt,
        input.endsOn,
        input.doseQuantity,
        input.route,
        input.scheduleMode,
        input.intervalHours,
        input.timesOfDay,
        input.alarmsEnabled,
        range.rangeEnd,
      ],
    );
    const treatmentId = inserted.rows[0].id;

    if (drafts.length > 0) {
      const values = [];
      const params = [];
      let i = 1;
      for (const d of drafts) {
        const alarmAt = alarmAtFor(d.scheduledAt, input.alarmsEnabled);
        values.push(
          `($${i++},$${i++},$${i++},'pending',$${i++})`,
        );
        params.push(treatmentId, caregiverId, d.scheduledAt, alarmAt);
      }
      await client.query(
        `INSERT INTO scheduled_doses
           (treatment_id, caregiver_id, scheduled_at, status, alarm_at)
         VALUES ${values.join(',')}
         ON CONFLICT (treatment_id, scheduled_at) DO NOTHING`,
        params,
      );
    }

    await client.query('COMMIT');
    const treatment = await getTreatment(caregiverId, treatmentId);
    return {
      ok: true,
      treatment,
      doseCount: drafts.length,
      truncatedBackfill: range.truncatedBackfill,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * @param {string} caregiverId
 * @param {string} treatmentId
 * @param {Record<string, unknown>} body
 */
export async function patchTreatment(caregiverId, treatmentId, body) {
  const existing = await getTreatmentRow(caregiverId, treatmentId);
  if (!existing) return { ok: false, code: 'NOT_FOUND' };
  if (existing.status !== 'active') {
    return { ok: false, code: 'ENDED' };
  }

  const blocked = ['scheduleMode', 'intervalHours', 'timesOfDay', 'startsAt'];
  for (const key of blocked) {
    if (body[key] !== undefined) {
      return { ok: false, code: 'CONFLICT', message: 'Altere o esquema encerrando e recriando o tratamento.' };
    }
  }

  /** @type {Record<string, string>} */
  const fields = {};
  /** @type {string[]} */
  const sets = [];
  /** @type {unknown[]} */
  const params = [];
  let i = 1;

  if (body.doseQuantity !== undefined) {
    const q = asString(body.doseQuantity).trim();
    if (!q) fields.doseQuantity = 'Informe a quantidade da dose.';
    else {
      sets.push(`dose_quantity = $${i++}`);
      params.push(q);
    }
  }

  if (body.route !== undefined) {
    const r = asString(body.route).trim();
    if (!r) fields.route = 'Informe a via.';
    else {
      sets.push(`route = $${i++}`);
      params.push(r);
    }
  }

  if (body.alarmsEnabled !== undefined) {
    sets.push(`alarms_enabled = $${i++}`);
    params.push(Boolean(body.alarmsEnabled));
  }

  let newEndsOn = existing.ends_on
    ? existing.ends_on instanceof Date
      ? existing.ends_on.toISOString().slice(0, 10)
      : String(existing.ends_on).slice(0, 10)
    : null;
  let endsOnChanged = false;

  if (body.endsOn !== undefined) {
    endsOnChanged = true;
    if (body.endsOn === null || body.endsOn === '') {
      newEndsOn = null;
    } else {
      const raw = asString(body.endsOn).trim();
      if (!DATE_RE.test(raw)) fields.endsOn = 'Data de fim inválida.';
      else if (courseTooLong(existing.starts_at, raw))
        fields.endsOn = 'Curso maior que 366 dias.';
      else newEndsOn = raw;
    }
    if (!fields.endsOn) {
      sets.push(`ends_on = $${i++}`);
      params.push(newEndsOn);
    }
  }

  if (Object.keys(fields).length > 0) {
    return { ok: false, code: 'VALIDATION', fields };
  }

  if (sets.length === 0) {
    return { ok: true, treatment: mapTreatment(existing) };
  }

  sets.push('updated_at = now()');
  params.push(caregiverId, treatmentId);

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE treatments SET ${sets.join(', ')}
       WHERE caregiver_id = $${i++} AND id = $${i++}`,
      params,
    );

    if (endsOnChanged) {
      const startsAt = new Date(existing.starts_at);
      if (newEndsOn) {
        const range = computeRange(startsAt, newEndsOn);
        // Cancel pending after new end
        await client.query(
          `UPDATE scheduled_doses
           SET status = 'cancelled', updated_at = now()
           WHERE treatment_id = $1
             AND status = 'pending'
             AND scheduled_at > $2`,
          [treatmentId, range.rangeEnd],
        );
        // Generate up to new end
        const drafts = generateDoses(
          {
            scheduleMode: existing.schedule_mode,
            startsAt,
            endsOn: newEndsOn,
            intervalHours: existing.interval_hours,
            timesOfDay: Array.isArray(existing.times_of_day)
              ? existing.times_of_day.map((t) => formatTimePg(t))
              : null,
          },
          range.rangeStart,
          range.rangeEnd,
        );
        await insertDoseDrafts(
          client,
          treatmentId,
          caregiverId,
          drafts,
          existing.alarms_enabled,
        );
        await client.query(
          `UPDATE treatments SET generated_until = $1, updated_at = now()
           WHERE id = $2`,
          [range.rangeEnd, treatmentId],
        );
      } else {
        // Became continuous: rolling window
        const range = computeRange(startsAt, null);
        const drafts = generateDoses(
          {
            scheduleMode: existing.schedule_mode,
            startsAt,
            endsOn: null,
            intervalHours: existing.interval_hours,
            timesOfDay: Array.isArray(existing.times_of_day)
              ? existing.times_of_day.map((t) => formatTimePg(t))
              : null,
          },
          range.rangeStart,
          range.rangeEnd,
        );
        await insertDoseDrafts(
          client,
          treatmentId,
          caregiverId,
          drafts,
          existing.alarms_enabled,
        );
        await client.query(
          `UPDATE treatments SET generated_until = $1, updated_at = now()
           WHERE id = $2`,
          [range.rangeEnd, treatmentId],
        );
      }
    }

    if (body.alarmsEnabled !== undefined) {
      const enabled = Boolean(body.alarmsEnabled);
      if (enabled) {
        await client.query(
          `UPDATE scheduled_doses
           SET alarm_at = scheduled_at - interval '5 minutes', updated_at = now()
           WHERE treatment_id = $1 AND status = 'pending' AND alarm_sent_at IS NULL`,
          [treatmentId],
        );
      } else {
        await client.query(
          `UPDATE scheduled_doses
           SET alarm_at = NULL, updated_at = now()
           WHERE treatment_id = $1 AND status = 'pending' AND alarm_sent_at IS NULL`,
          [treatmentId],
        );
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const treatment = await getTreatment(caregiverId, treatmentId);
  return { ok: true, treatment };
}

const END_REASON_MAX = 500;

/**
 * @param {string} ymd
 */
function isCivilDate(ymd) {
  try {
    return Temporal.PlainDate.from(ymd).toString() === ymd;
  } catch {
    return false;
  }
}

/**
 * @param {string} endedOn YYYY-MM-DD
 * @param {Date} now
 */
function endedAtInstant(endedOn, now) {
  if (endedOn < civilDate(now)) {
    return zonedToDate(endOfDaySaoPaulo(endedOn));
  }
  return now;
}

/**
 * @param {Record<string, unknown>} body
 * @param {{ startsAt: Date | string, now?: Date }} ctx
 */
export function parseEndTreatmentBody(body, ctx) {
  /** @type {Record<string, string>} */
  const fields = {};
  const now = ctx.now ?? new Date();
  const today = civilDate(now);
  const startCivil = civilDate(
    ctx.startsAt instanceof Date ? ctx.startsAt : new Date(ctx.startsAt),
  );

  /** @type {string} */
  let endedOn;
  if (body.endedOn == null || body.endedOn === '') {
    endedOn = today;
  } else {
    const raw = asString(body.endedOn).trim();
    if (!DATE_RE.test(raw) || !isCivilDate(raw)) {
      fields.endedOn = 'Data de término inválida.';
      endedOn = '';
    } else {
      endedOn = raw;
    }
  }

  if (endedOn && endedOn > today) {
    fields.endedOn = 'A data de término não pode ser no futuro.';
  } else if (
    endedOn &&
    endedOn < startCivil &&
    !(endedOn === today && startCivil > today)
  ) {
    fields.endedOn =
      'A data de término é anterior ao início do tratamento.';
  }

  /** @type {string | null} */
  let endReason = null;
  if (body.endReason != null && body.endReason !== '') {
    if (typeof body.endReason !== 'string') {
      fields.endReason = 'Motivo inválido.';
    } else {
      const raw = body.endReason.trim();
      if (raw.length > END_REASON_MAX) {
        fields.endReason = 'Motivo muito longo (máximo 500 caracteres).';
      } else if (raw.length > 0) {
        endReason = raw;
      }
    }
  }

  if (Object.keys(fields).length > 0) {
    return { ok: false, fields };
  }

  return {
    ok: true,
    value: {
      endedOn,
      endReason,
      endedAt: endedAtInstant(endedOn, now),
    },
  };
}

/**
 * Mark the patient↔medication link ended. History stays.
 * Future pending doses are cancelled; remaining pending doses stop alarming.
 * @param {string} caregiverId
 * @param {string} treatmentId
 * @param {Record<string, unknown>} [body]
 */
export async function endTreatment(caregiverId, treatmentId, body = {}) {
  const existing = await getTreatmentRow(caregiverId, treatmentId);
  if (!existing || existing.patient_caregiver_id !== caregiverId) {
    return { ok: false, code: 'NOT_FOUND' };
  }
  if (existing.status !== 'active') {
    return { ok: false, code: 'ENDED' };
  }

  const parsed = parseEndTreatmentBody(body, { startsAt: existing.starts_at });
  if (!parsed.ok) {
    return { ok: false, code: 'VALIDATION', fields: parsed.fields };
  }

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updated = await client.query(
      `UPDATE treatments
       SET status = 'ended',
           ended_at = $3,
           end_reason = $4,
           updated_at = now()
       WHERE id = $1
         AND caregiver_id = $2
         AND status = 'active'
         AND EXISTS (
           SELECT 1 FROM patients p
           WHERE p.id = treatments.patient_id
             AND p.caregiver_id = $2
         )
       RETURNING id`,
      [
        treatmentId,
        caregiverId,
        parsed.value.endedAt,
        parsed.value.endReason,
      ],
    );
    if ((updated.rowCount ?? 0) === 0) {
      await client.query('ROLLBACK');
      const exists = await getTreatment(caregiverId, treatmentId);
      return exists
        ? { ok: false, code: 'ENDED' }
        : { ok: false, code: 'NOT_FOUND' };
    }

    await client.query(
      `UPDATE scheduled_doses
       SET status = 'cancelled', alarm_at = NULL, updated_at = now()
       WHERE treatment_id = $1
         AND status = 'pending'
         AND scheduled_at > $2`,
      [treatmentId, parsed.value.endedAt],
    );
    await client.query(
      `UPDATE scheduled_doses
       SET alarm_at = NULL, updated_at = now()
       WHERE treatment_id = $1
         AND status = 'pending'
         AND alarm_sent_at IS NULL`,
      [treatmentId],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const treatment = await getTreatment(caregiverId, treatmentId);
  return { ok: true, treatment };
}

/**
 * Hard-delete a treatment and its doses/notes. For a mistaken registration.
 * Order is explicit so the link disappears even if a future migration
 * drops ON DELETE CASCADE.
 * @param {string} caregiverId
 * @param {string} treatmentId
 */
export async function deleteTreatment(caregiverId, treatmentId) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const locked = await client.query(
      `SELECT t.id
       FROM treatments t
       JOIN patients p ON p.id = t.patient_id
       WHERE t.id = $1
         AND t.caregiver_id = $2
         AND p.caregiver_id = $2
       FOR UPDATE OF t`,
      [treatmentId, caregiverId],
    );
    if ((locked.rowCount ?? 0) === 0) {
      await client.query('ROLLBACK');
      return { ok: false, code: 'NOT_FOUND' };
    }

    await client.query(
      `DELETE FROM notes
       WHERE treatment_id = $1
          OR scheduled_dose_id IN (
            SELECT id FROM scheduled_doses WHERE treatment_id = $1
          )`,
      [treatmentId],
    );
    await client.query(
      `DELETE FROM scheduled_doses WHERE treatment_id = $1`,
      [treatmentId],
    );
    const deleted = await client.query(
      `DELETE FROM treatments
       WHERE id = $1 AND caregiver_id = $2
       RETURNING id`,
      [treatmentId, caregiverId],
    );
    if ((deleted.rowCount ?? 0) === 0) {
      await client.query('ROLLBACK');
      return { ok: false, code: 'NOT_FOUND' };
    }
    await client.query('COMMIT');
    return { ok: true };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * @param {string} caregiverId
 * @param {string} treatmentId
 * @param {{ from?: string, to?: string, includeCancelled?: boolean }} query
 */
export async function listDoses(caregiverId, treatmentId, query = {}) {
  const treatment = await getTreatment(caregiverId, treatmentId);
  if (!treatment) return { ok: false, code: 'NOT_FOUND' };

  // Extend continuous window if needed
  if (treatment.status === 'active' && !treatment.endsOn) {
    await maybeExtendTreatment(caregiverId, treatmentId);
  }

  const params = [caregiverId, treatmentId];
  let i = 3;
  /** @type {string[]} */
  const clauses = ['caregiver_id = $1', 'treatment_id = $2'];

  if (!query.includeCancelled) {
    clauses.push(`status <> 'cancelled'`);
  }
  if (query.from) {
    clauses.push(`scheduled_at >= $${i++}`);
    params.push(new Date(query.from));
  }
  if (query.to) {
    clauses.push(`scheduled_at <= $${i++}`);
    params.push(new Date(query.to));
  }

  const result = await getPool().query(
    `SELECT id, treatment_id, caregiver_id, scheduled_at, status,
            administered_at, alarm_at
     FROM scheduled_doses
     WHERE ${clauses.join(' AND ')}
     ORDER BY scheduled_at ASC`,
    params,
  );

  return {
    ok: true,
    treatment,
    doses: result.rows.map(mapDose),
  };
}

/**
 * @param {string} caregiverId
 * @param {string} treatmentId
 */
export async function maybeExtendTreatment(caregiverId, treatmentId) {
  const row = await getTreatmentRow(caregiverId, treatmentId);
  if (!row || row.status !== 'active' || row.ends_on != null) return;

  const generatedUntil = row.generated_until
    ? new Date(row.generated_until)
    : null;
  if (!needsExtension(generatedUntil)) return;

  const startsAt = new Date(row.starts_at);
  const rangeEnd = nextRollingEnd(startsAt, generatedUntil);
  const rangeStart = generatedUntil ?? startsAt;

  const drafts = generateDoses(
    {
      scheduleMode: row.schedule_mode,
      startsAt,
      endsOn: null,
      intervalHours: row.interval_hours,
      timesOfDay: Array.isArray(row.times_of_day)
        ? row.times_of_day.map((t) => formatTimePg(t))
        : null,
    },
    rangeStart,
    rangeEnd,
  );

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await insertDoseDrafts(
      client,
      treatmentId,
      caregiverId,
      drafts,
      row.alarms_enabled,
    );
    await client.query(
      `UPDATE treatments SET generated_until = $1, updated_at = now()
       WHERE id = $2 AND caregiver_id = $3`,
      [rangeEnd, treatmentId, caregiverId],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * @param {import('pg').PoolClient} client
 * @param {string} treatmentId
 * @param {string} caregiverId
 * @param {{ scheduledAt: Date }[]} drafts
 * @param {boolean} alarmsEnabled
 */
async function insertDoseDrafts(
  client,
  treatmentId,
  caregiverId,
  drafts,
  alarmsEnabled,
) {
  if (drafts.length === 0) return;
  const values = [];
  const params = [];
  let i = 1;
  for (const d of drafts) {
    const alarmAt = alarmAtFor(d.scheduledAt, alarmsEnabled);
    values.push(`($${i++},$${i++},$${i++},'pending',$${i++})`);
    params.push(treatmentId, caregiverId, d.scheduledAt, alarmAt);
  }
  await client.query(
    `INSERT INTO scheduled_doses
       (treatment_id, caregiver_id, scheduled_at, status, alarm_at)
     VALUES ${values.join(',')}
     ON CONFLICT (treatment_id, scheduled_at) DO NOTHING`,
    params,
  );
}

/**
 * @param {string} caregiverId
 * @param {string} treatmentId
 */
async function getTreatmentRow(caregiverId, treatmentId) {
  const result = await getPool().query(
    `SELECT ${SELECT_TREATMENT}
     FROM treatments t
     JOIN patients p ON p.id = t.patient_id
     JOIN medications m ON m.id = t.medication_id
     WHERE t.caregiver_id = $1 AND t.id = $2`,
    [caregiverId, treatmentId],
  );
  return result.rows[0] ?? null;
}

/**
 * @param {Record<string, unknown>} body
 */
export function parseSuggestBody(body) {
  /** @type {Record<string, string>} */
  const fields = {};
  const n = Number(body.intervalHours);
  if (!Number.isInteger(n) || n <= 0) {
    fields.intervalHours = 'Informe o intervalo em horas (> 0).';
  }

  let sleepStart = '22:00';
  let sleepEnd = '07:00';
  if (body.sleepStart != null && body.sleepStart !== '') {
    const s = asString(body.sleepStart).trim();
    if (!isValidTime(s)) fields.sleepStart = 'Horário inválido.';
    else sleepStart = s;
  }
  if (body.sleepEnd != null && body.sleepEnd !== '') {
    const s = asString(body.sleepEnd).trim();
    if (!isValidTime(s)) fields.sleepEnd = 'Horário inválido.';
    else sleepEnd = s;
  }

  /** @type {string | undefined} */
  let anchorDate;
  if (body.anchorDate != null && body.anchorDate !== '') {
    const a = asString(body.anchorDate).trim();
    if (!DATE_RE.test(a)) fields.anchorDate = 'Data inválida.';
    else anchorDate = a;
  }

  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return {
    ok: true,
    value: {
      intervalHours: n,
      sleepStart,
      sleepEnd,
      anchorDate,
    },
  };
}

export { suggestFirstDose, UUID_RE, ROUTES };

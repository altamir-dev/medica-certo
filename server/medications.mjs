import { existsSync } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from './config.mjs';
import { getPool } from './db.mjs';
import { asString } from './patients.mjs';

const PG_UNIQUE_VIOLATION = '23505';

/** Shared with routes multipart limit. */
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

const ALLOWED_PHOTO_MIME = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

/**
 * Escape `\`, `%`, `_` for Postgres ILIKE … ESCAPE '\\'.
 * @param {string} value
 */
export function escapeIlike(value) {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * @param {Buffer} buffer
 * @param {string} mimetype
 */
export function matchesImageMagic(buffer, mimetype) {
  if (!buffer || buffer.length < 12) return false;
  if (mimetype === 'image/jpeg') {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (mimetype === 'image/png') {
    return (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a
    );
  }
  if (mimetype === 'image/webp') {
    return (
      buffer[0] === 0x52 &&
      buffer[1] === 0x49 &&
      buffer[2] === 0x46 &&
      buffer[3] === 0x46 &&
      buffer[8] === 0x57 &&
      buffer[9] === 0x45 &&
      buffer[10] === 0x42 &&
      buffer[11] === 0x50
    );
  }
  return false;
}

/**
 * @param {{ id: string, name: string, active_ingredient: string | null, indication: string | null, reference_posology: string | null, usual_interval_hours: number | null, photo_path: string | null, created_at: Date | string, updated_at: Date | string }} row
 */
export function mapMedication(row) {
  return {
    id: row.id,
    name: row.name,
    activeIngredient: row.active_ingredient ?? '',
    indication: row.indication ?? '',
    referencePosology: row.reference_posology ?? '',
    usualIntervalHours:
      row.usual_interval_hours === null || row.usual_interval_hours === undefined
        ? null
        : Number(row.usual_interval_hours),
    hasPhoto: Boolean(row.photo_path),
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
    updatedAt:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : String(row.updated_at),
  };
}

const SELECT_COLS = `id, name, active_ingredient, indication, reference_posology,
  usual_interval_hours, photo_path, created_at, updated_at`;

/**
 * @param {string} caregiverId
 * @param {string} [q]
 */
export async function listMedications(caregiverId, q) {
  const query = typeof q === 'string' ? q.trim() : '';
  if (!query) {
    const result = await getPool().query(
      `SELECT ${SELECT_COLS}
       FROM medications
       WHERE caregiver_id = $1
       ORDER BY lower(name) ASC, created_at ASC`,
      [caregiverId],
    );
    return result.rows.map(mapMedication);
  }

  const pattern = `%${escapeIlike(query)}%`;
  const result = await getPool().query(
    `SELECT ${SELECT_COLS}
     FROM medications
     WHERE caregiver_id = $1
       AND (
         name ILIKE $2 ESCAPE '\\'
         OR coalesce(active_ingredient, '') ILIKE $2 ESCAPE '\\'
       )
     ORDER BY lower(name) ASC, created_at ASC`,
    [caregiverId, pattern],
  );
  return result.rows.map(mapMedication);
}

/**
 * @param {string} caregiverId
 * @param {string} medicationId
 */
export async function getMedication(caregiverId, medicationId) {
  const result = await getPool().query(
    `SELECT ${SELECT_COLS}
     FROM medications
     WHERE id = $1 AND caregiver_id = $2`,
    [medicationId, caregiverId],
  );
  return result.rows[0] ? mapMedication(result.rows[0]) : null;
}

/**
 * @param {string} caregiverId
 * @param {string} name
 */
async function findMedicationIdByName(caregiverId, name) {
  const result = await getPool().query(
    `SELECT id FROM medications
     WHERE caregiver_id = $1 AND lower(name) = lower($2)
     LIMIT 1`,
    [caregiverId, name],
  );
  return result.rows[0]?.id ?? null;
}

/**
 * @param {unknown} err
 */
function isUniqueViolation(err) {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    /** @type {{ code?: string }} */ (err).code === PG_UNIQUE_VIOLATION
  );
}

/**
 * @param {string} caregiverId
 * @param {{ name: string, activeIngredient: string, indication: string, referencePosology: string, usualIntervalHours: number | null }} input
 * @returns {Promise<{ ok: true, medication: ReturnType<typeof mapMedication> } | { ok: false, code: 'DUPLICATE_NAME', existingId: string | null }>}
 */
export async function createMedication(caregiverId, input) {
  try {
    const result = await getPool().query(
      `INSERT INTO medications (
         caregiver_id, name, active_ingredient, indication,
         reference_posology, usual_interval_hours
       )
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${SELECT_COLS}`,
      [
        caregiverId,
        input.name,
        input.activeIngredient || null,
        input.indication || null,
        input.referencePosology || null,
        input.usualIntervalHours,
      ],
    );
    return { ok: true, medication: mapMedication(result.rows[0]) };
  } catch (err) {
    if (isUniqueViolation(err)) {
      const existingId = await findMedicationIdByName(caregiverId, input.name);
      return { ok: false, code: 'DUPLICATE_NAME', existingId };
    }
    throw err;
  }
}

/**
 * @param {string} caregiverId
 * @param {string} medicationId
 * @param {{ name: string, activeIngredient: string, indication: string, referencePosology: string, usualIntervalHours: number | null }} input
 * @returns {Promise<{ ok: true, medication: ReturnType<typeof mapMedication> } | { ok: false, code: 'DUPLICATE_NAME', existingId: string | null } | { ok: false, code: 'NOT_FOUND' }>}
 */
export async function updateMedication(caregiverId, medicationId, input) {
  try {
    const result = await getPool().query(
      `UPDATE medications
       SET name = $3,
           active_ingredient = $4,
           indication = $5,
           reference_posology = $6,
           usual_interval_hours = $7,
           updated_at = now()
       WHERE id = $1 AND caregiver_id = $2
       RETURNING ${SELECT_COLS}`,
      [
        medicationId,
        caregiverId,
        input.name,
        input.activeIngredient || null,
        input.indication || null,
        input.referencePosology || null,
        input.usualIntervalHours,
      ],
    );
    if (!result.rows[0]) return { ok: false, code: 'NOT_FOUND' };
    return { ok: true, medication: mapMedication(result.rows[0]) };
  } catch (err) {
    if (isUniqueViolation(err)) {
      const existingId = await findMedicationIdByName(caregiverId, input.name);
      return { ok: false, code: 'DUPLICATE_NAME', existingId };
    }
    throw err;
  }
}

/**
 * KD21: block delete when an active treatment exists (table arrives in PR5).
 * @param {string} caregiverId
 * @param {string} medicationId
 */
export async function hasActiveTreatmentsForMedication(
  caregiverId,
  medicationId,
) {
  const pool = getPool();
  const reg = await pool.query(
    `SELECT to_regclass('public.treatments') AS reg`,
  );
  if (!reg.rows[0]?.reg) return false;

  const result = await pool.query(
    `SELECT 1
     FROM treatments
     WHERE medication_id = $1
       AND caregiver_id = $2
       AND status = 'active'
     LIMIT 1`,
    [medicationId, caregiverId],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Absolute path under data/med-photos for a stored relative photo_path.
 * Throws if path escapes the med-photos root.
 * @param {string} relativePath
 */
export function resolvePhotoAbsolutePath(relativePath) {
  const root = resolve(config.dataDir, 'med-photos');
  const absolute = resolve(root, relativePath);
  if (!absolute.startsWith(root + '/') && absolute !== root) {
    throw new Error('Invalid photo path');
  }
  return absolute;
}

/**
 * @param {string | null | undefined} relativePath
 */
async function removePhotoFile(relativePath) {
  if (!relativePath) return;
  try {
    const absolute = resolvePhotoAbsolutePath(relativePath);
    if (existsSync(absolute)) await unlink(absolute);
  } catch {
    // best-effort cleanup
  }
}

/**
 * @param {string} caregiverId
 * @param {string} medicationId
 * @returns {Promise<'deleted' | 'not_found' | 'conflict'>}
 */
export async function deleteMedication(caregiverId, medicationId) {
  if (await hasActiveTreatmentsForMedication(caregiverId, medicationId)) {
    return 'conflict';
  }

  const result = await getPool().query(
    `DELETE FROM medications
     WHERE id = $1 AND caregiver_id = $2
     RETURNING photo_path`,
    [medicationId, caregiverId],
  );

  if ((result.rowCount ?? 0) === 0) return 'not_found';
  await removePhotoFile(result.rows[0].photo_path);
  return 'deleted';
}

/**
 * @param {string} caregiverId
 * @param {string} medicationId
 * @returns {Promise<{ absolutePath: string, contentType: string } | null>}
 */
export async function getMedicationPhotoStreamInfo(
  caregiverId,
  medicationId,
) {
  const result = await getPool().query(
    `SELECT photo_path FROM medications
     WHERE id = $1 AND caregiver_id = $2`,
    [medicationId, caregiverId],
  );
  const relative = result.rows[0]?.photo_path;
  if (!relative) return null;

  let absolute;
  try {
    absolute = resolvePhotoAbsolutePath(relative);
  } catch {
    return null;
  }
  if (!existsSync(absolute)) return null;

  const ext = extname(absolute).toLowerCase();
  const contentType =
    ext === '.png'
      ? 'image/png'
      : ext === '.webp'
        ? 'image/webp'
        : 'image/jpeg';

  return { absolutePath: absolute, contentType };
}

/**
 * @param {string} caregiverId
 * @param {string} medicationId
 * @param {{ buffer: Buffer, mimetype: string }} file
 * @returns {Promise<{ ok: true, medication: ReturnType<typeof mapMedication> } | { ok: false, code: 'NOT_FOUND' | 'VALIDATION', message?: string }>}
 */
export async function saveMedicationPhoto(caregiverId, medicationId, file) {
  const ext = ALLOWED_PHOTO_MIME[file.mimetype];
  if (!ext) {
    return {
      ok: false,
      code: 'VALIDATION',
      message: 'Use JPEG, PNG ou WebP.',
    };
  }
  if (!file.buffer || file.buffer.length === 0) {
    return {
      ok: false,
      code: 'VALIDATION',
      message: 'Arquivo de foto vazio.',
    };
  }
  if (file.buffer.length > MAX_PHOTO_BYTES) {
    return {
      ok: false,
      code: 'VALIDATION',
      message: 'Foto deve ter no máximo 2 MB.',
    };
  }
  if (!matchesImageMagic(file.buffer, file.mimetype)) {
    return {
      ok: false,
      code: 'VALIDATION',
      message: 'Arquivo não corresponde a uma imagem JPEG, PNG ou WebP.',
    };
  }

  const existing = await getPool().query(
    `SELECT photo_path FROM medications
     WHERE id = $1 AND caregiver_id = $2`,
    [medicationId, caregiverId],
  );
  if (!existing.rows[0]) return { ok: false, code: 'NOT_FOUND' };

  const oldPath = existing.rows[0].photo_path;
  const relative = `${caregiverId}/${randomUUID()}${ext}`;
  const absolute = resolvePhotoAbsolutePath(relative);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, file.buffer);

  let result;
  try {
    result = await getPool().query(
      `UPDATE medications
       SET photo_path = $3, updated_at = now()
       WHERE id = $1 AND caregiver_id = $2
       RETURNING ${SELECT_COLS}`,
      [medicationId, caregiverId, relative],
    );
  } catch (err) {
    await removePhotoFile(relative);
    throw err;
  }

  if (!result.rows[0]) {
    await removePhotoFile(relative);
    return { ok: false, code: 'NOT_FOUND' };
  }

  if (oldPath && oldPath !== relative) {
    await removePhotoFile(oldPath);
  }

  return { ok: true, medication: mapMedication(result.rows[0]) };
}

/**
 * @param {Record<string, unknown>} body
 * @returns {{ ok: true, value: { name: string, activeIngredient: string, indication: string, referencePosology: string, usualIntervalHours: number | null } } | { ok: false, fields: Record<string, string> }}
 */
export function parseMedicationBody(body) {
  /** @type {Record<string, string>} */
  const fields = {};

  const name = asString(body.name).trim();
  const activeIngredient = asString(body.activeIngredient).trim();
  const indication = asString(body.indication).trim();
  const referencePosology = asString(body.referencePosology).trim();

  if (!name) fields.name = 'Informe o nome.';
  else if (name.length > 120) fields.name = 'Nome muito longo.';

  if (activeIngredient.length > 200) {
    fields.activeIngredient = 'Princípio ativo muito longo.';
  }
  if (indication.length > 500) {
    fields.indication = 'Indicação muito longa.';
  }
  if (referencePosology.length > 2000) {
    fields.referencePosology = 'Posologia de referência muito longa.';
  }

  /** @type {number | null} */
  let usualIntervalHours = null;
  const rawInterval = body.usualIntervalHours;
  if (rawInterval !== null && rawInterval !== undefined && rawInterval !== '') {
    const n =
      typeof rawInterval === 'number'
        ? rawInterval
        : Number(asString(rawInterval).trim());
    if (!Number.isInteger(n) || n < 1 || n > 168) {
      fields.usualIntervalHours =
        'Informe um intervalo em horas entre 1 e 168.';
    } else {
      usualIntervalHours = n;
    }
  }

  if (Object.keys(fields).length > 0) {
    return { ok: false, fields };
  }

  return {
    ok: true,
    value: {
      name,
      activeIngredient,
      indication,
      referencePosology,
      usualIntervalHours,
    },
  };
}

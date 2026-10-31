import { getPool } from './db.mjs';
import {
  listAccessiblePatients,
  resolvePatientAccess,
} from './access.mjs';

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * @param {unknown} value
 */
export function asString(value) {
  return typeof value === 'string' ? value : '';
}

/**
 * @param {string} value
 */
export function isValidTime(value) {
  return TIME_RE.test(value);
}

/**
 * Today in America/Sao_Paulo as YYYY-MM-DD.
 */
export function todaySaoPaulo() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/**
 * @param {string} value
 */
export function isValidBirthDate(value) {
  if (!DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    return false;
  }
  return value < todaySaoPaulo();
}

/**
 * @param {{ id: string, name: string, birth_date: string | Date, sleep_start: string, sleep_end: string, created_at: Date | string, updated_at: Date | string }} row
 */
export function mapPatient(row) {
  const birthDate =
    row.birth_date instanceof Date
      ? row.birth_date.toISOString().slice(0, 10)
      : String(row.birth_date).slice(0, 10);

  return {
    id: row.id,
    name: row.name,
    birthDate,
    sleepStart: formatTime(row.sleep_start),
    sleepEnd: formatTime(row.sleep_end),
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

/**
 * pg may return time as '22:00:00' or Date.
 * @param {unknown} value
 */
function formatTime(value) {
  if (value instanceof Date) {
    const hh = String(value.getUTCHours()).padStart(2, '0');
    const mm = String(value.getUTCMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }
  const raw = String(value ?? '');
  const match = raw.match(/^(\d{2}):(\d{2})/);
  if (match) return `${match[1]}:${match[2]}`;
  return raw;
}

/**
 * @param {string} caregiverId
 */
export async function listPatients(caregiverId) {
  return listAccessiblePatients(caregiverId);
}

/**
 * @param {string} caregiverId
 * @param {string} patientId
 */
export async function getPatient(caregiverId, patientId) {
  const access = await resolvePatientAccess(caregiverId, patientId);
  return access?.patient ?? null;
}

/**
 * @param {string} caregiverId
 * @param {{ name: string, birthDate: string, sleepStart: string, sleepEnd: string }} input
 */
export async function createPatient(caregiverId, input) {
  const result = await getPool().query(
    `INSERT INTO patients (caregiver_id, name, birth_date, sleep_start, sleep_end)
     VALUES ($1, $2, $3::date, $4::time, $5::time)
     RETURNING id, name, birth_date, sleep_start, sleep_end, created_at, updated_at`,
    [
      caregiverId,
      input.name,
      input.birthDate,
      input.sleepStart,
      input.sleepEnd,
    ],
  );
  return mapPatient(result.rows[0]);
}

/**
 * @param {string} caregiverId
 * @param {string} patientId
 * @param {{ name: string, birthDate: string, sleepStart: string, sleepEnd: string }} input
 */
export async function updatePatient(caregiverId, patientId, input) {
  const result = await getPool().query(
    `UPDATE patients
     SET name = $3,
         birth_date = $4::date,
         sleep_start = $5::time,
         sleep_end = $6::time,
         updated_at = now()
     WHERE id = $1 AND caregiver_id = $2
     RETURNING id, name, birth_date, sleep_start, sleep_end, created_at, updated_at`,
    [
      patientId,
      caregiverId,
      input.name,
      input.birthDate,
      input.sleepStart,
      input.sleepEnd,
    ],
  );
  return result.rows[0] ? mapPatient(result.rows[0]) : null;
}

/**
 * KD21: block delete when an active treatment exists (table arrives in PR5).
 * @param {string} caregiverId
 * @param {string} patientId
 */
export async function hasActiveTreatments(caregiverId, patientId) {
  const pool = getPool();
  const reg = await pool.query(
    `SELECT to_regclass('public.treatments') AS reg`,
  );
  if (!reg.rows[0]?.reg) return false;

  const result = await pool.query(
    `SELECT 1
     FROM treatments
     WHERE patient_id = $1
       AND caregiver_id = $2
       AND status = 'active'
     LIMIT 1`,
    [patientId, caregiverId],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * @param {string} caregiverId
 * @param {string} patientId
 * @returns {Promise<'deleted' | 'not_found' | 'conflict'>}
 */
export async function deletePatient(caregiverId, patientId) {
  if (await hasActiveTreatments(caregiverId, patientId)) {
    return 'conflict';
  }

  const result = await getPool().query(
    `DELETE FROM patients
     WHERE id = $1 AND caregiver_id = $2
     RETURNING id`,
    [patientId, caregiverId],
  );

  if ((result.rowCount ?? 0) === 0) return 'not_found';
  return 'deleted';
}

/**
 * @param {Record<string, unknown>} body
 * @returns {{ ok: true, value: { name: string, birthDate: string, sleepStart: string, sleepEnd: string } } | { ok: false, fields: Record<string, string> }}
 */
export function parsePatientBody(body) {
  /** @type {Record<string, string>} */
  const fields = {};

  const name = asString(body.name).trim();
  const birthDate = asString(body.birthDate).trim();
  const sleepStartRaw = asString(body.sleepStart).trim();
  const sleepEndRaw = asString(body.sleepEnd).trim();

  if (!name) fields.name = 'Informe o nome.';
  else if (name.length > 120) fields.name = 'Nome muito longo.';

  if (!birthDate) fields.birthDate = 'Informe a data de nascimento.';
  else if (!isValidBirthDate(birthDate)) {
    fields.birthDate = 'Data de nascimento inválida ou futura.';
  }

  const sleepStart = sleepStartRaw || '22:00';
  const sleepEnd = sleepEndRaw || '07:00';

  if (sleepStartRaw && !isValidTime(sleepStartRaw)) {
    fields.sleepStart = 'Use o formato HH:MM.';
  }
  if (sleepEndRaw && !isValidTime(sleepEndRaw)) {
    fields.sleepEnd = 'Use o formato HH:MM.';
  }

  if (Object.keys(fields).length > 0) {
    return { ok: false, fields };
  }

  return {
    ok: true,
    value: { name, birthDate, sleepStart, sleepEnd },
  };
}

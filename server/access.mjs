import { getPool } from './db.mjs';
import { mapPatient } from './patients.mjs';

const PATIENT_SELECT = `
  p.id, p.name, p.birth_date, p.sleep_start, p.sleep_end, p.created_at, p.updated_at,
  p.caregiver_id
`;

/**
 * @param {string} sessionCaregiverId
 * @param {string} patientId
 * @returns {Promise<{ role: 'owner' | 'grantee', ownerCaregiverId: string, patient: ReturnType<typeof mapPatient> & { access: 'owner' | 'grantee' } } | null>}
 */
export async function resolvePatientAccess(sessionCaregiverId, patientId) {
  const { rows } = await getPool().query(
    `SELECT ${PATIENT_SELECT}
     FROM patients p
     WHERE p.id = $1 AND p.caregiver_id = $2`,
    [patientId, sessionCaregiverId],
  );
  if (rows[0]) {
    const patient = {
      ...mapPatient(rows[0]),
      access: /** @type {const} */ ('owner'),
      ownerCaregiverId: sessionCaregiverId,
    };
    return {
      role: 'owner',
      ownerCaregiverId: sessionCaregiverId,
      patient,
    };
  }

  const grant = await getPool().query(
    `SELECT ${PATIENT_SELECT}
     FROM patient_access pa
     INNER JOIN patients p ON p.id = pa.patient_id
     WHERE pa.patient_id = $1 AND pa.caregiver_id = $2`,
    [patientId, sessionCaregiverId],
  );
  const row = grant.rows[0];
  if (!row) return null;
  const patient = {
    ...mapPatient(row),
    access: /** @type {const} */ ('grantee'),
    ownerCaregiverId: row.caregiver_id,
  };
  return {
    role: 'grantee',
    ownerCaregiverId: row.caregiver_id,
    patient,
  };
}

/**
 * @param {string} sessionCaregiverId
 */
export async function listAccessiblePatients(sessionCaregiverId) {
  const { rows } = await getPool().query(
    `SELECT * FROM (
       SELECT ${PATIENT_SELECT}, 'owner'::text AS access
       FROM patients p
       WHERE p.caregiver_id = $1
       UNION ALL
       SELECT ${PATIENT_SELECT}, 'grantee'::text AS access
       FROM patient_access pa
       INNER JOIN patients p ON p.id = pa.patient_id
       WHERE pa.caregiver_id = $1
     ) combined
     ORDER BY lower(name) ASC, created_at ASC`,
    [sessionCaregiverId],
  );
  return rows.map((row) => ({
    ...mapPatient(row),
    access: row.access === 'grantee' ? 'grantee' : 'owner',
    ownerCaregiverId: row.caregiver_id,
  }));
}

/**
 * @param {string} sessionCaregiverId
 * @param {string} patientId
 */
export async function isPatientOwner(sessionCaregiverId, patientId) {
  const { rows } = await getPool().query(
    `SELECT 1 FROM patients WHERE id = $1 AND caregiver_id = $2`,
    [patientId, sessionCaregiverId],
  );
  return Boolean(rows[0]);
}

/**
 * @param {string} sessionCaregiverId
 * @param {string} doseId
 */
export async function resolveDoseAccess(sessionCaregiverId, doseId) {
  const { rows } = await getPool().query(
    `SELECT
       d.id,
       d.treatment_id,
       d.caregiver_id AS owner_caregiver_id,
       d.scheduled_at,
       d.status,
       d.administered_at,
       d.alarm_at,
       d.snooze_count,
       p.id AS patient_id
     FROM scheduled_doses d
     INNER JOIN treatments t ON t.id = d.treatment_id
     INNER JOIN patients p ON p.id = t.patient_id
     WHERE d.id = $1
       AND (
         d.caregiver_id = $2
         OR EXISTS (
           SELECT 1 FROM patient_access pa
           WHERE pa.patient_id = p.id AND pa.caregiver_id = $2
         )
       )`,
    [doseId, sessionCaregiverId],
  );
  const row = rows[0];
  if (!row) return null;
  const role =
    row.owner_caregiver_id === sessionCaregiverId ? 'owner' : 'grantee';
  return {
    role,
    ownerCaregiverId: row.owner_caregiver_id,
    treatmentId: row.treatment_id,
    patientId: row.patient_id,
    row,
  };
}

/**
 * Patient ids owned by session caregiver (for invite validation).
 * @param {string} ownerId
 * @param {string[]} patientIds
 */
export async function filterOwnedPatientIds(ownerId, patientIds) {
  if (!patientIds.length) return [];
  const { rows } = await getPool().query(
    `SELECT id FROM patients
     WHERE caregiver_id = $1 AND id = ANY($2::uuid[])`,
    [ownerId, patientIds],
  );
  return rows.map((r) => r.id);
}

/**
 * @param {import('pg').PoolClient} client
 * @param {{ granteeId: string, ownerId: string, patientIds: string[] }} input
 */
export async function insertPatientAccessRows(client, { granteeId, ownerId, patientIds }) {
  for (const patientId of patientIds) {
    await client.query(
      `INSERT INTO patient_access (patient_id, caregiver_id, granted_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (patient_id, caregiver_id) DO NOTHING`,
      [patientId, granteeId, ownerId],
    );
  }
}

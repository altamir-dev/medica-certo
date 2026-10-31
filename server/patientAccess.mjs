import { getPool } from './db.mjs';
import {
  filterOwnedPatientIds,
  insertPatientAccessRows,
  isPatientOwner,
} from './access.mjs';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * @param {string} ownerId
 */
export async function listAccessGrantees(ownerId) {
  const { rows } = await getPool().query(
    `SELECT
       c.id,
       c.email,
       c.name,
       min(pa.created_at) AS since
     FROM patient_access pa
     INNER JOIN caregivers c ON c.id = pa.caregiver_id
     WHERE pa.granted_by = $1
     GROUP BY c.id, c.email, c.name
     ORDER BY lower(c.name) ASC, c.email ASC`,
    [ownerId],
  );
  return rows.map((row) => ({
    caregiverId: row.id,
    email: row.email,
    name: row.name,
    since: new Date(row.since).toISOString(),
  }));
}

/**
 * @param {string} ownerId
 * @param {string} granteeId
 */
export async function getGranteeAccess(ownerId, granteeId) {
  const { rows } = await getPool().query(
    `SELECT pa.patient_id, p.name
     FROM patient_access pa
     INNER JOIN patients p ON p.id = pa.patient_id
     WHERE pa.granted_by = $1 AND pa.caregiver_id = $2
     ORDER BY lower(p.name) ASC`,
    [ownerId, granteeId],
  );
  if (!rows.length) return null;
  return {
    granteeId,
    patientIds: rows.map((r) => r.patient_id),
    patients: rows.map((r) => ({ id: r.patient_id, name: r.name })),
  };
}

/**
 * Replace grantee's patient set from this owner.
 * @param {string} ownerId
 * @param {string} granteeId
 * @param {string[]} patientIds
 */
export async function setGranteePatients(ownerId, granteeId, patientIds) {
  const owned = await filterOwnedPatientIds(ownerId, patientIds);
  if (owned.length !== patientIds.length) {
    return {
      ok: false,
      code: 'NOT_FOUND',
      message: 'Paciente não encontrado.',
    };
  }
  if (granteeId === ownerId) {
    return { ok: false, code: 'VALIDATION', message: 'Operação inválida.' };
  }

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `DELETE FROM patient_access
       WHERE granted_by = $1 AND caregiver_id = $2`,
      [ownerId, granteeId],
    );
    if (owned.length > 0) {
      await insertPatientAccessRows(client, {
        granteeId,
        ownerId,
        patientIds: owned,
      });
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
 * @param {string} ownerId
 * @param {string} granteeId
 */
export async function revokeGranteeAccess(ownerId, granteeId) {
  const result = await getPool().query(
    `DELETE FROM patient_access
     WHERE granted_by = $1 AND caregiver_id = $2
     RETURNING patient_id`,
    [ownerId, granteeId],
  );
  if ((result.rowCount ?? 0) === 0) {
    return { ok: false, code: 'NOT_FOUND', message: 'Acesso não encontrado.' };
  }
  return { ok: true };
}

/**
 * @param {unknown} body
 */
export function parseGranteePatientsBody(body) {
  const source =
    body && typeof body === 'object'
      ? /** @type {Record<string, unknown>} */ (body)
      : {};
  /** @type {Record<string, string>} */
  const fields = {};
  const raw = source.patientIds;
  if (!Array.isArray(raw) || raw.length === 0) {
    fields.patientIds = 'Selecione ao menos um paciente.';
    return { ok: false, fields };
  }
  /** @type {string[]} */
  const patientIds = [];
  for (const item of raw) {
    const id = String(item).trim();
    if (!UUID_RE.test(id)) {
      fields.patientIds = 'Paciente inválido.';
      break;
    }
    patientIds.push(id);
  }
  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return { ok: true, value: { patientIds: [...new Set(patientIds)] } };
}

export { isPatientOwner };

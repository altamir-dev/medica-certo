import crypto from 'node:crypto';
import { hashPassword } from './auth.mjs';
import {
  filterOwnedPatientIds,
  insertPatientAccessRows,
} from './access.mjs';
import { getPool } from './db.mjs';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const DEFAULT_INVITE_DAYS = 7;
export const MIN_INVITE_DAYS = 1;
export const MAX_INVITE_DAYS = 30;
export const INVITE_INVALID_MESSAGE = 'Convite inválido ou expirado.';
export const REGISTER_FAILED_MESSAGE = 'Não foi possível concluir o cadastro.';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PG_UNIQUE_VIOLATION = '23505';
const DUMMY_HASH = crypto
  .createHash('sha256')
  .update('medica-certo-invite-dummy-v1')
  .digest('hex');

const PROMOTION_SQL = `
  UPDATE caregivers AS c
  SET is_admin = true
  WHERE c.id = (
    SELECT id
    FROM caregivers
    ORDER BY created_at ASC, id ASC
    LIMIT 1
  )
  AND NOT EXISTS (
    SELECT 1 FROM caregivers WHERE is_admin = true
  )
`;

/**
 * Same statement as migration 008. Idempotent: does nothing if an admin exists.
 * @param {import('pg').Pool | import('pg').PoolClient} db
 */
export async function promoteOldestCaregiver(db) {
  await db.query(PROMOTION_SQL);
}

/**
 * @param {string} token
 */
export function hashInviteToken(token) {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Compares SHA-256 hex digests in constant time. Missing or malformed
 * digests are compared against a dummy so the caller does not branch first.
 * @param {string | null | undefined} storedHash
 * @param {string | null | undefined} presentedHash
 */
export function hashesEqual(storedHash, presentedHash) {
  const storedValid =
    typeof storedHash === 'string' && /^[0-9a-f]{64}$/.test(storedHash);
  const presentedValid =
    typeof presentedHash === 'string' && /^[0-9a-f]{64}$/.test(presentedHash);
  const left = Buffer.from(storedValid ? storedHash : DUMMY_HASH, 'hex');
  const right = Buffer.from(presentedValid ? presentedHash : DUMMY_HASH, 'hex');
  const same = crypto.timingSafeEqual(left, right);
  return Boolean(
    same && storedValid && presentedValid && storedHash === presentedHash,
  );
}

export function generateInviteToken() {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, tokenHash: hashInviteToken(token) };
}

/**
 * @param {unknown} token
 */
export function normalizeInviteToken(token) {
  if (typeof token !== 'string') return '';
  const trimmed = token.trim();
  if (trimmed.length < 20 || trimmed.length > 200) return '';
  return trimmed;
}

/**
 * @param {Date} now
 * @param {number} days
 */
export function inviteExpiresAt(now, days) {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * @param {{ revoked_at?: Date | string | null, used_at?: Date | string | null, expires_at: Date | string }} row
 * @param {Date} [now]
 */
export function inviteStatus(row, now = new Date()) {
  if (row.revoked_at) return 'revoked';
  if (row.used_at) return 'used';
  if (new Date(row.expires_at).getTime() <= now.getTime()) return 'expired';
  return 'pending';
}

/**
 * @param {{ token_hash?: string, revoked_at?: Date | string | null, used_at?: Date | string | null, expires_at?: Date | string } | null | undefined} row
 * @param {Date} now
 * @param {string} presentedHash
 */
export function evaluateInvite(row, now, presentedHash) {
  const match = hashesEqual(row?.token_hash ?? null, presentedHash);
  if (!row || !match) return { ok: false, reason: 'invalid' };
  if (row.revoked_at) return { ok: false, reason: 'revoked' };
  if (row.used_at) return { ok: false, reason: 'used' };
  const expires = new Date(row.expires_at ?? 0).getTime();
  if (!Number.isFinite(expires) || expires <= now.getTime()) {
    return { ok: false, reason: 'expired' };
  }
  return { ok: true };
}

/**
 * Public registration gate. A non-empty invite token never falls through
 * to bootstrap, even when the caregivers table is still empty.
 * @param {{ caregiverCount: number, inviteToken: unknown }} input
 */
export function registrationDecision({ caregiverCount, inviteToken }) {
  if (typeof inviteToken === 'string' && inviteToken.trim() !== '') {
    return { mode: 'invite', token: inviteToken.trim() };
  }
  if (caregiverCount > 0) return { mode: 'closed' };
  return { mode: 'bootstrap' };
}

/**
 * @param {import('pg').PoolClient} client
 * @param {string} inviteId
 */
async function loadInvitePatientIds(client, inviteId) {
  const { rows } = await client.query(
    `SELECT patient_id FROM invite_patients WHERE invite_id = $1`,
    [inviteId],
  );
  return rows.map((r) => r.patient_id);
}

/**
 * @param {import('pg').PoolClient} client
 * @param {{ inviteId: string, ownerId: string, granteeId: string }} input
 */
async function grantInvitePatients(client, { inviteId, ownerId, granteeId }) {
  const patientIds = await loadInvitePatientIds(client, inviteId);
  if (!patientIds.length) return;
  await insertPatientAccessRows(client, {
    granteeId,
    ownerId,
    patientIds,
  });
}

/**
 * @param {unknown} body
 */
export function parseInviteCreateBody(body) {
  const source =
    body && typeof body === 'object'
      ? /** @type {Record<string, unknown>} */ (body)
      : {};
  /** @type {Record<string, string>} */
  const fields = {};

  let email = null;
  if (source.email == null || String(source.email).trim() === '') {
    fields.email = 'Informe o e-mail do convidado.';
  } else {
    email = String(source.email).trim().toLowerCase();
    if (email.length > 200 || !EMAIL_RE.test(email)) {
      fields.email = 'Informe um e-mail válido.';
    }
  }

  const rawPatients = source.patientIds;
  /** @type {string[]} */
  let patientIds = [];
  if (!Array.isArray(rawPatients) || rawPatients.length === 0) {
    fields.patientIds = 'Selecione ao menos um paciente.';
  } else {
    for (const item of rawPatients) {
      const id = String(item).trim();
      if (!UUID_RE.test(id)) {
        fields.patientIds = 'Paciente inválido.';
        break;
      }
      patientIds.push(id);
    }
    patientIds = [...new Set(patientIds)];
  }

  let expiresInDays = DEFAULT_INVITE_DAYS;
  const rawDays = source.expiresInDays;
  if (rawDays != null && rawDays !== '') {
    const n =
      typeof rawDays === 'number'
        ? rawDays
        : typeof rawDays === 'string'
          ? Number(rawDays)
          : Number.NaN;
    if (!Number.isInteger(n) || n < MIN_INVITE_DAYS || n > MAX_INVITE_DAYS) {
      fields.expiresInDays = 'Validade deve ser entre 1 e 30 dias.';
    } else {
      expiresInDays = n;
    }
  }

  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return { ok: true, value: { email, expiresInDays, patientIds } };
}

/**
 * @param {{ id: string, email: string | null, expires_at: Date | string, created_at: Date | string, used_at: Date | string | null, revoked_at: Date | string | null }} row
 * @param {Date} [now]
 */
export function toInvite(row, now = new Date()) {
  return {
    id: row.id,
    email: row.email,
    status: inviteStatus(row, now),
    expiresAt: new Date(row.expires_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
    usedAt: row.used_at ? new Date(row.used_at).toISOString() : null,
    revokedAt: row.revoked_at ? new Date(row.revoked_at).toISOString() : null,
  };
}

/**
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {{ email: string, passwordHash: string, name: string, isAdmin: boolean }} input
 */
export async function insertCaregiver(db, { email, passwordHash, name, isAdmin }) {
  const { rows } = await db.query(
    `INSERT INTO caregivers (email, password_hash, name, is_admin)
     VALUES ($1, $2, $3, $4)
     RETURNING id, email, name, alarms_enabled, is_admin`,
    [email, passwordHash, name, isAdmin],
  );
  const row = rows[0];
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    alarmsEnabled: row.alarms_enabled,
    isAdmin: Boolean(row.is_admin),
  };
}

/**
 * @param {{ createdBy: string, email: string, patientIds: string[], expiresInDays: number, now?: Date }} input
 */
export async function createInvite({
  createdBy,
  email,
  patientIds,
  expiresInDays,
  now = new Date(),
}) {
  const owned = await filterOwnedPatientIds(createdBy, patientIds);
  if (owned.length !== patientIds.length) {
    return {
      ok: false,
      code: 'NOT_FOUND',
      message: 'Paciente não encontrado.',
    };
  }

  const { token, tokenHash } = generateInviteToken();
  const expiresAt = inviteExpiresAt(now, expiresInDays);
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO caregiver_invites (token_hash, email, created_by, expires_at)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email::text AS email, expires_at, created_at, used_at, revoked_at`,
      [tokenHash, email, createdBy, expiresAt.toISOString()],
    );
    const inviteRow = rows[0];
    for (const patientId of owned) {
      await client.query(
        `INSERT INTO invite_patients (invite_id, patient_id) VALUES ($1, $2)`,
        [inviteRow.id, patientId],
      );
    }
    await client.query('COMMIT');
    return {
      ok: true,
      invite: {
        ...toInvite(inviteRow, now),
        patientIds: owned,
      },
      token,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * @param {string} createdBy
 * @param {Date} [now]
 */
export async function listInvites(createdBy, now = new Date()) {
  const { rows } = await getPool().query(
    `SELECT id, email::text AS email, expires_at, created_at, used_at, revoked_at
     FROM caregiver_invites
     WHERE created_by = $1
     ORDER BY created_at DESC, id DESC`,
    [createdBy],
  );
  return rows.map((row) => toInvite(row, now));
}

/**
 * @param {string} caregiverId
 * @param {string} id
 */
export async function revokeInvite(caregiverId, id) {
  const { rows } = await getPool().query(
    `UPDATE caregiver_invites
     SET revoked_at = now()
     WHERE id = $1
       AND created_by = $2
       AND used_at IS NULL
       AND revoked_at IS NULL
     RETURNING id, email::text AS email, expires_at, created_at, used_at, revoked_at`,
    [id, caregiverId],
  );
  if (rows[0]) return { ok: true, invite: toInvite(rows[0]) };

  const existing = await getPool().query(
    `SELECT used_at, revoked_at
     FROM caregiver_invites
     WHERE id = $1 AND created_by = $2`,
    [id, caregiverId],
  );
  if (!existing.rows[0]) {
    return {
      ok: false,
      code: 'NOT_FOUND',
      message: 'Convite não encontrado.',
    };
  }
  if (existing.rows[0].used_at) {
    return {
      ok: false,
      code: 'CONFLICT',
      message: 'Convite já utilizado.',
    };
  }
  return {
    ok: false,
    code: 'CONFLICT',
    message: 'Convite já revogado.',
  };
}

/**
 * @param {unknown} token
 */
export async function lookupInvite(token) {
  const normalized = normalizeInviteToken(token);
  const presentedHash = hashInviteToken(normalized);
  const { rows } = await getPool().query(
    `SELECT token_hash, email::text AS email, expires_at, used_at, revoked_at
     FROM caregiver_invites
     WHERE token_hash = $1`,
    [presentedHash],
  );
  const row = rows[0] ?? null;
  const decision = evaluateInvite(row, new Date(), presentedHash);
  if (!decision.ok || !row) return { ok: false };
  return {
    ok: true,
    email: row.email,
    expiresAt: new Date(row.expires_at).toISOString(),
  };
}

/**
 * Consumes a single-use invite and creates a non-admin caregiver.
 * Duplicate e-mail returns a generic failure and does not consume the invite.
 * @param {{ email: string, password: string, name: string, token: string }} input
 */
export async function registerWithInvite({ email, password, name, token }) {
  const normalized = normalizeInviteToken(token);
  const presentedHash = hashInviteToken(normalized);
  const passwordHash = await hashPassword(password);
  const client = await getPool().connect();

  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id, token_hash, email::text AS email, expires_at, used_at, revoked_at
       FROM caregiver_invites
       WHERE token_hash = $1
       FOR UPDATE`,
      [presentedHash],
    );
    const row = rows[0] ?? null;
    const decision = evaluateInvite(row, new Date(), presentedHash);
    if (!decision.ok || !row) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        code: 'INVITE_INVALID',
        message: INVITE_INVALID_MESSAGE,
      };
    }

    const bound = row.email ? String(row.email).trim().toLowerCase() : '';
    if (!bound || bound !== email) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        code: 'VALIDATION',
        message: 'Dados inválidos.',
        fields: { email: 'Este convite é para outro e-mail.' },
      };
    }

    /** @type {{ id: string, email: string, name: string, alarmsEnabled: boolean, isAdmin: boolean }} */
    let caregiver;
    try {
      caregiver = await insertCaregiver(client, {
        email,
        passwordHash,
        name,
        isAdmin: false,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      if (
        err &&
        typeof err === 'object' &&
        /** @type {{ code?: string }} */ (err).code === PG_UNIQUE_VIOLATION
      ) {
        return {
          ok: false,
          code: 'REGISTER_FAILED',
          message: REGISTER_FAILED_MESSAGE,
        };
      }
      throw err;
    }

    const updated = await client.query(
      `UPDATE caregiver_invites
       SET used_at = now(), used_by = $2
       WHERE id = $1
         AND used_at IS NULL
         AND revoked_at IS NULL
         AND expires_at > now()
       RETURNING id, created_by`,
      [row.id, caregiver.id],
    );
    if (updated.rowCount !== 1) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        code: 'INVITE_INVALID',
        message: INVITE_INVALID_MESSAGE,
      };
    }

    await grantInvitePatients(client, {
      inviteId: row.id,
      ownerId: updated.rows[0].created_by,
      granteeId: caregiver.id,
    });

    await client.query('COMMIT');
    return { ok: true, caregiver };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* transaction already finished */
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Accept invite for an already registered caregiver (same e-mail as invite).
 * @param {{ caregiverId: string, email: string, token: string }} input
 */
export async function acceptInviteForCaregiver({ caregiverId, email, token }) {
  const normalized = normalizeInviteToken(token);
  const presentedHash = hashInviteToken(normalized);
  const client = await getPool().connect();

  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id, token_hash, email::text AS email, created_by, expires_at, used_at, revoked_at
       FROM caregiver_invites
       WHERE token_hash = $1
       FOR UPDATE`,
      [presentedHash],
    );
    const row = rows[0] ?? null;
    const decision = evaluateInvite(row, new Date(), presentedHash);
    if (!decision.ok || !row) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        code: 'INVITE_INVALID',
        message: INVITE_INVALID_MESSAGE,
      };
    }

    const bound = row.email ? String(row.email).trim().toLowerCase() : '';
    if (!bound || bound !== email) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        code: 'VALIDATION',
        message: 'Dados inválidos.',
        fields: { email: 'Este convite é para outro e-mail.' },
      };
    }

    const updated = await client.query(
      `UPDATE caregiver_invites
       SET used_at = now(), used_by = $2
       WHERE id = $1
         AND used_at IS NULL
         AND revoked_at IS NULL
         AND expires_at > now()
       RETURNING id, created_by`,
      [row.id, caregiverId],
    );
    if (updated.rowCount !== 1) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        code: 'INVITE_INVALID',
        message: INVITE_INVALID_MESSAGE,
      };
    }

    await grantInvitePatients(client, {
      inviteId: row.id,
      ownerId: updated.rows[0].created_by,
      granteeId: caregiverId,
    });

    await client.query('COMMIT');
    return { ok: true };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* transaction already finished */
    }
    throw err;
  } finally {
    client.release();
  }
}

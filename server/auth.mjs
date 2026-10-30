import crypto from 'node:crypto';
import argon2 from 'argon2';
import { config } from './config.mjs';
import { getPool } from './db.mjs';

export const COOKIE_NAME = 'mc_session';

const SESSION_TTL_MS = config.sessionDays * 24 * 60 * 60 * 1000;
const SLIDE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

/**
 * Simple sliding-window rate limiter (in-process; OK with replicas: 1).
 * @param {{ max?: number, windowMs?: number }} [opts]
 */
export function createRateLimiter({ max = 10, windowMs = 60_000 } = {}) {
  /** @type {Map<string, number[]>} */
  const hits = new Map();

  return (key, now = Date.now()) => {
    const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      hits.set(key, recent);
      return false;
    }
    recent.push(now);
    hits.set(key, recent);
    return true;
  };
}

export const loginRateLimit = createRateLimiter({ max: 10, windowMs: 60_000 });
export const registerRateLimit = createRateLimiter({ max: 10, windowMs: 60_000 });

/**
 * @param {string} password
 */
export async function hashPassword(password) {
  return argon2.hash(password, { type: argon2.argon2id });
}

/**
 * @param {string} hash
 * @param {string} password
 */
export async function verifyPassword(hash, password) {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

/**
 * @param {string} token
 * @param {number} maxAgeSec
 */
export function buildSessionCookie(token, maxAgeSec) {
  const parts = [
    `${COOKIE_NAME}=${token}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${maxAgeSec}`,
  ];
  if (config.cookieSecure) parts.push('Secure');
  return parts.join('; ');
}

export function clearSessionCookie() {
  return buildSessionCookie('', 0);
}

/**
 * @param {import('fastify').FastifyRequest} request
 */
export function readSessionToken(request) {
  const header = request.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq);
    if (key === COOKIE_NAME) {
      return decodeURIComponent(trimmed.slice(eq + 1));
    }
  }
  return null;
}

function newSessionId() {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * @param {string} caregiverId
 */
export async function createSession(caregiverId) {
  const id = newSessionId();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await getPool().query(
    `INSERT INTO sessions (id, caregiver_id, expires_at)
     VALUES ($1, $2, $3)`,
    [id, caregiverId, expiresAt.toISOString()],
  );
  return { id, expiresAt };
}

/**
 * @param {string | null} token
 * @returns {Promise<{
 *   caregiver: { id: string, email: string, name: string, alarmsEnabled: boolean },
 *   sessionId: string,
 *   refreshedCookie?: string
 * } | null>}
 */
export async function resolveSession(token) {
  if (!token) return null;

  const { rows } = await getPool().query(
    `SELECT
       s.id AS session_id,
       s.expires_at,
       c.id AS caregiver_id,
       c.email,
       c.name,
       c.alarms_enabled
     FROM sessions s
     INNER JOIN caregivers c ON c.id = s.caregiver_id
     WHERE s.id = $1`,
    [token],
  );

  const row = rows[0];
  if (!row) return null;

  const expiresAt = new Date(row.expires_at);
  const now = Date.now();
  if (expiresAt.getTime() <= now) {
    await getPool().query('DELETE FROM sessions WHERE id = $1', [token]);
    return null;
  }

  /** @type {string | undefined} */
  let refreshedCookie;
  const remaining = expiresAt.getTime() - now;
  if (remaining < SESSION_TTL_MS - SLIDE_THRESHOLD_MS) {
    const newExpires = new Date(now + SESSION_TTL_MS);
    await getPool().query(
      'UPDATE sessions SET expires_at = $1 WHERE id = $2',
      [newExpires.toISOString(), token],
    );
    refreshedCookie = buildSessionCookie(
      token,
      Math.floor(SESSION_TTL_MS / 1000),
    );
  }

  return {
    sessionId: row.session_id,
    caregiver: {
      id: row.caregiver_id,
      email: row.email,
      name: row.name,
      alarmsEnabled: row.alarms_enabled,
    },
    refreshedCookie,
  };
}

/**
 * @param {string | null} token
 */
export async function destroySession(token) {
  if (!token) return;
  await getPool().query('DELETE FROM sessions WHERE id = $1', [token]);
}

export async function countCaregivers() {
  const { rows } = await getPool().query(
    'SELECT COUNT(*)::int AS count FROM caregivers',
  );
  return rows[0]?.count ?? 0;
}

/**
 * @param {{ email: string, password: string, name: string }} input
 */
export async function createCaregiver({ email, password, name }) {
  const passwordHash = await hashPassword(password);
  const { rows } = await getPool().query(
    `INSERT INTO caregivers (email, password_hash, name)
     VALUES ($1, $2, $3)
     RETURNING id, email, name, alarms_enabled`,
    [email.trim().toLowerCase(), passwordHash, name.trim()],
  );
  const row = rows[0];
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    alarmsEnabled: row.alarms_enabled,
  };
}

/**
 * @param {string} email
 */
export async function findCaregiverByEmail(email) {
  const { rows } = await getPool().query(
    `SELECT id, email, name, password_hash, alarms_enabled
     FROM caregivers
     WHERE email = $1`,
    [email.trim().toLowerCase()],
  );
  return rows[0] ?? null;
}

/**
 * Seeds the first caregiver from BOOTSTRAP_* env when the table is empty.
 */
export async function maybeSeedBootstrap(logger = console) {
  const email = config.bootstrapEmail;
  const password = config.bootstrapPassword;
  if (!email || !password) return;

  const count = await countCaregivers();
  if (count > 0) return;

  const name = config.bootstrapName || 'Cuidador';
  await createCaregiver({ email, password, name });
  logger.info?.(
    { email },
    'bootstrap caregiver created from BOOTSTRAP_* env',
  ) ?? logger.log?.(`bootstrap caregiver created: ${email}`);
}

/**
 * @param {import('fastify').FastifyReply} reply
 * @param {number} status
 * @param {string} code
 * @param {string} message
 * @param {Record<string, string>} [fields]
 */
export function sendError(reply, status, code, message, fields) {
  /** @type {{ error: { code: string, message: string, fields?: Record<string, string> } }} */
  const body = { error: { code, message } };
  if (fields && Object.keys(fields).length > 0) {
    body.error.fields = fields;
  }
  return reply.code(status).send(body);
}

/**
 * Client IP for rate limiting. Trusts X-Forwarded-For only behind proxy (prod).
 * @param {import('fastify').FastifyRequest} request
 */
export function clientIp(request) {
  if (config.isProd) {
    const forwarded = request.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
      return forwarded.split(',')[0].trim();
    }
  }
  return request.ip || 'unknown';
}

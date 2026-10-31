import crypto from 'node:crypto';
import { getPool } from './db.mjs';
import { config } from './config.mjs';

const PUSH_HOSTS = [
  /(^|\.)push\.apple\.com$/i,
  /^fcm\.googleapis\.com$/i,
  /(^|\.)push\.services\.mozilla\.com$/i,
  /(^|\.)notify\.windows\.com$/i,
  /^android\.googleapis\.com$/i,
];

const B64U = /^[A-Za-z0-9_-]+={0,2}$/;
const MAX_SUBS_PER_CAREGIVER = 20;

/**
 * @param {unknown} u
 */
export function validEndpoint(u) {
  try {
    const x = new URL(String(u));
    return (
      x.protocol === 'https:' &&
      !x.port &&
      (x.pathname + x.search).length > 8 &&
      PUSH_HOSTS.some((re) => re.test(x.hostname)) &&
      String(u).length <= 1000
    );
  } catch {
    return false;
  }
}

/**
 * @param {string} endpoint
 */
export function subscriptionId(endpoint) {
  return crypto.createHash('sha256').update(endpoint).digest('hex').slice(0, 16);
}

/**
 * @param {string} [ua]
 */
function uaLabel(ua = '') {
  const u = String(ua);
  const os = /iPhone|iPad/.test(u)
    ? 'iPhone/iPad'
    : /Android/.test(u)
      ? 'Android'
      : /Macintosh|Mac OS/.test(u)
        ? 'Mac'
        : /Windows/.test(u)
          ? 'Windows'
          : /Linux/.test(u)
            ? 'Linux'
            : 'Aparelho';
  const br = /Edg\//.test(u)
    ? 'Edge'
    : /Firefox\//.test(u)
      ? 'Firefox'
      : /Chrome\//.test(u)
        ? 'Chrome'
        : /Safari\//.test(u)
          ? 'Safari'
          : '';
  return br ? `${br} no ${os}` : os;
}

export function isPushConfigured() {
  return Boolean(config.vapidPublic && config.vapidPrivate);
}

/**
 * @param {string} caregiverId
 * @param {{ endpoint: string, keys?: { p256dh?: string, auth?: string } }} sub
 * @param {{ ua?: string, label?: string }} [meta]
 */
export async function subscribePush(caregiverId, sub, meta = {}) {
  const ep = sub?.endpoint;
  const k = sub?.keys || {};
  if (!validEndpoint(ep)) {
    return {
      ok: false,
      code: 'VALIDATION',
      message: 'Endpoint de push não reconhecido.',
    };
  }
  if (
    !B64U.test(String(k.p256dh || '')) ||
    !B64U.test(String(k.auth || '')) ||
    String(k.p256dh).length > 200 ||
    String(k.auth).length > 100
  ) {
    return { ok: false, code: 'VALIDATION', message: 'Chaves inválidas.' };
  }

  const pool = getPool();
  const existing = await pool.query(
    `SELECT id FROM push_subscriptions
     WHERE caregiver_id = $1 AND endpoint = $2`,
    [caregiverId, ep],
  );
  if (!existing.rows[0]) {
    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS n FROM push_subscriptions WHERE caregiver_id = $1`,
      [caregiverId],
    );
    if ((countRes.rows[0]?.n ?? 0) >= MAX_SUBS_PER_CAREGIVER) {
      return {
        ok: false,
        code: 'LIMIT',
        message: 'Limite de 20 aparelhos atingido.',
      };
    }
  }

  const id = subscriptionId(ep);
  const label =
    String(meta.label || '')
      .trim()
      .slice(0, 60) || uaLabel(meta.ua);

  await pool.query(
    `INSERT INTO push_subscriptions
       (id, caregiver_id, endpoint, p256dh, auth, label, ua, fails)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 0)
     ON CONFLICT (caregiver_id, endpoint) DO UPDATE SET
       id = EXCLUDED.id,
       p256dh = EXCLUDED.p256dh,
       auth = EXCLUDED.auth,
       label = EXCLUDED.label,
       ua = EXCLUDED.ua,
       fails = 0,
       last_error = NULL`,
    [
      id,
      caregiverId,
      ep,
      k.p256dh,
      k.auth,
      label,
      String(meta.ua || '').slice(0, 200),
    ],
  );

  return { ok: true, id, label };
}

/**
 * @param {string} caregiverId
 * @param {{ endpoint?: string, id?: string }} target
 */
export async function unsubscribePush(caregiverId, target = {}) {
  const pool = getPool();
  const { rowCount } = await pool.query(
    `DELETE FROM push_subscriptions
     WHERE caregiver_id = $1
       AND (endpoint = $2 OR id = $3)`,
    [caregiverId, target.endpoint || '\0', target.id || '\0'],
  );
  return { removed: rowCount ?? 0 };
}

/**
 * @param {string} caregiverId
 */
export async function listSubscriptions(caregiverId) {
  const { rows } = await getPool().query(
    `SELECT id, label, ua, created_at, last_ok_at, last_error, fails
     FROM push_subscriptions
     WHERE caregiver_id = $1
     ORDER BY created_at ASC`,
    [caregiverId],
  );
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    ua: r.ua,
    createdAt: r.created_at,
    lastOkAt: r.last_ok_at,
    lastError: r.last_error,
    fails: r.fails,
  }));
}

/**
 * @param {import('pg').PoolClient | import('pg').Pool} db
 * @param {string} caregiverId
 */
async function loadSubs(db, caregiverId) {
  const { rows } = await db.query(
    `SELECT id, endpoint, p256dh, auth, label
     FROM push_subscriptions
     WHERE caregiver_id = $1`,
    [caregiverId],
  );
  return rows;
}

/**
 * @param {object} sub
 * @param {string} payload
 * @param {{ ttl?: number, urgency?: string, topic?: string }} opts
 */
async function sendOne(sub, payload, opts) {
  const webpush = (await import('web-push')).default;
  return webpush.sendNotification(
    {
      endpoint: sub.endpoint,
      keys: { p256dh: sub.p256dh, auth: sub.auth },
    },
    payload,
    {
      vapidDetails: {
        subject: config.vapidSubject,
        publicKey: config.vapidPublic,
        privateKey: config.vapidPrivate,
      },
      TTL: opts.ttl ?? 3600,
      urgency: opts.urgency ?? 'high',
      topic: opts.topic,
      timeout: 15_000,
    },
  );
}

/**
 * @param {string} caregiverId
 * @param {object} payloadObj
 * @param {{ ttl?: number, urgency?: string, topic?: string }} [opts]
 */
export async function notifyCaregiver(caregiverId, payloadObj, opts = {}) {
  if (!isPushConfigured()) {
    return { sent: 0, skipped: 'vapid-not-configured' };
  }
  const pool = getPool();
  const list = await loadSubs(pool, caregiverId);
  if (!list.length) return { sent: 0, skipped: 'no-subscriptions' };

  const payload = JSON.stringify(payloadObj);
  let ok = 0;
  let fail = 0;

  await Promise.all(
    list.map(async (s) => {
      try {
        await sendOne(s, payload, opts);
        ok++;
        await pool.query(
          `UPDATE push_subscriptions
           SET last_ok_at = now(), fails = 0, last_error = NULL
           WHERE id = $1`,
          [s.id],
        );
      } catch (e) {
        fail++;
        const st = /** @type {{ statusCode?: number, status?: number, body?: string, message?: string }} */ (
          e
        );
        const status = st.statusCode || st.status;
        const gone = status === 404 || status === 410;
        const msg = gone
          ? 'subscription gone'
          : String(st.body || st.message || 'error').slice(0, 140);
        if (gone) {
          await pool.query(`DELETE FROM push_subscriptions WHERE id = $1`, [
            s.id,
          ]);
        } else {
          await pool.query(
            `UPDATE push_subscriptions
             SET fails = fails + 1, last_error = $2
             WHERE id = $1`,
            [s.id, msg],
          );
          await pool.query(
            `DELETE FROM push_subscriptions WHERE id = $1 AND fails >= 10`,
            [s.id],
          );
        }
      }
    }),
  );

  return { sent: ok, failed: fail };
}

/**
 * @param {string} caregiverId
 * @param {{ id?: string }} [target]
 */
export async function sendTestPush(caregiverId, target = {}) {
  if (!isPushConfigured()) {
    return { ok: false, code: 'UNAVAILABLE', message: 'VAPID não configurado.' };
  }
  const pool = getPool();
  let list = await loadSubs(pool, caregiverId);
  if (target.id) list = list.filter((s) => s.id === target.id);
  if (!list.length) {
    return { ok: false, code: 'NOT_FOUND', message: 'Nenhum aparelho inscrito.' };
  }

  const payload = JSON.stringify({
    kind: 'test',
    title: 'Notificações ativas',
    body: 'Tudo certo: este aparelho recebe os alarmes do Medica Certo.',
    url: '/configuracoes',
    tag: 'mc-test',
    ts: Date.now(),
    force: true,
  });

  let ok = 0;
  let fail = 0;
  const results = [];
  for (const s of list) {
    try {
      await sendOne(s, payload, { ttl: 300, urgency: 'high', topic: 'test' });
      ok++;
      results.push({ id: s.id, label: s.label, ok: true });
      await pool.query(
        `UPDATE push_subscriptions
         SET last_ok_at = now(), fails = 0, last_error = NULL
         WHERE id = $1`,
        [s.id],
      );
    } catch (e) {
      fail++;
      const st = /** @type {{ statusCode?: number, message?: string }} */ (e);
      results.push({
        id: s.id,
        label: s.label,
        ok: false,
        error: String(st.message || 'error').slice(0, 120),
      });
    }
  }
  return { ok: true, sent: ok, failed: fail, results };
}

/**
 * @param {string} caregiverId
 * @param {boolean} alarmsEnabled
 */
export async function updateCaregiverAlarms(caregiverId, alarmsEnabled) {
  const { rows } = await getPool().query(
    `UPDATE caregivers
     SET alarms_enabled = $2
     WHERE id = $1
     RETURNING id, email, name, alarms_enabled, is_admin`,
    [caregiverId, Boolean(alarmsEnabled)],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    alarmsEnabled: row.alarms_enabled,
    isAdmin: Boolean(row.is_admin),
  };
}

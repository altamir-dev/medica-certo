import { getPool } from './db.mjs';
import { notifyCaregiver } from './push.mjs';
import { config } from './config.mjs';
import { purgeExpiredIntakes } from './ai/drafts.mjs';

/**
 * Claim due pending doses and send aggregated Web Push per caregiver.
 * Only claims when the caregiver has at least one push subscription, so
 * activating a device later can still receive overdue/due alarms.
 * @param {{ log?: { info: Function, error: Function, debug?: Function } }} [deps]
 */
export async function runAlarmTick(deps = {}) {
  const log = deps.log ?? console;
  const pool = getPool();

  const due = await pool.query(
    `SELECT
       d.id,
       d.caregiver_id,
       d.scheduled_at,
       d.alarm_at
     FROM scheduled_doses d
     INNER JOIN treatments t ON t.id = d.treatment_id
     INNER JOIN caregivers c ON c.id = d.caregiver_id
     WHERE d.status = 'pending'
       AND d.alarm_sent_at IS NULL
       AND d.alarm_at IS NOT NULL
       AND d.alarm_at <= now()
       AND t.status = 'active'
       AND t.alarms_enabled = true
       AND c.alarms_enabled = true
     ORDER BY d.scheduled_at ASC
     LIMIT 200`,
  );

  const rows = due.rows;
  if (!rows.length) {
    return { claimed: 0, notified: 0 };
  }

  /** @type {Map<string, typeof rows>} */
  const byCaregiver = new Map();
  for (const row of rows) {
    const list = byCaregiver.get(row.caregiver_id) ?? [];
    list.push(row);
    byCaregiver.set(row.caregiver_id, list);
  }

  let claimed = 0;
  let notified = 0;

  for (const [caregiverId, doses] of byCaregiver) {
    const subCount = await pool.query(
      `SELECT COUNT(*)::int AS n FROM push_subscriptions WHERE caregiver_id = $1`,
      [caregiverId],
    );
    if ((subCount.rows[0]?.n ?? 0) === 0) {
      continue;
    }

    const ids = doses.map((d) => d.id);
    const claim = await pool.query(
      `UPDATE scheduled_doses
       SET alarm_sent_at = now(), updated_at = now()
       WHERE id = ANY($1::uuid[])
         AND status = 'pending'
         AND alarm_sent_at IS NULL
       RETURNING id`,
      [ids],
    );
    const claimedIds = claim.rows.map((r) => r.id);
    if (!claimedIds.length) continue;
    claimed += claimedIds.length;

    const n = claimedIds.length;
    const body =
      n === 1
        ? 'Há uma dose para administrar.'
        : `Há ${n} doses para administrar.`;
    try {
      const result = await notifyCaregiver(
        caregiverId,
        {
          kind: 'dose_alarm',
          title: 'Hora do medicamento',
          body,
          url: '/',
          tag: `mc-dose-${caregiverId.slice(0, 8)}`,
          ts: Date.now(),
          count: n,
        },
        { ttl: 3600, urgency: 'high', topic: 'dose' },
      );
      if (result.sent > 0) notified += 1;
      log.info?.(
        {
          caregiverId,
          doses: n,
          sent: result.sent,
          skipped: result.skipped,
        },
        'alarm push',
      );
    } catch (err) {
      log.error?.({ err, caregiverId }, 'alarm push failed');
    }
  }

  return { claimed, notified };
}

/**
 * @param {import('fastify').FastifyInstance} app
 */
export function startAlarmScheduler(app) {
  const ms = Number.isFinite(config.alarmSchedulerMs)
    ? Math.max(10_000, config.alarmSchedulerMs)
    : 45_000;

  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runAlarmTick({ log: app.log });
    } catch (err) {
      app.log.error({ err }, 'alarm scheduler tick failed');
    } finally {
      running = false;
    }
  };

  const id = setInterval(() => {
    void tick();
  }, ms);
  if (typeof id.unref === 'function') id.unref();

  setTimeout(() => {
    void tick();
  }, 3_000).unref?.();

  const purge = async () => {
    try {
      await purgeExpiredIntakes();
    } catch (err) {
      app.log.error({ err }, 'intake purge failed');
    }
  };
  const purgeId = setInterval(() => {
    void purge();
  }, 15 * 60 * 1000);
  if (typeof purgeId.unref === 'function') purgeId.unref();
  setTimeout(() => {
    void purge();
  }, 10_000).unref?.();

  app.log.info({ intervalMs: ms }, 'alarm scheduler started');
  return () => {
    clearInterval(id);
    clearInterval(purgeId);
  };
}

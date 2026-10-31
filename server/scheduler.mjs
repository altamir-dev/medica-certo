import { getPool } from './db.mjs';
import { notifyCaregiver } from './push.mjs';
import { config } from './config.mjs';
import { purgeExpiredIntakes } from './ai/drafts.mjs';

/**
 * Resolve caregivers who should receive alarm push for a dose (owner + grantees).
 * @param {import('pg').Pool} pool
 * @param {string} doseId
 * @param {string} ownerCaregiverId
 */
async function alarmRecipientsForDose(pool, doseId, ownerCaregiverId) {
  const { rows } = await pool.query(
    `SELECT $1::uuid AS caregiver_id
     UNION
     SELECT pa.caregiver_id
     FROM scheduled_doses d
     INNER JOIN treatments t ON t.id = d.treatment_id
     INNER JOIN patient_access pa ON pa.patient_id = t.patient_id
     WHERE d.id = $2
       AND pa.granted_by = $1`,
    [ownerCaregiverId, doseId],
  );
  return rows.map((r) => r.caregiver_id);
}

/**
 * Claim due pending doses and send Web Push per recipient (owner + grantees).
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
     INNER JOIN caregivers owner_c ON owner_c.id = d.caregiver_id
     WHERE d.status = 'pending'
       AND d.alarm_at IS NOT NULL
       AND d.alarm_at <= now()
       AND t.status = 'active'
       AND t.alarms_enabled = true
       AND owner_c.alarms_enabled = true
     ORDER BY d.scheduled_at ASC
     LIMIT 200`,
  );

  const rows = due.rows;
  if (!rows.length) {
    return { claimed: 0, notified: 0 };
  }

  let claimed = 0;
  let notified = 0;

  /** @type {Map<string, { doseIds: string[], count: number }>} */
  const batchByRecipient = new Map();

  for (const dose of rows) {
    const recipients = await alarmRecipientsForDose(
      pool,
      dose.id,
      dose.caregiver_id,
    );
    for (const caregiverId of recipients) {
      const { rows: subRows } = await pool.query(
        `SELECT COUNT(*)::int AS n FROM push_subscriptions WHERE caregiver_id = $1`,
        [caregiverId],
      );
      if ((subRows[0]?.n ?? 0) === 0) continue;

      const { rows: prefRows } = await pool.query(
        `SELECT alarms_enabled FROM caregivers WHERE id = $1`,
        [caregiverId],
      );
      if (!prefRows[0]?.alarms_enabled) continue;

      const receipt = await pool.query(
        `SELECT 1 FROM dose_alarm_receipts
         WHERE scheduled_dose_id = $1 AND caregiver_id = $2`,
        [dose.id, caregiverId],
      );
      if (receipt.rows[0]) continue;

      const entry = batchByRecipient.get(caregiverId) ?? {
        doseIds: [],
        count: 0,
      };
      if (!entry.doseIds.includes(dose.id)) {
        entry.doseIds.push(dose.id);
        entry.count += 1;
      }
      batchByRecipient.set(caregiverId, entry);
    }
  }

  for (const [caregiverId, batch] of batchByRecipient) {
    for (const doseId of batch.doseIds) {
      const insert = await pool.query(
        `INSERT INTO dose_alarm_receipts (scheduled_dose_id, caregiver_id)
         SELECT $1, $2
         WHERE EXISTS (
           SELECT 1 FROM scheduled_doses d
           WHERE d.id = $1 AND d.status = 'pending'
         )
         ON CONFLICT DO NOTHING
         RETURNING scheduled_dose_id`,
        [doseId, caregiverId],
      );
      if (insert.rowCount === 1) claimed += 1;
    }

    const n = batch.count;
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

      for (const doseId of batch.doseIds) {
        await pool.query(
          `UPDATE scheduled_doses
           SET alarm_sent_at = COALESCE(alarm_sent_at, now()), updated_at = now()
           WHERE id = $1 AND status = 'pending' AND alarm_sent_at IS NULL`,
          [doseId],
        );
      }

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

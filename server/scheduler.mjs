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
 * First push plus this many repeats while the dose stays pending and due.
 * @returns {{ maxTotal: number, intervalMs: number }}
 */
function repeatLimits() {
  const extra = Number.isFinite(config.alarmRepeatMax)
    ? config.alarmRepeatMax
    : 3;
  const intervalMs = Number.isFinite(config.alarmRepeatIntervalMs)
    ? config.alarmRepeatIntervalMs
    : 120_000;
  return { maxTotal: 1 + extra, intervalMs };
}

const CLAIM_RECEIPT_SQL = `
INSERT INTO dose_alarm_receipts (scheduled_dose_id, caregiver_id, send_count, last_sent_at)
SELECT $1::uuid, $2::uuid, 1, now()
WHERE EXISTS (
  SELECT 1 FROM scheduled_doses d
  WHERE d.id = $1::uuid
    AND d.status = 'pending'
    AND d.alarm_at IS NOT NULL
    AND d.alarm_at <= now()
)
ON CONFLICT (scheduled_dose_id, caregiver_id) DO UPDATE
SET send_count = dose_alarm_receipts.send_count + 1,
    last_sent_at = now()
WHERE dose_alarm_receipts.send_count < $3::int
  AND dose_alarm_receipts.last_sent_at <= now() - ($4::int * interval '1 millisecond')
  AND EXISTS (
    SELECT 1 FROM scheduled_doses d
    WHERE d.id = dose_alarm_receipts.scheduled_dose_id
      AND d.status = 'pending'
      AND d.alarm_at IS NOT NULL
      AND d.alarm_at <= now()
  )
RETURNING send_count
`;

/**
 * Claim due pending doses and send Web Push per recipient (owner + grantees).
 * Repeats up to alarmRepeatMax extra times, alarmRepeatIntervalMs apart,
 * until the dose is no longer pending or its alarm_at moves to the future
 * (snooze deletes receipts and starts the count over).
 * @param {{ log?: { info: Function, error: Function, debug?: Function } }} [deps]
 */
export async function runAlarmTick(deps = {}) {
  const log = deps.log ?? console;
  const pool = getPool();
  const { maxTotal, intervalMs } = repeatLimits();

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
       AND EXISTS (
         SELECT 1
         FROM (
           SELECT d.caregiver_id AS caregiver_id
           UNION
           SELECT pa.caregiver_id
           FROM patient_access pa
           WHERE pa.patient_id = t.patient_id
             AND pa.granted_by = d.caregiver_id
         ) recipients
         INNER JOIN caregivers c
           ON c.id = recipients.caregiver_id AND c.alarms_enabled = true
         INNER JOIN push_subscriptions ps ON ps.caregiver_id = c.id
         WHERE NOT EXISTS (
           SELECT 1
           FROM dose_alarm_receipts r
           WHERE r.scheduled_dose_id = d.id
             AND r.caregiver_id = c.id
             AND (
               r.send_count >= $1
               OR r.last_sent_at > now() - ($2::int * interval '1 millisecond')
             )
         )
       )
     ORDER BY d.scheduled_at ASC
     LIMIT 200`,
    [maxTotal, intervalMs],
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
         WHERE scheduled_dose_id = $1
           AND caregiver_id = $2
           AND (
             send_count >= $3
             OR last_sent_at > now() - ($4::int * interval '1 millisecond')
           )`,
        [dose.id, caregiverId, maxTotal, intervalMs],
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
    /** @type {string[]} */
    const claimedIds = [];
    let resends = 0;
    for (const doseId of batch.doseIds) {
      const insert = await pool.query(CLAIM_RECEIPT_SQL, [
        doseId,
        caregiverId,
        maxTotal,
        intervalMs,
      ]);
      if ((insert.rowCount ?? 0) === 1) {
        claimed += 1;
        claimedIds.push(doseId);
        if ((insert.rows[0]?.send_count ?? 1) > 1) resends += 1;
      }
    }
    if (claimedIds.length === 0) continue;

    const n = claimedIds.length;
    const body =
      n === 1
        ? 'Há uma dose para administrar.'
        : `Há ${n} doses para administrar.`;
    try {
      // urgency high asks the push service to wake the device. TTL 1h keeps
      // the latest undelivered alarm (topic "dose" collapses older ones).
      // Repeats re-alert after a notification was already shown and ignored.
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

      for (const doseId of claimedIds) {
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
          resends,
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

  app.log.info(
    {
      intervalMs: ms,
      repeatMax: config.alarmRepeatMax,
      repeatIntervalMs: config.alarmRepeatIntervalMs,
    },
    'alarm scheduler started',
  );
  return () => {
    clearInterval(id);
    clearInterval(purgeId);
  };
}

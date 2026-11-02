import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

// Banco próprio: os outros testes truncam TEST_DATABASE_URL em paralelo.
const testUrl =
  process.env.SCHEDULER_TEST_DATABASE_URL ??
  'postgres://medica:medica@127.0.0.1:5432/medica_certo_scheduler_test';

process.env.DATABASE_URL = testUrl;
process.env.VAPID_PUBLIC_KEY = '';
process.env.VAPID_PRIVATE_KEY = '';
process.env.BOOTSTRAP_EMAIL = '';
process.env.BOOTSTRAP_PASSWORD = '';
process.env.ALARM_REPEAT_MAX = '3';
process.env.ALARM_REPEAT_INTERVAL_MS = '120000';

const { config } = await import('./config.mjs');
const silent = { info() {}, error() {}, debug() {} };

function databaseName(url) {
  const name = new URL(url).pathname.replace(/^\//, '');
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Nome de banco inseguro: ${name}`);
  }
  return name;
}

async function ensureTestDatabase() {
  const name = databaseName(testUrl);
  const admin = new URL(testUrl);
  admin.pathname = '/postgres';
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const found = await client.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [name],
    );
    if (found.rows.length === 0) {
      await client.query(`CREATE DATABASE ${name}`);
    }
  } finally {
    await client.end();
  }
}

describe('push de dose', () => {
  it('mantém urgência alta e TTL de 1h', () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'scheduler.mjs'),
      'utf8',
    );
    assert.match(src, /ttl:\s*3600/);
    assert.match(src, /urgency:\s*'high'/);
    assert.match(src, /topic:\s*'dose'/);
    assert.equal(config.alarmRepeatMax, 3);
    assert.equal(config.alarmRepeatIntervalMs, 120_000);
  });
});

describe('repetição do alarme', { concurrency: 1 }, () => {
  /** @type {import('pg').Pool} */
  let pool;
  /** @type {() => Promise<void>} */
  let closeDb;
  /** @type {(deps?: object) => Promise<{ claimed: number, notified: number }>} */
  let runAlarmTick;
  /** @type {(caregiverId: string, doseId: string) => Promise<{ ok: boolean }>} */
  let snoozeDose;

  before(async () => {
    await ensureTestDatabase();
    const db = await import('./db.mjs');
    closeDb = db.closeDb;
    pool = db.getPool();
    const { runMigrations } = await import('./migrate.mjs');
    await runMigrations({ info() {} });
    ({ runAlarmTick } = await import('./scheduler.mjs'));
    ({ snoozeDose } = await import('./doses.mjs'));
  });

  after(async () => {
    if (closeDb) await closeDb();
  });

  beforeEach(async () => {
    await pool.query(`
      TRUNCATE TABLE
        dose_alarm_receipts,
        invite_patients,
        patient_access,
        caregiver_invites,
        notes,
        scheduled_doses,
        treatments,
        push_subscriptions,
        medications,
        patients,
        sessions,
        caregivers
      RESTART IDENTITY CASCADE
    `);
  });

  async function tick() {
    return runAlarmTick({ log: silent });
  }

  /**
   * @param {string} doseId
   * @param {string} caregiverId
   */
  async function sendCount(doseId, caregiverId) {
    const { rows } = await pool.query(
      `SELECT send_count
       FROM dose_alarm_receipts
       WHERE scheduled_dose_id = $1 AND caregiver_id = $2`,
      [doseId, caregiverId],
    );
    return rows[0] ? rows[0].send_count : null;
  }

  /**
   * @param {string} doseId
   */
  async function backdate(doseId) {
    await pool.query(
      `UPDATE dose_alarm_receipts
       SET last_sent_at = now() - interval '3 minutes'
       WHERE scheduled_dose_id = $1`,
      [doseId],
    );
  }

  async function seedDueDose() {
    const caregiver = await pool.query(
      `INSERT INTO caregivers (email, password_hash, name)
       VALUES ($1, 'x', 'Cuidador')
       RETURNING id`,
      [`alarm.${crypto.randomUUID()}@example.test`],
    );
    const caregiverId = caregiver.rows[0].id;
    const patient = await pool.query(
      `INSERT INTO patients (caregiver_id, name, birth_date)
       VALUES ($1, 'Paciente', '1970-01-01')
       RETURNING id`,
      [caregiverId],
    );
    const patientId = patient.rows[0].id;
    const med = await pool.query(
      `INSERT INTO medications (caregiver_id, name)
       VALUES ($1, $2)
       RETURNING id`,
      [caregiverId, `Med ${crypto.randomUUID()}`],
    );
    const treatment = await pool.query(
      `INSERT INTO treatments (
         caregiver_id, patient_id, medication_id, starts_at,
         dose_quantity, route, schedule_mode, interval_hours, alarms_enabled, status
       ) VALUES (
         $1, $2, $3, now() - interval '1 day',
         '1 cp', 'oral', 'regular_interval', 8, true, 'active'
       )
       RETURNING id`,
      [caregiverId, patientId, med.rows[0].id],
    );
    const dose = await pool.query(
      `INSERT INTO scheduled_doses (
         treatment_id, caregiver_id, scheduled_at, status, alarm_at
       ) VALUES ($1, $2, now() - interval '5 minutes', 'pending', now() - interval '1 minute')
       RETURNING id`,
      [treatment.rows[0].id, caregiverId],
    );
    await pool.query(
      `INSERT INTO push_subscriptions (id, caregiver_id, endpoint, p256dh, auth)
       VALUES ($1, $2, $3, 'p256dh-key', 'auth-key')`,
      [
        crypto.randomBytes(8).toString('hex'),
        caregiverId,
        `https://fcm.googleapis.com/fcm/send/${crypto.randomUUID()}`,
      ],
    );
    return { caregiverId, patientId, doseId: dose.rows[0].id };
  }

  it('envia uma vez e não repete dentro do intervalo', async () => {
    const { caregiverId, doseId } = await seedDueDose();
    const first = await tick();
    assert.equal(first.claimed, 1);
    assert.equal(await sendCount(doseId, caregiverId), 1);
    const sent = await pool.query(
      `SELECT alarm_sent_at IS NOT NULL AS sent FROM scheduled_doses WHERE id = $1`,
      [doseId],
    );
    assert.equal(sent.rows[0].sent, true);

    const second = await tick();
    assert.equal(second.claimed, 0);
    assert.equal(await sendCount(doseId, caregiverId), 1);
  });

  it('dois ticks paralelos só consomem um reenvio', async () => {
    const { caregiverId, doseId } = await seedDueDose();
    await tick();
    await backdate(doseId);
    await Promise.all([tick(), tick()]);
    assert.equal(await sendCount(doseId, caregiverId), 2);
  });

  it('repete mais 3 vezes e para', async () => {
    const { caregiverId, doseId } = await seedDueDose();
    await tick();
    assert.equal(await sendCount(doseId, caregiverId), 1);
    for (let expected = 2; expected <= 4; expected += 1) {
      await backdate(doseId);
      await tick();
      assert.equal(await sendCount(doseId, caregiverId), expected);
    }
    await backdate(doseId);
    await tick();
    assert.equal(await sendCount(doseId, caregiverId), 4);
  });

  it('não repete dose administrada', async () => {
    const { caregiverId, doseId } = await seedDueDose();
    await tick();
    await pool.query(
      `UPDATE scheduled_doses SET status = 'administered' WHERE id = $1`,
      [doseId],
    );
    await backdate(doseId);
    await tick();
    assert.equal(await sendCount(doseId, caregiverId), 1);
  });

  it('soneca apaga o recibo e só reenvia quando o novo horário vence', async () => {
    const { caregiverId, doseId } = await seedDueDose();
    await tick();
    const snoozed = await snoozeDose(caregiverId, doseId);
    assert.equal(snoozed.ok, true);
    assert.equal(await sendCount(doseId, caregiverId), null);
    await tick();
    assert.equal(await sendCount(doseId, caregiverId), null);

    await pool.query(
      `UPDATE scheduled_doses
       SET alarm_at = now() - interval '1 second'
       WHERE id = $1`,
      [doseId],
    );
    await tick();
    assert.equal(await sendCount(doseId, caregiverId), 1);
  });

  it('avisa o convidado mesmo se o dono já esgotou as repetições', async () => {
    const { caregiverId, patientId, doseId } = await seedDueDose();
    await tick();
    await pool.query(
      `UPDATE dose_alarm_receipts
       SET send_count = 4, last_sent_at = now()
       WHERE scheduled_dose_id = $1 AND caregiver_id = $2`,
      [doseId, caregiverId],
    );

    const grantee = await pool.query(
      `INSERT INTO caregivers (email, password_hash, name)
       VALUES ($1, 'x', 'Convidado')
       RETURNING id`,
      [`grantee.${crypto.randomUUID()}@example.test`],
    );
    const granteeId = grantee.rows[0].id;
    await pool.query(
      `INSERT INTO patient_access (patient_id, caregiver_id, granted_by)
       VALUES ($1, $2, $3)`,
      [patientId, granteeId, caregiverId],
    );
    await pool.query(
      `INSERT INTO push_subscriptions (id, caregiver_id, endpoint, p256dh, auth)
       VALUES ($1, $2, $3, 'p256dh-key', 'auth-key')`,
      [
        crypto.randomBytes(8).toString('hex'),
        granteeId,
        `https://fcm.googleapis.com/fcm/send/${crypto.randomUUID()}`,
      ],
    );

    const result = await tick();
    assert.equal(result.claimed, 1);
    assert.equal(await sendCount(doseId, caregiverId), 4);
    assert.equal(await sendCount(doseId, granteeId), 1);
  });
});

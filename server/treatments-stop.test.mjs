import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';
import pg from 'pg';

const testUrl =
  process.env.TEST_DATABASE_URL ??
  'postgres://medica:medica@127.0.0.1:5432/medica_certo_test';

process.env.DATABASE_URL = testUrl;
process.env.VAPID_PUBLIC_KEY = '';
process.env.VAPID_PRIVATE_KEY = '';
process.env.BOOTSTRAP_EMAIL = '';
process.env.BOOTSTRAP_PASSWORD = '';

const { parseEndTreatmentBody } = await import('./treatments.mjs');
const { civilDate, endOfDaySaoPaulo, zonedToDate } = await import(
  './domain/timezone.mjs'
);

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

describe('parseEndTreatmentBody', () => {
  const startsAt = new Date('2026-10-01T15:00:00.000Z');
  const now = new Date('2026-10-20T15:00:00.000Z');

  it('aceita data passada e motivo, guardando o fim do dia', () => {
    const parsed = parseEndTreatmentBody(
      { endedOn: '2026-10-10', endReason: '  alta hospitalar  ' },
      { startsAt, now },
    );
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.value.endedOn, '2026-10-10');
    assert.equal(parsed.value.endReason, 'alta hospitalar');
    assert.equal(
      parsed.value.endedAt.getTime(),
      zonedToDate(endOfDaySaoPaulo('2026-10-10')).getTime(),
    );
  });

  it('usa hoje e motivo nulo quando o corpo vem vazio', () => {
    const parsed = parseEndTreatmentBody({ endReason: '   ' }, { startsAt, now });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.value.endedOn, civilDate(now));
    assert.equal(parsed.value.endReason, null);
    assert.equal(parsed.value.endedAt.getTime(), now.getTime());
  });

  it('rejeita data futura, anterior ao início, inválida ou motivo longo', () => {
    const future = parseEndTreatmentBody(
      { endedOn: '2026-10-21' },
      { startsAt, now },
    );
    const early = parseEndTreatmentBody(
      { endedOn: '2026-09-01' },
      { startsAt, now },
    );
    const invalid = parseEndTreatmentBody(
      { endedOn: '2026-02-31' },
      { startsAt, now },
    );
    const long = parseEndTreatmentBody(
      { endReason: 'x'.repeat(501) },
      { startsAt, now },
    );
    assert.equal(future.ok, false);
    assert.equal(early.ok, false);
    assert.equal(invalid.ok, false);
    assert.equal(long.ok, false);
    if (!future.ok) assert.match(future.fields.endedOn, /futuro/);
    if (!early.ok) assert.match(early.fields.endedOn, /anterior/);
    if (!invalid.ok) assert.match(invalid.fields.endedOn, /inválida/);
    if (!long.ok) assert.match(long.fields.endReason, /longo/);
  });
});

describe('parar medicamento', { concurrency: 1 }, () => {
  /** @type {import('fastify').FastifyInstance} */
  let app;
  /** @type {import('pg').Pool} */
  let pool;
  /** @type {() => Promise<void>} */
  let closeDb;
  /** @type {(caregiverId: string, opts?: { limit?: number }) => Promise<{ upcoming: { medicationName: string }[], overdue: { medicationName: string }[], dueAlarms: { medicationName: string }[] }>} */
  let getDashboard;
  /** @type {(deps?: object) => Promise<{ claimed: number }>} */
  let runAlarmTick;

  before(async () => {
    await ensureTestDatabase();
    const db = await import('./db.mjs');
    closeDb = db.closeDb;
    pool = db.getPool();
    const { runMigrations } = await import('./migrate.mjs');
    await runMigrations({ info() {} });
    const { buildApp } = await import('./app.mjs');
    app = await buildApp({ logger: false });
    await app.ready();
    ({ getDashboard } = await import('./doses.mjs'));
    ({ runAlarmTick } = await import('./scheduler.mjs'));
  });

  after(async () => {
    if (app) await app.close();
    if (closeDb) await closeDb();
  });

  beforeEach(async () => {
    await pool.query(`
      TRUNCATE TABLE
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

  async function scalar(sql, params = []) {
    const { rows } = await pool.query(sql, params);
    return rows[0].n;
  }

  async function seed(label) {
    const email = `${label}.${crypto.randomUUID()}@example.test`;
    const caregiver = await pool.query(
      `INSERT INTO caregivers (email, password_hash, name)
       VALUES ($1, 'x', $2)
       RETURNING id`,
      [email, label],
    );
    const caregiverId = caregiver.rows[0].id;
    const sessionId = crypto.randomBytes(18).toString('base64url');
    await pool.query(
      `INSERT INTO sessions (id, caregiver_id, expires_at)
       VALUES ($1, $2, now() + interval '2 days')`,
      [sessionId, caregiverId],
    );
    const patient = await pool.query(
      `INSERT INTO patients (caregiver_id, name, birth_date)
       VALUES ($1, $2, '1970-04-02')
       RETURNING id`,
      [caregiverId, `Paciente ${label}`],
    );
    return {
      caregiverId,
      cookie: `mc_session=${sessionId}`,
      patientId: patient.rows[0].id,
    };
  }

  async function addMedication(caregiverId, name) {
    const { rows } = await pool.query(
      `INSERT INTO medications (caregiver_id, name)
       VALUES ($1, $2)
       RETURNING id, name`,
      [caregiverId, name],
    );
    return rows[0];
  }

  async function createContinuous(cookie, patientId, medicationId, startsAt) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/treatments',
      headers: {
        cookie,
        'content-type': 'application/json',
      },
      payload: JSON.stringify({
        patientId,
        medicationId,
        startsAt,
        doseQuantity: '1 comprimido',
        route: 'VO',
        scheduleMode: 'regular_interval',
        intervalHours: 8,
        alarmsEnabled: true,
      }),
    });
    assert.equal(res.statusCode, 201, res.body);
    return res.json().treatment;
  }

  it('encerra com data e motivo, cancela doses futuras e mantém o histórico', async () => {
    const owner = await seed('dona');
    const medication = await addMedication(owner.caregiverId, 'Amoxicilina');
    const startsAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const treatment = await createContinuous(
      owner.cookie,
      owner.patientId,
      medication.id,
      startsAt,
    );
    const endedOn = Temporal.Now.zonedDateTimeISO('America/Sao_Paulo')
      .toPlainDate()
      .subtract({ days: 3 })
      .toString();
    const endedAt = zonedToDate(endOfDaySaoPaulo(endedOn));

    await pool.query(
      `UPDATE scheduled_doses
       SET status = 'administered', administered_at = scheduled_at, updated_at = now()
       WHERE id = (
         SELECT id FROM scheduled_doses
         WHERE treatment_id = $1
         ORDER BY scheduled_at ASC
         LIMIT 1
       )`,
      [treatment.id],
    );

    const future = await app.inject({
      method: 'POST',
      url: `/api/treatments/${treatment.id}/end`,
      headers: {
        cookie: owner.cookie,
        'content-type': 'application/json',
      },
      payload: JSON.stringify({ endedOn: '2999-01-01' }),
    });
    assert.equal(future.statusCode, 400, future.body);
    assert.equal(future.json().error.fields.endedOn != null, true);

    const res = await app.inject({
      method: 'POST',
      url: `/api/treatments/${treatment.id}/end`,
      headers: {
        cookie: owner.cookie,
        'content-type': 'application/json',
      },
      payload: JSON.stringify({
        endedOn,
        endReason: '  fim do antibiótico  ',
      }),
    });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.equal(body.treatment.status, 'ended');
    assert.equal(body.treatment.endReason, 'fim do antibiótico');

    const row = await pool.query(
      `SELECT status, end_reason, ended_at FROM treatments WHERE id = $1`,
      [treatment.id],
    );
    assert.equal(row.rows[0].status, 'ended');
    assert.equal(row.rows[0].end_reason, 'fim do antibiótico');
    assert.equal(new Date(row.rows[0].ended_at).getTime(), endedAt.getTime());

    assert.equal(
      await scalar(
        `SELECT count(*)::int AS n FROM scheduled_doses
         WHERE treatment_id = $1 AND status = 'pending' AND scheduled_at > $2`,
        [treatment.id, endedAt],
      ),
      0,
    );
    assert.ok(
      (await scalar(
        `SELECT count(*)::int AS n FROM scheduled_doses
         WHERE treatment_id = $1 AND status = 'cancelled'`,
        [treatment.id],
      )) > 0,
    );
    assert.ok(
      (await scalar(
        `SELECT count(*)::int AS n FROM scheduled_doses
         WHERE treatment_id = $1 AND status = 'pending' AND scheduled_at <= $2`,
        [treatment.id, endedAt],
      )) > 0,
    );
    assert.equal(
      await scalar(
        `SELECT count(*)::int AS n FROM scheduled_doses
         WHERE treatment_id = $1 AND status = 'administered'`,
        [treatment.id],
      ),
      1,
    );
    assert.equal(
      await scalar(
        `SELECT count(*)::int AS n FROM scheduled_doses
         WHERE treatment_id = $1 AND status = 'pending' AND alarm_at IS NOT NULL`,
        [treatment.id],
      ),
      0,
    );

    const again = await app.inject({
      method: 'POST',
      url: `/api/treatments/${treatment.id}/end`,
      headers: {
        cookie: owner.cookie,
        'content-type': 'application/json',
      },
      payload: '{}',
    });
    assert.equal(again.statusCode, 409);

    const listed = await app.inject({
      method: 'GET',
      url: `/api/patients/${owner.patientId}/treatments`,
      headers: { cookie: owner.cookie },
    });
    assert.equal(listed.statusCode, 200);
    const found = listed.json().treatments.find((item) => item.id === treatment.id);
    assert.equal(found.status, 'ended');
    assert.equal(found.endReason, 'fim do antibiótico');
  });

  it('remove o vínculo e as dependências sem apagar o catálogo nem outro tratamento', async () => {
    const owner = await seed('dona');
    const wrong = await addMedication(owner.caregiverId, 'Cadastro errado');
    const kept = await addMedication(owner.caregiverId, 'Losartana');
    const startsAt = new Date().toISOString();
    const doomed = await createContinuous(
      owner.cookie,
      owner.patientId,
      wrong.id,
      startsAt,
    );
    const survivor = await createContinuous(
      owner.cookie,
      owner.patientId,
      kept.id,
      startsAt,
    );
    const dose = await pool.query(
      `SELECT id FROM scheduled_doses WHERE treatment_id = $1 LIMIT 1`,
      [doomed.id],
    );
    await pool.query(
      `INSERT INTO notes (caregiver_id, treatment_id, body)
       VALUES ($1, $2, 'anotação do vínculo')`,
      [owner.caregiverId, doomed.id],
    );
    await pool.query(
      `INSERT INTO notes (caregiver_id, scheduled_dose_id, body)
       VALUES ($1, $2, 'anotação da dose')`,
      [owner.caregiverId, dose.rows[0].id],
    );
    await pool.query(
      `INSERT INTO notes (caregiver_id, treatment_id, body)
       VALUES ($1, $2, 'anotação que fica')`,
      [owner.caregiverId, survivor.id],
    );

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/treatments/${doomed.id}`,
      headers: { cookie: owner.cookie },
    });
    assert.equal(res.statusCode, 204, res.body);

    assert.equal(
      await scalar(`SELECT count(*)::int AS n FROM treatments WHERE id = $1`, [
        doomed.id,
      ]),
      0,
    );
    assert.equal(
      await scalar(
        `SELECT count(*)::int AS n FROM scheduled_doses WHERE treatment_id = $1`,
        [doomed.id],
      ),
      0,
    );
    assert.equal(
      await scalar(
        `SELECT count(*)::int AS n FROM notes
         WHERE treatment_id = $1
            OR scheduled_dose_id = $2`,
        [doomed.id, dose.rows[0].id],
      ),
      0,
    );
    assert.equal(
      await scalar(
        `SELECT count(*)::int AS n FROM notes WHERE treatment_id = $1`,
        [survivor.id],
      ),
      1,
    );
    assert.equal(
      await scalar(`SELECT count(*)::int AS n FROM treatments WHERE id = $1`, [
        survivor.id,
      ]),
      1,
    );
    assert.equal(
      await scalar(`SELECT count(*)::int AS n FROM medications WHERE id = $1`, [
        wrong.id,
      ]),
      1,
    );
    assert.equal(
      await scalar(`SELECT count(*)::int AS n FROM patients WHERE id = $1`, [
        owner.patientId,
      ]),
      1,
    );

    const again = await app.inject({
      method: 'DELETE',
      url: `/api/treatments/${doomed.id}`,
      headers: { cookie: owner.cookie },
    });
    assert.equal(again.statusCode, 404);
  });

  it('só o cuidador dono do paciente encerra ou remove', async () => {
    const owner = await seed('dona');
    const other = await seed('outro');
    const medication = await addMedication(owner.caregiverId, 'Dipirona');
    const treatment = await createContinuous(
      owner.cookie,
      owner.patientId,
      medication.id,
      new Date().toISOString(),
    );

    const endOther = await app.inject({
      method: 'POST',
      url: `/api/treatments/${treatment.id}/end`,
      headers: {
        cookie: other.cookie,
        'content-type': 'application/json',
      },
      payload: '{}',
    });
    assert.equal(endOther.statusCode, 404);
    assert.equal(endOther.json().error.code, 'NOT_FOUND');

    const deleteOther = await app.inject({
      method: 'DELETE',
      url: `/api/treatments/${treatment.id}`,
      headers: { cookie: other.cookie },
    });
    assert.equal(deleteOther.statusCode, 404);

    const endAnon = await app.inject({
      method: 'POST',
      url: `/api/treatments/${treatment.id}/end`,
      headers: { 'content-type': 'application/json' },
      payload: '{}',
    });
    assert.equal(endAnon.statusCode, 401);
    assert.equal(endAnon.json().error.code, 'UNAUTHORIZED');

    const deleteAnon = await app.inject({
      method: 'DELETE',
      url: `/api/treatments/${treatment.id}`,
    });
    assert.equal(deleteAnon.statusCode, 401);

    assert.equal(
      await scalar(
        `SELECT count(*)::int AS n FROM treatments WHERE id = $1 AND status = 'active'`,
        [treatment.id],
      ),
      1,
    );
    assert.ok(
      (await scalar(
        `SELECT count(*)::int AS n FROM scheduled_doses WHERE treatment_id = $1`,
        [treatment.id],
      )) > 0,
    );
  });

  it('tratamento encerrado não estende a grade nem dispara push', async () => {
    const owner = await seed('dona');
    const endedMed = await addMedication(
      owner.caregiverId,
      'Amoxicilina encerrada',
    );
    const activeMed = await addMedication(owner.caregiverId, 'Losartana ativa');
    const startsAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const ended = await createContinuous(
      owner.cookie,
      owner.patientId,
      endedMed.id,
      startsAt,
    );
    const active = await createContinuous(
      owner.cookie,
      owner.patientId,
      activeMed.id,
      startsAt,
    );

    const endRes = await app.inject({
      method: 'POST',
      url: `/api/treatments/${ended.id}/end`,
      headers: {
        cookie: owner.cookie,
        'content-type': 'application/json',
      },
      payload: '{}',
    });
    assert.equal(endRes.statusCode, 200, endRes.body);

    await pool.query(
      `UPDATE treatments
       SET generated_until = now() + interval '47 hours'
       WHERE id = ANY($1::uuid[])`,
      [[ended.id, active.id]],
    );

    const endedBefore = await scalar(
      `SELECT count(*)::int AS n FROM scheduled_doses WHERE treatment_id = $1`,
      [ended.id],
    );
    const activeBefore = await scalar(
      `SELECT count(*)::int AS n FROM scheduled_doses WHERE treatment_id = $1`,
      [active.id],
    );

    const endedDoses = await app.inject({
      method: 'GET',
      url: `/api/treatments/${ended.id}/doses`,
      headers: { cookie: owner.cookie },
    });
    const activeDoses = await app.inject({
      method: 'GET',
      url: `/api/treatments/${active.id}/doses`,
      headers: { cookie: owner.cookie },
    });
    assert.equal(endedDoses.statusCode, 200, endedDoses.body);
    assert.equal(activeDoses.statusCode, 200, activeDoses.body);

    assert.equal(
      await scalar(
        `SELECT count(*)::int AS n FROM scheduled_doses WHERE treatment_id = $1`,
        [ended.id],
      ),
      endedBefore,
    );
    assert.ok(
      (await scalar(
        `SELECT count(*)::int AS n FROM scheduled_doses WHERE treatment_id = $1`,
        [active.id],
      )) > activeBefore,
    );

    const revived = await pool.query(
      `UPDATE scheduled_doses
       SET status = 'pending',
           alarm_at = now() - interval '1 minute',
           alarm_sent_at = NULL,
           updated_at = now()
       WHERE id = (
         SELECT id FROM scheduled_doses
         WHERE treatment_id = $1
         ORDER BY scheduled_at ASC
         LIMIT 1
       )
       RETURNING id`,
      [ended.id],
    );
    const revivedId = revived.rows[0].id;

    await pool.query(
      `INSERT INTO push_subscriptions (id, caregiver_id, endpoint, p256dh, auth)
       VALUES ($1, $2, $3, 'p256', 'auth')`,
      [
        crypto.randomUUID(),
        owner.caregiverId,
        `https://push.example.test/${owner.caregiverId}`,
      ],
    );

    await runAlarmTick({ log: { info() {}, error() {}, debug() {} } });

    const revivedRow = await pool.query(
      `SELECT alarm_sent_at, status FROM scheduled_doses WHERE id = $1`,
      [revivedId],
    );
    assert.equal(revivedRow.rows[0].alarm_sent_at, null);
    assert.equal(revivedRow.rows[0].status, 'pending');
    assert.ok(
      (await scalar(
        `SELECT count(*)::int AS n FROM scheduled_doses
         WHERE treatment_id = $1 AND alarm_sent_at IS NOT NULL`,
        [active.id],
      )) > 0,
    );

    const dash = await getDashboard(owner.caregiverId);
    const names = [...dash.upcoming, ...dash.overdue, ...dash.dueAlarms].map(
      (item) => item.medicationName,
    );
    assert.equal(names.includes('Amoxicilina encerrada'), false);
    assert.equal(names.includes('Losartana ativa'), true);
  });
});

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';
import pg from 'pg';

const sharedUrl =
  process.env.TEST_DATABASE_URL ??
  'postgres://medica:medica@127.0.0.1:5432/medica_certo_test';
const testUrl = new URL(sharedUrl);
testUrl.pathname = '/medica_certo_invite_test';
const testUrlString = testUrl.toString();

process.env.DATABASE_URL = testUrlString;
process.env.VAPID_PUBLIC_KEY = '';
process.env.VAPID_PRIVATE_KEY = '';
process.env.BOOTSTRAP_EMAIL = '';
process.env.BOOTSTRAP_PASSWORD = '';

const {
  DEFAULT_INVITE_DAYS,
  INVITE_INVALID_MESSAGE,
  REGISTER_FAILED_MESSAGE,
  evaluateInvite,
  generateInviteToken,
  hashInviteToken,
  hashesEqual,
  inviteExpiresAt,
  parseInviteCreateBody,
  promoteOldestCaregiver,
  registrationDecision,
} = await import('./invites.mjs');

const {
  inviteLookupRateLimit,
  inviteManageRateLimit,
  registerRateLimit,
} = await import('./auth.mjs');

function databaseName(url) {
  const name = new URL(url).pathname.replace(/^\//, '');
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Nome de banco inseguro: ${name}`);
  }
  return name;
}

async function ensureTestDatabase() {
  const name = databaseName(testUrlString);
  const admin = new URL(testUrlString);
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

function account(label) {
  return {
    email: `${label}.${crypto.randomUUID()}@example.test`,
    password: 'senha-segura',
    name: label,
  };
}

describe('regras de convite', () => {
  it('gera token opaco e guarda só o hash', () => {
    const { token, tokenHash } = generateInviteToken();
    assert.equal(token.length >= 40, true);
    assert.notEqual(token, tokenHash);
    assert.equal(tokenHash, hashInviteToken(token));
    assert.equal(hashesEqual(tokenHash, tokenHash), true);
    assert.equal(hashesEqual(null, tokenHash), false);
    assert.equal(hashesEqual(tokenHash, hashInviteToken(`${token}x`)), false);
    assert.equal(hashesEqual(tokenHash, 'curto'), false);
  });

  it('recusa convite usado, expirado, revogado ou desconhecido', () => {
    const now = new Date('2026-10-31T12:00:00.000Z');
    const { tokenHash } = generateInviteToken();
    const base = {
      token_hash: tokenHash,
      expires_at: inviteExpiresAt(now, DEFAULT_INVITE_DAYS).toISOString(),
      used_at: null,
      revoked_at: null,
    };
    assert.equal(evaluateInvite(base, now, tokenHash).ok, true);
    assert.equal(
      evaluateInvite({ ...base, used_at: now.toISOString() }, now, tokenHash)
        .reason,
      'used',
    );
    assert.equal(
      evaluateInvite(
        { ...base, expires_at: new Date(now.getTime() - 1000).toISOString() },
        now,
        tokenHash,
      ).reason,
      'expired',
    );
    assert.equal(
      evaluateInvite(
        { ...base, revoked_at: now.toISOString() },
        now,
        tokenHash,
      ).reason,
      'revoked',
    );
    assert.equal(evaluateInvite(null, now, tokenHash).reason, 'invalid');
  });

  it('fecha o cadastro sem convite depois do primeiro cuidador', () => {
    assert.equal(registrationDecision({ caregiverCount: 0, inviteToken: '' }).mode, 'bootstrap');
    assert.equal(
      registrationDecision({ caregiverCount: 2, inviteToken: '   ' }).mode,
      'closed',
    );
    assert.equal(
      registrationDecision({ caregiverCount: 2, inviteToken: undefined }).mode,
      'closed',
    );
    const withToken = registrationDecision({
      caregiverCount: 0,
      inviteToken: 'token-presente',
    });
    assert.equal(withToken.mode, 'invite');
    if (withToken.mode === 'invite') assert.equal(withToken.token, 'token-presente');
  });

  it('exige e-mail e pacientes no convite', () => {
    const parsed = parseInviteCreateBody({});
    assert.equal(parsed.ok, false);
    if (!parsed.ok) {
      assert.ok(parsed.fields.email);
      assert.ok(parsed.fields.patientIds);
    }
    const bound = parseInviteCreateBody({
      email: '  Ana@Example.com ',
      expiresInDays: '14',
      patientIds: ['11111111-1111-4111-8111-111111111111'],
    });
    assert.equal(bound.ok, true);
    if (bound.ok) {
      assert.equal(bound.value.email, 'ana@example.com');
      assert.equal(bound.value.expiresInDays, 14);
      assert.equal(bound.value.patientIds.length, 1);
    }
    const bad = parseInviteCreateBody({ expiresInDays: 0, email: 'nao-e-email' });
    assert.equal(bad.ok, false);
  });
});

describe('convites na API', { concurrency: 1 }, () => {
  /** @type {import('fastify').FastifyInstance} */
  let app;
  /** @type {import('pg').Pool} */
  let pool;
  /** @type {() => Promise<void>} */
  let closeDb;

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
  });

  after(async () => {
    if (app) await app.close();
    if (closeDb) await closeDb();
  });

  beforeEach(async () => {
    registerRateLimit.reset();
    inviteLookupRateLimit.reset();
    inviteManageRateLimit.reset();
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

  /**
   * @param {string} url
   * @param {unknown} payload
   * @param {string} [cookie]
   */
  function postJson(url, payload, cookie) {
    return app.inject({
      method: 'POST',
      url,
      headers: {
        'content-type': 'application/json',
        ...(cookie ? { cookie } : {}),
      },
      payload: JSON.stringify(payload),
    });
  }

  /**
   * @param {{ email: string, password: string, name: string, inviteToken?: string }} body
   */
  function postRegister(body) {
    return postJson('/api/auth/register', body);
  }

  async function bootstrapAdmin() {
    const admin = account('admin');
    const res = await postRegister(admin);
    assert.equal(res.statusCode, 201, res.body);
    const body = res.json();
    assert.equal(body.caregiver.isAdmin, true);
    const raw = res.headers['set-cookie'];
    const line = Array.isArray(raw) ? raw[0] : String(raw);
    assert.match(line, /HttpOnly/i);
    return {
      ...admin,
      id: body.caregiver.id,
      cookie: line.split(';')[0],
    };
  }

  /**
   * @param {string} cookie
   * @param {string} [name]
   */
  async function createPatient(cookie, name = 'Paciente teste') {
    const res = await postJson(
      '/api/patients',
      { name, birthDate: '1980-01-02' },
      cookie,
    );
    assert.equal(res.statusCode, 201, res.body);
    return res.json().patient;
  }

  /**
   * @param {string} cookie
   * @param {{ email?: string, expiresInDays?: number, patientIds?: string[] }} [body]
   */
  async function createInvite(cookie, body = {}) {
    let patientIds = body.patientIds;
    if (!patientIds?.length) {
      const patient = await createPatient(cookie);
      patientIds = [patient.id];
    }
    const payload = {
      email: body.email ?? `convidado.${crypto.randomUUID()}@example.test`,
      expiresInDays: body.expiresInDays,
      patientIds,
    };
    const res = await postJson('/api/invites', payload, cookie);
    assert.equal(res.statusCode, 201, res.body);
    return res.json();
  }

  it('promove só o cuidador mais antigo quando ninguém é admin', async () => {
    await pool.query(
      `INSERT INTO caregivers (email, password_hash, name, created_at)
       VALUES
         ('antigo@example.test', 'x', 'Antigo', now() - interval '10 days'),
         ('novo@example.test', 'x', 'Novo', now())`,
    );
    await promoteOldestCaregiver(pool);
    const { rows } = await pool.query(
      `SELECT email::text AS email, is_admin
       FROM caregivers
       ORDER BY created_at ASC`,
    );
    assert.deepEqual(
      rows.map((row) => [row.email, row.is_admin]),
      [
        ['antigo@example.test', true],
        ['novo@example.test', false],
      ],
    );

    await pool.query(
      `UPDATE caregivers SET is_admin = (email = 'novo@example.test')`,
    );
    await promoteOldestCaregiver(pool);
    const again = await pool.query(
      `SELECT email::text AS email, is_admin
       FROM caregivers
       ORDER BY created_at ASC`,
    );
    assert.equal(again.rows[0].is_admin, false);
    assert.equal(again.rows[1].is_admin, true);
  });

  it('gera convite de uso único e não persiste o token', async () => {
    const admin = await bootstrapAdmin();
    const created = await createInvite(admin.cookie, {
      email: 'Convidado@Example.test',
    });
    assert.equal(created.invite.status, 'pending');
    assert.equal(created.invite.email, 'convidado@example.test');
    assert.equal(typeof created.token, 'string');
    const expires = new Date(created.invite.expiresAt).getTime();
    const expected = Date.now() + 7 * 24 * 60 * 60 * 1000;
    assert.ok(Math.abs(expires - expected) < 60_000);

    const stored = await pool.query(
      'SELECT * FROM caregiver_invites WHERE id = $1',
      [created.invite.id],
    );
    assert.equal(stored.rows[0].token_hash, hashInviteToken(created.token));
    assert.equal(JSON.stringify(stored.rows[0]).includes(created.token), false);

    const columns = await pool.query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_name = 'caregiver_invites'`,
    );
    assert.equal(
      columns.rows.some((row) => row.column_name === 'token'),
      false,
    );

    const list = await app.inject({
      method: 'GET',
      url: '/api/invites',
      headers: { cookie: admin.cookie },
    });
    assert.equal(list.statusCode, 200, list.body);
    const listed = JSON.stringify(list.json());
    assert.equal(listed.includes(created.token), false);
    assert.equal(listed.includes(stored.rows[0].token_hash), false);
    assert.equal(list.json().invites[0].status, 'pending');
  });

  it('cadastra pelo convite, compartilha pacientes e bloqueia edição', async () => {
    const admin = await bootstrapAdmin();
    const owned = await createPatient(admin.cookie, 'Paciente da Ana');
    const invitee = account('ana');
    const created = await createInvite(admin.cookie, {
      email: invitee.email,
      patientIds: [owned.id],
    });
    const res = await postRegister({ ...invitee, inviteToken: created.token });
    assert.equal(res.statusCode, 201, res.body);
    assert.equal(res.json().caregiver.isAdmin, false);
    const raw = res.headers['set-cookie'];
    const line = Array.isArray(raw) ? raw[0] : String(raw);
    const cookie = line.split(';')[0];

    const adminList = await app.inject({
      method: 'GET',
      url: '/api/patients',
      headers: { cookie: admin.cookie },
    });
    const inviteeList = await app.inject({
      method: 'GET',
      url: '/api/patients',
      headers: { cookie },
    });
    assert.equal(adminList.json().patients.length, 1);
    assert.equal(inviteeList.json().patients.length, 1);
    assert.equal(inviteeList.json().patients[0].name, 'Paciente da Ana');
    assert.equal(inviteeList.json().patients[0].access, 'grantee');

    const denied = await postJson(
      '/api/patients',
      {
        name: 'Outro',
        birthDate: '1980-01-02',
      },
      cookie,
    );
    assert.equal(denied.statusCode, 201, denied.body);

    const putDenied = await app.inject({
      method: 'PUT',
      url: `/api/patients/${owned.id}`,
      headers: { cookie, 'content-type': 'application/json' },
      payload: JSON.stringify({
        name: 'Hackeado',
        birthDate: '1980-01-02',
      }),
    });
    assert.equal(putDenied.statusCode, 404);
  });

  it('recusa reutilizar o mesmo convite', async () => {
    const admin = await bootstrapAdmin();
    const firstAccount = account('primeiro');
    const created = await createInvite(admin.cookie, { email: firstAccount.email });
    const first = await postRegister({
      ...firstAccount,
      inviteToken: created.token,
    });
    assert.equal(first.statusCode, 201, first.body);

    const second = await postRegister({
      ...account('segundo'),
      email: firstAccount.email,
      inviteToken: created.token,
    });
    assert.equal(second.statusCode, 400, second.body);
    assert.equal(second.json().error.code, 'INVITE_INVALID');
    assert.equal(second.json().error.message, INVITE_INVALID_MESSAGE);
    assert.equal(second.headers['set-cookie'], undefined);

    const count = await pool.query(
      'SELECT COUNT(*)::int AS n FROM caregivers WHERE is_admin = false',
    );
    assert.equal(count.rows[0].n, 1);
  });

  it('recusa convite expirado', async () => {
    const admin = await bootstrapAdmin();
    const created = await createInvite(admin.cookie, { expiresInDays: 1 });
    await pool.query(
      `UPDATE caregiver_invites
       SET expires_at = now() - interval '1 minute'
       WHERE id = $1`,
      [created.invite.id],
    );

    const res = await postRegister({
      ...account('tarde'),
      inviteToken: created.token,
    });
    assert.equal(res.statusCode, 400, res.body);
    assert.equal(res.json().error.code, 'INVITE_INVALID');
    assert.equal(res.json().error.message, INVITE_INVALID_MESSAGE);

    const list = await app.inject({
      method: 'GET',
      url: '/api/invites',
      headers: { cookie: admin.cookie },
    });
    assert.equal(list.json().invites[0].status, 'expired');
    const caregivers = await pool.query('SELECT COUNT(*)::int AS n FROM caregivers');
    assert.equal(caregivers.rows[0].n, 1);
  });

  it('revoga convite pendente e impede o cadastro', async () => {
    const admin = await bootstrapAdmin();
    const created = await createInvite(admin.cookie);
    const revoked = await postJson(
      `/api/invites/${created.invite.id}/revoke`,
      {},
      admin.cookie,
    );
    assert.equal(revoked.statusCode, 200, revoked.body);
    assert.equal(revoked.json().invite.status, 'revoked');

    const again = await postJson(
      `/api/invites/${created.invite.id}/revoke`,
      {},
      admin.cookie,
    );
    assert.equal(again.statusCode, 409, again.body);

    const res = await postRegister({
      ...account('revogado'),
      inviteToken: created.token,
    });
    assert.equal(res.statusCode, 400, res.body);
    assert.equal(res.json().error.message, INVITE_INVALID_MESSAGE);

    const unknown = await app.inject({
      method: 'GET',
      url: `/api/auth/invites/${'a'.repeat(43)}`,
    });
    const lookup = await app.inject({
      method: 'GET',
      url: `/api/auth/invites/${created.token}`,
    });
    assert.equal(lookup.statusCode, unknown.statusCode);
    assert.deepEqual(lookup.json().error, unknown.json().error);
  });

  it('recusa cadastro sem convite quando já existe cuidador', async () => {
    await bootstrapAdmin();
    const res = await postRegister(account('intruso'));
    assert.equal(res.statusCode, 409, res.body);
    assert.equal(res.json().error.code, 'BOOTSTRAP_CLOSED');
    assert.equal(res.json().error.message, 'Cadastro inicial já foi feito.');
    const count = await pool.query('SELECT COUNT(*)::int AS n FROM caregivers');
    assert.equal(count.rows[0].n, 1);
  });

  it('não abre o bootstrap com um token inválido', async () => {
    const res = await postRegister({
      ...account('falso'),
      inviteToken: 'token-que-nao-existe-mesmo',
    });
    assert.equal(res.statusCode, 400, res.body);
    assert.equal(res.json().error.code, 'INVITE_INVALID');
    const count = await pool.query('SELECT COUNT(*)::int AS n FROM caregivers');
    assert.equal(count.rows[0].n, 0);
  });

  it('não revela se o e-mail já existe e não consome o convite', async () => {
    const admin = await bootstrapAdmin();
    const created = await createInvite(admin.cookie, { email: admin.email });
    const res = await postRegister({
      email: admin.email,
      password: 'outra-senha-forte',
      name: 'Outra pessoa',
      inviteToken: created.token,
    });
    assert.equal(res.statusCode, 409, res.body);
    assert.equal(res.json().error.code, 'REGISTER_FAILED');
    assert.equal(res.json().error.message, REGISTER_FAILED_MESSAGE);
    assert.equal(res.json().error.fields, undefined);
    assert.equal(JSON.stringify(res.json()).includes(admin.email), false);
    assert.doesNotMatch(res.json().error.message, /existe|já cadastrad|already/i);

    const row = await pool.query(
      'SELECT used_at FROM caregiver_invites WHERE id = $1',
      [created.invite.id],
    );
    assert.equal(row.rows[0].used_at, null);
  });

  it('amarra o e-mail informado no convite', async () => {
    const admin = await bootstrapAdmin();
    const created = await createInvite(admin.cookie, {
      email: 'ana@example.test',
    });
    const wrong = await postRegister({
      ...account('outra'),
      inviteToken: created.token,
    });
    assert.equal(wrong.statusCode, 400, wrong.body);
    assert.equal(wrong.json().error.fields.email, 'Este convite é para outro e-mail.');

    const right = await postRegister({
      email: 'ANA@example.test',
      password: 'senha-segura',
      name: 'Ana',
      inviteToken: created.token,
    });
    assert.equal(right.statusCode, 201, right.body);
    assert.equal(right.json().caregiver.email, 'ana@example.test');
  });

  it('convidado sem paciente próprio não gera convite incompleto', async () => {
    const admin = await bootstrapAdmin();
    const invitee = account('comum');
    const created = await createInvite(admin.cookie, { email: invitee.email });
    const registered = await postRegister({
      ...invitee,
      inviteToken: created.token,
    });
    assert.equal(registered.statusCode, 201, registered.body);
    const raw = registered.headers['set-cookie'];
    const cookie = (Array.isArray(raw) ? raw[0] : String(raw)).split(';')[0];

    const create = await postJson(
      '/api/invites',
      { email: 'outro@example.test', patientIds: [] },
      cookie,
    );
    assert.equal(create.statusCode, 400, create.body);
    assert.equal(create.json().error.code, 'VALIDATION');
  });

  it('serializa dois cadastros com o mesmo convite', async () => {
    const admin = await bootstrapAdmin();
    const sharedEmail = `duplo.${crypto.randomUUID()}@example.test`;
    const created = await createInvite(admin.cookie, { email: sharedEmail });
    const [a, b] = await Promise.all([
      postRegister({
        ...account('a'),
        email: sharedEmail,
        inviteToken: created.token,
      }),
      postRegister({
        ...account('b'),
        email: sharedEmail,
        inviteToken: created.token,
      }),
    ]);
    const statuses = [a.statusCode, b.statusCode].sort();
    assert.deepEqual(statuses, [201, 400]);
    const count = await pool.query(
      'SELECT COUNT(*)::int AS n FROM caregivers WHERE is_admin = false',
    );
    assert.equal(count.rows[0].n, 1);
  });

  it('limita cadastro por IP mesmo trocando o e-mail', async () => {
    await bootstrapAdmin();
    registerRateLimit.reset();
    for (let i = 0; i < 10; i += 1) {
      const res = await postRegister(account(`spray${i}`));
      assert.equal(res.statusCode, 409, res.body);
      assert.equal(res.json().error.code, 'BOOTSTRAP_CLOSED');
    }
    const blocked = await postRegister(account('spray-extra'));
    assert.equal(blocked.statusCode, 429, blocked.body);
    assert.equal(blocked.json().error.code, 'RATE_LIMITED');
  });

  it('limita cadastro, consulta e geração de convite', async () => {
    const admin = await bootstrapAdmin();
    registerRateLimit.reset();
    const email = `spray.${crypto.randomUUID()}@example.test`;
    for (let i = 0; i < 10; i += 1) {
      const res = await postRegister({
        email,
        password: 'senha-segura',
        name: 'Spray',
      });
      assert.equal(res.statusCode, 409, res.body);
    }
    const blockedRegister = await postRegister({
      email,
      password: 'senha-segura',
      name: 'Spray',
    });
    assert.equal(blockedRegister.statusCode, 429);
    assert.equal(blockedRegister.json().error.code, 'RATE_LIMITED');

    inviteLookupRateLimit.reset();
    const unknown = `/api/auth/invites/${'b'.repeat(43)}`;
    for (let i = 0; i < 10; i += 1) {
      const res = await app.inject({ method: 'GET', url: unknown });
      assert.equal(res.statusCode, 404, res.body);
    }
    const blockedLookup = await app.inject({ method: 'GET', url: unknown });
    assert.equal(blockedLookup.statusCode, 429);

    inviteManageRateLimit.reset();
    const patient = await createPatient(admin.cookie);
    for (let i = 0; i < 10; i += 1) {
      const res = await postJson(
        '/api/invites',
        {
          email: `rate.${i}@example.test`,
          patientIds: [patient.id],
        },
        admin.cookie,
      );
      assert.equal(res.statusCode, 201, res.body);
    }
    const blockedCreate = await postJson(
      '/api/invites',
      { email: 'blocked@example.test', patientIds: [patient.id] },
      admin.cookie,
    );
    assert.equal(blockedCreate.statusCode, 429);
    assert.equal(blockedCreate.json().error.code, 'RATE_LIMITED');
  });
});

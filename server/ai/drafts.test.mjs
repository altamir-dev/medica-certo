import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { after, before, describe, it } from 'node:test';
import pg from 'pg';

const testUrl =
  process.env.TEST_DATABASE_URL ??
  'postgres://medica:medica@127.0.0.1:5432/medica_certo_test';
const databaseUrl = new URL(testUrl);
databaseUrl.pathname = '/medica_certo_draft_test';
const testUrlString = databaseUrl.toString();

process.env.DATABASE_URL = testUrlString;
process.env.VAPID_PUBLIC_KEY = '';
process.env.VAPID_PRIVATE_KEY = '';
process.env.BOOTSTRAP_EMAIL = '';
process.env.BOOTSTRAP_PASSWORD = '';

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

describe('processDraft registra o custo', () => {
  /** @type {import('pg').Pool} */
  let pool;
  /** @type {() => Promise<void>} */
  let closeDb;
  /** @type {typeof import('./drafts.mjs').processDraft} */
  let processDraft;
  /** @type {typeof import('./drafts.mjs').resolveIntakeAbsolutePath} */
  let resolveIntakeAbsolutePath;

  before(async () => {
    await ensureTestDatabase();
    const db = await import('../db.mjs');
    closeDb = db.closeDb;
    pool = db.getPool();
    const { runMigrations } = await import('../migrate.mjs');
    await runMigrations({ info() {} });
    ({ processDraft, resolveIntakeAbsolutePath } = await import('./drafts.mjs'));
  });

  after(async () => {
    if (closeDb) await closeDb();
  });

  it('soma estimated_cost_usd com cast e não deixa o parâmetro sem tipo', async () => {
    const caregiverId = randomUUID();
    const draftId = randomUUID();
    const relative = `${caregiverId}/${draftId}.jpg`;
    const absolute = resolveIntakeAbsolutePath(relative);
    await mkdir(absolute.slice(0, absolute.lastIndexOf('/')), { recursive: true });
    await import('node:fs/promises').then(({ writeFile }) =>
      writeFile(absolute, Buffer.from([0xff, 0xd8, 0xff, 0xd9])),
    );

    try {
      await pool.query(
        `INSERT INTO caregivers (id, email, password_hash, name)
         VALUES ($1, $2, 'x', 'Teste')`,
        [caregiverId, `${caregiverId}@example.test`],
      );
      await pool.query(
        `INSERT INTO medication_drafts (
           id, caregiver_id, status, image_path, image_sha256, mime_type, expires_at
         ) VALUES ($1, $2, 'processing', $3, $4, 'image/jpeg', now() + interval '1 day')`,
        [draftId, caregiverId, relative, 'abc'],
      );
      await pool.query(
        `INSERT INTO ai_usage_daily (caregiver_id, usage_date, request_count, estimated_cost_usd)
         VALUES ($1, CURRENT_DATE, 1, 0)`,
        [caregiverId],
      );
      await pool.query(
        `INSERT INTO medication_ai_events (
           caregiver_id, draft_id, provider, model, prompt_version, outcome
         ) VALUES ($1, $2, 'OpenRouter', 'test', 'v2', 'pending')`,
        [caregiverId, draftId],
      );

      await processDraft(caregiverId, draftId, {
        fetchImpl: async () => {
          const err = new Error('timeout');
          err.name = 'TimeoutError';
          throw err;
        },
      });

      const cost = await pool.query(
        `SELECT estimated_cost_usd::float8 AS cost
         FROM ai_usage_daily
         WHERE caregiver_id = $1 AND usage_date = CURRENT_DATE`,
        [caregiverId],
      );
      assert.equal(cost.rowCount, 1);
      assert.ok(Number(cost.rows[0].cost) > 0);
    } finally {
      await rm(absolute, { force: true });
      await pool.query('DELETE FROM caregivers WHERE id = $1', [caregiverId]);
    }
  });
});

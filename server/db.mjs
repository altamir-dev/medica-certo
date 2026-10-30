import pg from 'pg';
import { config } from './config.mjs';

const { Pool } = pg;

/** @type {import('pg').Pool | null} */
let pool = null;

export function getPool() {
  if (!pool) {
    pool = new Pool({ connectionString: config.databaseUrl });
  }
  return pool;
}

export async function pingDb() {
  const client = await getPool().connect();
  try {
    await client.query('SELECT 1');
    return true;
  } finally {
    client.release();
  }
}

export async function closeDb() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');

function loadDotEnv() {
  const envPath = resolve(rootDir, '.env');
  if (!existsSync(envPath)) return;
  const text = readFileSync(envPath, 'utf8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv();

/**
 * @param {string} name
 * @param {number} fallback
 * @param {{ min?: number, max?: number }} [bounds]
 */
function intEnv(name, fallback, bounds = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  const min = bounds.min ?? 0;
  const max = bounds.max ?? Number.MAX_SAFE_INTEGER;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

const nodeEnv = process.env.NODE_ENV ?? 'development';

const cookieSecureEnv = process.env.COOKIE_SECURE;
const cookieSecure =
  cookieSecureEnv === '1' || cookieSecureEnv === 'true'
    ? true
    : cookieSecureEnv === '0' || cookieSecureEnv === 'false'
      ? false
      : nodeEnv === 'production';

export const config = {
  nodeEnv,
  isProd: nodeEnv === 'production',
  port: Number(process.env.PORT ?? 8080),
  host: process.env.HOST ?? '0.0.0.0',
  publicHost: process.env.PUBLIC_HOST ?? 'medica-certo.altamir.dev',
  databaseUrl:
    process.env.DATABASE_URL ??
    'postgres://medica:medica@127.0.0.1:5432/medica_certo',
  webDistDir: resolve(rootDir, 'web', 'dist'),
  dataDir: resolve(rootDir, 'data'),
  sessionDays: Number(process.env.SESSION_DAYS ?? 30),
  cookieSecure,
  bootstrapEmail: process.env.BOOTSTRAP_EMAIL ?? '',
  bootstrapPassword: process.env.BOOTSTRAP_PASSWORD ?? '',
  bootstrapName: process.env.BOOTSTRAP_NAME ?? 'Cuidador',
  vapidPublic: process.env.VAPID_PUBLIC_KEY?.trim() || '',
  vapidPrivate: process.env.VAPID_PRIVATE_KEY?.trim() || '',
  vapidSubject:
    process.env.VAPID_SUBJECT?.trim() || 'mailto:contato@altamir.dev',
  alarmSchedulerMs: Number(process.env.ALARM_SCHEDULER_MS ?? 45_000),
  /** Extra pushes after the first, while the dose stays pending. 0 disables. */
  alarmRepeatMax: intEnv('ALARM_REPEAT_MAX', 3, { min: 0, max: 10 }),
  /** Minimum gap between dose-alarm pushes for the same caregiver. */
  alarmRepeatIntervalMs: intEnv('ALARM_REPEAT_INTERVAL_MS', 120_000, {
    min: 30_000,
    max: 30 * 60 * 1000,
  }),
};

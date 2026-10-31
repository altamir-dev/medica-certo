import { closeDb } from './db.mjs';
import { runMigrations } from './migrate.mjs';

/**
 * One-shot entrypoint for the VPS deploy. The app also migrates on boot;
 * this process fails the deploy job with the SQL error before the new
 * container replaces the running one.
 */
let code = 0;
try {
  await runMigrations();
  console.log('migrations applied');
} catch (err) {
  console.error('migration failed');
  console.error(err);
  code = 1;
} finally {
  try {
    await closeDb();
  } catch (err) {
    console.error(err);
    code = 1;
  }
}

process.exit(code);

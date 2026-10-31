import { config } from './config.mjs';
import { closeDb } from './db.mjs';
import { runMigrations } from './migrate.mjs';
import { maybeSeedBootstrap } from './auth.mjs';
import { buildApp } from './app.mjs';
import { startAlarmScheduler } from './scheduler.mjs';

const app = await buildApp();

try {
  await runMigrations(app.log);
  await maybeSeedBootstrap(app.log);
} catch (err) {
  app.log.error(err, 'failed to migrate or seed');
  process.exit(1);
}

startAlarmScheduler(app);

async function shutdown() {
  try {
    await app.close();
  } finally {
    await closeDb();
  }
}

process.on('SIGINT', () => {
  shutdown().then(() => process.exit(0));
});
process.on('SIGTERM', () => {
  shutdown().then(() => process.exit(0));
});

try {
  await app.listen({ port: config.port, host: config.host });
  app.log.info(
    {
      port: config.port,
      publicHost: config.publicHost,
      nodeEnv: config.nodeEnv,
    },
    'medica-certo server listening',
  );
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

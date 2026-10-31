import { existsSync } from 'node:fs';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { config } from './config.mjs';
import { closeDb } from './db.mjs';
import { runMigrations } from './migrate.mjs';
import { maybeSeedBootstrap } from './auth.mjs';
import { authGuardPlugin } from './plugins/auth-guard.mjs';
import { healthRoutes } from './routes/health.mjs';
import { authRoutes } from './routes/auth.mjs';
import { patientsRoutes } from './routes/patients.mjs';
import { medicationsRoutes } from './routes/medications.mjs';
import { treatmentsRoutes } from './routes/treatments.mjs';
import { dosesRoutes } from './routes/doses.mjs';
import { pushRoutes } from './routes/push.mjs';
import { startAlarmScheduler } from './scheduler.mjs';

const app = Fastify({
  logger: {
    level: config.isProd ? 'info' : 'debug',
  },
  trustProxy: config.isProd,
});

try {
  await runMigrations(app.log);
  await maybeSeedBootstrap(app.log);
} catch (err) {
  app.log.error(err, 'failed to migrate or seed');
  process.exit(1);
}

await app.register(authGuardPlugin);
await app.register(healthRoutes);
await app.register(authRoutes);
await app.register(patientsRoutes);
await app.register(medicationsRoutes);
await app.register(treatmentsRoutes);
await app.register(dosesRoutes);
await app.register(pushRoutes);

startAlarmScheduler(app);

if (config.isProd && existsSync(config.webDistDir)) {
  await app.register(fastifyStatic, {
    root: config.webDistDir,
    wildcard: false,
  });

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/')) {
      return reply.code(404).send({
        error: {
          code: 'NOT_FOUND',
          message: 'Not found',
        },
      });
    }
    return reply.sendFile('index.html');
  });
} else {
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/')) {
      return reply.code(404).send({
        error: {
          code: 'NOT_FOUND',
          message: 'Not found',
        },
      });
    }
    return reply.code(404).send({
      error: {
        code: 'NOT_FOUND',
        message:
          'SPA not built. In development open the Vite URL (default http://127.0.0.1:5173).',
      },
    });
  });
}

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

import { existsSync } from 'node:fs';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { config } from './config.mjs';
import { authGuardPlugin } from './plugins/auth-guard.mjs';
import { healthRoutes } from './routes/health.mjs';
import { authRoutes } from './routes/auth.mjs';
import { patientsRoutes } from './routes/patients.mjs';
import { medicationsRoutes } from './routes/medications.mjs';
import { treatmentsRoutes } from './routes/treatments.mjs';
import { dosesRoutes } from './routes/doses.mjs';
import { pushRoutes } from './routes/push.mjs';
import { inviteRoutes } from './routes/invites.mjs';
import { aiRoutes } from './routes/ai.mjs';

/**
 * HTTP app without listening, migrating, or starting the alarm scheduler.
 * @param {{ logger?: import('fastify').FastifyServerOptions['logger'] }} [options]
 */
export async function buildApp(options = {}) {
  const app = Fastify({
    logger:
      options.logger === undefined
        ? { level: config.isProd ? 'info' : 'debug' }
        : options.logger,
    trustProxy: config.isProd,
  });

  await app.register(authGuardPlugin);
  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(patientsRoutes);
  await app.register(medicationsRoutes);
  await app.register(treatmentsRoutes);
  await app.register(dosesRoutes);
  await app.register(pushRoutes);
  await app.register(inviteRoutes);
  await app.register(aiRoutes);

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

  return app;
}

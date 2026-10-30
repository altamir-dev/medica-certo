import { existsSync } from 'node:fs';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { config } from './config.mjs';
import { closeDb } from './db.mjs';
import { healthRoutes } from './routes/health.mjs';

const app = Fastify({
  logger: {
    level: config.isProd ? 'info' : 'debug',
  },
});

await app.register(healthRoutes);

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

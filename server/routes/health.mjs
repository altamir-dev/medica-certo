import { pingDb } from '../db.mjs';

/**
 * @param {import('fastify').FastifyInstance} app
 */
export async function healthRoutes(app) {
  app.get('/api/health', async (_request, reply) => {
    let db = 'down';
    try {
      await pingDb();
      db = 'up';
    } catch {
      db = 'down';
    }

    const ok = db === 'up';
    return reply.code(ok ? 200 : 503).send({
      status: ok ? 'ok' : 'degraded',
      db,
      service: 'medica-certo',
      time: new Date().toISOString(),
    });
  });
}

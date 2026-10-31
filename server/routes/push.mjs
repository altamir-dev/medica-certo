import { sendError } from '../auth.mjs';
import {
  isPushConfigured,
  listSubscriptions,
  sendTestPush,
  subscribePush,
  unsubscribePush,
  updateCaregiverAlarms,
} from '../push.mjs';
import { config } from '../config.mjs';

/**
 * @param {import('fastify').FastifyInstance} app
 */
export async function pushRoutes(app) {
  app.get('/api/push/vapid-public-key', async (request, reply) => {
    if (!request.caregiver) {
      return sendError(reply, 401, 'UNAUTHORIZED', 'Faça login para continuar.');
    }
    if (!isPushConfigured()) {
      return {
        configured: false,
        publicKey: null,
      };
    }
    return {
      configured: true,
      publicKey: config.vapidPublic,
    };
  });

  app.get('/api/push/subscriptions', async (request, reply) => {
    if (!request.caregiver) {
      return sendError(reply, 401, 'UNAUTHORIZED', 'Faça login para continuar.');
    }
    const subscriptions = await listSubscriptions(request.caregiver.id);
    return {
      configured: isPushConfigured(),
      subscriptions,
    };
  });

  app.post('/api/push/subscribe', async (request, reply) => {
    if (!request.caregiver) {
      return sendError(reply, 401, 'UNAUTHORIZED', 'Faça login para continuar.');
    }
    if (!isPushConfigured()) {
      return sendError(
        reply,
        503,
        'UNAVAILABLE',
        'Notificações indisponíveis neste servidor.',
      );
    }
    const body = /** @type {Record<string, unknown>} */ (request.body ?? {});
    const subscription =
      body.subscription && typeof body.subscription === 'object'
        ? /** @type {{ endpoint?: string, keys?: { p256dh?: string, auth?: string } }} */ (
            body.subscription
          )
        : /** @type {{ endpoint?: string, keys?: { p256dh?: string, auth?: string } }} */ (
            body
          );
    const result = await subscribePush(request.caregiver.id, subscription, {
      ua: String(request.headers['user-agent'] || ''),
      label: typeof body.label === 'string' ? body.label : '',
    });
    if (!result.ok) {
      const status = result.code === 'LIMIT' ? 409 : 400;
      return sendError(
        reply,
        status,
        result.code || 'VALIDATION',
        result.message || 'Falha ao inscrever.',
      );
    }
    return { id: result.id, label: result.label };
  });

  app.delete('/api/push/subscribe', async (request, reply) => {
    if (!request.caregiver) {
      return sendError(reply, 401, 'UNAUTHORIZED', 'Faça login para continuar.');
    }
    const body = /** @type {Record<string, unknown>} */ (request.body ?? {});
    const result = await unsubscribePush(request.caregiver.id, {
      endpoint: typeof body.endpoint === 'string' ? body.endpoint : undefined,
      id: typeof body.id === 'string' ? body.id : undefined,
    });
    return result;
  });

  app.post('/api/push/test', async (request, reply) => {
    if (!request.caregiver) {
      return sendError(reply, 401, 'UNAUTHORIZED', 'Faça login para continuar.');
    }
    const body = /** @type {Record<string, unknown>} */ (request.body ?? {});
    const result = await sendTestPush(request.caregiver.id, {
      id: typeof body.id === 'string' ? body.id : undefined,
    });
    if (!result.ok) {
      const status =
        result.code === 'NOT_FOUND'
          ? 404
          : result.code === 'UNAVAILABLE'
            ? 503
            : 400;
      return sendError(
        reply,
        status,
        result.code || 'ERROR',
        result.message || 'Falha no teste.',
      );
    }
    return {
      sent: result.sent,
      failed: result.failed,
      results: result.results,
    };
  });

  app.patch('/api/me/preferences', async (request, reply) => {
    if (!request.caregiver) {
      return sendError(reply, 401, 'UNAUTHORIZED', 'Faça login para continuar.');
    }
    const body = /** @type {Record<string, unknown>} */ (request.body ?? {});
    if (typeof body.alarmsEnabled !== 'boolean') {
      return sendError(reply, 400, 'VALIDATION', 'Informe alarmsEnabled.', {
        alarmsEnabled: 'Obrigatório (boolean).',
      });
    }
    const caregiver = await updateCaregiverAlarms(
      request.caregiver.id,
      body.alarmsEnabled,
    );
    if (!caregiver) {
      return sendError(reply, 404, 'NOT_FOUND', 'Cuidador não encontrado.');
    }
    return { caregiver };
  });
}

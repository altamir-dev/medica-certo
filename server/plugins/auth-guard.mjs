import fp from 'fastify-plugin';
import {
  readSessionToken,
  resolveSession,
  sendError,
} from '../auth.mjs';

const PUBLIC_PATHS = new Set([
  '/api/health',
  '/api/auth/login',
  '/api/auth/register',
]);

const INVITE_LOOKUP = /^\/api\/auth\/invites\/[^/]+$/;

/**
 * Protects `/api/*` except health + login + register (+ logout).
 * Attaches `request.caregiver` when authenticated.
 * Wrapped with fastify-plugin so the hook applies to sibling routes.
 *
 * @param {import('fastify').FastifyInstance} app
 */
async function authGuardPluginImpl(app) {
  app.decorateRequest('caregiver', null);

  app.addHook('preHandler', async (request, reply) => {
    const path = request.url.split('?')[0];
    if (!path.startsWith('/api/')) return;
    if (PUBLIC_PATHS.has(path) || INVITE_LOOKUP.test(path)) return;
    if (path === '/api/auth/logout') return;

    const token = readSessionToken(request);
    const resolved = await resolveSession(token);
    if (!resolved) {
      return sendError(
        reply,
        401,
        'UNAUTHORIZED',
        'Faça login para continuar.',
      );
    }

    if (resolved.refreshedCookie) {
      reply.header('set-cookie', resolved.refreshedCookie);
    }

    request.caregiver = resolved.caregiver;
  });
}

export const authGuardPlugin = fp(authGuardPluginImpl, {
  name: 'auth-guard',
});

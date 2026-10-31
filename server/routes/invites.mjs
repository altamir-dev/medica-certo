import {
  clientIp,
  inviteLookupRateLimit,
  inviteManageRateLimit,
  sendError,
} from '../auth.mjs';
import {
  createInvite,
  listInvites,
  lookupInvite,
  parseInviteCreateBody,
  revokeInvite,
} from '../invites.mjs';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const RATE_LIMIT_MESSAGE = 'Muitas tentativas. Aguarde um minuto.';

/**
 * @param {import('fastify').FastifyRequest} request
 * @param {import('fastify').FastifyReply} reply
 */
function requireAdmin(request, reply) {
  if (!request.caregiver) {
    return sendError(reply, 401, 'UNAUTHORIZED', 'Faça login para continuar.');
  }
  if (!request.caregiver.isAdmin) {
    return sendError(
      reply,
      403,
      'FORBIDDEN',
      'Só o administrador pode gerenciar convites.',
    );
  }
  return null;
}

/**
 * @param {import('fastify').FastifyInstance} app
 */
export async function inviteRoutes(app) {
  app.post('/api/invites', async (request, reply) => {
    const denied = requireAdmin(request, reply);
    if (denied) return denied;

    if (!inviteManageRateLimit(`create:${request.caregiver.id}`)) {
      return sendError(reply, 429, 'RATE_LIMITED', RATE_LIMIT_MESSAGE);
    }

    const body = /** @type {Record<string, unknown>} */ (request.body ?? {});
    const parsed = parseInviteCreateBody(body);
    if (!parsed.ok) {
      return sendError(
        reply,
        400,
        'VALIDATION',
        'Dados inválidos.',
        parsed.fields,
      );
    }

    const created = await createInvite({
      createdBy: request.caregiver.id,
      email: parsed.value.email,
      expiresInDays: parsed.value.expiresInDays,
    });
    return reply.code(201).send(created);
  });

  app.get('/api/invites', async (request, reply) => {
    const denied = requireAdmin(request, reply);
    if (denied) return denied;

    if (!inviteManageRateLimit(`list:${request.caregiver.id}`)) {
      return sendError(reply, 429, 'RATE_LIMITED', RATE_LIMIT_MESSAGE);
    }

    const invites = await listInvites(request.caregiver.id);
    return { invites };
  });

  app.post('/api/invites/:id/revoke', async (request, reply) => {
    const denied = requireAdmin(request, reply);
    if (denied) return denied;

    if (!inviteManageRateLimit(`revoke:${request.caregiver.id}`)) {
      return sendError(reply, 429, 'RATE_LIMITED', RATE_LIMIT_MESSAGE);
    }

    const { id } = /** @type {{ id: string }} */ (request.params);
    if (!UUID_RE.test(id)) {
      return sendError(reply, 404, 'NOT_FOUND', 'Convite não encontrado.');
    }

    const result = await revokeInvite(request.caregiver.id, id);
    if (!result.ok) {
      const status = result.code === 'NOT_FOUND' ? 404 : 409;
      return sendError(reply, status, result.code, result.message);
    }
    return { invite: result.invite };
  });

  app.get('/api/auth/invites/:token', async (request, reply) => {
    if (!inviteLookupRateLimit(clientIp(request))) {
      return sendError(reply, 429, 'RATE_LIMITED', RATE_LIMIT_MESSAGE);
    }

    const { token } = /** @type {{ token: string }} */ (request.params);
    const result = await lookupInvite(token);
    if (!result.ok) {
      return sendError(
        reply,
        404,
        'INVITE_INVALID',
        'Convite inválido ou expirado.',
      );
    }
    return {
      invite: {
        email: result.email,
        expiresAt: result.expiresAt,
      },
    };
  });
}

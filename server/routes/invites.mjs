import {
  clientIp,
  inviteLookupRateLimit,
  inviteManageRateLimit,
  sendError,
} from '../auth.mjs';
import {
  acceptInviteForCaregiver,
  createInvite,
  listInvites,
  lookupInvite,
  parseInviteCreateBody,
  revokeInvite,
} from '../invites.mjs';
import {
  getGranteeAccess,
  listAccessGrantees,
  parseGranteePatientsBody,
  revokeGranteeAccess,
  setGranteePatients,
} from '../patientAccess.mjs';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const RATE_LIMIT_MESSAGE = 'Muitas tentativas. Aguarde um minuto.';

/**
 * @param {import('fastify').FastifyRequest} request
 * @param {import('fastify').FastifyReply} reply
 */
function requireAuth(request, reply) {
  if (!request.caregiver) {
    return sendError(reply, 401, 'UNAUTHORIZED', 'Faça login para continuar.');
  }
  return null;
}

/**
 * @param {import('fastify').FastifyInstance} app
 */
export async function inviteRoutes(app) {
  app.post('/api/invites', async (request, reply) => {
    const denied = requireAuth(request, reply);
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
      patientIds: parsed.value.patientIds,
      expiresInDays: parsed.value.expiresInDays,
    });
    if (!created.ok) {
      return sendError(reply, 404, created.code, created.message);
    }
    return reply.code(201).send({
      invite: created.invite,
      token: created.token,
    });
  });

  app.get('/api/invites', async (request, reply) => {
    const denied = requireAuth(request, reply);
    if (denied) return denied;

    if (!inviteManageRateLimit(`list:${request.caregiver.id}`)) {
      return sendError(reply, 429, 'RATE_LIMITED', RATE_LIMIT_MESSAGE);
    }

    const invites = await listInvites(request.caregiver.id);
    return { invites };
  });

  app.post('/api/invites/:id/revoke', async (request, reply) => {
    const denied = requireAuth(request, reply);
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

  app.post('/api/auth/invites/:token/accept', async (request, reply) => {
    const denied = requireAuth(request, reply);
    if (denied) return denied;

    if (!inviteManageRateLimit(`accept:${request.caregiver.id}`)) {
      return sendError(reply, 429, 'RATE_LIMITED', RATE_LIMIT_MESSAGE);
    }

    const { token } = /** @type {{ token: string }} */ (request.params);
    const result = await acceptInviteForCaregiver({
      caregiverId: request.caregiver.id,
      email: request.caregiver.email.trim().toLowerCase(),
      token,
    });
    if (!result.ok) {
      const status =
        result.code === 'INVITE_INVALID'
          ? 404
          : result.code === 'VALIDATION'
            ? 400
            : 409;
      return sendError(
        reply,
        status,
        result.code,
        result.message,
        result.fields,
      );
    }
    return { ok: true };
  });

  app.get('/api/patient-access', async (request, reply) => {
    const denied = requireAuth(request, reply);
    if (denied) return denied;

    const grantees = await listAccessGrantees(request.caregiver.id);
    return { grantees };
  });

  app.get('/api/patient-access/:granteeId', async (request, reply) => {
    const denied = requireAuth(request, reply);
    if (denied) return denied;

    const { granteeId } = /** @type {{ granteeId: string }} */ (request.params);
    if (!UUID_RE.test(granteeId)) {
      return sendError(reply, 404, 'NOT_FOUND', 'Acesso não encontrado.');
    }

    const detail = await getGranteeAccess(request.caregiver.id, granteeId);
    if (!detail) {
      return sendError(reply, 404, 'NOT_FOUND', 'Acesso não encontrado.');
    }
    return { access: detail };
  });

  app.put('/api/patient-access/:granteeId', async (request, reply) => {
    const denied = requireAuth(request, reply);
    if (denied) return denied;

    const { granteeId } = /** @type {{ granteeId: string }} */ (request.params);
    if (!UUID_RE.test(granteeId)) {
      return sendError(reply, 404, 'NOT_FOUND', 'Acesso não encontrado.');
    }

    const parsed = parseGranteePatientsBody(request.body);
    if (!parsed.ok) {
      return sendError(
        reply,
        400,
        'VALIDATION',
        'Dados inválidos.',
        parsed.fields,
      );
    }

    const result = await setGranteePatients(
      request.caregiver.id,
      granteeId,
      parsed.value.patientIds,
    );
    if (!result.ok) {
      return sendError(reply, 404, result.code, result.message);
    }
    return { ok: true };
  });

  app.delete('/api/patient-access/:granteeId', async (request, reply) => {
    const denied = requireAuth(request, reply);
    if (denied) return denied;

    const { granteeId } = /** @type {{ granteeId: string }} */ (request.params);
    if (!UUID_RE.test(granteeId)) {
      return sendError(reply, 404, 'NOT_FOUND', 'Acesso não encontrado.');
    }

    const result = await revokeGranteeAccess(request.caregiver.id, granteeId);
    if (!result.ok) {
      return sendError(reply, 404, result.code, result.message);
    }
    return reply.code(204).send();
  });
}

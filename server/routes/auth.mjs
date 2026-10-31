import {
  buildSessionCookie,
  clearSessionCookie,
  clientIp,
  countCaregivers,
  createCaregiver,
  createSession,
  destroySession,
  findCaregiverByEmail,
  loginRateLimit,
  readSessionToken,
  registerRateLimit,
  sendError,
  toPublicCaregiver,
  verifyPassword,
} from '../auth.mjs';
import { config } from '../config.mjs';
import {
  registrationDecision,
  registerWithInvite,
} from '../invites.mjs';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 200;
const MAX_NAME = 120;

/**
 * @param {unknown} value
 */
function asString(value) {
  return typeof value === 'string' ? value : '';
}

/**
 * @param {import('fastify').FastifyInstance} app
 */
export async function authRoutes(app) {
  app.post('/api/auth/register', async (request, reply) => {
    const body = /** @type {Record<string, unknown>} */ (request.body ?? {});
    const email = asString(body.email).trim().toLowerCase();
    const password = asString(body.password);
    const name = asString(body.name).trim();

    const ip = clientIp(request);
    // Per e-mail and per IP: rotating addresses must not multiply attempts.
    if (
      !registerRateLimit(`${ip}:${email || 'none'}`) ||
      !registerRateLimit(`ip:${ip}`)
    ) {
      return sendError(
        reply,
        429,
        'RATE_LIMITED',
        'Muitas tentativas. Aguarde um minuto.',
      );
    }

    /** @type {Record<string, string>} */
    const fields = {};
    if (!EMAIL_RE.test(email)) fields.email = 'Informe um e-mail válido.';
    if (password.length < MIN_PASSWORD) {
      fields.password = `Senha deve ter ao menos ${MIN_PASSWORD} caracteres.`;
    } else if (password.length > MAX_PASSWORD) {
      fields.password = 'Senha muito longa.';
    }
    if (!name) fields.name = 'Informe o nome.';
    else if (name.length > MAX_NAME) fields.name = 'Nome muito longo.';

    if (Object.keys(fields).length > 0) {
      return sendError(reply, 400, 'VALIDATION', 'Dados inválidos.', fields);
    }

    const maxAgeSec = config.sessionDays * 24 * 60 * 60;
    const decision = registrationDecision({
      caregiverCount: await countCaregivers(),
      inviteToken: body.inviteToken,
    });

    if (decision.mode === 'closed') {
      return sendError(
        reply,
        409,
        'BOOTSTRAP_CLOSED',
        'Cadastro inicial já foi feito.',
      );
    }

    if (decision.mode === 'invite') {
      const invited = await registerWithInvite({
        email,
        password,
        name,
        token: decision.token,
      });
      if (!invited.ok) {
        const status = invited.code === 'REGISTER_FAILED' ? 409 : 400;
        return sendError(
          reply,
          status,
          invited.code,
          invited.message,
          invited.fields,
        );
      }
      const invitedSession = await createSession(invited.caregiver.id);
      return reply
        .header('set-cookie', buildSessionCookie(invitedSession.id, maxAgeSec))
        .code(201)
        .send({ caregiver: invited.caregiver });
    }

    const caregiver = await createCaregiver({
      email,
      password,
      name,
      isAdmin: true,
    });
    const session = await createSession(caregiver.id);

    return reply
      .header('set-cookie', buildSessionCookie(session.id, maxAgeSec))
      .code(201)
      .send({ caregiver });
  });

  app.post('/api/auth/login', async (request, reply) => {
    const body = /** @type {Record<string, unknown>} */ (request.body ?? {});
    const email = asString(body.email).trim().toLowerCase();
    const password = asString(body.password);

    const ip = clientIp(request);
    if (!loginRateLimit(`${ip}:${email || 'none'}`)) {
      return sendError(
        reply,
        429,
        'RATE_LIMITED',
        'Muitas tentativas. Aguarde um minuto.',
      );
    }

    if (!EMAIL_RE.test(email) || !password) {
      return sendError(
        reply,
        401,
        'UNAUTHORIZED',
        'E-mail ou senha inválidos.',
      );
    }

    const row = await findCaregiverByEmail(email);
    const ok =
      row && (await verifyPassword(row.password_hash, password));

    if (!ok) {
      request.log.info({ email }, 'login failed');
      return sendError(
        reply,
        401,
        'UNAUTHORIZED',
        'E-mail ou senha inválidos.',
      );
    }

    // Rotate session id on every login.
    const previous = readSessionToken(request);
    if (previous) await destroySession(previous);

    const session = await createSession(row.id);
    const maxAgeSec = config.sessionDays * 24 * 60 * 60;
    const caregiver = toPublicCaregiver(row);

    request.log.info({ caregiverId: row.id }, 'login ok');

    return reply
      .header('set-cookie', buildSessionCookie(session.id, maxAgeSec))
      .send({ caregiver });
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const token = readSessionToken(request);
    await destroySession(token);
    return reply
      .header('set-cookie', clearSessionCookie())
      .send({ ok: true });
  });

  app.get('/api/auth/me', async (request, reply) => {
    // auth-guard already validated the session and may have slid the TTL.
    if (!request.caregiver) {
      return sendError(
        reply,
        401,
        'UNAUTHORIZED',
        'Sessão inválida ou expirada.',
      );
    }
    return { caregiver: request.caregiver };
  });
}

import multipart from '@fastify/multipart';
import { sendError } from '../auth.mjs';
import { getPool } from '../db.mjs';
import { matchesImageMagic } from '../medications.mjs';
import {
  confirmDraft,
  createDraft,
  discardDraft,
  getDraft,
  getDraftImage,
  hasAiConsent,
  monthlyQuota,
  recordAiConsent,
} from '../ai/drafts.mjs';
import { quotaMessage, readAiSettings } from '../ai/settings.mjs';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);

/**
 * @param {import('fastify').FastifyInstance} app
 */
export async function aiRoutes(app) {
  const settings = readAiSettings();
  await app.register(multipart, {
    limits: {
      fileSize: settings.maxUploadBytes,
      files: 1,
    },
  });

  app.get('/api/ai/status', async (request, reply) => {
    if (!request.caregiver) {
      return sendError(reply, 401, 'UNAUTHORIZED', 'Faça login para continuar.');
    }
    const current = readAiSettings();
    if (!current.enabled) {
      return { enabled: false, providerName: '', model: '', consented: false };
    }
    const consented = await hasAiConsent(
      request.caregiver.id,
      current.providerName,
      current.model,
    );
    const quota = await monthlyQuota(request.caregiver.id);
    return {
      enabled: true,
      providerName: current.providerName,
      model: current.model,
      consented,
      quota,
    };
  });

  app.post('/api/ai/consent', async (request, reply) => {
    if (!request.caregiver) {
      return sendError(reply, 401, 'UNAUTHORIZED', 'Faça login para continuar.');
    }
    const current = readAiSettings();
    if (!current.enabled) {
      return sendError(reply, 404, 'AI_DISABLED', 'Leitura por foto está desligada.');
    }
    await recordAiConsent(
      request.caregiver.id,
      current.providerName,
      current.model,
    );
    return { ok: true };
  });

  app.post('/api/medication-drafts', async (request, reply) => {
    if (!request.caregiver) {
      return sendError(reply, 401, 'UNAUTHORIZED', 'Faça login para continuar.');
    }
    const current = readAiSettings();
    if (!current.enabled) {
      return sendError(reply, 404, 'AI_DISABLED', 'Leitura por foto está desligada.');
    }

    let data;
    try {
      data = await request.file();
    } catch (err) {
      const code =
        typeof err === 'object' && err && 'code' in err
          ? /** @type {{ code?: string }} */ (err).code
          : '';
      if (code === 'FST_REQ_FILE_TOO_LARGE') {
        return sendError(reply, 400, 'VALIDATION', 'A imagem deve ter no máximo 8 MB.');
      }
      throw err;
    }
    if (!data) {
      return sendError(reply, 400, 'VALIDATION', 'Envie a imagem no campo image.');
    }
    const chunks = [];
    for await (const chunk of data.file) chunks.push(chunk);
    if (data.file.truncated) {
      return sendError(reply, 400, 'VALIDATION', 'A imagem deve ter no máximo 8 MB.');
    }
    const buffer = Buffer.concat(chunks);
    if (!ALLOWED.has(data.mimetype) || !matchesImageMagic(buffer, data.mimetype)) {
      return sendError(
        reply,
        400,
        'VALIDATION',
        'Use JPEG, PNG ou WebP.',
      );
    }

    let patientId = null;
    const query = /** @type {{ patientId?: string }} */ (request.query);
    const patientRaw = typeof query.patientId === 'string' ? query.patientId : '';
    if (patientRaw) {
      if (!UUID_RE.test(patientRaw)) {
        return sendError(reply, 400, 'VALIDATION', 'Paciente inválido.');
      }
      const patient = await getPool().query(
        `SELECT id FROM patients WHERE id = $1 AND caregiver_id = $2`,
        [patientRaw, request.caregiver.id],
      );
      if (!patient.rows[0]) {
        return sendError(reply, 404, 'NOT_FOUND', 'Paciente não encontrado.');
      }
      patientId = patientRaw;
    }

    const created = await createDraft(
      request.caregiver.id,
      { buffer, mimetype: data.mimetype, patientId },
      { log: request.log },
    );
    if (!created.ok) {
      if (created.code === 'CONSENT_REQUIRED') {
        return sendError(
          reply,
          403,
          'CONSENT_REQUIRED',
          'Confirme o envio da imagem antes de continuar.',
        );
      }
      if (created.code === 'RATE_LIMITED') {
        return sendError(
          reply,
          429,
          'RATE_LIMITED',
          created.message ?? quotaMessage(readAiSettings().monthlyLimit),
        );
      }
      if (created.code === 'AI_BUDGET') {
        return sendError(
          reply,
          429,
          'RATE_LIMITED',
          created.message ?? quotaMessage(readAiSettings().monthlyLimit),
        );
      }
      if (created.code === 'CONFLICT') {
        return sendError(
          reply,
          409,
          'CONFLICT',
          'Já existe uma leitura em andamento.',
        );
      }
      return sendError(reply, 404, 'AI_DISABLED', 'Leitura por foto está desligada.');
    }
    return reply.code(202).send({ draft: created.draft });
  });

  app.get('/api/medication-drafts/:id', async (request, reply) => {
    if (!request.caregiver) {
      return sendError(reply, 401, 'UNAUTHORIZED', 'Faça login para continuar.');
    }
    const { id } = /** @type {{ id: string }} */ (request.params);
    if (!UUID_RE.test(id)) {
      return sendError(reply, 404, 'NOT_FOUND', 'Leitura não encontrada.');
    }
    const draft = await getDraft(request.caregiver.id, id);
    if (!draft) return sendError(reply, 404, 'NOT_FOUND', 'Leitura não encontrada.');
    return { draft };
  });

  app.get('/api/medication-drafts/:id/image', async (request, reply) => {
    if (!request.caregiver) {
      return sendError(reply, 401, 'UNAUTHORIZED', 'Faça login para continuar.');
    }
    const { id } = /** @type {{ id: string }} */ (request.params);
    if (!UUID_RE.test(id)) {
      return sendError(reply, 404, 'NOT_FOUND', 'Imagem não encontrada.');
    }
    const image = await getDraftImage(request.caregiver.id, id);
    if (!image) return sendError(reply, 404, 'NOT_FOUND', 'Imagem não encontrada.');
    reply.header('Content-Type', image.contentType);
    reply.header('Cache-Control', 'private, no-cache');
    reply.header('X-Content-Type-Options', 'nosniff');
    return reply.send(image.stream);
  });

  app.delete('/api/medication-drafts/:id', async (request, reply) => {
    if (!request.caregiver) {
      return sendError(reply, 401, 'UNAUTHORIZED', 'Faça login para continuar.');
    }
    const { id } = /** @type {{ id: string }} */ (request.params);
    if (!UUID_RE.test(id)) {
      return sendError(reply, 404, 'NOT_FOUND', 'Leitura não encontrada.');
    }
    const ok = await discardDraft(request.caregiver.id, id);
    if (!ok) return sendError(reply, 404, 'NOT_FOUND', 'Leitura não encontrada.');
    return reply.code(204).send();
  });

  app.post('/api/medication-drafts/:id/confirm', async (request, reply) => {
    if (!request.caregiver) {
      return sendError(reply, 401, 'UNAUTHORIZED', 'Faça login para continuar.');
    }
    const { id } = /** @type {{ id: string }} */ (request.params);
    if (!UUID_RE.test(id)) {
      return sendError(reply, 404, 'NOT_FOUND', 'Leitura não encontrada.');
    }
    const body = /** @type {{ items?: unknown }} */ (request.body ?? {});
    const result = await confirmDraft(request.caregiver.id, id, body);
    if (!result.ok) {
      if (result.code === 'NOT_FOUND') {
        return sendError(reply, 404, 'NOT_FOUND', 'Leitura não encontrada.');
      }
      if (result.code === 'DUPLICATE_NAME') {
        return sendError(
          reply,
          409,
          'DUPLICATE_NAME',
          'Já existe um medicamento com este nome no seu catálogo.',
          {
            existingId: result.existingId ?? '',
            itemIndex: String(result.index ?? 0),
          },
        );
      }
      if (result.code === 'CONFLICT') {
        return sendError(
          reply,
          409,
          'CONFLICT',
          'Esta leitura não pode mais ser confirmada.',
        );
      }
      return sendError(
        reply,
        400,
        'VALIDATION',
        result.message ?? 'Dados inválidos.',
        result.fields,
      );
    }
    return reply.code(result.already ? 200 : 201).send({
      medicationIds: result.medicationIds,
      treatmentIds: result.treatmentIds,
    });
  });
}

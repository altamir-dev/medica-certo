import { createReadStream } from 'node:fs';
import multipart from '@fastify/multipart';
import { sendError } from '../auth.mjs';
import {
  MAX_PHOTO_BYTES,
  createMedication,
  deleteMedication,
  getMedication,
  getMedicationPhotoStreamInfo,
  listMedications,
  parseMedicationBody,
  saveMedicationPhoto,
  updateMedication,
} from '../medications.mjs';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MAX_SEARCH_Q = 200;

/**
 * @param {import('fastify').FastifyInstance} app
 */
export async function medicationsRoutes(app) {
  await app.register(multipart, {
    limits: {
      fileSize: MAX_PHOTO_BYTES,
      files: 1,
    },
  });

  app.get('/api/medications', async (request, reply) => {
    if (!request.caregiver) {
      return sendError(
        reply,
        401,
        'UNAUTHORIZED',
        'Faça login para continuar.',
      );
    }

    const query = /** @type {{ q?: string }} */ (request.query);
    const q = typeof query.q === 'string' ? query.q : '';
    if (q.length > MAX_SEARCH_Q) {
      return sendError(
        reply,
        400,
        'VALIDATION',
        `Busca deve ter no máximo ${MAX_SEARCH_Q} caracteres.`,
      );
    }
    const medications = await listMedications(request.caregiver.id, q);
    return { medications };
  });

  app.get('/api/medications/:id', async (request, reply) => {
    if (!request.caregiver) {
      return sendError(
        reply,
        401,
        'UNAUTHORIZED',
        'Faça login para continuar.',
      );
    }

    const { id } = /** @type {{ id: string }} */ (request.params);
    if (!UUID_RE.test(id)) {
      return sendError(reply, 404, 'NOT_FOUND', 'Medicamento não encontrado.');
    }

    const medication = await getMedication(request.caregiver.id, id);
    if (!medication) {
      return sendError(reply, 404, 'NOT_FOUND', 'Medicamento não encontrado.');
    }

    return { medication };
  });

  app.post('/api/medications', async (request, reply) => {
    if (!request.caregiver) {
      return sendError(
        reply,
        401,
        'UNAUTHORIZED',
        'Faça login para continuar.',
      );
    }

    const body = /** @type {Record<string, unknown>} */ (request.body ?? {});
    const parsed = parseMedicationBody(body);
    if (!parsed.ok) {
      return sendError(
        reply,
        400,
        'VALIDATION',
        'Dados inválidos.',
        parsed.fields,
      );
    }

    const result = await createMedication(request.caregiver.id, parsed.value);
    if (!result.ok) {
      /** @type {Record<string, string>} */
      const fields = {};
      if (result.existingId) fields.existingId = result.existingId;
      return sendError(
        reply,
        409,
        'DUPLICATE_NAME',
        'Já existe um medicamento com este nome no seu catálogo.',
        fields,
      );
    }

    return reply.code(201).send({ medication: result.medication });
  });

  app.put('/api/medications/:id', async (request, reply) => {
    if (!request.caregiver) {
      return sendError(
        reply,
        401,
        'UNAUTHORIZED',
        'Faça login para continuar.',
      );
    }

    const { id } = /** @type {{ id: string }} */ (request.params);
    if (!UUID_RE.test(id)) {
      return sendError(reply, 404, 'NOT_FOUND', 'Medicamento não encontrado.');
    }

    const body = /** @type {Record<string, unknown>} */ (request.body ?? {});
    const parsed = parseMedicationBody(body);
    if (!parsed.ok) {
      return sendError(
        reply,
        400,
        'VALIDATION',
        'Dados inválidos.',
        parsed.fields,
      );
    }

    const result = await updateMedication(
      request.caregiver.id,
      id,
      parsed.value,
    );
    if (!result.ok) {
      if (result.code === 'NOT_FOUND') {
        return sendError(
          reply,
          404,
          'NOT_FOUND',
          'Medicamento não encontrado.',
        );
      }
      /** @type {Record<string, string>} */
      const fields = {};
      if (result.existingId) fields.existingId = result.existingId;
      return sendError(
        reply,
        409,
        'DUPLICATE_NAME',
        'Já existe um medicamento com este nome no seu catálogo.',
        fields,
      );
    }

    return { medication: result.medication };
  });

  app.delete('/api/medications/:id', async (request, reply) => {
    if (!request.caregiver) {
      return sendError(
        reply,
        401,
        'UNAUTHORIZED',
        'Faça login para continuar.',
      );
    }

    const { id } = /** @type {{ id: string }} */ (request.params);
    if (!UUID_RE.test(id)) {
      return sendError(reply, 404, 'NOT_FOUND', 'Medicamento não encontrado.');
    }

    const result = await deleteMedication(request.caregiver.id, id);
    if (result === 'not_found') {
      return sendError(reply, 404, 'NOT_FOUND', 'Medicamento não encontrado.');
    }
    if (result === 'conflict') {
      return sendError(
        reply,
        409,
        'CONFLICT',
        'Não é possível excluir: há tratamento ativo com este medicamento.',
      );
    }

    return reply.code(204).send();
  });

  app.post('/api/medications/:id/photo', async (request, reply) => {
    if (!request.caregiver) {
      return sendError(
        reply,
        401,
        'UNAUTHORIZED',
        'Faça login para continuar.',
      );
    }

    const { id } = /** @type {{ id: string }} */ (request.params);
    if (!UUID_RE.test(id)) {
      return sendError(reply, 404, 'NOT_FOUND', 'Medicamento não encontrado.');
    }

    let data;
    try {
      data = await request.file();
    } catch (err) {
      const code =
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        /** @type {{ code?: string }} */ (err).code;
      if (code === 'FST_REQ_FILE_TOO_LARGE') {
        return sendError(
          reply,
          400,
          'VALIDATION',
          'Foto deve ter no máximo 2 MB.',
        );
      }
      throw err;
    }

    if (!data) {
      return sendError(
        reply,
        400,
        'VALIDATION',
        'Envie um arquivo de imagem no campo photo.',
      );
    }

    if (data.fieldname !== 'photo') {
      data.file.resume();
      return sendError(
        reply,
        400,
        'VALIDATION',
        'Envie um arquivo de imagem no campo photo.',
      );
    }

    const chunks = [];
    for await (const chunk of data.file) {
      chunks.push(chunk);
    }
    if (data.file.truncated) {
      return sendError(
        reply,
        400,
        'VALIDATION',
        'Foto deve ter no máximo 2 MB.',
      );
    }

    const buffer = Buffer.concat(chunks);
    const result = await saveMedicationPhoto(request.caregiver.id, id, {
      buffer,
      mimetype: data.mimetype,
    });

    if (!result.ok) {
      if (result.code === 'NOT_FOUND') {
        return sendError(
          reply,
          404,
          'NOT_FOUND',
          'Medicamento não encontrado.',
        );
      }
      return sendError(
        reply,
        400,
        'VALIDATION',
        result.message ?? 'Foto inválida.',
      );
    }

    return { medication: result.medication };
  });

  app.get('/api/medications/:id/photo', async (request, reply) => {
    if (!request.caregiver) {
      return sendError(
        reply,
        401,
        'UNAUTHORIZED',
        'Faça login para continuar.',
      );
    }

    const { id } = /** @type {{ id: string }} */ (request.params);
    if (!UUID_RE.test(id)) {
      return sendError(reply, 404, 'NOT_FOUND', 'Foto não encontrada.');
    }

    const info = await getMedicationPhotoStreamInfo(request.caregiver.id, id);
    if (!info) {
      return sendError(reply, 404, 'NOT_FOUND', 'Foto não encontrada.');
    }

    reply.header('Content-Type', info.contentType);
    reply.header('Cache-Control', 'private, no-cache');
    reply.header('X-Content-Type-Options', 'nosniff');
    return reply.send(createReadStream(info.absolutePath));
  });
}

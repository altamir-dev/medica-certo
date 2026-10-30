import { sendError } from '../auth.mjs';
import {
  createPatient,
  deletePatient,
  getPatient,
  listPatients,
  parsePatientBody,
  updatePatient,
} from '../patients.mjs';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * @param {import('fastify').FastifyInstance} app
 */
export async function patientsRoutes(app) {
  app.get('/api/patients', async (request, reply) => {
    if (!request.caregiver) {
      return sendError(
        reply,
        401,
        'UNAUTHORIZED',
        'Faça login para continuar.',
      );
    }

    const patients = await listPatients(request.caregiver.id);
    return { patients };
  });

  app.get('/api/patients/:id', async (request, reply) => {
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
      return sendError(reply, 404, 'NOT_FOUND', 'Paciente não encontrado.');
    }

    const patient = await getPatient(request.caregiver.id, id);
    if (!patient) {
      return sendError(reply, 404, 'NOT_FOUND', 'Paciente não encontrado.');
    }

    return { patient };
  });

  app.post('/api/patients', async (request, reply) => {
    if (!request.caregiver) {
      return sendError(
        reply,
        401,
        'UNAUTHORIZED',
        'Faça login para continuar.',
      );
    }

    const body = /** @type {Record<string, unknown>} */ (request.body ?? {});
    const parsed = parsePatientBody(body);
    if (!parsed.ok) {
      return sendError(
        reply,
        400,
        'VALIDATION',
        'Dados inválidos.',
        parsed.fields,
      );
    }

    const patient = await createPatient(request.caregiver.id, parsed.value);
    return reply.code(201).send({ patient });
  });

  app.put('/api/patients/:id', async (request, reply) => {
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
      return sendError(reply, 404, 'NOT_FOUND', 'Paciente não encontrado.');
    }

    const body = /** @type {Record<string, unknown>} */ (request.body ?? {});
    const parsed = parsePatientBody(body);
    if (!parsed.ok) {
      return sendError(
        reply,
        400,
        'VALIDATION',
        'Dados inválidos.',
        parsed.fields,
      );
    }

    const patient = await updatePatient(
      request.caregiver.id,
      id,
      parsed.value,
    );
    if (!patient) {
      return sendError(reply, 404, 'NOT_FOUND', 'Paciente não encontrado.');
    }

    return { patient };
  });

  app.delete('/api/patients/:id', async (request, reply) => {
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
      return sendError(reply, 404, 'NOT_FOUND', 'Paciente não encontrado.');
    }

    const result = await deletePatient(request.caregiver.id, id);
    if (result === 'not_found') {
      return sendError(reply, 404, 'NOT_FOUND', 'Paciente não encontrado.');
    }
    if (result === 'conflict') {
      return sendError(
        reply,
        409,
        'CONFLICT',
        'Não é possível excluir: há tratamento ativo para este paciente.',
      );
    }

    return reply.code(204).send();
  });
}

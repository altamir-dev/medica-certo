import { sendError } from '../auth.mjs';
import {
  UUID_RE,
  buildPreview,
  createTreatment,
  endTreatment,
  getTreatment,
  listDoses,
  listTreatmentsForPatient,
  parseSuggestBody,
  parseTreatmentBody,
  patchTreatment,
  suggestFirstDose,
} from '../treatments.mjs';
import { getPatient } from '../patients.mjs';

/**
 * @param {import('fastify').FastifyInstance} app
 */
export async function treatmentsRoutes(app) {
  app.get('/api/patients/:id/treatments', async (request, reply) => {
    if (!request.caregiver) {
      return sendError(reply, 401, 'UNAUTHORIZED', 'Faça login para continuar.');
    }
    const { id } = /** @type {{ id: string }} */ (request.params);
    if (!UUID_RE.test(id)) {
      return sendError(reply, 404, 'NOT_FOUND', 'Paciente não encontrado.');
    }
    const patient = await getPatient(request.caregiver.id, id);
    if (!patient) {
      return sendError(reply, 404, 'NOT_FOUND', 'Paciente não encontrado.');
    }
    const treatments = await listTreatmentsForPatient(
      request.caregiver.id,
      id,
    );
    return { treatments };
  });

  app.post('/api/treatments/preview', async (request, reply) => {
    if (!request.caregiver) {
      return sendError(reply, 401, 'UNAUTHORIZED', 'Faça login para continuar.');
    }
    const body = /** @type {Record<string, unknown>} */ (request.body ?? {});
    const parsed = parseTreatmentBody(body, { requireIds: false });
    if (!parsed.ok) {
      const code =
        parsed.fields.timesOfDay === 'Horários duplicados.'
          ? 'DUPLICATE_TIME'
          : 'VALIDATION';
      return sendError(reply, 400, code, 'Dados inválidos.', parsed.fields);
    }
    return buildPreview(parsed.value);
  });

  app.post('/api/treatments/suggest-first-dose', async (request, reply) => {
    if (!request.caregiver) {
      return sendError(reply, 401, 'UNAUTHORIZED', 'Faça login para continuar.');
    }
    const body = /** @type {Record<string, unknown>} */ (request.body ?? {});
    const parsed = parseSuggestBody(body);
    if (!parsed.ok) {
      return sendError(
        reply,
        400,
        'VALIDATION',
        'Dados inválidos.',
        parsed.fields,
      );
    }

    // Optional: pull sleep window from patient
    let sleepStart = parsed.value.sleepStart;
    let sleepEnd = parsed.value.sleepEnd;
    const patientId = typeof body.patientId === 'string' ? body.patientId : '';
    if (UUID_RE.test(patientId)) {
      const patient = await getPatient(request.caregiver.id, patientId);
      if (patient) {
        sleepStart = patient.sleepStart;
        sleepEnd = patient.sleepEnd;
      }
    }

    const result = suggestFirstDose({
      intervalHours: parsed.value.intervalHours,
      sleepStart,
      sleepEnd,
      anchorDate: parsed.value.anchorDate,
    });

    return {
      firstDoseAt: result.firstDoseAtIso,
      sleepHitCount: result.sleepHitCount,
      warning: result.warning,
      warningMessage: result.warningMessage,
      preview: result.preview,
    };
  });

  app.post('/api/treatments', async (request, reply) => {
    if (!request.caregiver) {
      return sendError(reply, 401, 'UNAUTHORIZED', 'Faça login para continuar.');
    }
    const body = /** @type {Record<string, unknown>} */ (request.body ?? {});
    const parsed = parseTreatmentBody(body);
    if (!parsed.ok) {
      const code =
        parsed.fields.timesOfDay === 'Horários duplicados.'
          ? 'DUPLICATE_TIME'
          : 'VALIDATION';
      return sendError(reply, 400, code, 'Dados inválidos.', parsed.fields);
    }

    const result = await createTreatment(request.caregiver.id, parsed.value);
    if (!result.ok) {
      if (result.code === 'PATIENT_NOT_FOUND') {
        return sendError(reply, 404, 'NOT_FOUND', 'Paciente não encontrado.');
      }
      if (result.code === 'MEDICATION_NOT_FOUND') {
        return sendError(
          reply,
          404,
          'NOT_FOUND',
          'Medicamento não encontrado.',
        );
      }
      return sendError(reply, 400, 'VALIDATION', 'Não foi possível criar.');
    }

    return reply.code(201).send({
      treatment: result.treatment,
      doseCount: result.doseCount,
      truncatedBackfill: result.truncatedBackfill,
    });
  });

  app.get('/api/treatments/:id', async (request, reply) => {
    if (!request.caregiver) {
      return sendError(reply, 401, 'UNAUTHORIZED', 'Faça login para continuar.');
    }
    const { id } = /** @type {{ id: string }} */ (request.params);
    if (!UUID_RE.test(id)) {
      return sendError(reply, 404, 'NOT_FOUND', 'Tratamento não encontrado.');
    }
    const treatment = await getTreatment(request.caregiver.id, id);
    if (!treatment) {
      return sendError(reply, 404, 'NOT_FOUND', 'Tratamento não encontrado.');
    }
    return { treatment };
  });

  app.patch('/api/treatments/:id', async (request, reply) => {
    if (!request.caregiver) {
      return sendError(reply, 401, 'UNAUTHORIZED', 'Faça login para continuar.');
    }
    const { id } = /** @type {{ id: string }} */ (request.params);
    if (!UUID_RE.test(id)) {
      return sendError(reply, 404, 'NOT_FOUND', 'Tratamento não encontrado.');
    }
    const body = /** @type {Record<string, unknown>} */ (request.body ?? {});
    const result = await patchTreatment(request.caregiver.id, id, body);
    if (!result.ok) {
      if (result.code === 'NOT_FOUND') {
        return sendError(reply, 404, 'NOT_FOUND', 'Tratamento não encontrado.');
      }
      if (result.code === 'ENDED') {
        return sendError(
          reply,
          409,
          'CONFLICT',
          'Tratamento já encerrado.',
        );
      }
      if (result.code === 'CONFLICT') {
        return sendError(
          reply,
          400,
          'CONFLICT',
          result.message ?? 'Encerrar e recriar para mudar o esquema.',
        );
      }
      if (result.code === 'VALIDATION') {
        return sendError(
          reply,
          400,
          'VALIDATION',
          'Dados inválidos.',
          result.fields,
        );
      }
      return sendError(reply, 400, 'VALIDATION', 'Não foi possível atualizar.');
    }
    return { treatment: result.treatment };
  });

  app.post('/api/treatments/:id/end', async (request, reply) => {
    if (!request.caregiver) {
      return sendError(reply, 401, 'UNAUTHORIZED', 'Faça login para continuar.');
    }
    const { id } = /** @type {{ id: string }} */ (request.params);
    if (!UUID_RE.test(id)) {
      return sendError(reply, 404, 'NOT_FOUND', 'Tratamento não encontrado.');
    }
    const result = await endTreatment(request.caregiver.id, id);
    if (!result.ok) {
      if (result.code === 'NOT_FOUND') {
        return sendError(reply, 404, 'NOT_FOUND', 'Tratamento não encontrado.');
      }
      return sendError(reply, 409, 'CONFLICT', 'Tratamento já encerrado.');
    }
    return { treatment: result.treatment };
  });

  app.get('/api/treatments/:id/doses', async (request, reply) => {
    if (!request.caregiver) {
      return sendError(reply, 401, 'UNAUTHORIZED', 'Faça login para continuar.');
    }
    const { id } = /** @type {{ id: string }} */ (request.params);
    if (!UUID_RE.test(id)) {
      return sendError(reply, 404, 'NOT_FOUND', 'Tratamento não encontrado.');
    }
    const q = /** @type {Record<string, string | undefined>} */ (
      request.query ?? {}
    );
    const result = await listDoses(request.caregiver.id, id, {
      from: q.from,
      to: q.to,
      includeCancelled: q.includeCancelled === '1' || q.includeCancelled === 'true',
    });
    if (!result.ok) {
      return sendError(reply, 404, 'NOT_FOUND', 'Tratamento não encontrado.');
    }
    return { treatment: result.treatment, doses: result.doses };
  });
}

import { sendError } from '../auth.mjs';
import {
  UUID_RE,
  administerDose,
  getCaregiverCalendar,
  getPatientSheet,
  updateAdministration,
} from '../doses.mjs';
import { getPatient } from '../patients.mjs';

/**
 * @param {import('fastify').FastifyInstance} app
 */
export async function dosesRoutes(app) {
  app.get('/api/dashboard/calendar', async (request, reply) => {
    if (!request.caregiver) {
      return sendError(reply, 401, 'UNAUTHORIZED', 'Faça login para continuar.');
    }
    const q = /** @type {Record<string, string | undefined>} */ (
      request.query ?? {}
    );
    const result = await getCaregiverCalendar(request.caregiver.id, {
      from: q.from,
      to: q.to,
    });
    return { calendar: result.calendar };
  });

  app.get('/api/patients/:id/sheet', async (request, reply) => {
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
    const q = /** @type {Record<string, string | undefined>} */ (
      request.query ?? {}
    );
    const result = await getPatientSheet(request.caregiver.id, id, {
      from: q.from,
      to: q.to,
    });
    if (!result.ok) {
      return sendError(reply, 404, 'NOT_FOUND', 'Paciente não encontrado.');
    }
    return { patient, sheet: result.sheet };
  });

  app.post('/api/doses/:id/administer', async (request, reply) => {
    if (!request.caregiver) {
      return sendError(reply, 401, 'UNAUTHORIZED', 'Faça login para continuar.');
    }
    const { id } = /** @type {{ id: string }} */ (request.params);
    if (!UUID_RE.test(id)) {
      return sendError(reply, 404, 'NOT_FOUND', 'Dose não encontrada.');
    }
    const body = /** @type {Record<string, unknown>} */ (request.body ?? {});
    const result = await administerDose(request.caregiver.id, id, {
      administeredAt:
        typeof body.administeredAt === 'string' ? body.administeredAt : undefined,
      note: typeof body.note === 'string' ? body.note : undefined,
      confirmEarly: body.confirmEarly === true,
    });

    if (!result.ok) {
      if (result.code === 'NOT_FOUND') {
        return sendError(reply, 404, 'NOT_FOUND', 'Dose não encontrada.');
      }
      if (result.code === 'DUPLICATE_ADMINISTRATION') {
        return sendError(
          reply,
          409,
          'DUPLICATE_ADMINISTRATION',
          'Dose já administrada.',
        );
      }
      if (result.code === 'CONFIRM_EARLY_REQUIRED') {
        return sendError(
          reply,
          400,
          'CONFIRM_EARLY_REQUIRED',
          'Confirme para registrar dose antes do horário previsto.',
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
      return sendError(reply, 409, 'CONFLICT', 'Não foi possível registrar.');
    }

    return { dose: result.dose };
  });

  app.patch('/api/doses/:id/administration', async (request, reply) => {
    if (!request.caregiver) {
      return sendError(reply, 401, 'UNAUTHORIZED', 'Faça login para continuar.');
    }
    const { id } = /** @type {{ id: string }} */ (request.params);
    if (!UUID_RE.test(id)) {
      return sendError(reply, 404, 'NOT_FOUND', 'Dose não encontrada.');
    }
    const body = /** @type {Record<string, unknown>} */ (request.body ?? {});
    if (typeof body.administeredAt !== 'string') {
      return sendError(reply, 400, 'VALIDATION', 'Informe a data/hora.', {
        administeredAt: 'Obrigatório.',
      });
    }
    const result = await updateAdministration(request.caregiver.id, id, {
      administeredAt: body.administeredAt,
      note: typeof body.note === 'string' ? body.note : undefined,
    });
    if (!result.ok) {
      if (result.code === 'NOT_FOUND') {
        return sendError(reply, 404, 'NOT_FOUND', 'Dose não encontrada.');
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
      return sendError(reply, 409, 'CONFLICT', 'Dose não está administrada.');
    }
    return { dose: result.dose };
  });
}

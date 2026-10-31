import { getPool } from './db.mjs';
import { asString } from './patients.mjs';
import { mapDose, maybeExtendTreatment, UUID_RE } from './treatments.mjs';
import {
  addDaysYmd,
  civilDate,
  formatZonedIso,
  localHm,
  toZoned,
} from './domain/timezone.mjs';

/**
 * @param {string} caregiverId
 * @param {string} patientId
 * @param {{ from?: string, to?: string }} [range]
 */
export async function getPatientSheet(caregiverId, patientId, range = {}) {
  const pool = getPool();

  const patientRes = await pool.query(
    `SELECT id, name, birth_date, sleep_start, sleep_end
     FROM patients WHERE id = $1 AND caregiver_id = $2`,
    [patientId, caregiverId],
  );
  if (!patientRes.rows[0]) return { ok: false, code: 'NOT_FOUND' };

  const treatmentsRes = await pool.query(
    `SELECT t.id, t.starts_at, t.ends_on, t.status, t.dose_quantity, t.route,
            t.schedule_mode, t.interval_hours, t.times_of_day, t.generated_until,
            m.name AS medication_name
     FROM treatments t
     JOIN medications m ON m.id = t.medication_id
     WHERE t.caregiver_id = $1 AND t.patient_id = $2 AND t.status = 'active'
     ORDER BY t.starts_at ASC`,
    [caregiverId, patientId],
  );

  const treatments = treatmentsRes.rows;
  for (const t of treatments) {
    if (t.ends_on == null) {
      await maybeExtendTreatment(caregiverId, t.id);
    }
  }

  const now = new Date();
  const today = civilDate(now);

  // Calendário padrão: ontem → hoje + 6 dias
  /** @type {string} */
  let fromDay = range.from && /^\d{4}-\d{2}-\d{2}$/.test(range.from)
    ? range.from
    : addDaysYmd(today, -1);
  /** @type {string} */
  let toDay = range.to && /^\d{4}-\d{2}-\d{2}$/.test(range.to)
    ? range.to
    : addDaysYmd(today, 6);

  if (fromDay > toDay) {
    const tmp = fromDay;
    fromDay = toDay;
    toDay = tmp;
  }

  const MED_COLORS = [
    '#3b82f6',
    '#22c55e',
    '#a855f7',
    '#f97316',
    '#06b6d4',
    '#ec4899',
    '#eab308',
    '#14b8a6',
  ];

  const treatmentIds = treatments.map((t) => t.id);
  /** @type {{ id: string, treatment_id: string, caregiver_id: string, scheduled_at: Date|string, status: string, administered_at: Date|string|null, alarm_at: Date|string|null }[]} */
  let doseRows = [];
  if (treatmentIds.length > 0) {
    const dosesRes = await pool.query(
      `SELECT d.id, d.treatment_id, d.caregiver_id, d.scheduled_at, d.status,
              d.administered_at, d.alarm_at
       FROM scheduled_doses d
       WHERE d.caregiver_id = $1
         AND d.treatment_id = ANY($2::uuid[])
         AND d.status <> 'cancelled'
         AND d.scheduled_at >= $3::timestamptz
         AND d.scheduled_at <= ($4::date + time '23:59:59.999') AT TIME ZONE 'America/Sao_Paulo'
       ORDER BY d.scheduled_at ASC`,
      [
        caregiverId,
        treatmentIds,
        `${fromDay}T00:00:00-03:00`,
        toDay,
      ],
    );
    doseRows = dosesRes.rows;
  }

  /** @type {Map<string, string>} */
  const colorByTreatment = new Map();
  treatments.forEach((t, idx) => {
    colorByTreatment.set(t.id, MED_COLORS[idx % MED_COLORS.length]);
  });

  /** @type {Map<string, { name: string, doseQuantity: string, route: string, schemeLabel: string }>} */
  const metaByTreatment = new Map();
  for (const t of treatments) {
    let schemeLabel = '';
    if (t.schedule_mode === 'regular_interval') {
      schemeLabel = `${t.interval_hours}/${t.interval_hours}h`;
    } else {
      schemeLabel = 'horários';
    }
    metaByTreatment.set(t.id, {
      name: t.medication_name,
      doseQuantity: t.dose_quantity,
      route: t.route,
      schemeLabel,
    });
  }

  /** @type {Set<string>} */
  const slotSet = new Set();
  /** @type {{ doseId: string, scheduledAt: Date }[]} */
  const pendingForNext = [];

  /** @type {Record<string, Array<{
   *   doseId: string,
   *   treatmentId: string,
   *   medicationName: string,
   *   doseQuantity: string,
   *   route: string,
   *   color: string,
   *   scheduledAt: string,
   *   status: string,
   *   administeredAt: string | null,
   *   note: string | null,
   *   isNext: boolean,
   *   isOverdue: boolean,
   * }>>} */
  const byDaySlot = {};

  for (const row of doseRows) {
    const z = toZoned(row.scheduled_at);
    const day = z.toPlainDate().toString();
    const slot = localHm(z);
    slotSet.add(slot);

    const key = `${day}|${slot}`;
    const meta = metaByTreatment.get(row.treatment_id);
    const isOverdue =
      row.status === 'pending' &&
      new Date(row.scheduled_at).getTime() < now.getTime();

    if (!byDaySlot[key]) byDaySlot[key] = [];
    byDaySlot[key].push({
      doseId: row.id,
      treatmentId: row.treatment_id,
      medicationName: meta?.name ?? 'Medicamento',
      doseQuantity: meta?.doseQuantity ?? '',
      route: meta?.route ?? '',
      color: colorByTreatment.get(row.treatment_id) ?? MED_COLORS[0],
      scheduledAt: formatZonedIso(z),
      status: row.status,
      administeredAt: row.administered_at
        ? formatZonedIso(toZoned(row.administered_at))
        : null,
      note: null,
      isNext: false,
      isOverdue,
    });

    if (row.status === 'pending') {
      pendingForNext.push({
        doseId: row.id,
        scheduledAt: new Date(row.scheduled_at),
      });
    }
  }

  // Latest note per dose
  const doseIds = doseRows.map((r) => r.id);
  /** @type {Map<string, string>} */
  const noteByDose = new Map();
  if (doseIds.length > 0) {
    const notesRes = await pool.query(
      `SELECT DISTINCT ON (scheduled_dose_id) scheduled_dose_id, body
       FROM notes
       WHERE caregiver_id = $1
         AND scheduled_dose_id = ANY($2::uuid[])
       ORDER BY scheduled_dose_id, created_at DESC`,
      [caregiverId, doseIds],
    );
    for (const n of notesRes.rows) {
      noteByDose.set(n.scheduled_dose_id, n.body);
    }
    for (const chips of Object.values(byDaySlot)) {
      for (const chip of chips) {
        chip.note = noteByDose.get(chip.doseId) ?? null;
      }
    }
  }

  let nextDoseId = /** @type {string | null} */ (null);
  if (pendingForNext.length > 0) {
    const overdue = pendingForNext
      .filter((d) => d.scheduledAt.getTime() < now.getTime())
      .sort((a, b) => a.scheduledAt - b.scheduledAt);
    const future = pendingForNext
      .filter((d) => d.scheduledAt.getTime() >= now.getTime())
      .sort((a, b) => a.scheduledAt - b.scheduledAt);
    nextDoseId = (overdue[0] ?? future[0])?.doseId ?? null;
  }

  if (nextDoseId) {
    for (const chips of Object.values(byDaySlot)) {
      for (const chip of chips) {
        if (chip.doseId === nextDoseId) chip.isNext = true;
      }
    }
  }

  /** @type {{ ymd: string, label: string, isToday: boolean, isYesterday: boolean }[]} */
  const days = [];
  const yesterday = addDaysYmd(today, -1);
  for (let d = fromDay; d <= toDay; d = addDaysYmd(d, 1)) {
    const isToday = d === today;
    const isYesterday = d === yesterday;
    let label;
    if (isToday) label = 'Hoje';
    else if (isYesterday) label = 'Ontem';
    else {
      const [y, m, dayNum] = d.split('-').map(Number);
      label = new Intl.DateTimeFormat('pt-BR', {
        weekday: 'short',
        day: '2-digit',
        month: '2-digit',
      }).format(new Date(y, m - 1, dayNum));
    }
    days.push({ ymd: d, label, isToday, isYesterday });
  }

  const slots = [...slotSet].sort();

  const medications = treatments.map((t) => {
    const meta = metaByTreatment.get(t.id);
    return {
      treatmentId: t.id,
      name: t.medication_name,
      doseQuantity: t.dose_quantity,
      route: t.route,
      schemeLabel: meta?.schemeLabel ?? '',
      color: colorByTreatment.get(t.id) ?? MED_COLORS[0],
    };
  });

  return {
    ok: true,
    sheet: {
      patientId,
      from: fromDay,
      to: toDay,
      today,
      medications,
      slots,
      days,
      byDaySlot,
      nextDoseId,
    },
  };
}

/**
 * @param {string} caregiverId
 * @param {string} doseId
 * @param {{ administeredAt?: string, note?: string, confirmEarly?: boolean }} input
 */
export async function administerDose(caregiverId, doseId, input) {
  const pool = getPool();
  const existing = await pool.query(
    `SELECT d.id, d.treatment_id, d.scheduled_at, d.status, d.administered_at
     FROM scheduled_doses d
     WHERE d.id = $1 AND d.caregiver_id = $2`,
    [doseId, caregiverId],
  );
  const row = existing.rows[0];
  if (!row) return { ok: false, code: 'NOT_FOUND' };

  if (row.status === 'administered') {
    return { ok: false, code: 'DUPLICATE_ADMINISTRATION' };
  }
  if (row.status === 'skipped' || row.status === 'cancelled') {
    return { ok: false, code: 'CONFLICT' };
  }

  const scheduledAt = new Date(row.scheduled_at);
  const now = new Date();
  let administeredAt = input.administeredAt
    ? new Date(input.administeredAt)
    : now;
  if (Number.isNaN(administeredAt.getTime())) {
    return {
      ok: false,
      code: 'VALIDATION',
      fields: { administeredAt: 'Data/hora inválida.' },
    };
  }

  if (scheduledAt.getTime() > now.getTime() && input.confirmEarly !== true) {
    return { ok: false, code: 'CONFIRM_EARLY_REQUIRED' };
  }

  const note = asString(input.note).trim();
  if (note.length > 2000) {
    return {
      ok: false,
      code: 'VALIDATION',
      fields: { note: 'Observação muito longa.' },
    };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updated = await client.query(
      `UPDATE scheduled_doses
       SET status = 'administered',
           administered_at = $1,
           updated_at = now()
       WHERE id = $2 AND caregiver_id = $3 AND status = 'pending'
       RETURNING id, treatment_id, caregiver_id, scheduled_at, status,
                 administered_at, alarm_at`,
      [administeredAt, doseId, caregiverId],
    );
    if ((updated.rowCount ?? 0) === 0) {
      await client.query('ROLLBACK');
      return { ok: false, code: 'CONFLICT' };
    }

    if (note) {
      await client.query(
        `INSERT INTO notes (caregiver_id, treatment_id, scheduled_dose_id, body)
         VALUES ($1, $2, $3, $4)`,
        [caregiverId, row.treatment_id, doseId, note],
      );
    }

    await client.query('COMMIT');
    return { ok: true, dose: mapDose(updated.rows[0]) };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Allow updating stamp on already administered (edit time + optional note).
 * @param {string} caregiverId
 * @param {string} doseId
 * @param {{ administeredAt: string, note?: string }} input
 */
export async function updateAdministration(caregiverId, doseId, input) {
  const pool = getPool();
  const existing = await pool.query(
    `SELECT d.id, d.treatment_id, d.status
     FROM scheduled_doses d
     WHERE d.id = $1 AND d.caregiver_id = $2`,
    [doseId, caregiverId],
  );
  const row = existing.rows[0];
  if (!row) return { ok: false, code: 'NOT_FOUND' };
  if (row.status !== 'administered') {
    return { ok: false, code: 'CONFLICT' };
  }

  const administeredAt = new Date(input.administeredAt);
  if (Number.isNaN(administeredAt.getTime())) {
    return {
      ok: false,
      code: 'VALIDATION',
      fields: { administeredAt: 'Data/hora inválida.' },
    };
  }

  const note = asString(input.note ?? '').trim();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updated = await client.query(
      `UPDATE scheduled_doses
       SET administered_at = $1, updated_at = now()
       WHERE id = $2 AND caregiver_id = $3
       RETURNING id, treatment_id, caregiver_id, scheduled_at, status,
                 administered_at, alarm_at`,
      [administeredAt, doseId, caregiverId],
    );
    if (note) {
      await client.query(
        `INSERT INTO notes (caregiver_id, treatment_id, scheduled_dose_id, body)
         VALUES ($1, $2, $3, $4)`,
        [caregiverId, row.treatment_id, doseId, note],
      );
    }
    await client.query('COMMIT');
    return { ok: true, dose: mapDose(updated.rows[0]) };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export { UUID_RE };

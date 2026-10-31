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

  /** @type {string} */
  let fromDay = range.from && /^\d{4}-\d{2}-\d{2}$/.test(range.from)
    ? range.from
    : today;
  /** @type {string} */
  let toDay = range.to && /^\d{4}-\d{2}-\d{2}$/.test(range.to)
    ? range.to
    : addDaysYmd(today, 7);

  if (!range.from && treatments.length > 0) {
    let minStart = today;
    for (const t of treatments) {
      const s = civilDate(new Date(t.starts_at));
      if (s < minStart) minStart = s;
    }
    // Cap history display to 31 days back
    const floor = addDaysYmd(today, -31);
    fromDay = minStart < floor ? floor : minStart;
  }

  if (!range.to && treatments.length > 0) {
    let maxEnd = toDay;
    for (const t of treatments) {
      if (t.ends_on) {
        const e =
          t.ends_on instanceof Date
            ? t.ends_on.toISOString().slice(0, 10)
            : String(t.ends_on).slice(0, 10);
        if (e > maxEnd) maxEnd = e;
      } else if (t.generated_until) {
        const e = civilDate(new Date(t.generated_until));
        if (e > maxEnd) maxEnd = e;
      }
    }
    toDay = maxEnd;
  }

  if (fromDay > toDay) {
    const tmp = fromDay;
    fromDay = toDay;
    toDay = tmp;
  }

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

  /** @type {Map<string, Set<string>>} */
  const slotsByTreatment = new Map();
  for (const t of treatments) {
    slotsByTreatment.set(t.id, new Set());
  }

  /** @type {Record<string, {
   *   doseId: string,
   *   treatmentId: string,
   *   scheduledAt: string,
   *   status: string,
   *   administeredAt: string | null,
   *   day: string,
   *   slot: string,
   *   isNext: boolean,
   *   isOverdue: boolean,
   * }>} */
  const cells = {};

  /** @type {{ doseId: string, scheduledAt: Date, status: string }[]} */
  const pendingForNext = [];

  for (const row of doseRows) {
    const z = toZoned(row.scheduled_at);
    const day = z.toPlainDate().toString();
    const slot = localHm(z);
    slotsByTreatment.get(row.treatment_id)?.add(slot);

    const key = `${row.treatment_id}|${day}|${slot}`;
    const scheduledAt = formatZonedIso(z);
    const administeredAt = row.administered_at
      ? formatZonedIso(toZoned(row.administered_at))
      : null;
    const isOverdue =
      row.status === 'pending' && new Date(row.scheduled_at).getTime() < now.getTime();

    cells[key] = {
      doseId: row.id,
      treatmentId: row.treatment_id,
      scheduledAt,
      status: row.status,
      administeredAt,
      day,
      slot,
      isNext: false,
      isOverdue,
    };

    if (row.status === 'pending') {
      pendingForNext.push({
        doseId: row.id,
        scheduledAt: new Date(row.scheduled_at),
        status: row.status,
      });
    }
  }

  // Next: earliest overdue pending, else earliest future pending
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
    for (const cell of Object.values(cells)) {
      if (cell.doseId === nextDoseId) cell.isNext = true;
    }
  }

  /** @type {string[]} */
  const days = [];
  for (let d = fromDay; d <= toDay; d = addDaysYmd(d, 1)) {
    days.push(d);
  }

  const columns = treatments
    .map((t) => {
      const slots = [...(slotsByTreatment.get(t.id) ?? [])].sort();
      let schemeLabel = '';
      if (t.schedule_mode === 'regular_interval') {
        schemeLabel = `${t.interval_hours}/${t.interval_hours}h`;
      } else {
        schemeLabel = 'horários';
      }
      return {
        treatmentId: t.id,
        medicationName: t.medication_name,
        doseQuantity: t.dose_quantity,
        route: t.route,
        schemeLabel,
        slots,
      };
    })
    .filter((c) => c.slots.length > 0);

  return {
    ok: true,
    sheet: {
      patientId,
      from: fromDay,
      to: toDay,
      columns,
      days,
      cells,
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

import {
  TZ,
  addDaysYmd,
  civilDate,
  endOfDaySaoPaulo,
  formatZonedIso,
  inSleepWindow,
  localHm,
  minutesSinceMidnight,
  toZoned,
  zonedFromParts,
  zonedToDate,
} from './timezone.mjs';

const BACKFILL_CAP_DAYS = 31;
const ROLLING_WINDOW_DAYS = 7;
const MAX_COURSE_DAYS = 366;
const SUGGEST_HORIZON_HOURS = 72;
const ALARM_LEAD_MINUTES = 5;

/**
 * @typedef {'regular_interval' | 'custom_times'} ScheduleMode
 *
 * @typedef {{
 *   scheduleMode: ScheduleMode,
 *   startsAt: Date,
 *   endsOn: string | null,
 *   intervalHours?: number | null,
 *   timesOfDay?: string[] | null,
 * }} TreatmentScheduleInput
 *
 * @typedef {{ scheduledAt: Date }} DoseDraft
 */

/**
 * @param {Date} startsAt
 * @param {string | null} endsOn
 * @param {Date} [now]
 */
export function computeRange(startsAt, endsOn, now = new Date()) {
  const nowZ = toZoned(now);
  const startsZ = toZoned(startsAt);

  /** @type {Temporal.ZonedDateTime} */
  let rangeStartZ;
  /** @type {boolean} */
  let truncatedBackfill;
  /** @type {Temporal.ZonedDateTime} */
  let rangeEndZ;

  if (endsOn) {
    // Curso com fim: grade completa (R4.4). Sem cap de backfill de 31d.
    rangeStartZ = startsZ;
    rangeEndZ = endOfDaySaoPaulo(endsOn);
    truncatedBackfill = false;
  } else {
    const backfillFloor = nowZ.subtract({ days: BACKFILL_CAP_DAYS });
    rangeStartZ =
      Temporal.ZonedDateTime.compare(startsZ, backfillFloor) > 0
        ? startsZ
        : backfillFloor;
    truncatedBackfill =
      Temporal.ZonedDateTime.compare(startsZ, rangeStartZ) < 0;
    const base =
      Temporal.ZonedDateTime.compare(startsZ, nowZ) > 0 ? startsZ : nowZ;
    rangeEndZ = base.add({ days: ROLLING_WINDOW_DAYS });
  }

  return {
    rangeStart: zonedToDate(rangeStartZ),
    rangeEnd: zonedToDate(rangeEndZ),
    truncatedBackfill,
    rangeStartIso: formatZonedIso(rangeStartZ),
    rangeEndIso: formatZonedIso(rangeEndZ),
  };
}

/**
 * @param {string} startsAtIsoOrDate
 * @param {string} endsOn
 */
export function courseTooLong(startsAt, endsOn) {
  const startDay = civilDate(startsAt instanceof Date ? startsAt : new Date(startsAt));
  const start = Temporal.PlainDate.from(startDay);
  const end = Temporal.PlainDate.from(endsOn);
  const days = start.until(end).days;
  return days > MAX_COURSE_DAYS;
}

/**
 * @param {TreatmentScheduleInput} treatment
 * @param {Date} rangeStart
 * @param {Date} rangeEnd
 * @returns {DoseDraft[]}
 */
export function generateDoses(treatment, rangeStart, rangeEnd) {
  if (treatment.scheduleMode === 'regular_interval') {
    return generateRegular(
      treatment.startsAt,
      treatment.intervalHours ?? 0,
      rangeStart,
      rangeEnd,
    );
  }
  return generateCustom(
    treatment.startsAt,
    treatment.timesOfDay ?? [],
    rangeStart,
    rangeEnd,
  );
}

/**
 * @param {Date} firstDoseAt
 * @param {number} intervalHours
 * @param {Date} rangeStart
 * @param {Date} rangeEnd
 */
function generateRegular(firstDoseAt, intervalHours, rangeStart, rangeEnd) {
  if (!(intervalHours > 0)) return [];
  const drafts = [];
  let t = toZoned(firstDoseAt);
  const end = toZoned(rangeEnd);
  const start = toZoned(rangeStart);

  // Advance to first occurrence >= rangeStart
  while (Temporal.ZonedDateTime.compare(t, start) < 0) {
    t = t.add({ hours: intervalHours });
    if (Temporal.ZonedDateTime.compare(t, end) > 0) return drafts;
  }

  while (Temporal.ZonedDateTime.compare(t, end) <= 0) {
    drafts.push({ scheduledAt: zonedToDate(t) });
    t = t.add({ hours: intervalHours });
  }
  return drafts;
}

/**
 * @param {Date} startsAt
 * @param {string[]} timesOfDay
 * @param {Date} rangeStart
 * @param {Date} rangeEnd
 */
function generateCustom(startsAt, timesOfDay, rangeStart, rangeEnd) {
  const times = normalizeTimesOfDay(timesOfDay);
  if (times.length === 0) return [];

  const startsZ = toZoned(startsAt);
  const startBound = toZoned(rangeStart);
  const endBound = toZoned(rangeEnd);

  const startDate = civilDate(
    Temporal.ZonedDateTime.compare(startsZ, startBound) > 0 ? startsZ : startBound,
  );
  const endDate = civilDate(endBound);

  /** @type {DoseDraft[]} */
  const drafts = [];
  let day = startDate;
  while (day <= endDate) {
    for (const hm of times) {
      const zdt = zonedFromParts(day, hm);
      if (
        Temporal.ZonedDateTime.compare(zdt, startsZ) >= 0 &&
        Temporal.ZonedDateTime.compare(zdt, startBound) >= 0 &&
        Temporal.ZonedDateTime.compare(zdt, endBound) <= 0
      ) {
        drafts.push({ scheduledAt: zonedToDate(zdt) });
      }
    }
    day = addDaysYmd(day, 1);
  }
  return drafts;
}

/**
 * Sort + validate unique HH:MM.
 * @param {string[]} times
 * @returns {{ ok: true, times: string[] } | { ok: false, code: 'DUPLICATE_TIME' | 'INVALID_TIME' | 'EMPTY_TIMES' }}
 */
export function parseTimesOfDay(times) {
  if (!Array.isArray(times) || times.length === 0) {
    return { ok: false, code: 'EMPTY_TIMES' };
  }
  const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
  /** @type {string[]} */
  const cleaned = [];
  for (const raw of times) {
    if (typeof raw !== 'string' || !TIME_RE.test(raw)) {
      return { ok: false, code: 'INVALID_TIME' };
    }
    cleaned.push(raw);
  }
  const sorted = [...cleaned].sort(
    (a, b) => minutesSinceMidnight(a) - minutesSinceMidnight(b),
  );
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === sorted[i - 1]) {
      return { ok: false, code: 'DUPLICATE_TIME' };
    }
  }
  return { ok: true, times: sorted };
}

/**
 * @param {string[]} times
 */
function normalizeTimesOfDay(times) {
  const parsed = parseTimesOfDay(times);
  return parsed.ok ? parsed.times : [];
}

/**
 * @param {{
 *   intervalHours: number,
 *   sleepStart?: string,
 *   sleepEnd?: string,
 *   anchorDate?: string,
 * }} input
 */
export function suggestFirstDose(input) {
  const intervalHours = input.intervalHours;
  if (!(intervalHours > 0)) {
    throw new Error('intervalHours must be > 0');
  }
  const sleepStart = input.sleepStart ?? '22:00';
  const sleepEnd = input.sleepEnd ?? '07:00';
  const anchorDate =
    input.anchorDate ??
    toZoned(new Date()).toPlainDate().toString();

  /** @type {{ hm: string, sleepHits: number, firstIsDaytime: boolean, score: [number, number, number] }[]} */
  const candidates = [];

  for (let minutes = 0; minutes < 24 * 60; minutes += 30) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    const hm = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    const first = zonedFromParts(anchorDate, hm);
    const horizon = first.add({ hours: SUGGEST_HORIZON_HOURS });

    let sleepHits = 0;
    let t = first;
    while (Temporal.ZonedDateTime.compare(t, horizon) < 0) {
      if (inSleepWindow(localHm(t), sleepStart, sleepEnd)) {
        sleepHits += 1;
      }
      t = t.add({ hours: intervalHours });
    }

    const firstIsDaytime = !inSleepWindow(hm, sleepStart, sleepEnd);
    const score = /** @type {[number, number, number]} */ ([
      sleepHits,
      firstIsDaytime ? 0 : 1,
      minutesSinceMidnight(hm),
    ]);
    candidates.push({ hm, sleepHits, firstIsDaytime, score });
  }

  candidates.sort((a, b) => {
    for (let i = 0; i < 3; i++) {
      if (a.score[i] !== b.score[i]) return a.score[i] - b.score[i];
    }
    return 0;
  });

  const best = candidates[0];
  const firstZ = zonedFromParts(anchorDate, best.hm);
  const previewEnd = firstZ.add({ hours: SUGGEST_HORIZON_HOURS });
  const preview = generateRegular(
    zonedToDate(firstZ),
    intervalHours,
    zonedToDate(firstZ),
    zonedToDate(previewEnd.subtract({ milliseconds: 1 })),
  ).slice(0, 3);

  return {
    firstDoseAt: zonedToDate(firstZ),
    firstDoseAtIso: formatZonedIso(firstZ),
    sleepHitCount: best.sleepHits,
    warning: best.sleepHits > 0,
    warningMessage:
      best.sleepHits > 0
        ? 'Algumas doses cairão na janela de sono.'
        : null,
    preview: preview.map((d) => ({
      scheduledAt: formatZonedIso(toZoned(d.scheduledAt)),
    })),
  };
}

/**
 * @param {Date} scheduledAt
 * @param {boolean} alarmsEnabled
 */
export function alarmAtFor(scheduledAt, alarmsEnabled) {
  if (!alarmsEnabled) return null;
  return new Date(scheduledAt.getTime() - ALARM_LEAD_MINUTES * 60 * 1000);
}

/**
 * Whether generated_until is within 48h and needs extension (continuous only).
 * @param {Date | null} generatedUntil
 * @param {Date} [now]
 */
export function needsExtension(generatedUntil, now = new Date()) {
  if (!generatedUntil) return true;
  const limit = new Date(now.getTime() + 48 * 60 * 60 * 1000);
  return generatedUntil.getTime() <= limit.getTime();
}

/**
 * Next rolling window end for continuous treatments.
 * @param {Date} startsAt
 * @param {Date | null} generatedUntil
 * @param {Date} [now]
 */
export function nextRollingEnd(startsAt, generatedUntil, now = new Date()) {
  const baseMs = Math.max(
    now.getTime(),
    startsAt.getTime(),
    generatedUntil ? generatedUntil.getTime() : 0,
  );
  return new Date(baseMs + ROLLING_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

export {
  BACKFILL_CAP_DAYS,
  ROLLING_WINDOW_DAYS,
  MAX_COURSE_DAYS,
  ALARM_LEAD_MINUTES,
  TZ,
  formatZonedIso,
  toZoned,
  civilDate,
};

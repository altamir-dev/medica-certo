const TZ = 'America/Sao_Paulo';

function T() {
  return Temporal;
}

/**
 * @param {string} ymd YYYY-MM-DD
 * @param {string} hm HH:MM or HH:MM:SS
 */
export function zonedFromParts(ymd, hm) {
  const time = hm.length === 5 ? `${hm}:00` : hm.slice(0, 8);
  return T()
    .PlainDate.from(ymd)
    .toPlainDateTime(T().PlainTime.from(time))
    .toZonedDateTime(TZ);
}

/**
 * @param {Date | string | number} value
 */
export function toZoned(value) {
  const instant =
    value instanceof Date
      ? T().Instant.fromEpochMilliseconds(value.getTime())
      : typeof value === 'number'
        ? T().Instant.fromEpochMilliseconds(value)
        : T().Instant.from(String(value));
  return instant.toZonedDateTimeISO(TZ);
}

/**
 * End of civil day (23:59:59.999) in America/Sao_Paulo.
 * @param {string} ymd
 */
export function endOfDaySaoPaulo(ymd) {
  return zonedFromParts(ymd, '23:59:59').with({
    millisecond: 999,
  });
}

/**
 * @param {Temporal.ZonedDateTime} zdt
 * @returns {Date}
 */
export function zonedToDate(zdt) {
  return new Date(zdt.epochMilliseconds);
}

/**
 * @param {Temporal.ZonedDateTime} zdt
 * @returns {string} ISO-8601 with offset
 */
export function formatZonedIso(zdt) {
  return zdt.toString({ timeZoneName: 'never' });
}

/**
 * @param {Date} date
 */
export function formatDateIso(date) {
  return formatZonedIso(toZoned(date));
}

/**
 * Civil date YYYY-MM-DD in America/Sao_Paulo.
 * @param {Date | Temporal.ZonedDateTime} value
 */
export function civilDate(value) {
  if (value instanceof Date) {
    return toZoned(value).toPlainDate().toString();
  }
  return value.toPlainDate().toString();
}

/**
 * @param {string} ymd
 * @param {number} days
 */
export function addDaysYmd(ymd, days) {
  return T().PlainDate.from(ymd).add({ days }).toString();
}

/**
 * Minutes since local midnight.
 * @param {string} hm HH:MM
 */
export function minutesSinceMidnight(hm) {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
}

/**
 * @param {string} hm HH:MM
 * @param {string} sleepStart
 * @param {string} sleepEnd
 */
export function inSleepWindow(hm, sleepStart, sleepEnd) {
  const t = minutesSinceMidnight(hm);
  const s = minutesSinceMidnight(sleepStart);
  const e = minutesSinceMidnight(sleepEnd);
  if (s < e) {
    return t >= s && t < e;
  }
  return t >= s || t < e;
}

/**
 * Local HH:MM from zoned datetime.
 * @param {Temporal.ZonedDateTime} zdt
 */
export function localHm(zdt) {
  return `${String(zdt.hour).padStart(2, '0')}:${String(zdt.minute).padStart(2, '0')}`;
}

export { TZ };

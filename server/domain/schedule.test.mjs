import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeRange,
  courseTooLong,
  generateDoses,
  parseTimesOfDay,
  suggestFirstDose,
  formatZonedIso,
  toZoned,
} from './schedule.mjs';
import { zonedFromParts, zonedToDate, inSleepWindow } from './timezone.mjs';

describe('inSleepWindow', () => {
  it('handles overnight window 22:00–07:00', () => {
    assert.equal(inSleepWindow('21:59', '22:00', '07:00'), false);
    assert.equal(inSleepWindow('22:00', '22:00', '07:00'), true);
    assert.equal(inSleepWindow('03:00', '22:00', '07:00'), true);
    assert.equal(inSleepWindow('06:59', '22:00', '07:00'), true);
    assert.equal(inSleepWindow('07:00', '22:00', '07:00'), false);
    assert.equal(inSleepWindow('12:00', '22:00', '07:00'), false);
  });
});

describe('parseTimesOfDay', () => {
  it('sorts and accepts unique times', () => {
    const parsed = parseTimesOfDay(['20:00', '08:00', '12:00']);
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.deepEqual(parsed.times, ['08:00', '12:00', '20:00']);
    }
  });

  it('rejects duplicates', () => {
    const parsed = parseTimesOfDay(['08:00', '08:00']);
    assert.equal(parsed.ok, false);
    if (!parsed.ok) assert.equal(parsed.code, 'DUPLICATE_TIME');
  });
});

describe('generateDoses regular_interval', () => {
  it('generates 8/8h for a single day course', () => {
    const startsAt = zonedToDate(zonedFromParts('2026-09-14', '08:00'));
    const range = computeRange(startsAt, '2026-09-14', startsAt);
    const doses = generateDoses(
      {
        scheduleMode: 'regular_interval',
        startsAt,
        endsOn: '2026-09-14',
        intervalHours: 8,
      },
      range.rangeStart,
      range.rangeEnd,
    );
    assert.deepEqual(
      doses.map((d) => formatZonedIso(toZoned(d.scheduledAt))),
      [
        '2026-09-14T08:00:00-03:00',
        '2026-09-14T16:00:00-03:00',
      ],
    );
  });

  it('materializes full multi-day course without 7d cap', () => {
    const startsAt = zonedToDate(zonedFromParts('2026-09-14', '08:00'));
    const range = computeRange(startsAt, '2026-09-27', startsAt);
    const doses = generateDoses(
      {
        scheduleMode: 'regular_interval',
        startsAt,
        endsOn: '2026-09-27',
        intervalHours: 8,
      },
      range.rangeStart,
      range.rangeEnd,
    );
    // Dia 14: 08/16; dias 15–27: 00/08/16 → 2 + 13*3 = 41
    assert.equal(doses.length, 41);
    assert.equal(
      formatZonedIso(toZoned(doses[0].scheduledAt)),
      '2026-09-14T08:00:00-03:00',
    );
    assert.equal(
      formatZonedIso(toZoned(doses[doses.length - 1].scheduledAt)),
      '2026-09-27T16:00:00-03:00',
    );
  });
});

describe('generateDoses custom_times', () => {
  it('repeats daily times within period', () => {
    const startsAt = zonedToDate(zonedFromParts('2026-09-14', '08:00'));
    const range = computeRange(startsAt, '2026-09-16', startsAt);
    const doses = generateDoses(
      {
        scheduleMode: 'custom_times',
        startsAt,
        endsOn: '2026-09-16',
        timesOfDay: ['08:00', '20:00'],
      },
      range.rangeStart,
      range.rangeEnd,
    );
    assert.equal(doses.length, 6);
  });

  it('skips times before startsAt on first day', () => {
    const startsAt = zonedToDate(zonedFromParts('2026-09-14', '12:00'));
    const range = computeRange(startsAt, '2026-09-14', startsAt);
    const doses = generateDoses(
      {
        scheduleMode: 'custom_times',
        startsAt,
        endsOn: '2026-09-14',
        timesOfDay: ['08:00', '20:00'],
      },
      range.rangeStart,
      range.rangeEnd,
    );
    assert.equal(doses.length, 1);
    assert.equal(
      formatZonedIso(toZoned(doses[0].scheduledAt)),
      '2026-09-14T20:00:00-03:00',
    );
  });
});

describe('computeRange continuous', () => {
  it('uses rolling 7 days from max(startsAt, now)', () => {
    const startsAt = zonedToDate(zonedFromParts('2026-09-14', '08:00'));
    const now = startsAt;
    const range = computeRange(startsAt, null, now);
    assert.equal(range.truncatedBackfill, false);
    assert.equal(range.rangeEndIso, '2026-09-21T08:00:00-03:00');
  });
});

describe('courseTooLong', () => {
  it('rejects courses over 366 days', () => {
    const startsAt = zonedToDate(zonedFromParts('2026-01-01', '08:00'));
    assert.equal(courseTooLong(startsAt, '2027-01-03'), true);
    assert.equal(courseTooLong(startsAt, '2026-06-01'), false);
  });
});

describe('suggestFirstDose', () => {
  it('golden N=8 chooses 07:00 with sleepHitCount 3', () => {
    const result = suggestFirstDose({
      intervalHours: 8,
      sleepStart: '22:00',
      sleepEnd: '07:00',
      anchorDate: '2026-09-14',
    });
    assert.equal(result.firstDoseAtIso, '2026-09-14T07:00:00-03:00');
    assert.equal(result.sleepHitCount, 3);
    assert.equal(result.warning, true);
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { nearestSlot } from './clock.ts';

describe('nearestSlot', () => {
  it('picks closest clock time', () => {
    // 10:05 BRT ≈ choose fixed Instant
    const now = new Date('2026-10-30T13:05:00.000Z'); // 10:05 -03
    assert.equal(nearestSlot(['08:00', '10:00', '14:00'], now), '10:00');
  });

  it('returns null for empty', () => {
    assert.equal(nearestSlot([]), null);
  });
});

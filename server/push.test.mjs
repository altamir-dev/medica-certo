import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { subscriptionId, validEndpoint } from './push.mjs';

describe('validEndpoint', () => {
  it('accepts known push hosts', () => {
    assert.equal(
      validEndpoint('https://fcm.googleapis.com/fcm/send/abc123456'),
      true,
    );
    assert.equal(
      validEndpoint('https://updates.push.services.mozilla.com/wpush/v2/xxx'),
      true,
    );
  });

  it('rejects unknown or http endpoints', () => {
    assert.equal(validEndpoint('http://fcm.googleapis.com/fcm/send/abc'), false);
    assert.equal(validEndpoint('https://evil.example/push'), false);
    assert.equal(validEndpoint('not-a-url'), false);
  });
});

describe('subscriptionId', () => {
  it('is stable for the same endpoint', () => {
    const a = subscriptionId('https://fcm.googleapis.com/fcm/send/abc');
    const b = subscriptionId('https://fcm.googleapis.com/fcm/send/abc');
    assert.equal(a, b);
    assert.equal(a.length, 16);
  });
});

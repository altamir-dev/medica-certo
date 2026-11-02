import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import {
  ALARM_BURST_MS,
  ALARM_INTERVAL_MS,
  ALARM_URL,
  DOSE_ALARM_VIBRATE,
  DOSE_ALARM_VIBRATE_CYCLE_MS,
} from './alarmSound.ts';

const here = dirname(fileURLToPath(import.meta.url));

describe('alarme in-app', () => {
  it('é mais longo e mais frequente que o bipe antigo', () => {
    assert.ok(ALARM_BURST_MS >= 700);
    assert.ok(ALARM_INTERVAL_MS <= 1100);
    assert.ok(ALARM_INTERVAL_MS >= ALARM_BURST_MS);
  });

  it('vibra no mesmo padrão da notificação de dose', () => {
    assert.deepEqual(DOSE_ALARM_VIBRATE, [500, 200, 500, 200, 500, 200, 1000]);
    assert.equal(
      DOSE_ALARM_VIBRATE_CYCLE_MS,
      DOSE_ALARM_VIBRATE.reduce((sum, ms) => sum + ms, 0),
    );
  });

  it('aponta para um wav curto e alto em public/sounds', () => {
    assert.equal(ALARM_URL, '/sounds/alarm.wav');
    const wav = readFileSync(join(here, '../../public/sounds/alarm.wav'));
    assert.equal(wav.subarray(0, 4).toString('ascii'), 'RIFF');
    assert.ok(wav.length > 1000);
    assert.ok(wav.length < 200_000);
  });
});

describe('service worker da dose', () => {
  const sw = readFileSync(join(here, '../../public/sw.js'), 'utf8');

  it('pede som, vibração, renotify e interação na dose', () => {
    assert.match(sw, /silent:\s*false/);
    assert.match(sw, /renotify:\s*true/);
    assert.match(sw, /requireInteraction:\s*doseAlarm/);
    assert.match(
      sw,
      /vibrate:\s*\[\s*500,\s*200,\s*500,\s*200,\s*500,\s*200,\s*1000\s*\]/,
    );
  });

  it('não inventa botões de tomar ou soneca', () => {
    assert.equal(sw.includes('actions:'), false);
  });
});

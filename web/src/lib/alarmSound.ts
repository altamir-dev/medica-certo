/**
 * Looping dose alarm.
 * Primary: loud file via HTMLAudioElement (volume 1).
 * Fallback: two-tone Web Audio through a compressor so gain can sit near 1.0
 * without clipping. Vibration repeats until stopAlarmSound.
 */

export const ALARM_URL = '/sounds/alarm.wav';

/** Same pattern as the dose_alarm notification in public/sw.js. */
export const DOSE_ALARM_VIBRATE = [500, 200, 500, 200, 500, 200, 1000];

export const DOSE_ALARM_VIBRATE_CYCLE_MS = DOSE_ALARM_VIBRATE.reduce(
  (sum, ms) => sum + ms,
  0,
);

/** Sounding length of one synth burst. Longer than the old 350ms beep. */
export const ALARM_BURST_MS = 780;

/** Gap between synth bursts. Shorter than the old 1600ms. */
export const ALARM_INTERVAL_MS = 1000;

const TONE_A_HZ = 880;
const TONE_B_HZ = 1174;
const PEAK_GAIN = 1;

let ctx: AudioContext | null = null;
let compressor: DynamicsCompressorNode | null = null;
let compressorCtx: AudioContext | null = null;
let fileEl: HTMLAudioElement | null = null;
let synthTimer: number | null = null;
let vibrateTimer: number | null = null;
let previewTimer: number | null = null;
let unlocked = false;
/** Real due-dose alarm owns the sound; a preview must not stop it. */
let pinned = false;
/** Want sound right now (preview or pinned). Cleared by halt. */
let wantSound = false;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  return ctx;
}

function outputNode(): DynamicsCompressorNode | null {
  const c = getCtx();
  if (!c) return null;
  if (!compressor || compressorCtx !== c) {
    compressor = c.createDynamicsCompressor();
    // Let a full-scale square through; only catch the overlap peak.
    compressor.threshold.value = -8;
    compressor.knee.value = 4;
    compressor.ratio.value = 6;
    compressor.attack.value = 0.002;
    compressor.release.value = 0.12;
    compressor.connect(c.destination);
    compressorCtx = c;
  }
  return compressor;
}

/** Call from a click/tap so browsers allow audio. */
export async function unlockAlarmAudio(): Promise<void> {
  const c = getCtx();
  if (!c) return;
  if (c.state === 'suspended') {
    try {
      await c.resume();
    } catch {
      /* ignore */
    }
  }
  unlocked = c.state === 'running';
}

function burstOnce() {
  const c = getCtx();
  const dest = outputNode();
  if (!c || !dest || c.state !== 'running') return;
  const gain = c.createGain();
  const oscA = c.createOscillator();
  const oscB = c.createOscillator();
  oscA.type = 'square';
  oscA.frequency.value = TONE_A_HZ;
  oscB.type = 'sawtooth';
  oscB.frequency.value = TONE_B_HZ;
  oscA.connect(gain);
  oscB.connect(gain);
  gain.connect(dest);

  const t = c.currentTime;
  const burst = ALARM_BURST_MS / 1000;
  const half = burst / 2;
  const attack = 0.012;
  const release = 0.04;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(PEAK_GAIN, t + attack);
  gain.gain.setValueAtTime(PEAK_GAIN, t + Math.max(attack, burst - release));
  gain.gain.exponentialRampToValueAtTime(0.0001, t + burst);
  oscA.start(t);
  oscA.stop(t + half);
  oscB.start(t + half);
  oscB.stop(t + burst + 0.02);
  oscB.onended = () => {
    try {
      oscA.disconnect();
      oscB.disconnect();
      gain.disconnect();
    } catch {
      /* ignore */
    }
  };
}

function startVibrate() {
  if (vibrateTimer != null) return;
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') {
    return;
  }
  const pulse = () => {
    if (!wantSound) return;
    try {
      navigator.vibrate(DOSE_ALARM_VIBRATE);
    } catch {
      /* ignore */
    }
  };
  pulse();
  vibrateTimer = window.setInterval(pulse, DOSE_ALARM_VIBRATE_CYCLE_MS);
}

function stopVibrate() {
  if (vibrateTimer != null) {
    window.clearInterval(vibrateTimer);
    vibrateTimer = null;
  }
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') {
    return;
  }
  try {
    navigator.vibrate(0);
  } catch {
    /* ignore */
  }
}

function startSynth() {
  if (synthTimer != null) return;
  if (fileEl && !fileEl.paused) {
    fileEl.pause();
  }
  burstOnce();
  synthTimer = window.setInterval(() => {
    if (!wantSound) return;
    burstOnce();
  }, ALARM_INTERVAL_MS);
}

function tryFile(): boolean {
  if (typeof Audio === 'undefined') return false;
  try {
    if (!fileEl) {
      fileEl = new Audio(ALARM_URL);
      fileEl.preload = 'auto';
    }
    fileEl.loop = true;
    fileEl.volume = 1;
    const played = fileEl.play();
    if (played && typeof played.then === 'function') {
      played.then(
        () => {
          if (!wantSound && fileEl) {
            fileEl.pause();
            fileEl.currentTime = 0;
            return;
          }
          if (synthTimer != null) {
            window.clearInterval(synthTimer);
            synthTimer = null;
          }
        },
        () => {
          if (!wantSound) return;
          startSynth();
        },
      );
    }
    return true;
  } catch {
    return false;
  }
}

function ensureRinging(preferFile = false) {
  wantSound = true;
  startVibrate();
  if (!preferFile && synthTimer != null) return;
  if (fileEl && !fileEl.paused) return;
  if (!tryFile()) startSynth();
}

function haltPlayback() {
  wantSound = false;
  if (synthTimer != null) {
    window.clearInterval(synthTimer);
    synthTimer = null;
  }
  if (fileEl) {
    fileEl.pause();
    fileEl.currentTime = 0;
  }
  stopVibrate();
}

export function startAlarmSound(): void {
  pinned = true;
  if (previewTimer != null) {
    window.clearTimeout(previewTimer);
    previewTimer = null;
  }
  void unlockAlarmAudio();
  ensureRinging();
}

export function stopAlarmSound(): void {
  pinned = false;
  if (previewTimer != null) {
    window.clearTimeout(previewTimer);
    previewTimer = null;
  }
  haltPlayback();
}

/**
 * Play the alarm for a few seconds. If a real dose alarm already owns the
 * sound, leave it running.
 */
export function previewAlarmSound(ms = 3000): 'preview' | 'ongoing' {
  const already = pinned;
  void unlockAlarmAudio();
  ensureRinging(true);
  if (already) return 'ongoing';
  if (previewTimer != null) window.clearTimeout(previewTimer);
  previewTimer = window.setTimeout(() => {
    previewTimer = null;
    if (!pinned) haltPlayback();
  }, ms);
  return 'preview';
}

export function isAlarmAudioUnlocked(): boolean {
  return unlocked;
}

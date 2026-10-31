/** Simple looping alarm beep via Web Audio (unlocked after a user gesture). */

let ctx: AudioContext | null = null;
let timer: number | null = null;
let unlocked = false;

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

function beepOnce() {
  const c = getCtx();
  if (!c || c.state !== 'running') return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'sine';
  osc.frequency.value = 880;
  gain.gain.value = 0.0001;
  osc.connect(gain);
  gain.connect(c.destination);
  const t = c.currentTime;
  gain.gain.exponentialRampToValueAtTime(0.2, t + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
  osc.start(t);
  osc.stop(t + 0.4);
}

export function startAlarmSound(): void {
  if (timer != null) return;
  void unlockAlarmAudio().then(() => {
    beepOnce();
    timer = window.setInterval(() => {
      beepOnce();
    }, 1600);
  });
}

export function stopAlarmSound(): void {
  if (timer != null) {
    window.clearInterval(timer);
    timer = null;
  }
}

export function isAlarmAudioUnlocked(): boolean {
  return unlocked;
}

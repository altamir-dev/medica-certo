/** Current wall clock HH:MM in America/Sao_Paulo. */
export function nowHmSaoPaulo(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const h = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const m = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${h}:${m}`;
}

function minutesSinceMidnight(hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Slot HH:MM closest to "now" (absolute distance on the clock).
 */
export function nearestSlot(slots: string[], now = new Date()): string | null {
  if (!slots.length) return null;
  const nowMin = minutesSinceMidnight(nowHmSaoPaulo(now));
  let best = slots[0]!;
  let bestDist = Infinity;
  for (const slot of slots) {
    const dist = Math.abs(minutesSinceMidnight(slot) - nowMin);
    if (dist < bestDist) {
      bestDist = dist;
      best = slot;
    }
  }
  return best;
}

/** Date line without time (stable width while seconds tick). */
export function formatNowDate(now = new Date()): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'full',
    timeZone: 'America/Sao_Paulo',
  }).format(now);
}

/** HH:MM:SS with always-2-digit parts (tabular-friendly). */
export function formatNowTime(now = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(now);
}

export function formatNowRealtime(now = new Date()): string {
  return `${formatNowDate(now)} · ${formatNowTime(now)}`;
}

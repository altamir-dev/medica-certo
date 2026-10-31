import { applyAnvisaMatch, rankAnvisaCandidates } from './anvisa.mjs';
import { reconcileReading, sanitizeModelPayload } from './extract.mjs';

/**
 * @param {unknown} raw
 * @param {string} nowIso
 * @param {(item: { name: string, activeIngredient: string }) => Promise<object[]>} lookup
 */
export async function interpretReading(raw, nowIso, lookup) {
  const sanitized = sanitizeModelPayload(raw);
  if (!sanitized.ok) return { ok: false, code: 'AI_INVALID_OUTPUT' };
  const reading = reconcileReading(sanitized.value, nowIso);
  for (const item of reading.items) {
    const rows = await lookup({
      name: item.name,
      activeIngredient: item.activeIngredient,
    });
    applyAnvisaMatch(
      item,
      rankAnvisaCandidates(rows, {
        name: item.name || item.activeIngredient,
        concentration: item.concentration,
      }),
    );
  }
  return { ok: true, reading };
}

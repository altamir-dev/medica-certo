const ROUTE_SET = new Set([
  'VO',
  'SL',
  'IM',
  'EV',
  'SC',
  'tópica',
  'inalatória',
  'retal',
  'ocular',
  'nasal',
  'outra',
]);

export const PROMPT_VERSION = 'v1';

const SYSTEM_PROMPT = `Você lê uma foto de caixa de medicamento ou de receita no Brasil.
Responda só com JSON no schema pedido.
Leia apenas o que está visível. Use string vazia e confiança 0 quando não der para ler.
Não invente número de registro, EAN, indicação nem posologia de bula.
Não devolva nome de paciente, CPF, CRM, endereço ou CID.
Vários medicamentos na mesma receita viram vários items (no máximo 8).
routeText é o texto da foto ("via oral", "VO"), não um código inventado.
mode é regular_interval, custom_times ou unknown.`;

export function visionSystemPrompt() {
  return SYSTEM_PROMPT;
}

export function visionJsonSchema() {
  return {
    name: 'medication_read',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        documentKind: {
          type: 'string',
          enum: ['package', 'prescription', 'unknown'],
        },
        documentKindConfidence: { type: 'number' },
        unreadable: { type: 'boolean' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              name: { type: 'string' },
              nameConfidence: { type: 'number' },
              manufacturer: { type: ['string', 'null'] },
              presentationText: { type: ['string', 'null'] },
              activeIngredients: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    name: { type: 'string' },
                    concentration: { type: ['string', 'null'] },
                    confidence: { type: 'number' },
                  },
                  required: ['name', 'concentration', 'confidence'],
                },
              },
              schedule: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  doseQuantity: { type: ['string', 'null'] },
                  routeText: { type: ['string', 'null'] },
                  mode: {
                    type: 'string',
                    enum: ['regular_interval', 'custom_times', 'unknown'],
                  },
                  intervalHours: { type: ['integer', 'null'] },
                  timesOfDay: { type: 'array', items: { type: 'string' } },
                  durationDays: { type: ['integer', 'null'] },
                  continuousUse: { type: 'boolean' },
                  rawText: { type: ['string', 'null'] },
                  confidence: { type: 'number' },
                },
                required: [
                  'doseQuantity',
                  'routeText',
                  'mode',
                  'intervalHours',
                  'timesOfDay',
                  'durationDays',
                  'continuousUse',
                  'rawText',
                  'confidence',
                ],
              },
            },
            required: [
              'name',
              'nameConfidence',
              'manufacturer',
              'presentationText',
              'activeIngredients',
              'schedule',
            ],
          },
        },
      },
      required: [
        'documentKind',
        'documentKindConfidence',
        'unreadable',
        'items',
      ],
    },
  };
}

/**
 * @param {number | null | undefined} value
 */
export function confidenceBand(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 'ausente';
  if (n >= 0.85) return 'alta';
  if (n >= 0.5) return 'media';
  return 'baixa';
}

/**
 * @param {unknown} text
 */
function clip(text, max) {
  const s = typeof text === 'string' ? text.trim() : '';
  return s.slice(0, max);
}

/**
 * @param {unknown} value
 */
function asConf(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/**
 * @param {string} routeText
 */
export function mapRouteText(routeText) {
  const t = routeText
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
  if (!t) return '';
  if (/\bsublingual\b|\bsl\b/.test(t)) return 'SL';
  if (/\bintramuscular\b|\bim\b/.test(t)) return 'IM';
  if (/\bendoven|\bintraven|\bev\b|\biv\b/.test(t)) return 'EV';
  if (/\bsubcut|\bsc\b/.test(t)) return 'SC';
  if (/topic/.test(t)) return 'tópica';
  if (/inal/.test(t)) return 'inalatória';
  if (/retal/.test(t)) return 'retal';
  if (/ocular|oftalm|olho/.test(t)) return 'ocular';
  if (/nasal/.test(t)) return 'nasal';
  if (/\bvo\b|via oral|\boral\b/.test(t)) return 'VO';
  return '';
}

/**
 * @param {string} raw
 */
export function parsePosologyHints(raw) {
  const text = String(raw ?? '');
  const intervalMatch =
    text.match(/(\d{1,2})\s*\/\s*\1\s*h/i) ||
    text.match(/de\s+(\d{1,2})\s+em\s+\1\s+hora/i);
  const intervalHours = intervalMatch ? Number(intervalMatch[1]) : null;
  const withoutInterval = text
    .replace(/(\d{1,2})\s*\/\s*\1\s*h/gi, ' ')
    .replace(/de\s+\d{1,2}\s+em\s+\d{1,2}\s+hora[s]?/gi, ' ');
  /** @type {string[]} */
  const times = [];
  for (const match of withoutInterval.matchAll(
    /\b([01]?\d|2[0-3])\s*(?::|h)\s*([0-5]\d)?\b/gi,
  )) {
    const hh = String(match[1]).padStart(2, '0');
    const mm = match[2] ? match[2] : '00';
    const stamp = `${hh}:${mm}`;
    if (!times.includes(stamp)) times.push(stamp);
  }
  times.sort();
  const daysMatch = text.match(/por\s+(\d{1,3})\s+dias/i);
  const durationDays = daysMatch ? Number(daysMatch[1]) : null;
  const continuous = /uso cont[ií]nuo/i.test(text);
  return { intervalHours, timesOfDay: times, durationDays, continuous };
}

/**
 * @param {string} startsAtIso
 * @param {number | null} durationDays
 */
export function endsOnFromDuration(startsAtIso, durationDays) {
  if (!durationDays || durationDays < 1) return null;
  const instant = Temporal.Instant.from(new Date(startsAtIso).toISOString());
  const zoned = instant.toZonedDateTimeISO('America/Sao_Paulo');
  return zoned
    .toPlainDate()
    .add({ days: durationDays - 1 })
    .toString();
}

/**
 * @param {unknown} raw
 */
export function parseModelJson(raw) {
  if (raw && typeof raw === 'object') return { ok: true, value: raw };
  if (typeof raw !== 'string') return { ok: false };
  const trimmed = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch {
    return { ok: false };
  }
}

/**
 * Descarta chaves fora do schema (CPF, registro inventado, nome do paciente).
 * @param {unknown} raw
 */
export function sanitizeModelPayload(raw) {
  const parsed = parseModelJson(raw);
  if (!parsed.ok || !parsed.value || typeof parsed.value !== 'object') {
    return { ok: false };
  }
  const body = /** @type {Record<string, unknown>} */ (parsed.value);
  const kind = body.documentKind;
  const documentKind =
    kind === 'package' || kind === 'prescription' || kind === 'unknown'
      ? kind
      : 'unknown';
  const itemsIn = Array.isArray(body.items) ? body.items.slice(0, 8) : [];
  const items = itemsIn.map((item) => sanitizeItem(item));
  return {
    ok: true,
    value: {
      documentKind,
      documentKindConfidence: asConf(body.documentKindConfidence),
      unreadable: Boolean(body.unreadable),
      items,
    },
  };
}

/**
 * @param {unknown} item
 */
function sanitizeItem(item) {
  const row =
    item && typeof item === 'object'
      ? /** @type {Record<string, unknown>} */ (item)
      : {};
  const ingredients = Array.isArray(row.activeIngredients)
    ? row.activeIngredients.slice(0, 6)
    : [];
  const schedule =
    row.schedule && typeof row.schedule === 'object'
      ? /** @type {Record<string, unknown>} */ (row.schedule)
      : {};
  const mode = schedule.mode;
  return {
    name: clip(row.name, 120),
    nameConfidence: asConf(row.nameConfidence),
    manufacturer: clip(row.manufacturer, 120) || null,
    presentationText: clip(row.presentationText, 200) || null,
    activeIngredients: ingredients.map((entry) => {
      const ing =
        entry && typeof entry === 'object'
          ? /** @type {Record<string, unknown>} */ (entry)
          : {};
      return {
        name: clip(ing.name, 200),
        concentration: clip(ing.concentration, 80) || null,
        confidence: asConf(ing.confidence),
      };
    }),
    schedule: {
      doseQuantity: clip(schedule.doseQuantity, 120) || null,
      routeText: clip(schedule.routeText, 80) || null,
      mode:
        mode === 'regular_interval' || mode === 'custom_times'
          ? mode
          : 'unknown',
      intervalHours:
        Number.isInteger(schedule.intervalHours) &&
        Number(schedule.intervalHours) > 0 &&
        Number(schedule.intervalHours) <= 168
          ? Number(schedule.intervalHours)
          : null,
      timesOfDay: Array.isArray(schedule.timesOfDay)
        ? schedule.timesOfDay
            .map((t) => clip(t, 5))
            .filter((t) => /^\d{2}:\d{2}$/.test(t))
            .slice(0, 12)
        : [],
      durationDays:
        Number.isInteger(schedule.durationDays) &&
        Number(schedule.durationDays) > 0 &&
        Number(schedule.durationDays) <= 366
          ? Number(schedule.durationDays)
          : null,
      continuousUse: Boolean(schedule.continuousUse),
      rawText: clip(schedule.rawText, 500) || null,
      confidence: asConf(schedule.confidence),
    },
  };
}

/**
 * @param {ReturnType<typeof sanitizeItem>} item
 * @param {string} nowIso
 */
function reconcileItem(item, nowIso) {
  const hints = parsePosologyHints(item.schedule.rawText ?? '');
  let disagreement = null;
  let confidence = item.schedule.confidence;
  const modelInterval = item.schedule.intervalHours;
  if (
    hints.intervalHours &&
    modelInterval &&
    hints.intervalHours !== modelInterval
  ) {
    disagreement = `A foto parece dizer ${hints.intervalHours}/${hints.intervalHours}h e a leitura automática disse ${modelInterval}h.`;
    confidence = Math.min(confidence, 0.7);
  }
  if (
    hints.timesOfDay.length >= 2 &&
    item.schedule.mode === 'regular_interval' &&
    !hints.intervalHours
  ) {
    disagreement =
      'A foto lista horários e a leitura automática marcou intervalo.';
    confidence = Math.min(confidence, 0.7);
  }

  let mode = item.schedule.mode;
  let intervalHours = modelInterval;
  let timesOfDay = item.schedule.timesOfDay;
  if (mode === 'unknown') {
    if (hints.timesOfDay.length >= 1 && !hints.intervalHours) {
      mode = 'custom_times';
      timesOfDay = hints.timesOfDay;
    } else if (hints.intervalHours) {
      mode = 'regular_interval';
      intervalHours = hints.intervalHours;
    }
  }
  if (hints.timesOfDay.length >= 2 && mode !== 'regular_interval') {
    timesOfDay = hints.timesOfDay;
    mode = 'custom_times';
  }

  const continuous =
    item.schedule.continuousUse || hints.continuous;
  const durationDays = item.schedule.durationDays ?? hints.durationDays;
  const endsOn = continuous ? null : endsOnFromDuration(nowIso, durationDays);
  const route = mapRouteText(item.schedule.routeText ?? '');
  const primary = item.activeIngredients[0];
  return {
    name: item.name,
    nameConfidence: item.nameConfidence,
    nameBand: confidenceBand(item.nameConfidence),
    nameSource: 'image',
    manufacturer: item.manufacturer,
    activeIngredient: primary?.name ?? '',
    activeIngredientConfidence: primary?.confidence ?? 0,
    concentration: primary?.concentration ?? '',
    concentrationSource: primary?.concentration ? 'image' : '',
    presentation: item.presentationText ?? '',
    anvisaRegistry: '',
    classeTerapeutica: '',
    candidates: [],
    schedule: {
      doseQuantity: item.schedule.doseQuantity ?? '',
      routeText: item.schedule.routeText ?? '',
      route,
      mode,
      intervalHours: mode === 'regular_interval' ? intervalHours : null,
      timesOfDay: mode === 'custom_times' ? timesOfDay : [],
      durationDays: continuous ? null : durationDays,
      continuousUse: continuous,
      endsOn,
      rawText: item.schedule.rawText ?? '',
      confidence,
      band: confidenceBand(confidence),
      disagreement,
    },
  };
}

/**
 * @param {NonNullable<Extract<ReturnType<typeof sanitizeModelPayload>, { ok: true }>>['value']} reading
 * @param {string} [nowIso]
 */
export function reconcileReading(reading, nowIso = new Date().toISOString()) {
  const joined = reading.items
    .map((item) => item.schedule.rawText ?? '')
    .join(' ');
  let documentKind = reading.documentKind;
  if (
    documentKind === 'package' &&
    /crm|posologia/i.test(joined)
  ) {
    documentKind = 'unknown';
  }
  if (
    documentKind === 'prescription' &&
    reading.items.every(
      (item) =>
        !item.schedule.doseQuantity &&
        !item.schedule.rawText &&
        item.schedule.mode === 'unknown',
    )
  ) {
    documentKind = 'unknown';
  }
  return {
    documentKind,
    documentKindConfidence: reading.documentKindConfidence,
    documentKindBand: confidenceBand(reading.documentKindConfidence),
    unreadable: reading.unreadable,
    items: reading.unreadable ? [] : reading.items.map((item) => reconcileItem(item, nowIso)),
  };
}

export { ROUTE_SET };

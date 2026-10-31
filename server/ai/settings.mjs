/**
 * Leitura por foto só liga com AI_ENABLED=1, AI_API_KEY e AI_MODEL.
 * Sem chave o processo sobe e a feature fica desligada.
 * @param {NodeJS.ProcessEnv} [env]
 */
export function readAiSettings(env = process.env) {
  const apiKey = String(env.AI_API_KEY ?? '').trim();
  const model = String(env.AI_MODEL ?? '').trim();
  const flag = String(env.AI_ENABLED ?? '').trim().toLowerCase();
  const requested = flag === '1' || flag === 'true';
  const baseUrl = String(
    env.AI_BASE_URL ?? 'https://openrouter.ai/api/v1',
  )
    .trim()
    .replace(/\/+$/, '');
  const providerName =
    String(env.AI_PROVIDER_NAME ?? 'OpenRouter').trim() || 'OpenRouter';

  return {
    enabled: requested && apiKey.length > 0 && model.length > 0,
    requested,
    apiKey,
    model,
    baseUrl,
    providerName,
    timeoutMs: clampInt(env.AI_TIMEOUT_MS, 45_000, 5_000, 120_000),
    maxUploadBytes: clampInt(env.AI_MAX_UPLOAD_BYTES, 8 * 1024 * 1024, 256 * 1024, 12 * 1024 * 1024),
    monthlyLimit: clampInt(env.AI_MONTHLY_LIMIT, 5, 1, 500),
    priceInputPerMillion: clampNum(env.AI_PRICE_INPUT_PER_MILLION, 0.0141, 0, 1000),
    priceOutputPerMillion: clampNum(env.AI_PRICE_OUTPUT_PER_MILLION, 0.144, 0, 1000),
    httpReferer:
      String(env.AI_HTTP_REFERER ?? 'https://medica-certo.altamir.dev').trim(),
    appTitle: String(env.AI_APP_TITLE ?? 'Medica Certo').trim() || 'Medica Certo',
    dataCollection: env.AI_DATA_COLLECTION === 'allow' ? 'allow' : 'deny',
    imageRetainDays: clampInt(env.AI_IMAGE_RETAIN_DAYS, 90, 0, 3650),
    promptVersion: String(env.AI_PROMPT_VERSION ?? 'v1').trim() || 'v1',
  };
}

/**
 * @param {unknown} raw
 * @param {number} fallback
 * @param {number} min
 * @param {number} max
 */
function clampInt(raw, fallback, min, max) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/**
 * @param {unknown} raw
 * @param {number} fallback
 * @param {number} min
 * @param {number} max
 */
function clampNum(raw, fallback, min, max) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Sem usage na resposta, estima para cima (3000 entrada + 800 saída).
 * @param {{ inputTokens?: number | null, outputTokens?: number | null, priceInputPerMillion: number, priceOutputPerMillion: number, fallback?: boolean }} input
 */
export function estimateCostUsd(input) {
  const usedIn =
    input.fallback || input.inputTokens == null ? 3000 : input.inputTokens;
  const usedOut =
    input.fallback || input.outputTokens == null ? 800 : input.outputTokens;
  return (
    (usedIn / 1_000_000) * input.priceInputPerMillion +
    (usedOut / 1_000_000) * input.priceOutputPerMillion
  );
}

/**
 * Mês-calendário em America/Sao_Paulo, intervalo [início, fim).
 * @param {Date} [now]
 */
export function saoPauloMonthBounds(now = new Date()) {
  const zoned = Temporal.Instant.from(now.toISOString()).toZonedDateTimeISO(
    'America/Sao_Paulo',
  );
  const start = zoned
    .toPlainDate()
    .with({ day: 1 })
    .toZonedDateTime('America/Sao_Paulo');
  const end = zoned
    .toPlainDate()
    .with({ day: 1 })
    .add({ months: 1 })
    .toZonedDateTime('America/Sao_Paulo');
  return {
    start: new Date(start.epochMilliseconds),
    end: new Date(end.epochMilliseconds),
  };
}

/**
 * @param {number} limit
 */
export function quotaMessage(limit) {
  const label = limit === 1 ? '1 leitura' : `${limit} leituras`;
  return `Você já usou as ${label} deste mês. Dá para cadastrar o medicamento à mão.`;
}

/**
 * @param {{ used: number, limit: number }} usage
 */
export function assessUsage(usage) {
  if (usage.used >= usage.limit) {
    return { ok: false, code: 'RATE_LIMITED', message: quotaMessage(usage.limit) };
  }
  return { ok: true };
}

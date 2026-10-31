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
    dailyLimit: clampInt(env.AI_DAILY_LIMIT, 30, 1, 500),
    hourlyLimit: clampInt(env.AI_HOURLY_LIMIT, 10, 1, 100),
    monthlyBudgetUsd: clampNum(env.AI_MONTHLY_BUDGET_USD, 5, 0.01, 1000),
    priceInputPerMillion: clampNum(env.AI_PRICE_INPUT_PER_MILLION, 0.0141, 0, 1000),
    priceOutputPerMillion: clampNum(env.AI_PRICE_OUTPUT_PER_MILLION, 0.144, 0, 1000),
    httpReferer:
      String(env.AI_HTTP_REFERER ?? 'https://medica-certo.altamir.dev').trim(),
    appTitle: String(env.AI_APP_TITLE ?? 'Medica Certo').trim() || 'Medica Certo',
    dataCollection: env.AI_DATA_COLLECTION === 'allow' ? 'allow' : 'deny',
    prescriptionRetainDays: clampInt(env.AI_PRESCRIPTION_RETAIN_DAYS, 1, 0, 365),
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
 * @param {{ dailyCount: number, hourlyCount: number, monthCostUsd: number, dailyLimit: number, hourlyLimit: number, monthlyBudgetUsd: number }} usage
 */
export function assessUsage(usage) {
  if (usage.hourlyCount >= usage.hourlyLimit) {
    return { ok: false, code: 'RATE_LIMITED' };
  }
  if (usage.dailyCount >= usage.dailyLimit) {
    return { ok: false, code: 'RATE_LIMITED' };
  }
  if (usage.monthCostUsd >= usage.monthlyBudgetUsd) {
    return { ok: false, code: 'AI_BUDGET' };
  }
  return { ok: true };
}

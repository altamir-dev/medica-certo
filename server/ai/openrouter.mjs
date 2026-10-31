import {
  PROMPT_VERSION,
  parseModelJson,
  visionJsonSchema,
  visionSystemPrompt,
} from './extract.mjs';

export { PROMPT_VERSION };

/**
 * Uma chamada de visão. fetchImpl permite teste sem rede.
 * @param {{
 *   settings: {
 *     apiKey: string,
 *     model: string,
 *     baseUrl: string,
 *     timeoutMs: number,
 *     httpReferer: string,
 *     appTitle: string,
 *     dataCollection: string,
 *     promptVersion: string,
 *   },
 *   image: Buffer,
 *   mimeType: string,
 *   fetchImpl?: typeof fetch,
 * }} input
 */
export async function completeVision(input) {
  const fetchImpl = input.fetchImpl ?? fetch;
  const started = Date.now();
  const dataUrl = `data:${input.mimeType};base64,${input.image.toString('base64')}`;
  const body = {
    model: input.settings.model,
    messages: [
      { role: 'system', content: visionSystemPrompt() },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Leia esta imagem de caixa ou receita. Não invente dados que não estejam visíveis.',
          },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: visionJsonSchema(),
    },
    reasoning: { enabled: false },
    provider: {
      data_collection: input.settings.dataCollection,
      require_parameters: true,
    },
  };

  /** @type {Response} */
  let response;
  try {
    response = await fetchImpl(`${input.settings.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.settings.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': input.settings.httpReferer,
        'X-Title': input.settings.appTitle,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(input.settings.timeoutMs),
    });
  } catch (err) {
    const aborted =
      err &&
      typeof err === 'object' &&
      'name' in err &&
      (err.name === 'TimeoutError' || err.name === 'AbortError');
    return {
      ok: false,
      outcome: aborted ? 'timeout' : 'http_error',
      httpStatus: 0,
      latencyMs: Date.now() - started,
      raw: null,
      usage: null,
      model: input.settings.model,
      promptVersion: input.settings.promptVersion || PROMPT_VERSION,
    };
  }

  const latencyMs = Date.now() - started;
  if (!response.ok) {
    return {
      ok: false,
      outcome: 'http_error',
      httpStatus: response.status,
      latencyMs,
      raw: null,
      usage: null,
      model: input.settings.model,
      promptVersion: input.settings.promptVersion || PROMPT_VERSION,
    };
  }

  /** @type {Record<string, unknown>} */
  let payload;
  try {
    payload = await response.json();
  } catch {
    return {
      ok: false,
      outcome: 'invalid_output',
      httpStatus: response.status,
      latencyMs,
      raw: null,
      usage: null,
      model: input.settings.model,
      promptVersion: input.settings.promptVersion || PROMPT_VERSION,
    };
  }

  const choice = Array.isArray(payload.choices) ? payload.choices[0] : null;
  const message =
    choice && typeof choice === 'object'
      ? /** @type {{ message?: { content?: unknown } }} */ (choice).message
      : null;
  const content = message?.content;
  const text = Array.isArray(content)
    ? content
        .map((part) =>
          part && typeof part === 'object' && 'text' in part
            ? String(/** @type {{ text?: unknown }} */ (part).text ?? '')
            : '',
        )
        .join('')
    : typeof content === 'string'
      ? content
      : '';
  const parsed = parseModelJson(text);
  const usage =
    payload.usage && typeof payload.usage === 'object'
      ? /** @type {{ prompt_tokens?: number, completion_tokens?: number }} */ (
          payload.usage
        )
      : null;

  if (!parsed.ok) {
    return {
      ok: false,
      outcome: 'invalid_output',
      httpStatus: response.status,
      latencyMs,
      raw: text,
      usage,
      model:
        typeof payload.model === 'string' ? payload.model : input.settings.model,
      promptVersion: input.settings.promptVersion || PROMPT_VERSION,
    };
  }

  return {
    ok: true,
    outcome: 'ok',
    httpStatus: response.status,
    latencyMs,
    raw: parsed.value,
    usage,
    model: typeof payload.model === 'string' ? payload.model : input.settings.model,
    promptVersion: input.settings.promptVersion || PROMPT_VERSION,
  };
}

/**
 * Uma retentativa só quando o HTTP foi 200 e o JSON não valida.
 * @param {Parameters<typeof completeVision>[0]} input
 */
export async function readWithOneRetry(input) {
  const first = await completeVision(input);
  if (first.ok || first.outcome !== 'invalid_output') return { attempts: [first], result: first };
  const second = await completeVision(input);
  return { attempts: [first, second], result: second };
}

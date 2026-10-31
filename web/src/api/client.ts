export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
  };
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: Record<string, string>;

  constructor(status: number, body: ApiErrorBody['error']) {
    super(body.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code;
    this.fields = body.fields;
  }
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  const isFormData =
    typeof FormData !== 'undefined' && init.body instanceof FormData;
  if (init.body && !headers.has('Content-Type') && !isFormData) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(path, {
    ...init,
    headers,
    credentials: 'same-origin',
  });

  if (res.status === 204) {
    return undefined as T;
  }

  const data: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    const errBody = data as ApiErrorBody | null;
    if (errBody?.error?.code) {
      throw new ApiError(res.status, errBody.error);
    }
    throw new ApiError(res.status, {
      code: 'INTERNAL',
      message: 'Falha inesperada na API.',
    });
  }

  return data as T;
}

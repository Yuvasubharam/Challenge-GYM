// Thin fetch wrapper. Same-origin cookie session (cg_admin, HttpOnly) — no tokens in JS.
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn; };

async function request<T>(method: string, path: string, body?: unknown, init: RequestInit = {}): Promise<T> {
  const isRaw = body instanceof Blob || body instanceof ArrayBuffer;
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : isRaw ? { 'Content-Type': (body as Blob).type || 'application/octet-stream' } : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : isRaw ? (body as BodyInit) : JSON.stringify(body),
    ...init,
  });
  if (res.status === 401 && !path.startsWith('/auth/')) onUnauthorized?.();
  const ct = res.headers.get('content-type') ?? '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string })?.error ?? `Request failed (${res.status})`);
  return data as T;
}

export const api = {
  get: <T>(p: string) => request<T>('GET', p),
  post: <T>(p: string, b: unknown = {}) => request<T>('POST', p, b),
  put: <T>(p: string, b: unknown) => request<T>('PUT', p, b),
  patch: <T>(p: string, b: unknown) => request<T>('PATCH', p, b),
  del: <T>(p: string, b: unknown = {}) => request<T>('DELETE', p, b), // JSON body: the API's CSRF check rejects non-JSON writes
  upload: <T>(p: string, file: Blob) => request<T>('PUT', p, file),
};

export const qs = (o: Record<string, string | number | undefined | null | boolean>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '' && v !== false) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

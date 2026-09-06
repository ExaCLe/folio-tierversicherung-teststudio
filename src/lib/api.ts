import type { Role } from '../../shared/insurance';

export class ApiError extends Error {
  code?: string;
  status: number;
  constructor(message: string, status: number, code?: string) {
    super(message); this.name = 'ApiError'; this.status = status; this.code = code;
  }
}

export async function api<T>(path: string, options: RequestInit & { role?: Role } = {}): Promise<T> {
  const { role, ...request } = options;
  const headers = new Headers(request.headers);
  if (request.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (role) headers.set('x-folio-role', role);
  let response: Response;
  try { response = await fetch(path.startsWith('/api/') ? path : `/api${path}`, { ...request, headers }); }
  catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('The local server is unavailable. Check that npm run dev is running.', 0, 'NETWORK_ERROR');
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(data?.error || `Request failed (${response.status}).`, response.status, data?.code);
  return data as T;
}

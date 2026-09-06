import type { ValidationIssue } from '../../shared/blocks';

export class StudioApiError extends Error {
  status: number;
  issues: ValidationIssue[];
  constructor(message: string, status: number, issues: ValidationIssue[] = []) {
    super(message); this.name = 'StudioApiError'; this.status = status; this.issues = issues;
  }
}

export async function studioApi<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/studio${path}`, {
      ...options,
      headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new StudioApiError('The local server is unavailable. Check that Folio is running and try again.', 0);
  }
  let result: { error?: string; message?: string; issues?: ValidationIssue[] };
  try {
    result = await response.json();
  } catch (error) {
    if (options.signal?.aborted || error instanceof DOMException && error.name === 'AbortError') throw error;
    if (response.ok) throw new StudioApiError('The local server returned an unreadable response. Try the action again.', response.status);
    result = {};
  }
  if (!response.ok) throw new StudioApiError(result.error || result.message || `Request failed (${response.status})`, response.status, result.issues);
  return result as T;
}

export function post<T>(path: string, value: unknown): Promise<T> {
  return studioApi<T>(path, { method: 'POST', body: JSON.stringify(value) });
}

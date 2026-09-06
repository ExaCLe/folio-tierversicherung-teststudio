import type { AgricultureRole } from '../../shared/agriculture';

export class AgricultureApiError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message); this.name = 'AgricultureApiError';
  }
}

export async function agricultureApi<T>(path: string, options: RequestInit & { role?: AgricultureRole } = {}): Promise<T> {
  const { role = 'Vermittler', ...request } = options;
  const headers = new Headers(request.headers);
  headers.set('x-agriculture-role', role);
  if (request.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  let response: Response;
  try { response = await fetch(path.startsWith('/api/agriculture') ? path : `/api/agriculture${path.startsWith('/') ? '' : '/'}${path}`, { ...request, headers }); }
  catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new AgricultureApiError('Das Versicherungssystem ist derzeit nicht erreichbar. Bitte versuchen Sie es erneut.', 0, 'VERBINDUNG_FEHLGESCHLAGEN');
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new AgricultureApiError(data?.error || 'Die Anfrage konnte nicht verarbeitet werden.', response.status, data?.code);
  if (data === null) throw new AgricultureApiError('Die Antwort konnte nicht gelesen werden. Bitte laden Sie den Vorgang erneut.', response.status, 'ANTWORT_UNGUELTIG');
  return data as T;
}

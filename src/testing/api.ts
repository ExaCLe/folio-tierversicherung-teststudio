export class TestingApiError extends Error {
  constructor(message: string, public status: number, public details?: unknown) {
    super(message);
    this.name = 'TestingApiError';
  }
}

export async function testingApi<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/testing${path}`, {
      ...options,
      headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
    });
  } catch (error) {
    if (options.signal?.aborted || error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new TestingApiError('Der lokale Server ist nicht erreichbar. Bitte prüfe, ob Folio gestartet ist.', 0);
  }
  let result: unknown;
  try {
    result = await response.json();
  } catch (error) {
    if (options.signal?.aborted || error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new TestingApiError('Der Server hat keine lesbare Antwort geliefert. Bitte versuche es erneut.', response.status);
  }
  if (!response.ok) {
    const failure = result as { error?: string; message?: string; details?: unknown };
    throw new TestingApiError(failure.error || failure.message || `Die Anfrage ist fehlgeschlagen (${response.status}).`, response.status, failure.details ?? result);
  }
  return result as T;
}

export function testingPost<T>(path: string, body: unknown, signal?: AbortSignal) {
  return testingApi<T>(path, { method: 'POST', body: JSON.stringify(body), signal });
}

export function messageOf(error: unknown) {
  return error instanceof Error ? error.message : 'Die Aktion konnte nicht abgeschlossen werden.';
}

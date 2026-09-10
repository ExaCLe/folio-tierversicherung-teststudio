import type { TestingCatalog, TestingAgentSettings, TestingScenario } from '../../shared/testing';
import type { TestingChatCommand, TestingChatSnapshot, TestingChatStreamEvent } from '../../shared/testing-chat';
import { TestingApiError, messageOf, testingApi } from '../testing/api';

export { messageOf, TestingApiError };

export interface TestingChatBootstrap {
  catalog: TestingCatalog;
  scenarios: TestingScenario[];
}

export const chatApi = {
  bootstrap: async (signal?: AbortSignal) => {
    const [catalog, scenarios] = await Promise.all([
      testingApi<TestingCatalog>('/catalog', { signal }),
      testingApi<TestingScenario[]>('/scenarios', { signal }),
    ]);
    return { catalog, scenarios };
  },
  settings: (signal?: AbortSignal) => testingApi<TestingAgentSettings>('/settings', { signal }),
  conversation: (id: string, signal?: AbortSignal) => testingApi<TestingChatSnapshot>(`/chat/conversations/${encodeURIComponent(id)}`, { signal }),
  create: (input: { message?: string; model: string; scenarioId?: string; requestId: string }) =>
    testingApi<TestingChatSnapshot>('/chat/conversations', { method: 'POST', body: JSON.stringify(input) }),
  command: (id: string, command: TestingChatCommand, expectedRevision: number, payload?: Record<string, unknown>) =>
    testingApi<TestingChatSnapshot>(`/chat/conversations/${encodeURIComponent(id)}/commands`, {
      method: 'POST',
      body: JSON.stringify({ command, expectedRevision, requestId: crypto.randomUUID(), payload }),
    }),
};

export function subscribeConversation(id: string, handlers: {
  onEvent: (event: TestingChatStreamEvent) => void;
  onConnection: (connected: boolean) => void;
}) {
  const source = new EventSource(`/api/testing/chat/conversations/${encodeURIComponent(id)}/events`);
  source.onopen = () => handlers.onConnection(true);
  source.onerror = () => handlers.onConnection(false);
  for (const type of ['snapshot', 'entry', 'state'] as const) {
    source.addEventListener(type, event => {
      try { handlers.onEvent(JSON.parse((event as MessageEvent).data) as TestingChatStreamEvent); }
      catch (cause) { console.warn('Unlesbares Chat-Ereignis', cause); }
    });
  }
  return () => source.close();
}

export interface RunnerObservation {
  runId: string; parentRunId?: string; rowId?: string; stepId?: string; stepPath?: string;
  stepLabel?: string; capturedAt: string; sequence: number; width: number; height: number; frameUrl: string;
}

export function subscribeObservations(runId: string, handlers: {
  onObservation: (value: RunnerObservation) => void;
  onEnd: () => void;
}) {
  const source = new EventSource(`/api/testing/observations/events?runId=${encodeURIComponent(runId)}`);
  const receive = (event: Event) => {
    try { const value = JSON.parse((event as MessageEvent).data) as RunnerObservation | null; if (value && typeof value.frameUrl === 'string') handlers.onObservation(value); }
    catch (cause) { console.warn('Unlesbare Browserbeobachtung', cause); }
  };
  source.addEventListener('snapshot', receive);
  source.addEventListener('observation', receive);
  source.addEventListener('end', () => { handlers.onEnd(); source.close(); });
  return () => source.close();
}

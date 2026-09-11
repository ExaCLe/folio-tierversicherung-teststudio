import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import type { TestingRun } from '../shared/testing';
import type { TestingCatalog, TestingScenario } from '../shared/testing';
import type { TestingChatSnapshot } from '../shared/testing-chat';

const conversation = (scenario?: TestingScenario, patch: Partial<TestingChatSnapshot> = {}): TestingChatSnapshot => ({
  conversation: { id: 'chat-browser-contract', revision: 3, eventSequence: 2, createdAt: '2026-09-10T08:00:00.000Z', updatedAt: '2026-09-10T08:00:00.000Z', model: 'luna', ...(scenario ? { scenarioId: scenario.id } : {}), entryIds: [] },
  timeline: [], tasks: [], questions: [], scenario, allowedCommands: scenario ? ['message', 'revise', 'save'] : ['explore', 'message'],
  confirmedFlow: scenario ? { scenarioRevision: scenario.revision, blocks: scenario.blocks } : null,
  ...(scenario ? { scenarioState: { revision: scenario.revision, fingerprint: 'browser-contract' } } : {}), ...patch,
});

async function scenario(request: APIRequestContext) {
  const response = await request.get('/api/testing/scenarios/kuh-direktionsanfrage');
  expect(response.ok()).toBeTruthy(); return response.json() as Promise<TestingScenario>;
}

async function staticChat(page: Page, snapshot: TestingChatSnapshot, entries: TestingChatSnapshot['timeline'] = []) {
  await page.route('**/api/testing/chat/conversations/chat-browser-contract', route => route.fulfill({ json: snapshot }));
  const entryEvents = entries.map((entry, index) => `event: entry\ndata: ${JSON.stringify({ type: 'entry', sequence: snapshot.conversation.eventSequence + index + 1, revision: snapshot.conversation.revision, entry })}\n\n`).join('');
  await page.route('**/api/testing/chat/conversations/chat-browser-contract/events', route => route.fulfill({ contentType: 'text/event-stream', body: `event: snapshot\ndata: ${JSON.stringify({ type: 'snapshot', sequence: snapshot.conversation.eventSequence, revision: snapshot.conversation.revision, snapshot })}\n\n${entryEvents}` }));
}

test('alternative Chat-Navigation erstellt leer, hängt bestehende Tests ohne Agentenauftrag an und hält Deeplinks', async ({ page, request }) => {
  mkdirSync('.local/verification/chat', { recursive: true });
  const existing = await scenario(request);
  const blank = conversation();
  let current = blank;
  const posts: Record<string, unknown>[] = [];
  await page.route('**/api/testing/chat/conversations', async route => {
    const payload = route.request().postDataJSON() as Record<string, unknown>; posts.push(payload);
    const value = payload.scenarioId ? conversation(existing) : blank; current = value;
    await route.fulfill({ status: 200, json: value });
  });
  await page.route('**/api/testing/chat/conversations/chat-browser-contract', route => route.fulfill({ json: current }));
  await page.route('**/api/testing/chat/conversations/chat-browser-contract/events', route => route.fulfill({ contentType: 'text/event-stream', body: '' }));
  await page.goto('/testing/chat');
  await page.getByRole('button', { name: 'Neuer Testfall', exact: true }).click();
  expect(posts).toHaveLength(0);
  const firstMessage = 'Prüfe einen synthetischen Kuhvorschlag mit Direktionsanfrage.';
  await page.getByPlaceholder(/Erstelle eine Kuhlebensversicherung/).fill(firstMessage);
  await page.getByRole('button', { name: 'Erkundung starten', exact: true }).click();
  expect(posts).toHaveLength(1); expect(posts[0]).toMatchObject({ message: firstMessage });

  await page.goto('/testing/chat'); posts.length = 0;
  await page.getByRole('button', { name: new RegExp(existing.title) }).click();
  expect(posts).toHaveLength(1); expect(posts[0]).toMatchObject({ scenarioId: existing.id }); expect(posts[0]).not.toHaveProperty('message');
  await page.screenshot({ path: '.local/verification/chat/chat.png', fullPage: true });
  await page.getByRole('button', { name: 'Ablauf', exact: true }).click();
  await expect(page).toHaveURL(/\/testing\/chat\/chat-browser-contract\/flow$/);
  await page.reload(); await expect(page.getByRole('button', { name: 'Ablauf', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: 'Browser', exact: true }).click();
  await expect(page).toHaveURL(/\/browser$/);
  await expect(page.getByRole('link', { name: 'Klassische Ansicht', exact: true })).toHaveAttribute('href', '/testing');
});

test('hält den letzten laufenden Auftrag erreichbar und zeigt wartende Aufträge als kompakte Queue', async ({ page }) => {
  mkdirSync('.local/verification/chat', { recursive: true });
  const timeline: TestingChatSnapshot['timeline'] = Array.from({ length: 7 }, (_, index) => ({
    id: `history-${index}`,
    at: `2026-09-10T08:0${index}:00.000Z`,
    kind: index % 2 ? 'user' : 'agent_summary',
    message: `Verlaufseintrag ${index + 1} mit genügend Text, damit die Unterhaltung in einem kurzen Fenster sicher scrollt.`,
  }));
  const snapshot = conversation(undefined, {
    conversation: { id: 'chat-browser-contract', revision: 8, eventSequence: 8, createdAt: '2026-09-10T08:00:00.000Z', updatedAt: '2026-09-10T08:09:00.000Z', model: 'luna', activeJobId: 'job-parent', entryIds: timeline.map(entry => entry.id) },
    timeline,
    tasks: [
      { id: 'job-parent', waitingForJobId: 'job-child', purpose: 'Fachlichen Ablauf planen', agent: { name: 'Sol', modelId: 'sol', color: '#635bff' }, status: 'queued', activityState: 'waiting', stage: 'planning', startedAt: '2026-09-10T08:07:00.000Z', publicDetails: [] },
      { id: 'job-next', purpose: 'Technische Vorbereitung', agent: { name: 'Luna', modelId: 'luna', color: '#e56b25' }, status: 'not_started', activityState: 'not_started', stage: 'wiring', startedAt: '2026-09-10T08:08:00.000Z', publicDetails: [] },
      { id: 'job-child', parentJobId: 'job-parent', purpose: 'Fachwissen prüfen', agent: { name: 'Luna', modelId: 'luna', color: '#0f9f8f' }, status: 'running', activityState: 'working', stage: 'knowledge', startedAt: new Date(Date.now() - 4_000).toISOString(), metrics: { elapsedMs: 4_000, requestCount: 2, apiRequestCount: 7, inputTokens: 1200, outputTokens: 340, totalTokens: 1540 }, publicDetails: [] },
    ],
    allowedCommands: ['message', 'cancel'],
  });
  await staticChat(page, snapshot);
  await page.setViewportSize({ width: 1180, height: 520 });
  await page.goto('/testing/chat/chat-browser-contract/chat');

  const queued = page.locator('.tc-queued-row');
  const running = page.getByRole('button', { name: /Fachwissen prüfen, In Arbeit/ });
  await expect(queued).toHaveCount(2);
  const waitingParent = queued.filter({ hasText: 'Fachlichen Ablauf planen' });
  await expect(waitingParent).toContainText('Wartet auf:');
  await expect(waitingParent.getByRole('button', { name: /Fachwissen prüfen, vorausgesetzte Aufgabe öffnen/ })).toBeVisible();
  await expect(queued.locator('.lucide-loader-circle')).toHaveCount(0);
  await expect(running).toBeVisible();
  await expect(running).toHaveCSS('border-bottom-width', '1px');
  expect(await queued.first().evaluate(element => element.getBoundingClientRect().height)).toBeLessThan(await running.evaluate(element => element.getBoundingClientRect().height));
  await queued.getByRole('button', { name: /Fachwissen prüfen, vorausgesetzte Aufgabe öffnen/ }).click();
  await expect(page.getByRole('dialog')).toContainText('Fachwissen prüfen');
  await expect(page.getByRole('dialog')).toContainText('Noch keine Ausgabe.');
  await expect(running).toContainText('7 API-Anfragen');
  await expect(running).toContainText('Eingabe 1.200');
  await expect(running).toContainText('Ausgabe 340');
  await expect(running).toContainText('Gesamt 1.540');
  await page.getByRole('button', { name: 'Aufgabendetails schließen' }).click();

  const assertBottomReachable = async () => {
    await running.scrollIntoViewIfNeeded();
    const bounds = await page.locator('.tc-timeline').evaluate(element => { const rect = element.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom }; });
    const card = await running.evaluate(element => { const rect = element.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom }; });
    const composer = await page.locator('.tc-composer').evaluate(element => { const rect = element.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom }; });
    expect(card.top).toBeGreaterThanOrEqual(bounds.top);
    expect(card.bottom).toBeLessThanOrEqual(bounds.bottom + 1);
    expect(bounds.bottom).toBeLessThanOrEqual(composer.top + 1);
    expect(composer.bottom).toBeLessThanOrEqual(await page.evaluate(() => innerHeight));
  };
  await assertBottomReachable();
  await page.screenshot({ path: '.local/verification/chat/queue-short-desktop.png' });
  await page.setViewportSize({ width: 390, height: 520 });
  await assertBottomReachable();
  await page.screenshot({ path: '.local/verification/chat/queue-short-mobile.png' });
});

test('zeigt Eingabe und Ausgabe providerübergreifend getrennt und bewahrt Null und unbekannt', async ({ page }) => {
  const snapshot = conversation(undefined, {
    conversation: { id: 'chat-browser-contract', revision: 9, eventSequence: 9, createdAt: '2026-09-10T08:00:00.000Z', updatedAt: '2026-09-10T08:09:00.000Z', model: 'luna', activeJobId: 'job-codex', entryIds: [] },
    tasks: [
      { id: 'job-codex', purpose: 'Codex-Metriken', agent: { name: 'Sol', modelId: 'sol', provider: 'codex', color: '#635bff' }, status: 'completed', activityState: 'done', startedAt: '2026-09-10T08:07:00.000Z', metrics: { elapsedMs: 1000, requestCount: 1, inputTokens: 332939, cachedInputTokens: 252416, outputTokens: 6574, totalTokens: 339513 }, publicDetails: [] },
      { id: 'job-claude', purpose: 'Claude-Metriken', agent: { name: 'Luna', modelId: 'luna', provider: 'claude', color: '#e56b25' }, status: 'completed', activityState: 'done', startedAt: '2026-09-10T08:07:00.000Z', metrics: { elapsedMs: 1000, requestCount: 1, inputTokens: 120, cachedInputTokens: 20, outputTokens: 3, totalTokens: 143 }, publicDetails: [] },
      { id: 'job-zero', purpose: 'Null-Metriken', agent: { name: 'Sol', modelId: 'sol', color: '#0f9f8f' }, status: 'completed', activityState: 'done', startedAt: '2026-09-10T08:07:00.000Z', metrics: { elapsedMs: 1000, requestCount: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 }, publicDetails: [] },
      { id: 'job-unknown', purpose: 'Unbekannte Metriken', agent: { name: 'Luna', modelId: 'luna', color: '#7656a4' }, status: 'completed', activityState: 'done', startedAt: '2026-09-10T08:07:00.000Z', metrics: { elapsedMs: 1000, requestCount: 1 }, publicDetails: [] },
    ],
  });
  await staticChat(page, snapshot);
  await page.goto('/testing/chat/chat-browser-contract/chat');
  const codex = page.getByRole('button', { name: /Codex-Metriken/ });
  await expect(codex).toContainText('Eingabe 332.939');
  await expect(codex).toContainText('Ausgabe 6.574');
  await expect(codex).toContainText('Gesamt 339.513');
  const claude = page.getByRole('button', { name: /Claude-Metriken/ });
  await expect(claude).toContainText('Eingabe 140');
  await expect(claude).toContainText('Ausgabe 3');
  const zero = page.getByRole('button', { name: /Null-Metriken/ });
  await expect(zero).toContainText('Eingabe 0');
  await expect(zero).toContainText('Ausgabe 0');
  await expect(zero).toContainText('Gesamt 0');
  const unknown = page.getByRole('button', { name: /Unbekannte Metriken/ });
  await expect(unknown).not.toContainText('Eingabe');
  await expect(unknown).not.toContainText('Ausgabe');
  await expect(unknown).not.toContainText('Gesamt');
});

test('zeigt Antworten, Aufgaben und einzeln speicherbare Rückfragen ohne internen Statuslärm', async ({ page, request }) => {
  mkdirSync('.local/verification/chat', { recursive: true });
  const seed = await scenario(request);
  const catalogResponse = await request.get('/api/testing/catalog');
  const catalog = await catalogResponse.json() as TestingCatalog;
  const sourceRef = seed.knowledgeRefs[0];
  const sourceTitle = catalog.knowledge.find(item => item.id === sourceRef)?.title ?? sourceRef;
  const newDefinition = { ...structuredClone(catalog.definitions[0]), id: 'preview.neue-direktionspruefung', name: 'Neue Direktionsfreigabe prüfen', semanticKey: 'preview.neue-direktionspruefung', origin: 'agent' as const };
  const newBlock = { ...structuredClone(seed.blocks[0]), id: 'preview-neue-direktionspruefung', definition: { id: newDefinition.id, version: newDefinition.version }, inputs: {} };
  const running = conversation(undefined, {
    conversation: { id: 'chat-browser-contract', revision: 7, eventSequence: 5, createdAt: '2026-09-10T08:00:00.000Z', updatedAt: '2026-09-10T08:02:00.000Z', model: 'luna', activeJobId: 'job-plan', entryIds: ['summary', 'steering'] },
    timeline: [
      { id: 'summary', at: '2026-09-10T08:01:00.000Z', kind: 'agent_summary', message: 'Der Ablauf deckt Antrag und Direktionsanfrage ab.', context: { jobId: 'job-research', phase: 'exploration', taskLabel: 'Kuhlebensversicherung fachlich erkunden', modelId: 'luna', modelLabel: 'Luna', provider: 'codex', stage: 'validating' }, content: { type: 'validated-summary', title: 'Fachliche Erkundung abgeschlossen', summary: 'Der Agent hat den Antrag, die Versicherungssumme und die Direktionsanfrage geprüft.', facts: [{ label: 'Versicherungssumme', value: '15.000 Euro' }] }, sources: [{ label: sourceTitle, kind: 'knowledge', ref: sourceRef }] },
      { id: 'steering', at: '2026-09-10T08:02:00.000Z', kind: 'user', message: 'Ergänze die Ablehnung ohne Direktionsfreigabe.', delivery: { state: 'routing', targetLabel: 'Planungsauftrag', detail: 'Die Nachricht ist gespeichert. Der laufende Auftrag wird beendet, bevor ein Folgeauftrag entsteht.' } },
    ],
    activeJob: { id: 'job-plan', phase: 'business', status: 'running', stage: 'planning', startedAt: '2026-09-10T08:01:30.000Z' },
    tasks: [
      { id: 'job-research', purpose: 'Fachliche Regeln und vorhandenes Wissen prüfen', agent: { name: 'Fachprüfung', modelId: 'luna', provider: 'codex', color: '#286b57' }, status: 'completed', activityState: 'done', stage: 'validating', startedAt: '2026-09-10T08:00:10.000Z', finishedAt: '2026-09-10T08:01:00.000Z', publicDetails: [{ id: 'research-result', at: '2026-09-10T08:01:00.000Z', kind: 'result', message: 'Versicherungssumme und Direktionsregel sind belegt.' }] },
      { id: 'job-plan', purpose: 'Prüfablauf für die Direktionsanfrage entwerfen', agent: { name: 'Ablaufentwurf', modelId: 'sol', provider: 'codex', color: '#7656a4' }, status: 'running', activityState: 'waiting', stage: 'planning', startedAt: '2026-09-10T08:01:30.000Z', publicDetails: [{ id: 'plan-progress', at: '2026-09-10T08:02:00.000Z', kind: 'progress', message: 'Der fachliche Ablauf steht. Für den Ablehnungsfall fehlt noch die gewünschte Begründung.' }] },
    ],
    questions: [
      { id: 'question-reason', jobId: 'job-plan', kind: 'clarification', text: 'Welcher Ablehnungsgrund soll im Test geprüft werden?', why: 'Die erwartete Begründung bestimmt den letzten Prüfschritt.', status: 'open' },
      { id: 'question-channel', jobId: 'job-plan', kind: 'clarification', text: 'Soll die Ablehnung im Portal oder per Brief erscheinen?', why: 'Davon hängt ab, wo der Test den Nachweis sucht.', status: 'open' },
    ],
    allowedCommands: ['message', 'answer', 'cancel'],
    validatedFlowPreview: { jobId: 'job-plan', scenarioRevision: 0, title: 'Kuhleben mit Direktionsanfrage', expectedOutcome: 'Antrag und Freigabe werden fachlich geprüft.', blocks: [newBlock], knowledgeRefs: seed.knowledgeRefs, newDefinitions: [newDefinition], newKnowledge: [], status: 'provisional', readonly: true },
  });
  let current = running;
  const commands: { command: string; payload?: { message?: string; answers?: { questionId: string; answer: string }[] } }[] = [];
  const routedEntry = { ...running.timeline[1], delivery: { state: 'replanning' as const, targetLabel: 'Planungsauftrag', successorJobId: 'job-plan-next', detail: 'Ein Folgeauftrag wurde angelegt.' } };
  let streamConnections = 0;
  await page.route('**/api/testing/chat/conversations/chat-browser-contract', route => route.fulfill({ json: current }));
  await page.route('**/api/testing/chat/conversations/chat-browser-contract/events', route => {
    streamConnections += 1;
    const body = streamConnections === 1
      ? `event: snapshot\ndata: ${JSON.stringify({ type: 'snapshot', sequence: 5, revision: 7, snapshot: running })}\n\n`
      : `event: snapshot\ndata: ${JSON.stringify({ type: 'snapshot', sequence: current.conversation.eventSequence, revision: current.conversation.revision, snapshot: current })}\n\nevent: entry\ndata: ${JSON.stringify({ type: 'entry', sequence: current.conversation.eventSequence + 1, revision: current.conversation.revision, entry: routedEntry })}\n\n`;
    return route.fulfill({ contentType: 'text/event-stream', body });
  });
  await page.route('**/api/testing/chat/conversations/chat-browser-contract/commands', async route => {
    const input = route.request().postDataJSON() as { command: string; payload?: { message?: string; answers?: { questionId: string; answer: string }[] } };
    commands.push(input);
    if (input.command === 'answer') {
      const submitted = input.payload?.answers ?? [];
      expect(submitted).toHaveLength(1);
      const questions = current.questions.map(question => { const answer = submitted.find(item => item.questionId === question.id); return answer ? { ...question, status: 'answered' as const, answer: answer.answer } : question; });
      const allAnswered = questions.every(question => question.status === 'answered');
      current = { ...current, conversation: { ...current.conversation, revision: current.conversation.revision + 1, eventSequence: current.conversation.eventSequence + 1 }, questions, tasks: current.tasks.map(task => task.id === 'job-plan' && allAnswered ? { ...task, activityState: 'working' as const, publicDetails: [...task.publicDetails, { id: 'plan-resumed', at: '2026-09-10T08:04:00.000Z', kind: 'progress' as const, message: 'Die Antworten sind übernommen. Der Ablaufentwurf wird fertiggestellt.' }] } : task) };
      await route.fulfill({ json: current });
      return;
    }
    expect(input.command).toBe('message');
    expect(input.payload?.message).toBe('Prüfe zusätzlich den Ablehnungsgrund.');
    const message = input.payload?.message ?? '';
    current = { ...current, conversation: { ...current.conversation, revision: current.conversation.revision + 1, eventSequence: current.conversation.eventSequence + 1 }, timeline: [...current.timeline, { id: 'steering-new', at: '2026-09-10T08:03:00.000Z', kind: 'user', message, delivery: { state: 'routing', targetLabel: 'Planungsauftrag' } }] };
    await route.fulfill({ json: current });
  });
  await page.goto('/testing/chat/chat-browser-contract/chat');
  await expect(page.getByRole('strong').filter({ hasText: 'Kuhlebensversicherung fachlich erkunden' })).toBeVisible();
  await expect(page.getByText('Neuplanung gestartet')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Fachliche Regeln und vorhandenes Wissen prüfen, Abgeschlossen/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Prüfablauf für die Direktionsanfrage entwerfen, Wartet auf Antwort/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: '2 Angaben fehlen' })).toBeVisible();
  await expect(page.getByLabel('Antwort auf: Welcher Ablehnungsgrund soll im Test geprüft werden?')).toBeVisible();
  await page.getByRole('button', { name: 'Details', exact: true }).first().click();
  await expect(page.getByRole('dialog')).toContainText('Fachliche Erkundung abgeschlossen');
  await expect(page.getByRole('dialog')).toContainText(sourceTitle);
  await page.screenshot({ path: '.local/verification/chat/agent-summary-details.png', fullPage: true });
  const sourcePagePromise = page.waitForEvent('popup');
  await page.getByRole('link', { name: sourceTitle, exact: true }).click();
  const sourcePage = await sourcePagePromise;
  await expect(sourcePage).toHaveURL(new RegExp(`/testing/knowledge/${encodeURIComponent(sourceRef)}$`));
  await expect(sourcePage.getByRole('heading', { name: sourceTitle, exact: true })).toBeVisible();
  await sourcePage.close();
  await page.getByRole('button', { name: 'Details schließen' }).click();
  await page.screenshot({ path: '.local/verification/chat/conversation-working-questions-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 1050 });
  await page.screenshot({ path: '.local/verification/chat/conversation-working-questions-mobile.png', fullPage: true });
  const secondAnswer = page.getByLabel('Antwort auf: Soll die Ablehnung im Portal oder per Brief erscheinen?');
  const secondSave = page.locator('.tc-question').filter({ hasText: 'Soll die Ablehnung im Portal oder per Brief erscheinen?' }).getByRole('button', { name: 'Antwort speichern' });
  await secondSave.scrollIntoViewIfNeeded();
  await expect(secondAnswer).toBeVisible();
  await expect(secondSave).toBeVisible();
  await page.screenshot({ path: '.local/verification/chat/question-fields-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole('button', { name: 'Andere Änderung schreiben', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Separate Nachricht', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Schließen', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Separate Nachricht', exact: true })).toHaveCount(0);
  const reasonAnswer = page.getByLabel('Antwort auf: Welcher Ablehnungsgrund soll im Test geprüft werden?');
  await reasonAnswer.fill('Fehlende Direktionsfreigabe');
  await page.reload();
  await expect(reasonAnswer).toHaveValue('Fehlende Direktionsfreigabe');
  await page.locator('.tc-question').filter({ hasText: 'Welcher Ablehnungsgrund soll im Test geprüft werden?' }).getByRole('button', { name: 'Antwort speichern' }).click();
  await expect(page.getByRole('heading', { name: 'Eine Angabe fehlt' })).toBeVisible();
  expect(commands[0]?.payload?.answers).toEqual([{ questionId: 'question-reason', answer: 'Fehlende Direktionsfreigabe' }]);
  await page.getByLabel('Antwort auf: Soll die Ablehnung im Portal oder per Brief erscheinen?').fill('Im Portal');
  await page.getByRole('button', { name: 'Antwort speichern', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Eine Angabe fehlt' })).toHaveCount(0);
  expect(commands[1]?.payload?.answers).toEqual([{ questionId: 'question-channel', answer: 'Im Portal' }]);
  await expect(page.getByRole('button', { name: /Prüfablauf für die Direktionsanfrage entwerfen, In Arbeit/ })).toBeVisible();
  await page.getByRole('button', { name: /Prüfablauf für die Direktionsanfrage entwerfen, In Arbeit/ }).click();
  await expect(page.getByRole('dialog')).toContainText('Die Antworten sind übernommen. Der Ablaufentwurf wird fertiggestellt.');
  await page.screenshot({ path: '.local/verification/chat/task-details-after-answer.png', fullPage: true });
  await page.getByRole('button', { name: 'Aufgabendetails schließen' }).click();
  const composer = page.getByRole('textbox', { name: 'Separate Nachricht', exact: true });
  await expect(composer).toBeEnabled();
  await page.getByLabel('Modell').selectOption('luna');
  await composer.fill('Prüfe zusätzlich den Ablehnungsgrund.');
  await page.getByRole('button', { name: 'Separate Nachricht senden', exact: true }).click();
  expect(commands[2]?.command).toBe('message');
  await expect(page.getByText('Prüfe zusätzlich den Ablehnungsgrund.')).toBeVisible();
  await page.getByRole('button', { name: 'Ablauf', exact: true }).click();
  await expect(page.getByText('VORLÄUFIGE VORSCHAU')).toBeVisible();
  await expect(page.getByText('Antrag und Freigabe werden fachlich geprüft.')).toBeVisible();
  await expect(page.getByLabel('Baustein hinzufügen')).toBeDisabled();
  await expect(page.locator('.blocklyText').filter({ hasText: 'Neue Direktionsfreigabe prüfen' })).toBeVisible();
  const flowComposer = page.getByRole('textbox', { name: 'Nachricht zum Ablauf' });
  await expect(flowComposer).toBeVisible();
  await flowComposer.fill('Behalte meine manuelle Änderung und ergänze den Grenzwert.');
  await expect(page.getByLabel('Ablauf-Chat').getByLabel('Modell')).toHaveValue('luna');
  await page.setViewportSize({ width: 681, height: 930 });
  await page.getByRole('heading', { name: 'Testmatrix' }).scrollIntoViewIfNeeded();
  const overlayBounds = await page.getByLabel('Ablauf-Chat').evaluate(element => { const rect = element.getBoundingClientRect(); return { left: rect.left, right: rect.right, bottom: rect.bottom }; });
  expect(overlayBounds.left).toBeGreaterThanOrEqual(0);
  expect(overlayBounds.right).toBeLessThanOrEqual(681);
  expect(overlayBounds.bottom).toBeLessThanOrEqual(930);
  await expect(page.getByRole('heading', { name: 'Testmatrix' })).toBeVisible();
  await page.screenshot({ path: '.local/verification/chat/flow-composer-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Unterhaltung', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Separate Nachricht' })).toHaveValue('Behalte meine manuelle Änderung und ergänze den Grenzwert.');
  await page.screenshot({ path: '.local/verification/chat/agent-summary-and-preview.png', fullPage: true });
});

test('Ablauf sperrt Agentenarbeit, dupliziert wirklich und behält einen abgewiesenen lokalen Entwurf', async ({ page, request }) => {
  const existing = await scenario(request);
  const running = conversation(existing, { activeJob: { id: 'job-running', phase: 'business', status: 'running', stage: 'planning', startedAt: new Date().toISOString() }, allowedCommands: ['cancel'] });
  await staticChat(page, running);
  await page.goto('/testing/chat/chat-browser-contract/flow');
  await expect(page.getByLabel('Baustein hinzufügen')).toBeDisabled();
  await expect(page.getByText('vorübergehend schreibgeschützt')).toBeVisible();

  await page.unrouteAll({ behavior: 'wait' });
  const editable = conversation(existing);
  await staticChat(page, editable);
  await page.route('**/api/testing/chat/conversations/chat-browser-contract/commands', async route => route.fulfill({ status: 409, json: { error: 'Synthetischer Revisionskonflikt', code: 'SCENARIO_STATE_CONFLICT' } }));
  await page.reload();
  const picker = page.getByLabel('Baustein hinzufügen');
  await picker.selectOption({ label: 'Als Benutzerrolle' }); await page.getByRole('button', { name: 'Hinzufügen', exact: true }).click();
  const key = `folio-testing-chat-draft:${existing.id}`;
  await expect.poll(() => page.evaluate(storageKey => JSON.parse(localStorage.getItem(storageKey)!).blocks.length, key)).toBe(existing.blocks.length + 1);
  await page.locator('.blocklyText').filter({ hasText: 'Angebot berechnen' }).first().click();
  await page.getByRole('button', { name: 'Block duplizieren', exact: true }).click();
  await expect.poll(() => page.evaluate(storageKey => JSON.parse(localStorage.getItem(storageKey)!).blocks.length, key)).toBe(existing.blocks.length + 2);
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Synthetischer Revisionskonflikt');
  await page.getByRole('button', { name: 'Unterhaltung', exact: true }).click();
  await page.getByRole('button', { name: 'Ablauf', exact: true }).click();
  await expect.poll(() => page.evaluate(storageKey => JSON.parse(localStorage.getItem(storageKey)!).blocks.length, key)).toBe(existing.blocks.length + 2);
  await page.screenshot({ path: '.local/verification/chat/flow.png', fullPage: true });
});

test('behält einen älteren lokalen Arbeitsstand, übernimmt den Agentenstand bewusst und kann ihn rückgängig machen', async ({ page, request }) => {
  const current = await scenario(request);
  const stale = { ...structuredClone(current), revision: current.revision - 1, blocks: [] };
  await page.addInitScript(({ key, marker, value }: { key: string; marker: string; value: string }) => { if (!localStorage.getItem(marker)) { localStorage.setItem(key, value); localStorage.setItem(marker, '1'); } }, { key: `folio-testing-chat-draft:${current.id}`, marker: `folio-testing-chat-seeded:${current.id}`, value: JSON.stringify(stale) });
  await staticChat(page, conversation(current));
  await page.goto('/testing/chat/chat-browser-contract/flow');

  await expect(page.locator('.blocklyText').filter({ hasText: 'Angebot berechnen' })).toHaveCount(0);
  await expect(page.getByText(`Der Agent hat Revision ${current.revision} geliefert. Deine offenen Änderungen bleiben der aktuelle Arbeitsstand.`)).toBeVisible();
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).at(-1).blocks, `folio-testing-chat-draft-backup:${current.id}`)).toEqual([]);

  await page.getByRole('button', { name: 'Agentenstand übernehmen' }).click();
  await expect(page.locator('.blocklyText').filter({ hasText: 'Angebot berechnen' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Rückgängig', exact: true }).click();
  await expect(page.locator('.blocklyText').filter({ hasText: 'Angebot berechnen' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Wiederholen', exact: true }).click();
  await expect(page.locator('.blocklyText').filter({ hasText: 'Angebot berechnen' }).first()).toBeVisible();
  await page.reload();
  await expect(page.locator('.blocklyText').filter({ hasText: 'Angebot berechnen' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Rückgängig', exact: true })).toBeEnabled();
});

test('behält nach Speichern und Rückgängig die neue Revisionsbasis', async ({ page, request }) => {
  let current = await scenario(request);
  const initialRevision = current.revision;
  let snapshot = conversation(current);
  const expectedScenarioRevisions: number[] = [];
  await staticChat(page, snapshot);
  await page.route('**/api/testing/chat/conversations/chat-browser-contract/commands', async route => {
    const input = route.request().postDataJSON() as { command: string; payload: { scenario: TestingScenario; expectedRevision: number } };
    expect(input.command).toBe('save');
    expectedScenarioRevisions.push(input.payload.expectedRevision);
    current = { ...input.payload.scenario, revision: current.revision + 1, updatedAt: new Date().toISOString() };
    snapshot = { ...conversation(current), conversation: { ...snapshot.conversation, revision: snapshot.conversation.revision + 1, eventSequence: snapshot.conversation.eventSequence + 1, scenarioId: current.id }, scenarioState: { revision: current.revision, fingerprint: `saved-${current.revision}` } };
    await route.fulfill({ json: snapshot });
  });
  await page.goto('/testing/chat/chat-browser-contract/flow');
  await page.getByLabel('Baustein hinzufügen').selectOption({ label: 'Als Benutzerrolle' });
  await page.getByRole('button', { name: 'Hinzufügen', exact: true }).click();
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(page.getByText(`Gespeicherter Stand · Revision ${current.revision}`)).toBeVisible();
  await page.getByRole('button', { name: 'Rückgängig', exact: true }).click();
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  expect(expectedScenarioRevisions).toEqual([initialRevision, initialRevision + 1]);
});

test('zeigt belegte Agentendetails live, ordnet Ausführung kausal und führt zur Freigabe über den Ablauf', async ({ page, request }) => {
  mkdirSync('.local/verification/chat/details', { recursive: true });
  const seed = await scenario(request);
  const sourceRef = seed.knowledgeRefs[0];
  const source = { label: 'Direktionsregel für TierSchutz', kind: 'knowledge' as const, ref: sourceRef };
  const baseTask: TestingChatSnapshot['tasks'][number] = {
    id: 'job-business', purpose: 'Fachlichen Ablauf korrigieren', agent: { name: 'Sol', modelId: 'sol', provider: 'codex', color: '#7656a4' },
    status: 'running', activityState: 'working', stage: 'planning', startedAt: '2026-09-10T07:58:00.000Z', executionAt: '2026-09-10T08:03:00.000Z',
    publicDetails: [
      { id: 'reasoning', at: '2026-09-10T08:03:00.000Z', kind: 'progress', message: 'Die öffentliche Herleitung vergleicht die Versicherungssumme mit der belegten Bayern-Grenze.', detail: { type: 'reasoning', label: 'Fachliche Herleitung', data: { summary: 'In Bayern beginnt die Direktionsprüfung oberhalb von 11.000 Euro.', facts: ['Bundesland Bayern', 'Versicherungssumme 12.000 Euro'] } }, sources: [source] },
      { id: 'answer', at: '2026-09-10T08:03:20.000Z', kind: 'progress', message: 'Korrigierte Agentenantwort, noch nicht geprüft.', detail: { type: 'message', label: 'Antwort des Fachagenten', data: { title: 'Korrigierter Ablauf', summary: 'Antrag, Grenzprüfung und Statusprüfung sind vollständig.' } } },
      { id: 'validation', at: '2026-09-10T08:03:40.000Z', kind: 'error', message: 'Der erste Entwurf enthielt einen nicht aufgelösten Ergebnisverweis.', detail: { type: 'validation', label: 'Schema- und Compilerprüfung', data: { valid: false, attempt: 1, errors: ['expectedStatus verweist auf keinen erzeugten Wert.'], correction: 'Die Statusprüfung liest jetzt proposal.status.' } } },
    ],
  };
  const queuedTask: TestingChatSnapshot['tasks'][number] = { id: 'job-technical', purpose: 'Technische Bindung vorbereiten', agent: { name: 'Luna', modelId: 'luna', provider: 'codex', color: '#e56b25' }, status: 'not_started', activityState: 'not_started', stage: 'wiring', startedAt: '2026-09-10T07:57:00.000Z', publicDetails: [] };
  const initial = conversation(seed, {
    conversation: { id: 'chat-browser-contract', revision: 11, eventSequence: 11, createdAt: '2026-09-10T08:00:00.000Z', updatedAt: '2026-09-10T08:03:40.000Z', model: 'sol', activeJobId: baseTask.id, entryIds: ['request'] },
    timeline: [{ id: 'request', at: '2026-09-10T08:00:00.000Z', kind: 'user', message: 'Prüfe den Bayern-Grenzwert und korrigiere den Ablauf.' }],
    tasks: [queuedTask, baseTask], allowedCommands: ['message', 'cancel'],
  });
  const completedTask = { ...baseTask, status: 'completed' as const, activityState: 'done' as const, finishedAt: '2026-09-10T08:04:20.000Z', publicDetails: [...baseTask.publicDetails, { id: 'result', at: '2026-09-10T08:04:20.000Z', kind: 'result' as const, message: 'Der korrigierte Ablauf verwendet den erzeugten Status und ist strukturell gültig.', detail: { type: 'result' as const, label: 'Korrigierter Ablauf', data: { summary: 'Antrag, Grenzprüfung und Statusprüfung sind vollständig.', facts: [] } }, sources: [source] }] };
  const completed = { ...initial, conversation: { ...initial.conversation, revision: 12, eventSequence: 12, activeJobId: undefined }, tasks: [queuedTask, completedTask], allowedCommands: ['message', 'approve'] as TestingChatSnapshot['allowedCommands'] };
  const approvedEntry: TestingChatSnapshot['timeline'][number] = { id: 'approval', at: '2026-09-10T08:05:00.000Z', kind: 'user_action', message: 'Du hast Revision 4 fachlich freigegeben.', scenarioRevision: seed.revision };
  const approved = { ...completed, conversation: { ...completed.conversation, revision: 13, eventSequence: 13, entryIds: ['request', 'approval'] }, timeline: [...completed.timeline, approvedEntry], allowedCommands: ['message', 'prepare'] as TestingChatSnapshot['allowedCommands'] };
  let current = initial;
  let reads = 0;
  let streams = 0;
  await page.route('**/api/testing/chat/conversations/chat-browser-contract', route => { reads += 1; if (reads > 1 && current === initial) current = completed; return route.fulfill({ json: current }); });
  await page.route('**/api/testing/chat/conversations/chat-browser-contract/events', route => {
    streams += 1;
    const interim = { id: 'job-business:codex:message_1', at: '2026-09-10T08:03:50.000Z', kind: 'agent_summary' as const, jobId: 'job-business', message: 'Technischer Agentenplan, noch nicht geprüft', detail: { type: 'message' as const, label: 'Agentenausgabe' } };
    const body = streams === 2 ? `event: entry\ndata: ${JSON.stringify({ type: 'entry', sequence: 12, revision: 12, entry: interim })}\n\nevent: state\ndata: ${JSON.stringify({ type: 'state', sequence: 13, revision: 12 })}\n\n` : '';
    return route.fulfill({ contentType: 'text/event-stream', body });
  });
  await page.route('**/api/testing/chat/conversations/chat-browser-contract/commands', async route => {
    const input = route.request().postDataJSON() as { command: string };
    expect(input.command).toBe('approve'); current = approved; await route.fulfill({ json: approved });
  });
  await page.goto('/testing/chat/chat-browser-contract/chat');
  const feed = page.locator('.tc-feed');
  await expect(feed.locator('[data-entry-id="request"]')).toBeVisible();
  await expect(feed.locator('[data-task-id="job-business"]')).toBeVisible();
  await expect(page.locator('.tc-queue [data-task-id="job-technical"]')).toBeVisible();
  await expect(feed).not.toContainText('Technischer Agentenplan, noch nicht geprüft');
  expect(await feed.locator('[data-entry-id="request"], [data-task-id="job-business"]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-entry-id') ?? node.getAttribute('data-task-id')))).toEqual(['request', 'job-business']);
  await page.locator('[data-task-id="job-business"]').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Reasoning-Zusammenfassung', { exact: true })).toHaveCount(0);
  await expect(dialog.getByText('Agentenausgabe', { exact: true })).toHaveCount(0);
  await expect(dialog.getByText('Korrigierte Agentenantwort, noch nicht geprüft.', { exact: true })).toHaveCount(0);
  await expect(dialog.getByText('Antrag, Grenzprüfung und Statusprüfung sind vollständig.', { exact: true })).toHaveCount(1);
  await expect(dialog.getByText('Alle ursprünglichen Ereignisse anzeigen', { exact: true })).toBeVisible();
  await expect(dialog.getByText('KI-Prüfer', { exact: false })).toHaveCount(0);
  await expect(dialog.getByText('Der korrigierte Ablauf verwendet den erzeugten Status und ist strukturell gültig.', { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(dialog.getByText('Die Statusprüfung liest jetzt proposal.status.', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('link', { name: source.label, exact: true }).first()).toBeVisible();
  expect(await dialog.locator('.tc-detail-report').evaluateAll(cards => cards.every(card => card.querySelectorAll('details').length <= 1))).toBe(true);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: '.local/verification/chat/details/detail-live-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '.local/verification/chat/details/detail-live-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Aufgabendetails schließen' }).click();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole('button', { name: 'Ablauf prüfen', exact: true }).click();
  await expect(page).toHaveURL(/\/flow$/);
  await expect(page.getByRole('button', { name: 'Freigeben', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Freigeben', exact: true }).click();
  await page.getByRole('button', { name: 'Unterhaltung', exact: true }).click();
  await expect(page.getByText('Du hast Revision 4 fachlich freigegeben.', { exact: true })).toBeVisible();
  await expect(page.locator('.tc-entry.is-user-action')).toContainText('Du hast');
  await expect(page.getByRole('button', { name: 'Freigeben', exact: true })).toHaveCount(0);
  await page.screenshot({ path: '.local/verification/chat/details/causal-chat-approved.png', fullPage: true });
});

test('sendet nach einem Stream-Zustand die neueste Unterhaltungsrevision', async ({ page, request }) => {
  const seed = await scenario(request);
  const initial = conversation(seed, { conversation: { id: 'chat-browser-contract', revision: 10, eventSequence: 10, createdAt: '2026-09-10T08:00:00.000Z', updatedAt: '2026-09-10T08:10:00.000Z', model: 'luna', scenarioId: seed.id, entryIds: [] }, allowedCommands: ['message', 'prepare'] });
  let postedRevision = 0;
  await page.route('**/api/testing/chat/conversations/chat-browser-contract', route => route.fulfill({ json: initial }));
  await page.route('**/api/testing/chat/conversations/chat-browser-contract/events', route => route.fulfill({ contentType: 'text/event-stream', body: `event: snapshot\ndata: ${JSON.stringify({ type: 'snapshot', sequence: 10, revision: 10, snapshot: initial })}\n\nevent: state\ndata: ${JSON.stringify({ type: 'state', sequence: 11, revision: 11 })}\n\n` }));
  await page.route('**/api/testing/chat/conversations/chat-browser-contract/commands', async route => { const input = route.request().postDataJSON() as { expectedRevision: number }; postedRevision = input.expectedRevision; await route.fulfill({ json: { ...initial, conversation: { ...initial.conversation, revision: 12, eventSequence: 12 } } }); });
  await page.goto('/testing/chat/chat-browser-contract/chat');
  await page.getByRole('button', { name: 'Technisch vorbereiten', exact: true }).click();
  await expect.poll(() => postedRevision).toBe(11);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('Browser-Tab zeigt ein echtes Live-Bild vor Abschluss und danach die gespeicherten Nachweise', async ({ page, request }) => {
  const seed = await scenario(request);
  const candidate = { ...seed, id: `chat-live-${randomUUID()}`, title: `${seed.title} · Chat-Liveprüfung`, source: 'human' as const };
  let response = await request.put(`/api/testing/scenarios/${candidate.id}`, { data: { ...candidate, expectedRevision: 0 } });
  expect(response.ok(), await response.text()).toBeTruthy(); const saved = await response.json() as TestingScenario;
  await page.goto('/testing/chat');
  await page.getByRole('button', { name: new RegExp(saved.title) }).click();
  await page.getByRole('button', { name: 'Ablauf', exact: true }).click();
  await page.getByRole('button', { name: 'Freigeben', exact: true }).click();
  await page.getByRole('button', { name: 'Unterhaltung', exact: true }).click();
  await page.getByRole('button', { name: 'Technisch vorbereiten', exact: true }).click();
  await expect(page.locator('.tc-feed')).not.toContainText('Ich prüfe den geforderten Ablauf gegen die vorhandenen Bausteine und fachlichen Quellen.');
  await expect(page.locator('.tc-feed')).not.toContainText('Technischer Agentenplan, noch nicht geprüft');
  await expect(page.locator('.tc-feed')).not.toContainText('Agentenantwort, noch nicht geprüft');
  const liveConversationId = decodeURIComponent(new URL(page.url()).pathname.split('/')[3]);
  let liveTaskId = '';
  await expect.poll(async () => {
    const response = await request.get(`/api/testing/chat/conversations/${liveConversationId}`);
    const current = await response.json() as TestingChatSnapshot;
    liveTaskId = current.tasks.find(task => task.purpose === 'Technisch vorbereiten' && task.status === 'running' && task.activityState === 'working' && task.publicDetails.some(item => item.message === 'Ich prüfe den geforderten Ablauf gegen die vorhandenen Bausteine und fachlichen Quellen.'))?.id ?? '';
    return liveTaskId;
  }, { timeout: 15_000 }).not.toBe('');
  await expect(page.locator(`[data-task-id="${liveTaskId}"]`)).toHaveAttribute('data-status', 'running');
  await page.locator(`[data-task-id="${liveTaskId}"]`).click();
  await expect(page.getByRole('dialog').getByText('Ich prüfe den geforderten Ablauf gegen die vorhandenen Bausteine und fachlichen Quellen.', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog').getByText('Reasoning-Zusammenfassung', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('dialog').getByText('Der Ablauf verbindet die fachliche Anforderung mit den vorhandenen Bausteinen; offene Annahmen bleiben im Ergebnis sichtbar.', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('dialog').getByText('Agentenausgabe', { exact: true })).toHaveCount(0);
  await expect(page.locator('.tc-feed')).not.toContainText('Der Ablauf verbindet die fachliche Anforderung mit den vorhandenen Bausteinen; offene Annahmen bleiben im Ergebnis sichtbar.');
  expect(await page.getByRole('dialog').locator('.tc-detail-report').evaluateAll(cards => cards.every(card => card.querySelectorAll('details').length <= 1))).toBe(true);
  await page.screenshot({ path: '.local/verification/chat/details/provider-real-sse.png', fullPage: true });
  await page.getByRole('button', { name: 'Aufgabendetails schließen' }).click();
  await page.getByRole('button', { name: 'Browser', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Test starten', exact: true })).toBeEnabled({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Test starten', exact: true }).click();
  await expect(page.getByRole('img', { name: /Live-Browser:/ })).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => Number(new URL((await page.getByRole('img', { name: /Live-Browser:/ }).getAttribute('src')) ?? '', page.url()).searchParams.get('v'))).toBeGreaterThan(1);
  await page.screenshot({ path: '.local/verification/chat/browser-live.png', fullPage: true });
  const liveSource = await page.getByRole('img', { name: /Live-Browser:/ }).getAttribute('src');
  expect(liveSource).toMatch(/\/api\/testing\/observations\/testlauf-[^/]+\/frame\?v=\d+/);
  await expect(page.getByRole('heading', { name: 'Test bestanden', exact: true })).toBeVisible({ timeout: 70_000 });
  await expect(page.getByRole('img', { name: /Nachweis:/ }).first()).toBeVisible();
  await page.screenshot({ path: '.local/verification/chat/browser-proofs.png', fullPage: true });
  const snapshotResponse = await request.get(`/api/testing/chat/conversations/${decodeURIComponent(new URL(page.url()).pathname.split('/')[3])}`);
  const snapshot = await snapshotResponse.json() as TestingChatSnapshot; const completed = snapshot.latestRun as TestingRun;
  expect(completed.status, completed.error).toBe('passed'); expect(completed.steps.every(step => !!step.screenshot)).toBe(true);
  expect((await request.get(`/api/testing/observations/${completed.id}/frame`)).status()).toBe(404);
});

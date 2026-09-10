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
      : `event: entry\ndata: ${JSON.stringify({ type: 'entry', sequence: 6, revision: 7, entry: routedEntry })}\n\n`;
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
      current = { ...current, conversation: { ...current.conversation, revision: current.conversation.revision + 1 }, questions, tasks: current.tasks.map(task => task.id === 'job-plan' && allAnswered ? { ...task, activityState: 'working' as const, publicDetails: [...task.publicDetails, { id: 'plan-resumed', at: '2026-09-10T08:04:00.000Z', kind: 'progress' as const, message: 'Die Antworten sind übernommen. Der Ablaufentwurf wird fertiggestellt.' }] } : task) };
      await route.fulfill({ json: current });
      return;
    }
    expect(input.command).toBe('message');
    expect(input.payload?.message).toBe('Prüfe zusätzlich den Ablehnungsgrund.');
    const message = input.payload?.message ?? '';
    current = { ...current, conversation: { ...current.conversation, revision: 9 }, timeline: [...current.timeline, { id: 'steering-new', at: '2026-09-10T08:03:00.000Z', kind: 'user', message, delivery: { state: 'routing', targetLabel: 'Planungsauftrag' } }] };
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
  await composer.fill('Prüfe zusätzlich den Ablehnungsgrund.');
  await page.getByRole('button', { name: 'Separate Nachricht senden', exact: true }).click();
  expect(commands[2]?.command).toBe('message');
  await expect(page.getByText('Prüfe zusätzlich den Ablehnungsgrund.')).toBeVisible();
  await page.getByRole('button', { name: 'Ablauf', exact: true }).click();
  await expect(page.getByText('VORLÄUFIGE VORSCHAU')).toBeVisible();
  await expect(page.getByText('Antrag und Freigabe werden fachlich geprüft.')).toBeVisible();
  await expect(page.getByLabel('Baustein hinzufügen')).toBeDisabled();
  await expect(page.locator('.blocklyText').filter({ hasText: 'Neue Direktionsfreigabe prüfen' })).toBeVisible();
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
  await page.getByRole('button', { name: 'Revision speichern', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Synthetischer Revisionskonflikt');
  await page.getByRole('button', { name: 'Unterhaltung', exact: true }).click();
  await page.getByRole('button', { name: 'Ablauf', exact: true }).click();
  await expect.poll(() => page.evaluate(storageKey => JSON.parse(localStorage.getItem(storageKey)!).blocks.length, key)).toBe(existing.blocks.length + 2);
  await page.screenshot({ path: '.local/verification/chat/flow.png', fullPage: true });
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

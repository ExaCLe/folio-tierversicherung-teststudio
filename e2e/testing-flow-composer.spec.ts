import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import type { TestingScenario } from '../shared/testing';
import type { TestingChatSnapshot } from '../shared/testing-chat';

const id = 'chat-flow-composer-contract';

async function scenario(request: APIRequestContext) {
  const response = await request.get('/api/testing/scenarios/kuh-direktionsanfrage');
  expect(response.ok()).toBeTruthy();
  return response.json() as Promise<TestingScenario>;
}

function snapshot(scenario?: TestingScenario, tasks: TestingChatSnapshot['tasks'] = []): TestingChatSnapshot {
  return {
    conversation: { id, revision: 1, eventSequence: 1, createdAt: '2026-09-10T08:00:00.000Z', updatedAt: '2026-09-10T08:00:00.000Z', model: 'luna', ...(scenario ? { scenarioId: scenario.id } : {}), entryIds: [] },
    timeline: [], tasks, questions: [], scenario, allowedCommands: scenario ? ['message', 'revise', 'save'] : ['explore', 'message'],
    confirmedFlow: scenario ? { scenarioRevision: scenario.revision, blocks: scenario.blocks } : null,
    ...(scenario ? { scenarioState: { revision: scenario.revision, fingerprint: 'flow-composer-contract' } } : {}),
  };
}

async function mockChat(page: Page, current: TestingChatSnapshot) {
  await page.route(`**/api/testing/chat/conversations/${id}`, route => route.fulfill({ json: current }));
  await page.route(`**/api/testing/chat/conversations/${id}/events`, route => route.fulfill({ contentType: 'text/event-stream', body: `event: snapshot\ndata: ${JSON.stringify({ type: 'snapshot', sequence: current.conversation.eventSequence, revision: current.conversation.revision, snapshot: current })}\n\n` }));
}

test('zeigt Cache-Metrik getrennt, inklusive Null, und lässt unbekannte Werte weg', async ({ page }) => {
  const current = snapshot(undefined, [
    { id: 'cache-zero', purpose: 'Cache mit Null', agent: { name: 'Sol', modelId: 'sol', provider: 'codex', color: '#635bff' }, status: 'completed', activityState: 'done', startedAt: '2026-09-10T08:00:00.000Z', metrics: { elapsedMs: 1000, requestCount: 1, inputTokens: 40, cachedInputTokens: 0, outputTokens: 2, totalTokens: 42 }, publicDetails: [] },
    { id: 'cache-unknown', purpose: 'Cache unbekannt', agent: { name: 'Luna', modelId: 'luna', provider: 'claude', color: '#e56b25' }, status: 'completed', activityState: 'done', startedAt: '2026-09-10T08:00:00.000Z', metrics: { elapsedMs: 1000, requestCount: 1, inputTokens: 40, outputTokens: 2, totalTokens: 42 }, publicDetails: [] },
  ]);
  await mockChat(page, current);
  await page.goto(`/testing/chat/${id}/chat`);
  await expect(page.getByRole('button', { name: /Cache mit Null/ })).toContainText('Eingabe 40');
  await expect(page.getByRole('button', { name: /Cache mit Null/ })).toContainText('Cache 0');
  await expect(page.getByRole('button', { name: /Cache mit Null/ })).toContainText('API-Anfragen unbekannt');
  await expect(page.getByRole('button', { name: /Cache mit Null/ })).not.toContainText('1 API-Anfragen');
  await expect(page.getByRole('button', { name: /Cache unbekannt/ }).locator('.tc-task-metrics')).not.toContainText('Cache');
});

test('zentriert den erweiterten Composer, wächst mit Text und sendet auf schmalem Viewport', async ({ page, request }) => {
  const seed = await scenario(request);
  const latest = 'Eine sehr lange letzte Agentenantwort mit vielen Details, die im erweiterten Composer umbrechen muss, ohne rechts aus dem Inhaltsbereich zu laufen.';
  const current = snapshot(seed, [{ id: 'latest', purpose: 'Letzte Antwort', agent: { name: 'Sol', modelId: 'sol', provider: 'codex', color: '#635bff' }, status: 'completed', activityState: 'done', startedAt: '2026-09-10T08:00:00.000Z', publicDetails: [{ id: 'latest-result', at: '2026-09-10T08:01:00.000Z', kind: 'result', message: latest, detail: { type: 'result', label: 'Ergebnis' } }] }]);
  await mockChat(page, current);
  await page.route(`**/api/testing/chat/conversations/${id}/commands`, async route => {
    expect(route.request().postDataJSON()).toMatchObject({ command: 'revise' });
    await route.fulfill({ json: { ...current, conversation: { ...current.conversation, revision: 2, eventSequence: 2 } } });
  });
  await page.setViewportSize({ width: 1200, height: 700 });
  await page.goto(`/testing/chat/${id}/flow`);
  const composer = page.locator('.tc-flow-composer');
  const textarea = page.getByRole('textbox', { name: 'Nachricht zum Ablauf', exact: true });
  await textarea.fill('Kurz');
  await expect(composer).toHaveClass(/is-expanded/);
  const short = await textarea.evaluate(element => ({ height: element.getBoundingClientRect().height, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }));
  const bounds = await composer.evaluate(element => { const rect = element.getBoundingClientRect(); const parent = element.closest('.tc-flow-pane')!.getBoundingClientRect(); return { left: rect.left, right: rect.right, center: rect.left + rect.width / 2, parentCenter: parent.left + parent.width / 2 }; });
  expect(Math.abs(bounds.center - bounds.parentCenter)).toBeLessThan(2);
  expect(short.scrollWidth).toBeLessThanOrEqual(short.clientWidth);
  await textarea.fill('Eine längere Änderung mit mehreren Zeilen, die den Composer wachsen lässt und die maximale Höhe prüft.\nNoch eine zweite Zeile.\nNoch eine dritte Zeile.');
  const long = await textarea.evaluate(element => ({ height: element.getBoundingClientRect().height, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }));
  expect(long.height).toBeGreaterThan(short.height);
  expect(long.height).toBeLessThanOrEqual(162);
  expect(long.scrollWidth).toBeLessThanOrEqual(long.clientWidth);
  const context = page.locator('.tc-flow-context span');
  await expect(context).toContainText(latest);
  expect(await context.evaluate(element => element.scrollWidth)).toBeLessThanOrEqual(await context.evaluate(element => element.clientWidth));
  await page.setViewportSize({ width: 390, height: 520 });
  const mobile = await composer.evaluate(element => { const rect = element.getBoundingClientRect(); return { left: rect.left, right: rect.right }; });
  expect(mobile.left).toBeGreaterThanOrEqual(0);
  expect(mobile.right).toBeLessThanOrEqual(390);
  await expect(page.getByLabel('Modell')).toBeVisible();
  const send = page.getByRole('button', { name: 'Nachricht zum Ablauf senden' });
  await expect(send).toBeVisible();
  await Promise.all([page.waitForRequest(`**/api/testing/chat/conversations/${id}/commands`), send.click()]);
});

test('letzte Matrixzeile bleibt oberhalb des kompakten und geöffneten Eingabefensters erreichbar', async ({ page, request }) => {
  await mockChat(page, snapshot(await scenario(request)));
  await page.setViewportSize({ width: 681, height: 930 });
  await page.goto(`/testing/chat/${id}/flow`);
  const pane = page.locator('.tc-flow-pane');
  const clearBottom = async () => {
    await pane.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect.poll(async () => page.locator('.tc-matrix').evaluate(element => {
      const composer = document.querySelector('.tc-flow-composer')!;
      return element.getBoundingClientRect().bottom <= composer.getBoundingClientRect().top - 8;
    })).toBe(true);
  };
  await expect(page.locator('.blocklySvg').first()).toBeVisible();
  await clearBottom();
  await page.getByRole('textbox', { name: 'Nachricht zum Ablauf' }).fill('Ändere den Ablauf.\nPrüfe die erste Rolle.\nPrüfe die zweite Rolle.\nPrüfe die Direktion.');
  await expect(page.locator('.tc-flow-composer')).toHaveClass(/is-expanded/);
  await clearBottom();
});

test('zeigt laufende Arbeit kompakt über den Blöcken mit Laufzeit, Schritt und Link zur Unterhaltung', async ({ page, request }) => {
  const startedAt = new Date(Date.now() - 12_000).toISOString();
  const task: TestingChatSnapshot['tasks'][number] = { id: 'working', purpose: 'Fachlichen Ablauf planen', agent: { name: 'Luna', modelId: 'luna', provider: 'codex', color: '#635bff' }, status: 'running', activityState: 'working', stage: 'planning', startedAt, executionAt: startedAt, publicDetails: [] };
  const current = snapshot(await scenario(request), [task]);
  current.activeJob = { id: task.id, phase: 'business', status: 'running', stage: 'planning', startedAt };
  current.conversation.activeJobId = task.id;
  await mockChat(page, current);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(`/testing/chat/${id}/flow`);
  const indicator = page.locator('.tc-flow-activity');
  await expect(indicator).toContainText('Luna · Ablaufplanung');
  await expect(indicator.locator('time')).toContainText(/\d+ s/);
  await expect(page.locator('.tc-agent-activity')).toHaveCount(0);
  const initial = await indicator.locator('svg').first().evaluate(element => getComputedStyle(element).transform);
  await expect.poll(() => indicator.locator('svg').first().evaluate(element => getComputedStyle(element).transform)).not.toBe(initial);
  expect(await indicator.evaluate(element => element.getBoundingClientRect().height)).toBeLessThan(40);
  await indicator.click();
  await expect(page).toHaveURL(new RegExp(`/testing/chat/${id}/chat$`));
  await expect(page.getByRole('button', { name: /Fachlichen Ablauf planen, In Arbeit/ })).toBeVisible();
});

test('behält die technische Blockierung an ihrem Zeitpunkt und erlaubt Vorbereitung nach freigegebener Korrektur', async ({ page, request }) => {
  const current = snapshot(await scenario(request), [
    { id: 'old-technical', purpose: 'Technisch vorbereiten', agent: { name: 'Luna', modelId: 'luna', color: '#e56b25' }, status: 'blocked', activityState: 'attention', startedAt: '2026-09-10T08:00:00.000Z', executionAt: '2026-09-10T08:00:01.000Z', finishedAt: '2026-09-10T08:01:00.000Z', publicDetails: [{ id: 'old-problem', at: '2026-09-10T08:01:00.000Z', kind: 'result', message: 'Das sichtbare Formular muss auf deaktiviert geprüft werden.', detail: { type: 'result', label: 'Ergebnis', data: { technicalStatus: 'blocked', nextAction: { kind: 'revise-business', instruction: 'Prüfe deaktiviert statt unsichtbar.' } } } }] },
    { id: 'business-rework', purpose: 'Fachlichen Ablauf planen', agent: { name: 'Luna', modelId: 'luna', color: '#635bff' }, status: 'completed', activityState: 'done', startedAt: '2026-09-10T08:03:00.000Z', executionAt: '2026-09-10T08:03:00.000Z', publicDetails: [] },
  ]);
  current.allowedCommands.push('prepare');
  current.timeline = [
    { id: 'problem', kind: 'agent_summary', at: '2026-09-10T08:01:00.000Z', jobId: 'old-technical', message: 'Das sichtbare Formular muss auf deaktiviert geprüft werden.' },
    { id: 'revision-request', kind: 'user', at: '2026-09-10T08:02:00.000Z', message: 'Bitte prüfe deaktiviert statt unsichtbar.' },
    { id: 'approved', kind: 'user_action', at: '2026-09-10T08:04:00.000Z', message: 'Du hast die korrigierte Fassung freigegeben.' },
  ];
  await mockChat(page, current);
  await page.goto(`/testing/chat/${id}/chat`);
  await expect(page.getByRole('button', { name: 'Technisch vorbereiten', exact: true })).toBeEnabled();
  await expect(page.locator('.tc-queue')).toHaveCount(0);
  await expect(page.locator('.tc-technical-blocked')).toHaveCount(0);
  await expect(page.locator('[data-task-id=old-technical]')).toContainText('Fachliche Korrektur angefordert');
  const contents = await page.locator('.tc-feed').innerText();
  expect(contents.indexOf('Technisch vorbereiten')).toBeLessThan(contents.indexOf('Das sichtbare Formular'));
  expect(contents.indexOf('Das sichtbare Formular')).toBeLessThan(contents.indexOf('Bitte prüfe deaktiviert'));
  expect(contents.indexOf('Bitte prüfe deaktiviert')).toBeLessThan(contents.indexOf('Fachlichen Ablauf planen'));
});

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

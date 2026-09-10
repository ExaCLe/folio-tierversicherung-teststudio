import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import type { TestingRun } from '../shared/testing';
import type { TestingScenario } from '../shared/testing';
import type { TestingChatSnapshot } from '../shared/testing-chat';

const conversation = (scenario?: TestingScenario, patch: Partial<TestingChatSnapshot> = {}): TestingChatSnapshot => ({
  conversation: { id: 'chat-browser-contract', revision: 3, eventSequence: 2, createdAt: '2026-09-10T08:00:00.000Z', updatedAt: '2026-09-10T08:00:00.000Z', model: 'luna', ...(scenario ? { scenarioId: scenario.id } : {}), entryIds: [] },
  timeline: [], scenario, allowedCommands: scenario ? ['message', 'revise', 'save'] : ['explore', 'message'],
  confirmedFlow: scenario ? { scenarioRevision: scenario.revision, blocks: scenario.blocks } : null,
  ...(scenario ? { scenarioState: { revision: scenario.revision, fingerprint: 'browser-contract' } } : {}), ...patch,
});

async function scenario(request: APIRequestContext) {
  const response = await request.get('/api/testing/scenarios/kuh-direktionsanfrage');
  expect(response.ok()).toBeTruthy(); return response.json() as Promise<TestingScenario>;
}

async function staticChat(page: Page, snapshot: TestingChatSnapshot) {
  await page.route('**/api/testing/chat/conversations/chat-browser-contract', route => route.fulfill({ json: snapshot }));
  await page.route('**/api/testing/chat/conversations/chat-browser-contract/events', route => route.fulfill({ contentType: 'text/event-stream', body: `event: snapshot\ndata: ${JSON.stringify({ type: 'snapshot', sequence: 2, revision: snapshot.conversation.revision, snapshot })}\n\n` }));
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

import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import type { TestingCatalog, TestingScenario } from '../shared/testing';
import type { TestingChatSnapshot } from '../shared/testing-chat';

async function seed(request: APIRequestContext) {
  const [scenarioResponse, catalogResponse] = await Promise.all([
    request.get('/api/testing/scenarios/kuh-direktionsanfrage'),
    request.get('/api/testing/catalog'),
  ]);
  expect(scenarioResponse.ok()).toBeTruthy();
  expect(catalogResponse.ok()).toBeTruthy();
  return { scenario: await scenarioResponse.json() as TestingScenario, catalog: await catalogResponse.json() as TestingCatalog };
}

async function staticConversation(page: Page, snapshot: TestingChatSnapshot) {
  await page.route('**/api/testing/chat/conversations/chat-scratch-cold', route => route.fulfill({ json: snapshot }));
  await page.route('**/api/testing/chat/conversations/chat-scratch-cold/events', route => route.fulfill({
    contentType: 'text/event-stream',
    body: `event: snapshot\ndata: ${JSON.stringify({ type: 'snapshot', sequence: snapshot.conversation.eventSequence, revision: snapshot.conversation.revision, snapshot })}\n\n`,
  }));
}

test('lädt Scratch kalt und nach Navigation erneut mit Rollen- und wiederverwendbarem Block', async ({ page, request }) => {
  const { scenario, catalog } = await seed(request);
  const role = catalog.definitions.find(definition => definition.name === 'Als Benutzerrolle');
  const reusable = catalog.definitions.find(definition => definition.kind === 'workflow');
  expect(role).toBeTruthy(); expect(reusable).toBeTruthy();
  const defaults = (definition: NonNullable<typeof role>) => Object.fromEntries(definition.inputs.flatMap(input => input.default === undefined ? [] : [[input.key, input.default]]));
  const customScenario: TestingScenario = {
    ...scenario, id: 'scratch-cold-scenario', title: 'Kalter Scratch-Start',
    blocks: [
      { id: 'cold-role', definition: { id: role!.id, version: role!.version }, label: role!.name, inputs: defaults(role!) },
      { id: 'cold-reusable', definition: { id: reusable!.id, version: reusable!.version }, label: reusable!.name, inputs: defaults(reusable!) },
    ],
  };
  const snapshot: TestingChatSnapshot = {
    conversation: { id: 'chat-scratch-cold', revision: 1, eventSequence: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), model: 'luna', scenarioId: customScenario.id, entryIds: [] },
    timeline: [], tasks: [], questions: [], scenario: customScenario,
    scenarioState: { revision: customScenario.revision, fingerprint: 'scratch-cold' },
    confirmedFlow: { scenarioRevision: customScenario.revision, blocks: customScenario.blocks }, allowedCommands: ['message', 'revise', 'save'],
  };
  await staticConversation(page, snapshot);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));

  await page.goto('/testing/chat/chat-scratch-cold/flow');
  await expect(page.locator('.blocklyText').filter({ hasText: role!.name })).toBeVisible();
  await expect(page.locator('.blocklyText').filter({ hasText: reusable!.name })).toBeVisible();
  await page.getByRole('button', { name: 'Unterhaltung', exact: true }).click();
  await expect(page.locator('.t-scratch-workspace')).toHaveCount(0);
  await page.getByRole('button', { name: 'Ablauf', exact: true }).click();
  await expect(page.locator('.t-scratch-workspace .blocklySvg')).toHaveCount(1);
  await expect(page.locator('.blocklyText').filter({ hasText: role!.name })).toBeVisible();
  await expect(page.locator('.blocklyText').filter({ hasText: reusable!.name })).toBeVisible();
  expect(errors).toEqual([]);
});

test('zeigt einen Live-Vorschlag mit seinem noch nicht veröffentlichten Ablaufbaustein', async ({ page, request }) => {
  const { scenario, catalog } = await seed(request);
  const added = catalog.definitions.find(definition => definition.name === 'Als Benutzerrolle');
  expect(added).toBeTruthy();
  const customScenario: TestingScenario = {
    ...scenario,
    id: 'live-catalog-scenario',
    blocks: [{ id: 'live-added-block', definition: { id: added!.id, version: added!.version }, label: added!.name, inputs: {} }],
  };
  const persisted = { ...scenario, blocks: [] };
  const snapshot: TestingChatSnapshot = {
    conversation: { id: 'chat-scratch-cold', revision: 2, eventSequence: 2, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), model: 'luna', scenarioId: customScenario.id, entryIds: [] },
    timeline: [], tasks: [], questions: [], scenario: persisted,
    scenarioState: { revision: persisted.revision, fingerprint: 'live-catalog' },
    confirmedFlow: { scenarioRevision: persisted.revision, blocks: persisted.blocks }, allowedCommands: ['revise', 'message'],
  };
  const proposal: TestingChatSnapshot = { ...snapshot, conversation: { ...snapshot.conversation, revision: 3, eventSequence: 3 }, proposed: { jobId: 'live-proposal', fingerprint: 'live-catalog', expectedRevision: persisted.revision, scenario: customScenario, changes: [], newDefinitions: [added!], newKnowledge: [] }, allowedCommands: ['apply', 'reject', 'revise', 'message'] };
  await staticConversation(page, snapshot);
  let catalogRequests = 0;
  await page.route('**/api/testing/catalog', async route => {
    catalogRequests += 1;
    await route.fulfill({ json: { ...catalog, definitions: catalog.definitions.filter(definition => definition !== added) } });
  });
  await page.route('**/api/testing/chat/conversations/chat-scratch-cold/commands', route => route.fulfill({ json: proposal }));
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));

  await page.goto('/testing/chat/chat-scratch-cold/flow');
  await expect(page.locator('.t-scratch-workspace .blocklySvg')).toHaveCount(1);
  await page.getByRole('textbox', { name: 'Nachricht zum Ablauf' }).fill('Ergänze die neue fachliche Prüfung.');
  await page.getByRole('button', { name: 'Nachricht zum Ablauf senden' }).click();
  await expect(page.locator('.blocklyText').filter({ hasText: added!.name })).toBeVisible();
  expect(catalogRequests).toBeGreaterThan(0);
  expect(errors).toEqual([]);
  await expect(page.getByText('Die Anwendung konnte nicht geöffnet werden.')).toHaveCount(0);
});

test('lädt den Katalog einmal nach, wenn ein persistierter Ablauf einen neuen Baustein enthält', async ({ page, request }) => {
  const { scenario, catalog } = await seed(request);
  const added = catalog.definitions.find(definition => definition.name === 'Als Benutzerrolle')!;
  const current = { ...scenario, id: 'persisted-catalog-scenario', blocks: [{ id: 'persisted-new-block', definition: { id: added.id, version: added.version }, inputs: {} }] };
  const snapshot: TestingChatSnapshot = {
    conversation: { id: 'chat-scratch-cold', revision: 2, eventSequence: 2, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), model: 'luna', scenarioId: current.id, entryIds: [] },
    timeline: [], tasks: [], questions: [], scenario: current,
    scenarioState: { revision: current.revision, fingerprint: 'persisted-catalog' }, confirmedFlow: { scenarioRevision: current.revision, blocks: current.blocks }, allowedCommands: ['revise', 'message'],
  };
  await staticConversation(page, snapshot);
  let requests = 0;
  await page.route('**/api/testing/catalog', route => { requests += 1; return route.fulfill({ json: requests === 1 ? { ...catalog, definitions: catalog.definitions.filter(definition => definition !== added) } : catalog }); });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));

  await page.goto('/testing/chat/chat-scratch-cold/flow');
  await expect(page.locator('.blocklyText').filter({ hasText: added.name })).toBeVisible();
  expect(requests).toBe(2); expect(errors).toEqual([]);
});

test('wiederholt einen weiterhin unvollständigen Katalog erst nach Benutzeraktion', async ({ page, request }) => {
  const { scenario, catalog } = await seed(request);
  const added = catalog.definitions.find(definition => definition.name === 'Als Benutzerrolle')!;
  const current = { ...scenario, id: 'missing-catalog-scenario', blocks: [{ id: 'missing-block', definition: { id: added.id, version: added.version }, inputs: {} }] };
  const snapshot: TestingChatSnapshot = {
    conversation: { id: 'chat-scratch-cold', revision: 2, eventSequence: 2, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), model: 'luna', scenarioId: current.id, entryIds: [] },
    timeline: [], tasks: [], questions: [], scenario: current,
    scenarioState: { revision: current.revision, fingerprint: 'missing-catalog' }, confirmedFlow: { scenarioRevision: current.revision, blocks: current.blocks }, allowedCommands: ['revise', 'message'],
  };
  await staticConversation(page, snapshot);
  let requests = 0;
  let successfulRequests = 0;
  const stale = { ...catalog, definitions: catalog.definitions.filter(definition => definition !== added) };
  await page.route('**/api/testing/catalog', route => { requests += 1; return route.fulfill({ json: stale }); });
  page.on('response', response => { if (response.url().endsWith('/api/testing/catalog') && response.status() === 200) successfulRequests += 1; });

  await page.goto('/testing/chat/chat-scratch-cold/flow');
  const retry = page.getByRole('button', { name: 'Erneut laden' });
  await expect(retry).toBeVisible();
  expect(successfulRequests).toBe(2);
  expect(requests - successfulRequests).toBeLessThanOrEqual(1);
  const beforeRetry = requests;
  const successfulBeforeRetry = successfulRequests;
  await page.waitForTimeout(250);
  expect(requests).toBe(beforeRetry);
  expect(successfulRequests).toBe(successfulBeforeRetry);
  await retry.click();
  await expect.poll(() => successfulRequests).toBe(successfulBeforeRetry + 1);
  expect(requests).toBe(beforeRetry + 1);
  await expect(retry).toBeVisible();
});

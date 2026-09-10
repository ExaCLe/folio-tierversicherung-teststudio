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

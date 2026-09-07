import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import type { TestingAgentJob, TestingScenario } from '../shared/testing';

const browserErrors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => { const errors: string[] = []; browserErrors.set(page, errors); page.on('pageerror', error => errors.push(error.message)); });
test.afterEach(({ page }) => { expect(browserErrors.get(page), 'Keine JavaScript-Fehler im Browser').toEqual([]); });

async function fixture(request: APIRequestContext) {
  const source = await (await request.get('/api/testing/scenarios/kuh-direktionsanfrage')).json();
  const response = await request.put(`/api/testing/scenarios/ueberarbeitung-${randomUUID()}`, { data: { ...source, title: 'Überarbeitung prüfen', expectedRevision: 0 } });
  expect(response.ok()).toBeTruthy(); return response.json() as Promise<TestingScenario>;
}
// These UI fixtures simulate a completed agent response. They never invoke a model.
async function proposalRoutes(page: Page, request: APIRequestContext, scenario: TestingScenario, hold = false, withNewDefinition = false) {
  let released = !hold;
  let job: TestingAgentJob | undefined;
  let applyCount = 0; let requestedModel: string | undefined;
  await page.route('**/api/testing/bootstrap', async route => { const response = await route.fetch(); const data = await response.json(); await route.fulfill({ json: { ...data, jobs: job ? [job, ...data.jobs] : data.jobs } }); });
  await page.route(`**/api/testing/scenarios/${scenario.id}/interpret-revision`, async route => {
    const body = route.request().postDataJSON(); requestedModel = body.model;
    const saved = await (await request.get(`/api/testing/scenarios/${scenario.id}`)).json();
    expect(body.revision).toBe(saved.revision);
    const compiled = await (await request.get(`/api/testing/scenarios/${scenario.id}/compile`)).json();
    const next = structuredClone(saved);
    next.blocks.push({ id: 'zusatzpruefung', definition: { id: 'pruefung.vorschlagsstatus', version: '1.0.0' }, inputs: { proposalId: { ref: 'vorschlag' }, expectedStatus: 'Direktionsprüfung' } });
    let draft: any;
    if (withNewDefinition) {
      const catalog = await (await request.get('/api/testing/catalog')).json();
      const definition = { ...catalog.definitions.find((item: any) => item.id === 'pruefung.vorschlagsstatus'), id: `pruefung.neu.${randomUUID()}`, name: 'Direktionsstatus nochmals prüfen', description: 'Eine neue fachliche Kontrollfähigkeit für die Vorschau.', origin: 'agent' };
      const knowledge = { ...catalog.knowledge.find((item: any) => item.id === 'regel.direktionsanfrage'), id: `wissen.neu.${randomUUID()}`, revision: 1, title: 'Neue Kontrollregel', summary: 'Der Direktionsstatus wird nach der Einreichung erneut geprüft.', content: 'Die erneute Kontrolle erwartet die Direktionsprüfung.', definitionRefs: [{ id: definition.id, version: definition.version }] };
      definition.knowledgeRefs = [knowledge.id]; next.blocks.at(-1).definition = { id: definition.id, version: definition.version };
      draft = { explanation: 'Die zusätzliche Kontrolle wird als neue Fähigkeit vorgeschlagen.', newDefinitions: [definition], newKnowledge: [knowledge], assumptions: ['Die Kontrolle ergänzt den bestehenden Ablauf.'], openQuestions: [] };
    }
    job = { id: `ui-proposal-${randomUUID()}`, phase: 'business', status: 'completed', model: body.model, prompt: body.text, scenarioId: saved.id, scenarioRevision: saved.revision, fingerprint: compiled.fingerprint, startedAt: new Date().toISOString(), events: [], result: { scope: 'scenario', reviewStatus: 'pending', draft, before: saved, scenario: next, applied: false } };
    await route.fulfill({ status: 202, json: { ...job, status: 'running', result: { scope: 'scenario', applied: false } } });
  });
  await page.route('**/api/testing/jobs/ui-proposal-**', async route => {
    if (route.request().url().endsWith('/apply-revision')) {
      applyCount++;
      for (const document of (job!.result as any).draft?.newKnowledge ?? []) expect((await request.post('/api/testing/knowledge', { data: { document } })).ok()).toBeTruthy();
      for (const definition of (job!.result as any).draft?.newDefinitions ?? []) expect((await request.post('/api/testing/definitions', { data: { definition } })).ok()).toBeTruthy();
      const response = await request.put(`/api/testing/scenarios/${scenario.id}`, { data: { ...(job!.result as any).scenario, expectedRevision: job!.scenarioRevision } });
      expect(response.ok()).toBeTruthy(); const saved = await response.json();
      const compiled = await (await request.get(`/api/testing/scenarios/${scenario.id}/compile`)).json();
      job!.result = { ...(job!.result as object), applied: true };
      await route.fulfill({ json: { scenario: saved, compiled, requiresApproval: true } });
    } else if (route.request().url().endsWith('/dismiss-revision')) { job!.result = { ...(job!.result as object), reviewStatus: 'dismissed' }; await route.fulfill({ json: job }); } else await route.fulfill({ json: released ? job : { ...job, status: 'running', result: { scope: 'scenario', applied: false } } });
  });
  return { applyCount: () => applyCount, requestedModel: () => requestedModel, release: () => { released = true; } };
}

test('Globale Anweisung speichert lokale Arbeit, zeigt Strukturänderungen und übernimmt eine neue Revision', async ({ page, request }, testInfo) => {
  const scenario = await fixture(request); const routes = await proposalRoutes(page, request, scenario, false, true);
  await page.goto(`/testing/editor/${scenario.id}`);
  await page.getByLabel('Name des Testfalls', { exact: true }).fill('Eigener aktueller Titel');
  await page.getByLabel('Anweisung für den gesamten Ablauf').fill('Füge am Ende eine weitere Statusprüfung ein.');
  await page.getByRole('button', { name: 'Speichern und Vorschlag erstellen', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Ablaufänderung prüfen', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Block hinzugefügt');
  await expect(dialog).toContainText('Neue Definition: Direktionsstatus nochmals prüfen');
  await expect(dialog).toContainText('Neues Fachwissen: Neue Kontrollregel');
  await expect(dialog.locator('.t-override-diff')).toContainText('Direktionsprüfung');
  expect((await (await request.get(`/api/testing/scenarios/${scenario.id}`)).json()).blocks).toEqual(scenario.blocks);
  await dialog.getByRole('button', { name: 'Dialog schließen', exact: true }).click();
  await page.getByRole('link', { name: 'Wissensbasis', exact: true }).click();
  await page.getByRole('link', { name: 'Testfall weiterbearbeiten', exact: true }).click();
  await page.getByRole('button', { name: 'Ablaufänderung prüfen', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Ablaufänderung übernehmen und speichern' })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath('globaler-aenderungsvorschlag.png'), fullPage: true });
  await dialog.getByRole('button', { name: 'Ablaufänderung übernehmen und speichern' }).click();
  await expect(dialog).not.toBeVisible();
  const saved = await (await request.get(`/api/testing/scenarios/${scenario.id}`)).json();
  expect(saved.revision).toBe(scenario.revision + 2);
  expect(saved.title).toBe('Eigener aktueller Titel'); expect(saved.blocks.at(-1).id).toBe('zusatzpruefung');
  expect(routes.applyCount()).toBe(1);
  await expect(page.getByRole('button', { name: 'Speichern', exact: true })).toBeDisabled();
});

test('Eigene Änderungen und neue gespeicherte Revision blockieren einen alten globalen Vorschlag', async ({ page, request }) => {
  const scenario = await fixture(request); const routes = await proposalRoutes(page, request, scenario);
  await page.goto(`/testing/editor/${scenario.id}`);
  await page.getByLabel('Anweisung für den gesamten Ablauf').fill('Ergänze eine Statusprüfung.');
  await page.getByRole('button', { name: 'Änderungsvorschlag erstellen', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Ablaufänderung prüfen', exact: true });
  await expect(dialog).toBeVisible(); await dialog.getByRole('button', { name: 'Dialog schließen', exact: true }).click();
  await page.getByLabel('Name des Testfalls', { exact: true }).fill('Eigene spätere Änderung');
  await page.getByRole('button', { name: 'Ablaufänderung prüfen', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Ablaufänderung übernehmen und speichern' })).toBeDisabled();
  await expect(dialog).toContainText('ungespeicherte Änderungen');
  await dialog.getByRole('button', { name: 'Dialog schließen', exact: true }).click();
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await page.getByRole('button', { name: 'Ablaufänderung prüfen', exact: true }).click();
  await expect(dialog).toContainText('früheren Testfallrevision');
  await expect(dialog.getByRole('button', { name: 'Ablaufänderung übernehmen und speichern' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Verwerfen', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Ablaufänderung prüfen', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Name des Testfalls', { exact: true })).toHaveValue('Eigene spätere Änderung');
  expect(routes.applyCount()).toBe(0);
});

test('Einstellungen speichern eigene Claude-Modelle und Argumente und erhalten sie nach Neuladen', async ({ page, request }, testInfo) => {
  const original = await (await request.get('/api/testing/settings')).json();
  try {
    await page.goto('/testing/settings');
    await page.getByRole('button', { name: 'Modell hinzufügen', exact: true }).click();
    const index = original.models.length + 1;
    await page.getByLabel(`Anzeigename Modell ${index}`, { exact: true }).fill('Prüfmodell Claude');
    await page.getByLabel(`Modellname Modell ${index}`, { exact: true }).fill('sonnet');
    await page.getByLabel(`Provider Modell ${index}`, { exact: true }).selectOption('claude');
    await page.getByLabel(`Zusätzliche Argumente Modell ${index}`, { exact: true }).fill('--effort high');
    await page.getByLabel('Standardmodell', { exact: true }).selectOption({ label: 'Prüfmodell Claude · Claude Code' });
    await page.getByRole('button', { name: 'Einstellungen speichern', exact: true }).click();
    await expect(page.getByText('Einstellungen gespeichert. Neue KI-Aufträge verwenden diese Konfiguration.', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel(`Zusätzliche Argumente Modell ${index}`, { exact: true })).toHaveValue('--effort high');
    await page.screenshot({ path: testInfo.outputPath('einstellungen-modelle.png'), fullPage: true });
    const saved = await (await request.get('/api/testing/settings')).json();
    expect(saved.models.at(-1)).toMatchObject({ label: 'Prüfmodell Claude', provider: 'claude', slug: 'sonnet', extraArgs: ['--effort', 'high'] });
    await page.getByRole('link', { name: 'Neuer Testfall', exact: true }).click();
    await expect(page.getByLabel('Modell für den Entwurf').getByRole('option', { name: 'Prüfmodell Claude · Claude Code', exact: true })).toHaveCount(1);
    await expect(page.getByLabel('Modell für den Entwurf')).toHaveValue(saved.models.at(-1).id);
    const scenario = await fixture(request); const routes = await proposalRoutes(page, request, scenario);
    expect((await request.post(`/api/testing/scenarios/${scenario.id}/approve`, { data: { revision: scenario.revision } })).ok()).toBeTruthy();
    const queued = await (await request.post(`/api/testing/scenarios/${scenario.id}/run`, { data: { revision: scenario.revision, model: saved.models.at(-1).id } })).json();
    await expect.poll(async () => (await (await request.get(`/api/testing/runs/${queued.id}`)).json()).status, { timeout: 70000 }).toBe('passed');
    await page.goto('/testing/runs');
    await expect(page.getByLabel('Modell für Wiederverwendung', { exact: true })).toHaveValue(saved.models.at(-1).id);
    await page.goto(`/testing/editor/${scenario.id}`);
    await expect(page.getByLabel('Modell für KI-Aufträge')).toHaveValue(saved.models.at(-1).id);
    await page.getByLabel('Anweisung für den gesamten Ablauf').fill('Ergänze eine Statusprüfung.');
    await page.getByRole('button', { name: 'Änderungsvorschlag erstellen', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Ablaufänderung prüfen', exact: true })).toBeVisible();
    expect(routes.requestedModel()).toBe(saved.models.at(-1).id);
  } finally {
    const current = await (await request.get('/api/testing/settings')).json();
    const restored = await request.put('/api/testing/settings', { data: { ...original, revision: current.revision } });
    expect(restored.ok()).toBeTruthy();
  }
});

test('Ein laufender globaler Auftrag überschreibt keine neueren lokalen Änderungen', async ({ page, request }) => {
  const scenario = await fixture(request); const routes = await proposalRoutes(page, request, scenario, true);
  await page.goto(`/testing/editor/${scenario.id}`);
  await page.getByLabel('Anweisung für den gesamten Ablauf').fill('Ergänze eine weitere Statusprüfung.');
  await page.getByRole('button', { name: 'Änderungsvorschlag erstellen', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Im Hintergrund weiterarbeiten', exact: true }).click();
  await page.getByLabel('Name des Testfalls', { exact: true }).fill('Während des KI-Auftrags weiterbearbeitet');
  routes.release();
  const dialog = page.getByRole('dialog', { name: 'Ablaufänderung prüfen', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('ungespeicherte Änderungen');
  await expect(dialog.getByRole('button', { name: 'Ablaufänderung übernehmen und speichern', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Verwerfen', exact: true }).click();
  await expect(page.getByLabel('Name des Testfalls', { exact: true })).toHaveValue('Während des KI-Auftrags weiterbearbeitet');
  expect((await (await request.get(`/api/testing/scenarios/${scenario.id}`)).json()).title).toBe(scenario.title);
  expect(routes.applyCount()).toBe(0);
});

test('Ein manuell ergänzter Block erklärt eine falsche Ergebnisquelle und springt auch zum fünften verschachtelten Fehlerfeld', async ({ page, request }, testInfo) => {
  const catalog = await (await request.get('/api/testing/catalog')).json();
  const base = catalog.definitions.find((item: any) => item.id === 'pruefung.vorschlagsstatus');
  const definition = { ...base, id: `pruefung.quelle.${randomUUID()}`, name: 'Ergebnisquelle prüfen', semanticKey: `quelle.${randomUUID()}`, bindingId: undefined, operation: undefined, origin: 'human', inputs: base.inputs.map((input: any) => input.key === 'proposalId' ? { ...input, default: { ref: 'kunde', type: 'customer-ref' } } : input) };
  expect((await request.post('/api/testing/definitions', { data: { definition } })).ok()).toBeTruthy();
  const scenario = await fixture(request);
  scenario.blocks[0].outputs = { ...scenario.blocks[0].outputs, customer: 'kunde' };
  const bad = Array.from({ length: 4 }, (_, index) => ({ id: `falsche-quelle-${index}`, definition: { id: definition.id, version: definition.version }, inputs: { proposalId: { ref: 'kunde', type: 'customer-ref' }, expectedStatus: 'Direktionsprüfung' } }));
  const savedResponse = await request.put(`/api/testing/scenarios/${scenario.id}`, { data: { ...scenario, blocks: [{ id: 'pruefungen', definition: { id: 'rolle.als', version: '1.0.0' }, inputs: { role: 'Vermittler' }, children: [...scenario.blocks, ...bad] }], expectedRevision: scenario.revision } });
  expect(savedResponse.ok()).toBeTruthy();
  await page.goto(`/testing/editor/${scenario.id}`);
  await page.getByRole('button', { name: 'Ablaufliste', exact: true }).click();
  await page.locator('.t-outline [data-block-path="pruefungen"]').click();
  await page.getByLabel('Einfügestelle', { exact: true }).selectOption('within');
  await page.getByRole('button', { name: 'Vorhandenen Block hinzufügen', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Block suchen').fill('Ergebnisquelle prüfen');
  await page.getByRole('dialog').getByRole('button').filter({ hasText: 'Ergebnisquelle prüfen' }).click();
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  const issues = page.locator('.t-validation-strip button').filter({ hasText: 'Ergebnisquelle prüfen' }).filter({ hasText: 'Kunde' });
  await expect(issues).toHaveCount(5);
  await expect(issues.last()).toContainText('Vorschlag');
  await expect(issues.last()).toContainText('Schritt 1.9');
  await expect(issues.last()).toContainText('Kunden anlegen');
  await expect(issues.last()).not.toContainText('customer-ref');
  await page.getByRole('tab', { name: 'Technik', exact: true }).click();
  await issues.last().click();
  await expect(page.getByRole('tab', { name: 'Werte', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.t-inspector #testing-value-proposalId')).toBeFocused();
  const saved = await (await request.get(`/api/testing/scenarios/${scenario.id}`)).json();
  const last = saved.blocks[0].children.at(-1);
  await expect(page.locator(`.t-outline [data-block-path="pruefungen/${last.id}"]`)).toHaveClass('active');
  await expect(page.locator('.t-inspector').getByRole('button', { name: /Quelle im Ablauf zeigen/ })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('referenzfehler-mit-feldsprung.png'), fullPage: true });
});

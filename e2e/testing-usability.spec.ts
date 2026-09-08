import { openDetails, workspaceNavigation, editWorkflow } from './helpers/testing-workspace';
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { deriveTestingLifecycle } from '../server/testing/lifecycle';
import { randomUUID } from 'node:crypto';
import type { TestingAgentJob, TestingCatalog, TestingScenario } from '../shared/testing';

async function readScenario(request: APIRequestContext, id: string): Promise<TestingScenario> {
  const response = await request.get(`/api/testing/scenarios/${id}`);
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}
async function fixture(request: APIRequestContext, mutate?: (value: TestingScenario) => void) {
  const source = await readScenario(request, 'kuh-direktionsanfrage');
  const value = { ...source, id: `bedienung-${randomUUID()}`, title: `Bedienprüfung ${randomUUID().slice(0, 8)}`, source: 'human' as const, revision: 0 };
  mutate?.(value);
  const response = await request.put(`/api/testing/scenarios/${value.id}`, { data: { ...value, expectedRevision: 0 } });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json() as Promise<TestingScenario>;
}
async function expectEditor(page: Page, value: TestingScenario) {
  await expect(page).toHaveURL(new RegExp(`/testing/editor/${value.id}(?:\\?step=\\d+)?$`));
  await expect(page.getByLabel('Name des Testfalls', { exact: true })).toHaveValue(value.title);

}
async function openOutline(page: Page, value: TestingScenario) {
  await page.goto(`/testing/editor/${value.id}?step=3`);
  await expectEditor(page, value);
  if (!value.blocks.length) await page.getByRole('button', { name: 'Ablauf selbst erstellen', exact: true }).click();
  await openDetails(page, '.t-editor-step');
  await expect(page.locator('.t-scratch-workspace .blocklySvg')).toBeVisible();
  await page.getByRole('button', { name: 'Ablaufliste', exact: true }).click();
  if (value.blocks.length) await page.locator('.t-outline > button').first().click();
}

async function selectFirst(page: Page) {
  await openDetails(page, '.t-editor-step');
  if (!await page.locator('.t-outline').isVisible()) await page.getByRole('button', { name: 'Ablaufliste', exact: true }).click();
  await page.locator('.t-outline > button').first().click();
}
async function chooseBlock(page: Page, name: string, within = false, placement = 'Am Ende anhängen') {
  await page.getByRole('button', { name: 'Block hinzufügen', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Block hinzufügen', exact: true });
  await picker.getByLabel('Block suchen', { exact: true }).fill(name);
  await picker.getByRole('option').filter({ hasText: name }).first().click();
  if (within) await picker.getByLabel('Einfügestelle', { exact: true }).selectOption('within');
  await picker.getByRole('button', { name: placement, exact: true }).click();
}

async function save(page: Page, request: APIRequestContext, id: string) {
  const previous = await readScenario(request, id);
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Speichern', exact: true })).toBeDisabled();
  const result = await readScenario(request, id);
  expect(result.revision).toBe(previous.revision + 1);
  return result;
}
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', event => { if (event.type() === 'error') errors.push(event.text()); });
  (page as Page & { usabilityErrors: string[] }).usabilityErrors = errors;
});
test.afterEach(async ({ page }) => {
  expect((page as Page & { usabilityErrors: string[] }).usabilityErrors, 'Keine JavaScript- oder Browserkonsolenfehler').toEqual([]);
});

test('Ein abgeschlossener Auftrag öffnet nach Wegnavigation und Neuladen seinen aktuellen gespeicherten Entwurf', async ({ page, request }, testInfo) => {
  const original = await fixture(request);
  const response = await request.put(`/api/testing/scenarios/${original.id}`, { data: { ...original, title: `${original.title} aktuell`, expectedRevision: original.revision } });
  expect(response.ok()).toBeTruthy();
  const current = await response.json() as TestingScenario;
  // Explicit navigation fixture, never a model execution or a claim of AI success.
  const job: TestingAgentJob = { id: `synthetic-completed-${randomUUID()}`, phase: 'business', status: 'completed', model: 'luna', prompt: 'Synthetischer abgeschlossener Auftrag ausschließlich für die Navigationsprüfung.', scenarioId: original.id, scenarioRevision: original.revision, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), events: [], result: { scenario: original } };
  await page.route('**/api/testing/bootstrap', async route => { const upstream = await route.fetch(); const data = await upstream.json(); await route.fulfill({ json: { ...data, jobs: [job, ...data.jobs], lifecycles: data.scenarios.map((scenario: TestingScenario) => deriveTestingLifecycle(scenario, data.catalog, [job, ...data.jobs], data.runs, data.approvals.find((approval: any) => approval.scenarioId === scenario.id && approval.scenarioRevision === scenario.revision))) } }); });
  await page.goto('/testing');
  await openDetails(page, '.t-overview-history');
  await page.getByRole('region', { name: 'Bisherige Agentenaufträge', exact: true }).getByRole('button').filter({ hasText: original.title }).click();
  await expectEditor(page, current);
  await workspaceNavigation(page, 'Wissensbasis');
  await page.getByRole('link', { name: 'Testfall erstellen', exact: true }).click();
  await expectEditor(page, current);
  await page.getByRole('link', { name: 'Alle Testfälle', exact: true }).click();
  await page.reload();
  await openDetails(page, '.t-overview-history');
  await page.getByRole('region', { name: 'Bisherige Agentenaufträge', exact: true }).getByRole('button').filter({ hasText: original.title }).click();
  await expectEditor(page, current);
  expect((await readScenario(request, current.id)).revision).toBe(current.revision);
  await page.screenshot({ path: testInfo.outputPath('auftrag-aktueller-entwurf.png'), fullPage: true });
});

test('Direktlink, Browser zurück und vorwärts wechseln Testfälle und erhalten ungespeicherte deutsche Geldwerte', async ({ page, request }, testInfo) => {
  const a = await fixture(request), b = await fixture(request);
  await openOutline(page, a);
  await page.getByLabel(/Versicherungssumme in EUR/).fill('17.654,32');
  await page.getByRole('link', { name: 'Alle Testfälle', exact: true }).click();
  await page.locator('.t-saved-test').filter({ hasText: b.title }).click();
  await expectEditor(page, b);
  expect((await readScenario(request, a.id)).revision).toBe(a.revision);
  await page.goBack();
  await expect(page).toHaveURL(/\/testing\/scenarios$/);
  await page.goBack();
  await expectEditor(page, a);
  await selectFirst(page);
  await expect(page.getByLabel(/Versicherungssumme in EUR/)).toHaveValue('17.654,32');
  await expect(page.locator('.t-editor-title')).toContainText('Ungespeicherte Änderungen');
  await page.goForward(); await page.goForward();
  await expectEditor(page, b);
  await page.goBack(); await page.goBack();
  await expectEditor(page, a);
  page.once('dialog', dialog => dialog.accept());
  await page.reload();
  await expectEditor(page, a);
  await selectFirst(page);
  await expect(page.getByLabel(/Versicherungssumme in EUR/)).toHaveValue('17.654,32');
  await expect(page.locator('.t-editor-title')).toContainText('Ungespeicherte Änderungen');
  expect((await readScenario(request, a.id)).revision).toBe(a.revision);
  const saved = await save(page, request, a.id);
  expect(saved.blocks[0].inputs.sumInsured).toBe(17654.32);
  await page.reload();
  await expectEditor(page, saved);
  await selectFirst(page);
  await expect(page.getByLabel(/Versicherungssumme in EUR/)).toHaveValue('17.654,32');
  await page.screenshot({ path: testInfo.outputPath('zurueck-und-vorwaerts.png'), fullPage: true });
});

test('Ein neuer Block beginnt ohne erfundene Pflichtwerte und bleibt lose gespeichert, bis er verbunden wird', async ({ page, request }, testInfo) => {
  const current = await fixture(request, value => { value.blocks = []; });
  const name = `Tiernachweis ${randomUUID().slice(0, 8)}`;
  await openOutline(page, current);
  await page.getByRole('button', { name: 'Block hinzufügen', exact: true }).click();
  await page.getByRole('button', { name: 'Neuen Block definieren', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Einen fachlichen Block definieren', exact: true });
  await dialog.getByLabel('Name des Blocks', { exact: true }).fill(name);
  await dialog.getByLabel('Blockart', { exact: true }).selectOption('assertion');
  await dialog.getByLabel('Was soll der Block bewirken?', { exact: true }).fill('Prüft einen tierärztlichen Nachweis anhand fachlicher Werte.');
  const inputs = [{ label: 'Nachweisbetrag', type: 'money' }, { label: 'Nachweisanzahl', type: 'number' }, { label: 'Nachweis geprüft', type: 'boolean' }];
  for (const [index, input] of inputs.entries()) {
    await dialog.getByRole('button', { name: 'Eingabe ergänzen', exact: true }).click();
    await dialog.getByLabel(`Bezeichnung der Eingabe ${index + 1}`, { exact: true }).fill(input.label);
    await dialog.getByLabel(`Datentyp der Eingabe ${index + 1}`, { exact: true }).selectOption(input.type);
    await dialog.getByLabel(`Pflichteingabe ${index + 1}`, { exact: true }).check();
  }
  await dialog.getByRole('button', { name: 'Wissen hinzufügen', exact: true }).click();
  await page.getByRole('dialog', { name: 'Wissen hinzufügen', exact: true }).getByRole('checkbox').first().check();
  await page.getByRole('button', { name: 'Auswahl übernehmen', exact: true }).click();
  await dialog.getByRole('button', { name: /^Definieren und / }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.t-inspector h3')).toHaveText(name);
  for (const input of inputs) await expect(page.getByLabel(new RegExp(input.label))).toHaveValue('');
  const layoutURL = `/api/testing/scenarios/${current.id}/layout`;
  await expect.poll(async () => (await (await request.get(layoutURL)).json()).parkedStacks?.length).toBe(1);
  let layout = await (await request.get(layoutURL)).json();
  expect(layout.parkedStacks[0][0].inputs).toEqual({});
  expect((await readScenario(request, current.id)).blocks).toEqual([]);
  await page.getByLabel(/Nachweisbetrag/).fill('9.876,54');
  await page.getByLabel(/Nachweisanzahl/).fill('7');
  await page.getByLabel(/Nachweis geprüft/).selectOption('true');
  // Reload immediately: layout persistence may still be debounced, but the local workspace must survive.
  await page.reload();
  await openDetails(page, '.t-editor-step');
  layout = await (await request.get(layoutURL)).json();
  const block = page.locator(`g[data-id="${layout.parkedStacks[0][0].id}"]`);
  await expect(block).toContainText('9.876,54');
  await expect(block).toContainText('Nachweisanzahl');
  await expect(block).toContainText('Ja');
  await expect(page.locator('.t-inspector')).toHaveCount(0);
  const path = block.locator(':scope > path.blocklyPath[id]');
  const box = (await path.boundingBox())!;
  await page.mouse.click(box.x + 24, box.y + 10);
  await expect(page.getByLabel(/Nachweisbetrag/)).toHaveValue('9.876,54');
  expect((await (await request.get(`/api/testing/scenarios/${current.id}/compile`)).json()).steps).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('neuer-block-lose-mit-eigenen-werten.png'), fullPage: true });
});

test('Vorhandene Blöcke lassen sich sichtbar ans Ende und in einen ausgewählten Baustein einfügen', async ({ page, request }) => {
  const current = await fixture(request);
  await openOutline(page, current);
  await chooseBlock(page, 'Kunden anlegen');
  await page.getByLabel(/Name des Kunden/).fill('Kunde am Ablaufende');
  const appended = await save(page, request, current.id);
  expect(appended.blocks.at(-1)?.definition.id).toBe('kunde.anlegen');
  expect(appended.blocks.at(-1)?.inputs.name).toBe('Kunde am Ablaufende');
  await page.locator('.t-outline > button').first().click();
  await chooseBlock(page, 'Kunden anlegen', true);
  await page.getByLabel(/Name des Kunden/).fill('Kunde im Baustein');
  const nested = await save(page, request, current.id);
  expect(nested.blocks).toHaveLength(appended.blocks.length);
  expect(nested.blocks[0].children?.at(-1)?.definition.id).toBe('kunde.anlegen');
  expect(nested.blocks[0].children?.at(-1)?.inputs.name).toBe('Kunde im Baustein');
});

test('Verschachtelte gleiche Aliasse benennen die richtige Ergebnisquelle und der Ansprung ändert keine Werte', async ({ page, request }, testInfo) => {
  const catalog = await (await request.get('/api/testing/catalog')).json() as TestingCatalog;
  const definition = catalog.definitions.find(item => item.id === 'ablauf.kuh-vorschlag')!;
  const makeWorkflow = (id: string, name: string) => ({ id, definition: { id: definition.id, version: definition.version }, label: name, inputs: { sumInsured: 15000 }, outputs: { proposal: `vorschlag-${id}` }, overrides: { kunde: { name: `Kundin ${name}` } } });
  const current = await fixture(request, value => { value.blocks = [makeWorkflow('erst', 'Erster Betrieb'), makeWorkflow('zweit', 'Zweiter Betrieb'), { id: 'auswahl', definition: { id: 'angebot.berechnen', version: '1.0.0' }, inputs: { proposalId: { ref: 'vorschlag-zweit' } } }]; });
  await openOutline(page, current);
  const farmButtons = page.locator('.t-outline').getByRole('button', { name: /Betrieb anlegen/ });
  await farmButtons.nth(1).click();
  const source = page.locator('.t-result-description').first();
  await expect(source).toContainText('Kundin Zweiter Betrieb');
  await expect(source).toContainText('Schritt 2.1');
  await expect(source).toContainText('Zweiter Betrieb');
  const customerSelect = page.locator('.t-result-reference select').first();
  await expect(customerSelect.locator('option')).toHaveCount(2);
  await expect(customerSelect.locator('option:checked')).toContainText('Kundin Zweiter Betrieb');
  expect(await customerSelect.locator('option').evaluateAll(options => new Set(options.map(option => (option as HTMLOptionElement).value)).size)).toBe(2);
  await page.getByRole('button', { name: 'Quelle im Ablauf zeigen · Schritt 2.1', exact: true }).click();
  await expect(page.getByLabel(/Name des Kunden/)).toHaveValue('Kundin Zweiter Betrieb');
  await expect(page.locator('.t-outline > button.active')).toContainText('Kunden anlegen');
  await expect(page.getByRole('button', { name: 'Speichern', exact: true })).toBeDisabled();
  await page.locator('.t-outline').getByRole('button', { name: /Angebot berechnen/ }).click();
  await expect(page.locator('.t-result-reference select option')).toHaveCount(2);
  await expect(page.locator('.t-result-description')).toContainText('Schritt 2.4');
  await page.getByRole('button', { name: 'Quelle im Ablauf zeigen · Schritt 2.4', exact: true }).click();
  await expect(page.locator('.t-inspector h3')).toHaveText('Versicherungsvorschlag anlegen');
  expect(await readScenario(request, current.id)).toEqual(current);
  await expect(page.getByRole('button', { name: 'Speichern', exact: true })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath('verschachtelte-ergebnisquelle.png'), fullPage: true });
});

test('Echte Scratch-Auswahl bleibt beim Bearbeiten, Tabwechsel und Klick außerhalb des Blocks erhalten', async ({ page, request }, testInfo) => {
  const current = await fixture(request);
  await page.goto(`/testing/editor/${current.id}`);
  await expectEditor(page, current);
  await openDetails(page, '.t-editor-step');
  await expect(page.locator('.t-scratch-workspace .blocklySvg')).toBeVisible();
  const selectScratchBlock = async (id = 'kuhvorschlag') => {
    await page.getByRole('button', { name: 'Alle Blöcke ins Bild setzen', exact: true }).click();
    const path = page.locator(`g[data-id="${id}"] > path.blocklyPath[id]`);
    await expect(path).toBeVisible();
    await path.scrollIntoViewIfNeeded();
    const box = (await path.boundingBox())!;
    await page.mouse.click(box.x + 24, box.y + 10);
  };
  const inspector = page.locator('.t-inspector');
  const money = page.getByLabel(/Versicherungssumme in EUR/);
  await selectScratchBlock();
  await expect(inspector.locator('h3')).toHaveText('Kuhlebensversicherung vorbereiten');
  await openDetails(page, '.t-inspector-meaning');
  await inspector.locator('.t-inspector-meaning p').click();
  await expect(money).toBeVisible();
  await selectScratchBlock();
  await money.click();
  await expect(money).toBeVisible();
  await money.fill('18.765,43');
  await money.blur();
  await expect(money).toHaveValue('18.765,43');
  await selectScratchBlock();
  await page.locator('.t-editor-title > span').click();
  await expectEditor(page, current);
  await expect(money).toHaveValue('18.765,43');
  for (const tab of ['Wissen', 'Technik', 'Werte']) {
    await selectScratchBlock();
    await inspector.getByRole('tab', { name: tab, exact: true }).click();
    await expect(inspector.getByRole('tab', { name: tab, exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(inspector.locator('h3')).toHaveText('Kuhlebensversicherung vorbereiten');
  }
  await expect(money).toHaveValue('18.765,43');
  await selectScratchBlock();
  const workspace = (await page.locator('.t-scratch-workspace .blocklySvg').boundingBox())!;
  const blank = { x: workspace.x + 12, y: workspace.y + workspace.height - 90 };
  expect(await page.evaluate(point => document.elementFromPoint(point.x, point.y)?.classList.contains('blocklyMainBackground'), blank)).toBeTruthy();
  await page.mouse.click(blank.x, blank.y);
  await expect(inspector).toHaveCount(0);
  await selectScratchBlock();
  await expect(money).toHaveValue('18.765,43');
  await money.fill('18.765,44');
  const saved = await save(page, request, current.id);
  expect(saved.blocks[0].inputs.sumInsured).toBe(18765.44);
  await page.screenshot({ path: testInfo.outputPath('scratch-inspector-weiter-bearbeitbar.png'), fullPage: true });
  await selectScratchBlock('pruefung');
  await expect(inspector.locator('h3')).toHaveText('Zustand des Vorschlags prüfen');
  await page.getByRole('button', { name: 'Block löschen', exact: true }).click();
  await expect(inspector).toHaveCount(0);
  await expect(inspector.getByRole('tablist')).toHaveCount(0);
  const deleted = await save(page, request, current.id);
  expect(deleted.blocks.some(block => block.id === 'pruefung')).toBeFalsy();
});

test('Ein eigener Übersichtstab zeigt alle gespeicherten Testfälle und führt nach Öffnen wieder zur Liste', async ({ page, request }, testInfo) => {
  const current = await fixture(request);
  const all = await (await request.get('/api/testing/scenarios')).json() as TestingScenario[];
  await page.goto('/testing/new');
  await expect(page.getByLabel('Deine Anforderung', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Alle Testfälle', exact: true }).click();
  await expect(page).toHaveURL(/\/testing\/scenarios$/);
  await expect(page.getByRole('heading', { name: 'Alle Testfälle', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Alle Testfälle', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByLabel('Deine Anforderung', { exact: true })).toHaveCount(0);
  const collection = page.getByRole('region', { name: 'Gespeicherte Testfälle', exact: true });
  expect(await collection.locator('.t-saved-test').count()).toBeGreaterThanOrEqual(all.length);
  for (const scenario of all) await expect(collection.locator('.t-saved-test').filter({ hasText: scenario.title }).first()).toBeVisible();
  await page.getByLabel('Testfälle durchsuchen', { exact: true }).fill(current.title);
  await expect(collection.locator('.t-saved-test')).toHaveCount(1);
  await expect(collection.locator('.t-saved-test')).toHaveAttribute('data-scenario-revision', String(current.revision));
  await collection.locator('.t-saved-test').click();
  await expectEditor(page, current);
  await workspaceNavigation(page, 'Alle Testfälle');
  await expect(page).toHaveURL(/\/testing\/scenarios$/);
  await expect(page.getByRole('heading', { name: 'Alle Testfälle', exact: true })).toBeVisible();
  await page.reload();
  await expect(collection.locator('.t-saved-test').filter({ hasText: current.title })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('gespeicherte-testfaelle-eigener-tab.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath('gespeicherte-testfaelle-mobil.png'), fullPage: true });
  await page.getByRole('button', { name: 'Navigation öffnen', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Alle Testfälle', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Testfall erstellen', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('teststudio-navigation-mobil.png'), fullPage: true });
  await page.getByRole('link', { name: 'Alle Testfälle', exact: true }).click();
  await page.getByRole('button', { name: 'Testfall erstellen', exact: true }).click();
  await expect(page).toHaveURL(/\/testing\/new$/);
  await expect(page.getByLabel('Deine Anforderung', { exact: true })).toBeVisible();
});

test('Abweichungen zeigen wirksame Workflowwerte und klappen geänderte Schritte ohne fachliche Änderung auf', async ({ page, request }, testInfo) => {
  const current = await fixture(request, value => {
    value.blocks[0].inputs = { ...value.blocks[0].inputs, customerName: 'QA Kundin mit Abweichung' };
    value.blocks[0].overrides = { betrieb: { state: 'Bayern' } };
  });
  const layoutURL = `/api/testing/scenarios/${current.id}/layout`;
  const layoutResponse = await request.put(layoutURL, { data: { scenarioId: current.id, collapsed: ['kuhvorschlag', 'kuhvorschlag/tier'] } });
  expect(layoutResponse.ok()).toBeTruthy();
  await page.goto(`/testing/editor/${current.id}`);
  await expectEditor(page, current);
  await openDetails(page, '.t-editor-step');
  await expect(page.locator('.t-scratch-workspace .blocklySvg')).toBeVisible();
  await selectFirst(page);
  await expect(page.getByRole('region', { name: 'Abweichungen vom Standard', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Scratch-Blöcke', exact: true }).click();
  const tier = page.locator('g[data-id="kuhvorschlag/tier"]');
  await page.getByRole('button', { name: 'Geänderte Schritte zeigen', exact: true }).click();
  await expect(tier.getByText('Tierart', { exact: true })).toHaveCount(0);
  await expect(page.locator('g[data-id="kuhvorschlag/kunde"]')).toContainText('QA Kundin mit Abweichung');
  await expect(page.locator('g[data-id="kuhvorschlag/betrieb"]')).toContainText('Bayern');
  await expect(tier).toContainText('15.000');
  await expect(tier).toContainText('Versicherungssumme');
  await expect(page.locator('.t-scratch-workspace .blocklyBlockCanvas').first()).not.toContainText('Standardwerte');
  await expect(page.locator('.t-scratch-workspace .blocklyBlockCanvas').first()).not.toContainText('Geändert ·');
  await expect.poll(async () => (await (await request.get(layoutURL)).json()).collapsed).toEqual([]);
  expect(await readScenario(request, current.id)).toEqual(current);
  await expect(page.getByRole('button', { name: 'Speichern', exact: true })).toBeDisabled();
  await page.reload();
  await expectEditor(page, current);
  await selectFirst(page);
  await page.getByRole('button', { name: 'Scratch-Blöcke', exact: true }).click();
  await expect(tier).toBeVisible();
  await page.getByLabel(/Versicherungssumme in EUR/).fill('16.000,50');
  const saved = await save(page, request, current.id);
  expect(saved.blocks[0].inputs.sumInsured).toBe(16000.5);
  expect(saved.blocks[0].children).toBeUndefined();
  await expect(tier).toBeVisible();
  await expect(tier).toContainText('16.000,5');
  await page.screenshot({ path: testInfo.outputPath('workflow-abweichungen-aufgeklappt.png'), fullPage: true });
  await page.getByRole('button', { name: 'Ablaufliste', exact: true }).click();
  await page.locator('.t-outline').getByRole('button', { name: /Betrieb anlegen/ }).click();
  await expect(page.locator('.t-inspector h3')).toHaveText('Betrieb anlegen');
  await expect(page.getByLabel(/Bundesland/)).toHaveValue('Bayern');
  await expect(page.getByRole('button', { name: 'Speichern', exact: true })).toBeDisabled();
  expect(await readScenario(request, current.id)).toEqual(saved);
});

test('Ein abgekoppelter Scratch-Block behält eigene Werte bei fremder Feldänderung und erneutem Andocken', async ({ page, request }, testInfo) => {
  const parkedValues = { name: 'Geparkte Kundin', email: 'geparkt@example.test', phone: '030 1234567' };
  const current = await fixture(request, value => {
    value.blocks = [{ ...value.blocks[0], inputs: { ...value.blocks[0].inputs, customerName: 'Startkundin' } }, value.blocks.at(-1)!, { id: 'park-kunde', definition: { id: 'kunde.anlegen', version: '1.0.0' }, inputs: parkedValues, outputs: { customer: 'park-kundin' } }];
  });
  await page.goto(`/testing/editor/${current.id}`);
  await expectEditor(page, current);
  await openDetails(page, '.t-editor-step');
  await expect(page.locator('.t-scratch-workspace .blocklySvg')).toBeVisible();
  await page.getByRole('button', { name: 'Alle Blöcke ins Bild setzen', exact: true }).click();
  await page.locator('.t-canvas').scrollIntoViewIfNeeded();
  const parkedPath = page.locator('g[data-id="park-kunde"] > path.blocklyPath[id]');
  const original = (await parkedPath.boundingBox())!;
  await page.mouse.move(original.x + 25, original.y + 12);
  await page.mouse.down();
  await page.mouse.move(original.x + 230, original.y - 90, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator('.t-parked-warning')).toContainText('1 lose Blöcke');
  const layoutURL = `/api/testing/scenarios/${current.id}/layout`;
  const parked = () => page.locator('g[data-id="park-kunde"]');
  await expect(parked()).toContainText(parkedValues.name);
  await page.getByRole('button', { name: 'Alle Blöcke ins Bild setzen', exact: true }).click();
  await page.locator('.t-canvas').scrollIntoViewIfNeeded();
  await page.locator('g[data-id="kuhvorschlag/kunde"]').getByText('Startkundin', { exact: true }).dblclick();
  const canvasInput = page.locator('input.blocklyHtmlInput');
  await expect(canvasInput).toBeVisible();
  await canvasInput.fill('Geänderte Startkundin');
  await canvasInput.press('Enter');
  await expect(parked()).toContainText(parkedValues.name);
  await expect(parked()).toContainText(parkedValues.email);
  await expect.poll(async () => (await (await request.get(layoutURL)).json()).parkedBlocks?.find((block: { id: string }) => block.id === 'park-kunde')?.inputs).toEqual(parkedValues);
  await save(page, request, current.id);
  await page.reload();
  await openDetails(page, '.t-editor-step');
  await expect(parked()).toContainText(parkedValues.name);
  await page.getByRole('button', { name: 'Alle Blöcke ins Bild setzen', exact: true }).click();
  await page.locator('.t-canvas').scrollIntoViewIfNeeded();
  const source = (await parkedPath.boundingBox())!;
  const tail = (await page.locator('g[data-id="pruefung"] > path.blocklyPath[id]').boundingBox())!;
  await page.mouse.move(source.x + 24, source.y + 10);
  await page.mouse.down();
  await page.mouse.move(tail.x + 24, tail.y + tail.height + 6, { steps: 16 });
  await page.mouse.up();
  await expect(page.locator('.t-parked-warning')).toHaveCount(0);
  const saved = await save(page, request, current.id);
  expect(saved.blocks.at(-1)?.inputs).toEqual(parkedValues);
  expect(saved.blocks[0].inputs.customerName).toBe('Startkundin');
  expect(saved.blocks[0].children?.find(block => block.id === 'kunde')?.inputs.name).toBe('Geänderte Startkundin');
  expect(saved.blocks[0].children?.find(block => block.id === 'tier')?.inputs.sumInsured).toEqual({ param: 'sumInsured' });
  expect(saved.blocks[0].children?.find(block => block.id === 'betrieb')?.inputs.state).toEqual({ param: 'state' });
  const compilation = await (await request.get(`/api/testing/scenarios/${current.id}/compile`)).json();
  expect(compilation.steps.find((step: { path: string }) => step.path === 'kuhvorschlag/kunde')?.inputs.name).toBe('Geänderte Startkundin');
  expect(compilation.steps.find((step: { path: string }) => step.path === 'park-kunde')?.inputs.name).toBe(parkedValues.name);
  await page.screenshot({ path: testInfo.outputPath('geparkte-eigene-werte-erhalten.png'), fullPage: true });
});

for (const phase of ['duplicates', 'technical'] as const) test(`Ein fehlgeschlagener Bausteinvergleich (${phase}) erklärt die Wiederaufnahme und erhält lokale Änderungen`, async ({ page, request }, testInfo) => {
  const original = await fixture(request);
  expect((await request.post(`/api/testing/scenarios/${original.id}/approve`, { data: { revision: original.revision } })).ok()).toBeTruthy();
  // Historical error fixture with invented identifiers; no model call or imported customer data.
  const rawError = `${phase === 'technical' ? 'Die unabhängige Dublettenprüfung ist fehlgeschlagen: ' : ''}Dublettenprüfung: Auch die KI-Korrektur verletzt den Vertrag: Der Vergleichsblock für qa.berechtigung@1.0.0 muss eine andere vorhandene Definition sein.`;
  let job: TestingAgentJob = { id: `synthetic-failed-${randomUUID()}`, phase, status: 'failed', model: 'luna', prompt: 'Synthetischer fehlerhafter Bausteinvergleich.', scenarioId: original.id, scenarioRevision: original.revision, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), error: rawError, events: [{ id: randomUUID(), at: new Date().toISOString(), kind: 'error', message: rawError }] };
  await page.route('**/api/testing/bootstrap', async route => { const upstream = await route.fetch(); const data = await upstream.json(); await route.fulfill({ json: { ...data, jobs: [job, ...data.jobs], lifecycles: data.scenarios.map((scenario: TestingScenario) => deriveTestingLifecycle(scenario, data.catalog, [job, ...data.jobs], data.runs, data.approvals.find((approval: any) => approval.scenarioId === scenario.id && approval.scenarioRevision === scenario.revision))) } }); });
  const submitted: unknown[] = [];
  await page.route('**/api/testing/jobs/synthetic-retry-*', route => route.fulfill({ json: job }));
  await page.route('**/api/testing/jobs/technical', async route => { submitted.push(route.request().postDataJSON()); job = { ...job, id: `synthetic-retry-${randomUUID()}`, phase: 'technical', status: 'completed', scenarioRevision: route.request().postDataJSON().revision, error: undefined, events: [], result: { needsBusinessReview: true, duplicateDecisions: [{ proposed: original.blocks[0].definition, chosen: { id: 'direktion.entscheiden', version: '1.0.0' }, decision: 'extend', compatible: false, reason: 'Der vorhandene Block muss fachlich erweitert werden.' }] } }; await route.fulfill({ status: 202, json: { ...job, status: 'running' } }); });
  await openOutline(page, original);
  await page.getByLabel(/Versicherungssumme in EUR/).fill('17.654,32');
  await page.getByRole('link', { name: 'Alle Testfälle', exact: true }).click();
  await page.reload();
  await openDetails(page, '.t-overview-history');
  await page.getByRole('region', { name: 'Bisherige Agentenaufträge', exact: true }).getByRole('button').filter({ hasText: original.title }).click();
  await selectFirst(page);
  await page.getByRole('button', { name: 'Früheren Auftrag ansehen', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Früheren Auftrag ansehen', exact: true });
  await expect(dialog.getByRole('alert')).toContainText('Die KI hat keinen gültigen Vergleich geliefert');
  await expect(dialog.getByRole('alert')).toContainText('Dieses Ergebnis wurde nicht übernommen');
  await expect(dialog.getByText(rawError, { exact: true })).not.toBeVisible();
  await dialog.getByText('Technische Fehlerdetails anzeigen', { exact: true }).click();
  await expect(dialog.locator('.t-agent-failure pre').filter({ hasText: rawError })).toBeVisible();
  await dialog.getByText('Technische Fehlerdetails anzeigen', { exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('bausteinvergleich-verstaendlicher-fehler.png') });
  await dialog.getByRole('button', { name: 'Dialog schließen', exact: true }).click();
  await expectEditor(page, original);
  await selectFirst(page);
  await expect(page.getByLabel(/Versicherungssumme in EUR/)).toHaveValue('17.654,32');
  await expect(page.locator('.t-editor-title')).toContainText('Ungespeicherte Änderungen');
  expect(submitted).toEqual([]);
  const current = await save(page, request, original.id);
  await page.getByRole('button', { name: /^(?:Speichern und fachlich freigeben|Fachlich freigeben)$/ }).click();
  await page.getByRole('button', { name: 'Schritt 4: Technik & Prüfen', exact: true }).click();
  await expect(page.getByRole('button', { name: /^(Technik & Probelauf|Mit vorhandener Technik ausführen)$/ })).toBeEnabled();
  await page.getByRole('button', { name: 'Technik neu vorbereiten', exact: true }).click();
  const restart = page.getByRole('dialog', { name: 'Technik neu vorbereiten', exact: true });
  await restart.getByLabel('Modell für technische Vorbereitung', { exact: true }).selectOption('sol');
  await restart.getByRole('button', { name: 'Technik & Probelauf', exact: true }).click();
  expect(submitted).toEqual([{ scenarioId: original.id, revision: current.revision, model: 'sol' }]);
  await page.getByRole('button', { name: 'Schritt 3: Fachlich prüfen', exact: true }).click();
  await page.getByRole('button', { name: 'Vorschläge ansehen', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Vorhandene Fähigkeiten bewusst wiederverwenden', exact: true })).toBeVisible();
  await expect(page.locator('.t-agent-failure')).toHaveCount(0);
  await expect(page.locator('.t-duplicate-review')).toContainText('Die Definition muss fachlich überarbeitet werden');
});

test('Die Arbeitsfläche blendet echte Defaults aus und vergrößert sich im Vollbild ohne Zoomänderung', async ({ page, request }, testInfo) => {
  const current = await fixture(request, value => { value.blocks[0].inputs = {}; delete value.blocks[0].overrides; });
  await page.goto(`/testing/editor/${current.id}`);
  await openDetails(page, '.t-editor-step');
  await expect(page.locator('.blocklyToolbox')).toHaveCount(0);
  await expect(page.locator('.t-inspector')).toHaveCount(0);
  const root = page.locator('g[data-id="kuhvorschlag"]');
  await expect(root.getByText('Versicherungssumme in EUR', { exact: true })).toHaveCount(0);
  await selectFirst(page);
  await expect(page.getByLabel(/Versicherungssumme in EUR/)).toHaveValue('3.500');
  await page.getByLabel(/Versicherungssumme in EUR/).fill('12.345,67');
  await page.getByRole('button', { name: 'Scratch-Blöcke', exact: true }).click();
  await expect(root).toContainText('12.345,67');
  await expect(root.getByText('Versicherungssumme in EUR', { exact: true }).first()).toBeVisible();
  await page.getByLabel(/Versicherungssumme in EUR/).fill('3.500');
  await expect(root.getByText('Versicherungssumme in EUR', { exact: true })).toHaveCount(0);
  // Returning to the actual definition default remains a valid explicit value.
  const saved = await save(page, request, current.id);
  const workbench = page.locator('.t-workbench');
  const before = (await workbench.boundingBox())!;
  const zoom = await page.locator('.blocklyBlockCanvas').first().getAttribute('transform');
  const scale = (text: string | null) => text?.match(/scale\(([^)]+)\)/)?.[1];
  await page.getByRole('button', { name: 'Arbeitsfläche vergrößern', exact: true }).click();
  await expect(workbench).toHaveClass(/is-fullscreen/);
  const expanded = (await workbench.boundingBox())!;
  const viewport = page.viewportSize()!;
  const visibleArea = (rect: typeof before) => Math.max(0, Math.min(viewport.width, rect.x + rect.width) - Math.max(0, rect.x)) * Math.max(0, Math.min(viewport.height, rect.y + rect.height) - Math.max(0, rect.y));
  expect(visibleArea(expanded)).toBeGreaterThan(visibleArea(before));
  expect(expanded.x).toBeLessThanOrEqual(13);
  expect(expanded.y).toBeLessThanOrEqual(13);
  expect(scale(await page.locator('.blocklyBlockCanvas').first().getAttribute('transform'))).toBe(scale(zoom));
  await expect(page.getByLabel(/Versicherungssumme in EUR/)).toHaveValue('3.500');
  await page.screenshot({ path: testInfo.outputPath('volle-arbeitsflaeche-ohne-defaultwerte.png') });
  await page.keyboard.press('Escape');
  await expect(workbench).not.toHaveClass(/is-fullscreen/);
  expect(await readScenario(request, current.id)).toEqual(saved);
});

test('Verschachtelte Wertepaare zeigen nur geänderte fachliche Unterfelder statt technischer JSON-Werte', async ({ page, request }) => {
  const catalog = await (await request.get('/api/testing/catalog')).json() as TestingCatalog;
  const seed = catalog.definitions.find(item => item.id === 'pruefung.vorschlagsstatus')!;
  const definition = { ...seed, id: `qa.wertepaare.${randomUUID()}`, name: 'Nachweiswerte prüfen', semanticKey: `qa.${randomUUID()}`, operation: undefined, bindingId: undefined, inputs: [{ key: 'evidenceDetails', label: 'Nachweis', type: 'object', fields: [{ key: 'insuredAmount', label: 'Nachweisbetrag', type: 'money' }, { key: 'accepted', label: 'Fachlich bestätigt', type: 'boolean' }, { key: 'regionCode', label: 'Gebiet', type: 'text' }], default: { insuredAmount: 3500, accepted: false, regionCode: 'Nord' } }], outputs: [] };
  expect((await request.post('/api/testing/definitions', { data: { definition } })).ok()).toBeTruthy();
  const workflow = { ...seed, id: `qa.werteworkflow.${randomUUID()}`, name: 'Nachweise vorbereiten', semanticKey: `qa.${randomUUID()}`, operation: undefined, bindingId: undefined, kind: 'workflow', inputs: [], outputs: [], body: [{ id: 'nachweis', definition: { id: definition.id, version: definition.version }, inputs: {} }] };
  expect((await request.post('/api/testing/definitions', { data: { definition: workflow } })).ok()).toBeTruthy();
  const current = await fixture(request, value => { value.blocks = [{ id: 'vorbereitung', definition: { id: workflow.id, version: workflow.version }, inputs: {}, overrides: { nachweis: { evidenceDetails: { insuredAmount: 12345.67, accepted: true, regionCode: 'Nord' } } } }]; });
  await page.goto(`/testing/editor/${current.id}`);
  await openDetails(page, '.t-editor-step');
  const nested = page.locator('g[data-id="vorbereitung/nachweis"]');
  await expect(nested).toContainText('Nachweisbetrag: 12.345,67');
  await expect(nested).toContainText('Fachlich bestätigt: Ja');
  await expect(nested).not.toContainText('insuredAmount');
  await expect(nested).not.toContainText('regionCode');
  await expect(nested).not.toContainText('Nord');
  await expect(nested).not.toContainText('{');
  expect(await readScenario(request, current.id)).toEqual(current);
});

test('Ein direkt im Scratch-Block zurückgesetzter Default lässt sich nativ rückgängig machen und wiederholen', async ({ page, request }) => {
  const current = await fixture(request);
  await page.goto(`/testing/editor/${current.id}`);
  await openDetails(page, '.t-editor-step');
  const root = page.locator('g[data-id="kuhvorschlag"]');
  await page.getByRole('button', { name: 'Alle Blöcke ins Bild setzen', exact: true }).click();
  await root.locator(':scope > g.blocklyEditableField').getByText('15.000', { exact: true }).dblclick();
  const input = page.locator('input.blocklyHtmlInput');
  await expect(input).toBeVisible();
  await input.fill('3.500');
  await input.press('Enter');
  await expect(root.getByText('Versicherungssumme in EUR', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Rückgängig', exact: true }).click();
  await expect(root).toContainText('15.000');
  await expect(page.getByRole('button', { name: 'Speichern', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Wiederholen', exact: true }).click();
  await expect(root.getByText('Versicherungssumme in EUR', { exact: true })).toHaveCount(0);
  const saved = await save(page, request, current.id);
  expect(saved.blocks[0].inputs.sumInsured).toBe(3500);
});

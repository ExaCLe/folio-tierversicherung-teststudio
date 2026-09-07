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
  await expect(page).toHaveURL(new RegExp(`/testing/editor/${value.id}$`));
  await expect(page.getByLabel('Name des Testfalls', { exact: true })).toHaveValue(value.title);
  await expect(page.locator('.t-editor-title')).toContainText(`Revision ${value.revision}`);
}
async function openOutline(page: Page, value: TestingScenario) {
  await page.goto(`/testing/editor/${value.id}`);
  await expectEditor(page, value);
  if (!value.blocks.length) await page.getByRole('button', { name: 'Ablauf selbst erstellen', exact: true }).click();
  await openDetails(page, '.t-editor-step');
  await expect(page.locator('.t-scratch-workspace .blocklySvg')).toBeVisible();
  await page.getByRole('button', { name: 'Ablaufliste', exact: true }).click();
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
  await expect(page.getByLabel(/Versicherungssumme in EUR/)).toHaveValue('17.654,32');
  await expect(page.locator('.t-editor-title')).toContainText('Ungespeicherte Änderungen');
  await page.goForward(); await page.goForward();
  await expectEditor(page, b);
  await page.goBack(); await page.goBack();
  await expectEditor(page, a);
  page.once('dialog', dialog => dialog.accept());
  await page.reload();
  await expectEditor(page, a);
  await expect(page.getByLabel(/Versicherungssumme in EUR/)).toHaveValue('17.654,32');
  await expect(page.locator('.t-editor-title')).toContainText('Ungespeicherte Änderungen');
  expect((await readScenario(request, a.id)).revision).toBe(a.revision);
  const saved = await save(page, request, a.id);
  expect(saved.blocks[0].inputs.sumInsured).toBe(17654.32);
  await page.reload();
  await expectEditor(page, saved);
  await expect(page.getByLabel(/Versicherungssumme in EUR/)).toHaveValue('17.654,32');
  await page.screenshot({ path: testInfo.outputPath('zurueck-und-vorwaerts.png'), fullPage: true });
});

test('Eine völlig neue Fähigkeit wird unter einem leeren Ablauf definiert, direkt eingefügt und mit typisierten Werten gespeichert', async ({ page, request }, testInfo) => {
  const current = await fixture(request, value => { value.blocks = []; });
  const name = `Tiernachweis ${randomUUID().slice(0, 8)}`;
  await openOutline(page, current);
  await page.getByRole('button', { name: 'Neuen Block definieren und hinzufügen', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name des Blocks', { exact: true }).fill(name);
  await dialog.getByLabel('Fachliche Bedeutung', { exact: true }).fill('Prüft einen neuen tierärztlichen Nachweis anhand fachlicher Werte.');
  await expect(dialog.getByLabel(/Fachlicher Schlüssel/)).not.toHaveValue('');
  const generatedKey = await dialog.getByLabel(/Fachlicher Schlüssel/).inputValue();
  const inputs = [{ key: 'limit', label: 'Nachweisbetrag', type: 'money' }, { key: 'anzahl', label: 'Nachweisanzahl', type: 'number' }, { key: 'geprueft', label: 'Nachweis geprüft', type: 'boolean' }];
  for (const [index, input] of inputs.entries()) {
    await dialog.getByRole('button', { name: 'Eingabe ergänzen', exact: true }).click();
    await dialog.getByLabel(`Schlüssel der Eingabe ${index + 1}`, { exact: true }).fill(input.key);
    await dialog.getByLabel(`Bezeichnung der Eingabe ${index + 1}`, { exact: true }).fill(input.label);
    await dialog.getByLabel(`Datentyp der Eingabe ${index + 1}`, { exact: true }).selectOption(input.type);
  }
  await openDetails(page, '.t-definition-knowledge > details');
  await dialog.getByRole('checkbox').last().check();
  await dialog.getByRole('button', { name: 'Definieren und zum Ablauf hinzufügen', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.t-outline > button')).toHaveCount(1);
  await expect(page.locator('.t-inspector h3')).toHaveText(name);
  await page.getByLabel(/Nachweisbetrag/).fill('9.876,54');
  await page.getByLabel(/Nachweisanzahl/).fill('7');
  await page.getByLabel(/Nachweis geprüft/).selectOption('true');
  const saved = await save(page, request, current.id);
  expect(saved.blocks).toHaveLength(1);
  expect(saved.blocks[0].inputs).toMatchObject({ limit: 9876.54, anzahl: 7, geprueft: true });
  const catalog = await (await request.get('/api/testing/catalog')).json() as TestingCatalog;
  expect(catalog.definitions.find(definition => definition.id === saved.blocks[0].definition.id)).toMatchObject({ name, semanticKey: generatedKey });
  await page.reload();
  await expect(page.getByLabel(/Nachweisbetrag/)).toHaveValue('9.876,54');
  await expect(page.getByLabel(/Nachweisanzahl/)).toHaveValue('7');
  await expect(page.getByLabel(/Nachweis geprüft/)).toHaveValue('true');
  await page.screenshot({ path: testInfo.outputPath('neue-faehigkeit-direkt-im-test.png'), fullPage: true });
});

test('Vorhandene Blöcke lassen sich sichtbar ans Ende und in einen ausgewählten Baustein einfügen', async ({ page, request }) => {
  const current = await fixture(request);
  await openOutline(page, current);
  const add = async () => {
    await page.getByRole('button', { name: 'Vorhandenen Block hinzufügen', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Vorhandenen Block hinzufügen', exact: true });
    // Runtime tests may add another definition with the same display name.
    await dialog.getByLabel('Block suchen', { exact: true }).fill('kunde.anlegen');
    await dialog.getByRole('button').filter({ hasText: 'Kunden anlegen' }).click();
  };
  await add();
  await page.getByLabel(/Name des Kunden/).fill('Kunde am Ablaufende');
  const appended = await save(page, request, current.id);
  expect(appended.blocks.at(-1)?.definition.id).toBe('kunde.anlegen');
  expect(appended.blocks.at(-1)?.inputs.name).toBe('Kunde am Ablaufende');
  await page.locator('.t-outline > button').first().click();
  await page.getByLabel('Einfügestelle', { exact: true }).selectOption('within');
  await add();
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
  const blank = { x: workspace.x + workspace.width - 60, y: workspace.y + 40 };
  expect(await page.evaluate(point => document.elementFromPoint(point.x, point.y)?.classList.contains('blocklyMainBackground'), blank)).toBeTruthy();
  await page.mouse.click(blank.x, blank.y);
  await expect(money).toHaveValue('18.765,43');
  await money.fill('18.765,44');
  const saved = await save(page, request, current.id);
  expect(saved.blocks[0].inputs.sumInsured).toBe(18765.44);
  await page.screenshot({ path: testInfo.outputPath('scratch-inspector-weiter-bearbeitbar.png'), fullPage: true });
  await selectScratchBlock('pruefung');
  await expect(inspector.locator('h3')).toHaveText('Zustand des Vorschlags prüfen');
  await page.getByRole('button', { name: 'Block löschen', exact: true }).click();
  await expect(inspector.locator('.t-inspector-empty')).toBeVisible();
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
  await expect(collection.locator('.t-saved-test')).toContainText(`Revision ${current.revision}`);
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
  await expect(page.locator('.t-scratch-workspace .blocklySvg')).toBeVisible();
  const deviations = page.getByRole('region', { name: 'Abweichungen vom Standard', exact: true });
  await expect(deviations).toBeVisible();
  await openDetails(page, '.t-value-changes > details');
  const farm = deviations.locator('.t-value-change').filter({ hasText: 'Schritt 1.2' }).filter({ hasText: 'Bundesland' });
  await expect(farm.locator('del')).toHaveText('Niedersachsen');
  await expect(farm.locator('ins')).toHaveText('Bayern');
  const animal = deviations.locator('.t-value-change').filter({ hasText: 'Schritt 1.3' }).filter({ hasText: 'Versicherungssumme' });
  await expect(animal.locator('del')).toHaveText('3.500 EUR');
  await expect(animal.locator('ins')).toHaveText('15.000 EUR');
  const tier = page.locator('g[data-id="kuhvorschlag/tier"]');
  await expect(tier.getByText('Tierart', { exact: true })).toBeHidden();
  await deviations.getByRole('button', { name: 'Geänderte Schritte aufklappen', exact: true }).click();
  await expect(tier.getByText('Tierart', { exact: true })).toBeVisible();
  await expect(page.locator('g[data-id="kuhvorschlag/kunde"]')).toContainText('QA Kundin mit Abweichung');
  await expect(tier).toContainText('15.000 EUR');
  await expect.poll(async () => (await (await request.get(layoutURL)).json()).collapsed).toEqual([]);
  expect(await readScenario(request, current.id)).toEqual(current);
  await expect(page.getByRole('button', { name: 'Speichern', exact: true })).toBeDisabled();
  await page.reload();
  await expectEditor(page, current);
  await expect(tier).toBeVisible();
  await page.getByLabel(/Versicherungssumme in EUR/).fill('16.000,50');
  const saved = await save(page, request, current.id);
  expect(saved.blocks[0].inputs.sumInsured).toBe(16000.5);
  expect(saved.blocks[0].children).toBeUndefined();
  await expect(tier).toBeVisible();
  await expect(tier).toContainText('16.000,5 EUR');
  await page.screenshot({ path: testInfo.outputPath('workflow-abweichungen-aufgeklappt.png'), fullPage: true });
  await openDetails(page, '.t-value-changes > details');
  await farm.getByRole('button', { name: 'Geänderten Schritt zeigen · Schritt 1.2', exact: true }).click();
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
  const dialog = page.locator('.t-inline-activity');
  await expect(dialog.getByRole('alert')).toContainText('Die KI hat keinen gültigen Vergleich geliefert');
  await expect(dialog.getByRole('alert')).toContainText('Dieses Ergebnis wurde nicht übernommen');
  await expect(dialog.getByText(rawError, { exact: true })).not.toBeVisible();
  await dialog.getByText('Technische Fehlerdetails anzeigen', { exact: true }).click();
  await expect(dialog.locator('pre').filter({ hasText: rawError })).toBeVisible();
  await dialog.getByText('Technische Fehlerdetails anzeigen', { exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('bausteinvergleich-verstaendlicher-fehler.png') });
  await expectEditor(page, original);
  await expect(page.getByLabel(/Versicherungssumme in EUR/)).toHaveValue('17.654,32');
  await expect(page.locator('.t-editor-title')).toContainText('Ungespeicherte Änderungen');
  expect(submitted).toEqual([]);
  const current = await save(page, request, original.id);
  await page.getByRole('button', { name: /^(?:Speichern und fachlich freigeben|Fachlich freigeben)$/ }).click();
  await expect(page.getByRole('button', { name: /^(Technik & Probelauf|Mit vorhandener Technik ausführen)$/ })).toBeEnabled();
  await openDetails(page, '.t-workspace-context');
  await page.getByLabel('Modell für KI-Aufträge', { exact: true }).selectOption('sol');
  await page.getByRole('button', { name: /^(Technik & Probelauf|Technik neu vorbereiten)$/ }).click();
  expect(submitted).toEqual([{ scenarioId: original.id, revision: current.revision, model: 'sol' }]);
  await expect(page.getByRole('heading', { name: 'Vorhandene Fähigkeiten bewusst wiederverwenden', exact: true })).toBeVisible();
  await expect(page.locator('.t-agent-failure')).toHaveCount(0);
  await expect(page.locator('.t-duplicate-review')).toContainText('Die Definition muss fachlich überarbeitet werden');
});

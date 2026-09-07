import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
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
  await page.route('**/api/testing/bootstrap', async route => { const upstream = await route.fetch(); const data = await upstream.json(); await route.fulfill({ json: { ...data, jobs: [job, ...data.jobs] } }); });
  await page.goto('/testing');
  await page.getByRole('region', { name: 'Bisherige Agentenaufträge', exact: true }).getByRole('button').filter({ hasText: original.title }).click();
  await page.getByRole('button', { name: 'Entwurf ansehen', exact: true }).click();
  await expectEditor(page, current);
  await page.getByRole('link', { name: 'Wissensbasis', exact: true }).click();
  await page.getByRole('link', { name: 'Testfall weiterbearbeiten', exact: true }).click();
  await expectEditor(page, current);
  await page.getByRole('link', { name: 'Testfälle', exact: true }).click();
  await page.reload();
  await page.getByRole('region', { name: 'Bisherige Agentenaufträge', exact: true }).getByRole('button').filter({ hasText: original.title }).click();
  await page.getByRole('button', { name: 'Entwurf ansehen', exact: true }).click();
  await expectEditor(page, current);
  expect((await readScenario(request, current.id)).revision).toBe(current.revision);
  await page.screenshot({ path: testInfo.outputPath('auftrag-aktueller-entwurf.png'), fullPage: true });
});

test('Direktlink, Browser zurück und vorwärts wechseln Testfälle und erhalten ungespeicherte deutsche Geldwerte', async ({ page, request }, testInfo) => {
  const a = await fixture(request), b = await fixture(request);
  await openOutline(page, a);
  await page.getByLabel(/Versicherungssumme in EUR/).fill('17.654,32');
  await page.getByRole('link', { name: 'Testfälle', exact: true }).click();
  await page.locator('.t-saved-test').filter({ hasText: b.title }).click();
  await expectEditor(page, b);
  expect((await readScenario(request, a.id)).revision).toBe(a.revision);
  await page.goBack();
  await expect(page).toHaveURL(/\/testing$/);
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

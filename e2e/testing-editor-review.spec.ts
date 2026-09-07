import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import type { TestingCatalog, TestingCompiledScenario, TestingScenario } from '../shared/testing';

async function scenario(request: APIRequestContext, id: string): Promise<TestingScenario> {
  const response = await request.get(`/api/testing/scenarios/${id}`);
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function copyScenario(request: APIRequestContext, seedId = 'kuh-direktionsanfrage') {
  const source = await scenario(request, seedId);
  const copy = { ...source, id: `editor-pruefung-${randomUUID()}`, title: `Editorprüfung ${randomUUID().slice(0, 8)}`, source: 'human', revision: 0 };
  const response = await request.put(`/api/testing/scenarios/${copy.id}`, { data: { ...copy, expectedRevision: 0 } });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json() as Promise<TestingScenario>;
}

async function openEditor(page: Page, current: TestingScenario, outline = true) {
  await page.goto(`/testing/editor/${current.id}`);
  await expect(page.getByLabel('Name des Testfalls', { exact: true })).toHaveValue(current.title);
  await expect(page.locator('.t-scratch-workspace .blocklySvg')).toBeVisible();
  if (outline) await page.getByRole('button', { name: 'Ablaufliste', exact: true }).click();
}

async function save(page: Page, request: APIRequestContext, id: string) {
  const previous = await scenario(request, id);
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Speichern', exact: true })).toBeDisabled();
  const saved = await scenario(request, id);
  expect(saved.revision).toBe(previous.revision + 1);
  return saved;
}

async function compiled(request: APIRequestContext, id: string): Promise<TestingCompiledScenario> {
  const response = await request.get(`/api/testing/scenarios/${id}/compile`);
  expect(response.ok()).toBeTruthy();
  return response.json();
}

test('Deutsche Geldwerte und eine lokale Betriebsabweichung bleiben nach Freigabe und Neuladen erhalten', async ({ page, request }, testInfo) => {
  const current = await copyScenario(request);
  await openEditor(page, current);
  const money = page.getByLabel(/Versicherungssumme in EUR/);
  await money.fill('15.000,00');
  await money.blur();
  await expect(money).toHaveValue('15.000');
  await expect(page.getByRole('button', { name: 'Speichern', exact: true })).toBeDisabled();
  expect((await compiled(request, current.id)).steps.find(step => step.definition.id === 'tier.anlegen')?.inputs.sumInsured).toBe(15000);

  await page.locator('.t-outline').getByRole('button', { name: /Betrieb anlegen/ }).click();
  await expect(page.getByText('Änderungen gelten nur innerhalb dieses Tests.', { exact: false })).toBeVisible();
  await page.getByLabel(/Bundesland/).selectOption('Bayern');
  const saved = await save(page, request, current.id);
  expect(saved.blocks[0].children).toBeUndefined();
  expect(Object.values(saved.blocks[0].overrides ?? {})).toContainEqual({ state: 'Bayern' });
  let compilation = await compiled(request, current.id);
  expect(compilation.valid).toBeTruthy();
  expect(compilation.steps.find(step => step.definition.id === 'betrieb.anlegen')?.inputs.state).toBe('Bayern');
  const catalog = await (await request.get('/api/testing/catalog')).json() as TestingCatalog;
  expect(catalog.definitions.find(definition => definition.id === 'ablauf.kuh-vorschlag')?.inputs.find(input => input.key === 'state')?.default).toBe('Niedersachsen');

  await page.getByRole('button', { name: 'Fachlich freigeben', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Technik & Probelauf', exact: true })).toBeVisible();
  const approved = await compiled(request, current.id);
  expect(approved.approval).toBeTruthy();
  await page.getByRole('button', { name: 'Vergrößern', exact: true }).click();
  await expect.poll(async () => (await (await request.get(`/api/testing/scenarios/${current.id}/layout`)).json()).zoom).toBeGreaterThan(0.85);
  expect((await compiled(request, current.id)).approval?.id).toBe(approved.approval?.id);
  expect((await scenario(request, current.id)).revision).toBe(saved.revision);

  await page.locator('.t-outline').getByRole('button', { name: /Kuhlebensversicherung vorbereiten/ }).click();
  await page.getByLabel(/Versicherungssumme in EUR/).fill('16.000,50');
  await expect(page.getByRole('button', { name: 'Fachlich freigeben', exact: true })).toBeVisible();
  await save(page, request, current.id);
  compilation = await compiled(request, current.id);
  expect(compilation.executable).toBeFalsy();
  expect(compilation.issues.some(issue => issue.code === 'APPROVAL_STALE')).toBeTruthy();
  await expect(page.getByRole('button', { name: 'Fachlich freigeben', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Technik & Probelauf', exact: true })).toHaveCount(0);
  expect(compilation.steps.find(step => step.definition.id === 'tier.anlegen')?.inputs.sumInsured).toBe(16000.5);
  await page.reload();
  await expect(page.getByLabel(/Versicherungssumme in EUR/)).toHaveValue('16.000,5');
  await page.getByRole('button', { name: 'Ablaufliste', exact: true }).click();
  await page.locator('.t-outline').getByRole('button', { name: /Betrieb anlegen/ }).click();
  await expect(page.getByLabel(/Bundesland/)).toHaveValue('Bayern');
  await page.screenshot({ path: testInfo.outputPath('lokale-betriebsabweichung.png'), fullPage: true });
});

test('Menschen ergänzen eine fehlende Fähigkeit und erweitern ihr typisiertes Schema als neue Version', async ({ page, request }, testInfo) => {
  const current = await copyScenario(request);
  const name = `Tierärztliche Prüfung ${randomUUID().slice(0, 6)}`;
  const semanticKey = `qa.tiernachweis.${randomUUID()}`;
  const catalog = await (await request.get('/api/testing/catalog')).json() as TestingCatalog;
  await openEditor(page, current);
  await page.getByRole('button', { name: 'Neuen Block definieren und hinzufügen', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name des Blocks', { exact: true }).fill(name);
  await dialog.getByLabel('Fachliche Bedeutung', { exact: true }).fill('Eine neue fachliche Prüfung mit veränderbarer Summe. Die technische Zuordnung wird anschließend ergänzt.');
  await dialog.getByLabel(/Fachlicher Schlüssel/).fill(semanticKey);
  await dialog.getByRole('button', { name: 'Eingabe ergänzen', exact: true }).click();
  await dialog.getByLabel('Schlüssel der Eingabe 1', { exact: true }).fill('limit');
  await dialog.getByLabel('Bezeichnung der Eingabe 1', { exact: true }).fill('Prüfwert');
  await dialog.getByLabel('Datentyp der Eingabe 1', { exact: true }).selectOption('money');
  await dialog.getByRole('checkbox', { name: 'Pflicht', exact: true }).check();
  await dialog.getByRole('checkbox', { name: catalog.knowledge[0].title, exact: true }).check();
  await dialog.getByRole('button', { name: 'Definieren und zum Ablauf hinzufügen', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.t-inspector h3')).toHaveText(name);
  await page.getByLabel(/Prüfwert/).fill('15.000');
  await save(page, request, current.id);
  let result = await compiled(request, current.id);
  expect(result.valid).toBeTruthy();
  expect(result.executable).toBeFalsy();
  const added = result.steps.find(step => step.label === name)!;
  expect(added.inputs.limit).toBe(15000);
  expect(added.binding).toBeUndefined();
  expect(result.issues.some(issue => issue.code === 'BINDING_MISSING' && issue.path === added.path)).toBeTruthy();

  await page.getByLabel('Neuer Eingabeschlüssel', { exact: true }).fill('anzahlNachweise');
  await page.getByRole('button', { name: 'Eingabeschlüssel hinzufügen', exact: true }).click();
  await page.getByLabel(/anzahlNachweise/).fill('5');
  await save(page, request, current.id);
  expect((await compiled(request, current.id)).issues.some(issue => issue.code === 'INPUT_UNKNOWN' && issue.field === 'anzahlNachweise')).toBeTruthy();
  await page.getByRole('button', { name: 'Blockdefinition bearbeiten', exact: true }).click();
  await dialog.getByRole('button', { name: 'Eingabe ergänzen', exact: true }).click();
  await dialog.getByLabel('Schlüssel der Eingabe 2', { exact: true }).fill('anzahlNachweise');
  await dialog.getByLabel('Bezeichnung der Eingabe 2', { exact: true }).fill('Anzahl der Nachweise');
  await dialog.getByLabel('Datentyp der Eingabe 2', { exact: true }).selectOption('number');
  await dialog.getByRole('button', { name: 'Definition speichern', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByLabel(/Anzahl der Nachweise/).fill('5');
  await save(page, request, current.id);
  result = await compiled(request, current.id);
  expect(result.valid).toBeTruthy();
  expect(result.steps.find(step => step.label === name)?.definition.version).toBe('1.0.1');
  expect(result.steps.find(step => step.label === name)?.inputs.anzahlNachweise).toBe(5);
  const updatedCatalog = await (await request.get('/api/testing/catalog')).json() as TestingCatalog;
  const versions = updatedCatalog.definitions.filter(definition => definition.semanticKey === semanticKey);
  expect(versions).toHaveLength(2);
  expect(versions.find(definition => definition.version === '1.0.0')?.inputs.map(input => input.key)).toEqual(['limit']);
  const knowledge = updatedCatalog.knowledge.filter(doc => doc.id === catalog.knowledge[0].id).sort((left, right) => right.revision - left.revision)[0];
  expect(knowledge.definitionRefs.some(ref => ref.id === added.definition.id && ref.version === '1.0.1')).toBeTruthy();
  await page.reload();
  await page.getByRole('button', { name: 'Ablaufliste', exact: true }).click();
  await page.locator('.t-outline').getByRole('button', { name: new RegExp(name) }).click();
  await expect(page.getByLabel(/Anzahl der Nachweise/)).toHaveValue('5');
  await page.screenshot({ path: testInfo.outputPath('neue-fachliche-faehigkeit.png'), fullPage: true });
  await page.getByRole('link', { name: 'Wissensbasis', exact: true }).click();
  await page.getByLabel('Wissensbasis durchsuchen', { exact: true }).fill(knowledge.title);
  await expect(page.getByRole('navigation', { name: 'Wissensdokumente', exact: true }).getByRole('button')).toHaveCount(1);
  await page.getByRole('navigation', { name: 'Wissensdokumente', exact: true }).getByRole('button').click();
  await expect(page.locator('.t-knowledge-article header')).toContainText(`REVISION ${knowledge.revision}`);
});

test('Wissen, Bibliothek und Änderungsfolgen führen beidseitig zu den betroffenen Testfällen', async ({ page, request }, testInfo) => {
  await page.goto('/testing/library');
  await page.getByLabel('Blockbibliothek durchsuchen', { exact: true }).fill('Angebot berechnen');
  await page.locator('.t-definition-card').filter({ has: page.getByRole('heading', { name: 'Angebot berechnen', exact: true }) }).click();
  await expect(page.getByRole('dialog', { name: 'Angebot berechnen', exact: true })).toBeVisible();
  const source = page.getByRole('dialog').locator('.t-source-link').first();
  const title = (await source.innerText()).trim();
  await source.click();
  const knowledge = page.getByRole('dialog', { name: 'Verknüpftes Fachwissen', exact: true });
  await expect(knowledge.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await knowledge.getByRole('button', { name: /Angebot berechnen/ }).click();
  await expect(page.getByRole('dialog', { name: 'Angebot berechnen', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Änderungsfolgen untersuchen', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Änderungsfolgen', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.t-impact-item').filter({ hasText: 'Angebot berechnen' })).toContainText('Direkt verbunden');
  await expect(page.locator('.t-impact-item').filter({ hasText: 'Standard-Kuhlebensversicherung abschließen' })).toContainText('Über');
  await expect(page.getByRole('button', { name: /Police als Sachbearbeiter drucken/ })).toBeVisible();
  await page.getByRole('button', { name: /Police als Sachbearbeiter drucken/ }).click();
  await expect(page.getByLabel('Name des Testfalls', { exact: true })).toHaveValue('Police als Sachbearbeiter drucken');
  await page.getByRole('link', { name: 'Abhängigkeiten', exact: true }).click();
  await page.getByRole('tab', { name: 'Gespeicherte Verbindungen', exact: true }).click();
  await page.getByLabel('Datensatzart', { exact: true }).selectOption('binding');
  await page.getByLabel('Gespeicherte Verbindungen durchsuchen', { exact: true }).fill('Angebot');
  await page.locator('.t-record-list button').first().click();
  await expect(page.locator('.t-connected-records button').first()).toBeVisible();
  const graph = await (await request.get('/api/testing/graph')).json();
  expect(graph.nodes.length).toBeGreaterThan(20);
  expect(graph.edges.length).toBeGreaterThan(20);
  await page.screenshot({ path: testInfo.outputPath('nachvollziehbare-verbindungen.png'), fullPage: true });
});

test('Ein neuer zusammengesetzter Baustein kann zunächst als leerer fachlicher Entwurf gespeichert werden', async ({ page, request }) => {
  const current = await copyScenario(request);
  const name = `Eigener Tierablauf ${randomUUID().slice(0, 6)}`;
  const catalog = await (await request.get('/api/testing/catalog')).json() as TestingCatalog;
  await openEditor(page, current);
  await page.getByRole('button', { name: 'Neuen Block definieren und hinzufügen', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name des Blocks', { exact: true }).fill(name);
  await dialog.getByLabel('Blockart', { exact: true }).selectOption('workflow');
  await dialog.getByLabel('Fachliche Bedeutung', { exact: true }).fill('Die enthaltenen Schritte werden im nächsten Bearbeitungsschritt zusammengestellt.');
  await dialog.getByLabel(/Fachlicher Schlüssel/).fill(`qa.ablauf.${randomUUID()}`);
  await dialog.getByRole('checkbox', { name: catalog.knowledge[0].title, exact: true }).check();
  await dialog.getByRole('button', { name: 'Definieren und zum Ablauf hinzufügen', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.t-inspector h3')).toHaveText(name);
  await save(page, request, current.id);
  const result = await compiled(request, current.id);
  const definition = result.definitions.find(item => item.name === name);
  expect(definition?.kind).toBe('workflow');
  expect(definition?.body).toEqual([]);
  expect(result.issues.some(issue => issue.code === 'COMPOSITION_EMPTY' && issue.message.includes(name))).toBeTruthy();
  await expect(page.locator('.t-validation-strip')).toContainText('enthält noch keine Schritte');
});

test('Ein mit der Maus gelöster Scratch-Block bleibt gespeichert und wird im echten Probelauf nicht ausgeführt', async ({ page, request }, testInfo) => {
  const current = await copyScenario(request);
  await openEditor(page, current, false);
  await page.getByRole('button', { name: 'Alle Blöcke ins Bild setzen', exact: true }).click();
  const blockPath = page.locator('g[data-id="pruefung"] > path.blocklyPath[id]');
  await expect(blockPath).toBeVisible();
  await blockPath.scrollIntoViewIfNeeded();
  const box = await blockPath.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.move(box!.x + 25, box!.y + 12);
  await page.mouse.down();
  await page.mouse.move(box!.x + 180, box!.y - 90, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator('.t-parked-warning')).toContainText('1 lose Blöcke');
  await save(page, request, current.id);
  await expect.poll(async () => (await (await request.get(`/api/testing/scenarios/${current.id}/layout`)).json()).parkedBlocks?.length).toBe(1);
  expect((await compiled(request, current.id)).steps).toHaveLength(6);
  await page.reload();
  await expect(page.locator('.t-parked-warning')).toContainText('1 lose Blöcke');
  await expect(page.locator('g[data-id="pruefung"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Fachlich freigeben', exact: true }).click();
  await page.getByRole('button', { name: 'Mit vorhandener Technik ausführen', exact: true }).click();
  await expect(page.locator('.t-run-inline')).toContainText('6 von 6 Schritten bestanden', { timeout: 90_000 });
  const runs = await (await request.get('/api/testing/runs')).json();
  const run = runs.find((entry: { scenarioId: string }) => entry.scenarioId === current.id);
  expect(run.status).toBe('passed');
  expect(run.steps).toHaveLength(6);
  expect(run.steps.some((step: { path: string }) => step.path === 'pruefung')).toBeFalsy();
  const jobs = await (await request.get('/api/testing/jobs')).json();
  expect(jobs.filter((job: { scenarioId?: string }) => job.scenarioId === current.id)).toHaveLength(0);
  await page.screenshot({ path: testInfo.outputPath('loser-block-und-erfolgreicher-lauf.png'), fullPage: true });
});

test('Native Scratch-Kopien behalten ihre Verbindungen und können unabhängig angedockt, rückgängig gemacht und ausgeführt werden', async ({ page, request }, testInfo) => {
  const current = await copyScenario(request);
  await openEditor(page, current, false);
  await page.getByRole('button', { name: 'Alle Blöcke ins Bild setzen', exact: true }).click();
  const path = page.locator('g[data-id="kuhvorschlag"] > path.blocklyPath[id]');
  let box = (await path.boundingBox())!;
  await page.mouse.click(box.x + 24, box.y + 10, { button: 'right' });
  await page.getByText('Block einklappen', { exact: true }).click();
  box = (await path.boundingBox())!;
  await page.mouse.click(box.x + 24, box.y + 10, { button: 'right' });
  await page.getByText('Duplizieren', { exact: true }).click();
  await page.mouse.move(box.x + 280, box.y + 80, { steps: 10 });
  await page.mouse.click(box.x + 280, box.y + 80);
  await expect(page.locator('.t-parked-warning')).toContainText('4 lose Blöcke');
  const layoutURL = `/api/testing/scenarios/${current.id}/layout`;
  await expect.poll(async () => (await (await request.get(layoutURL)).json()).parkedBlocks?.length).toBe(4);
  const layout = await (await request.get(layoutURL)).json();
  const duplicate = layout.parkedBlocks[0];
  expect(duplicate.id).not.toBe('kuhvorschlag');
  expect(duplicate.definition).toEqual(current.blocks[0].definition);
  expect(duplicate.outputs.proposal).not.toBe('vorschlag');
  const topLevelBlocks = page.locator('.blocklyBlockCanvas').first().locator(':scope > g[data-id]');
  await expect(topLevelBlocks).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Speichern', exact: true })).toBeDisabled();
  expect((await scenario(request, current.id)).revision).toBe(1);
  await page.reload();
  await expect(page.locator('.t-parked-warning')).toContainText('4 lose Blöcke');
  await expect(topLevelBlocks).toHaveCount(2);
  expect((await compiled(request, current.id)).steps).toHaveLength(7);
  await page.getByRole('button', { name: 'Alle Blöcke ins Bild setzen', exact: true }).click();
  const copyPath = page.locator(`g[data-id="${duplicate.id}"] > path.blocklyPath[id]`);
  const originalTail = page.locator('g[data-id="pruefung"] > path.blocklyPath[id]');
  const copyBox = (await copyPath.boundingBox())!;
  const tailBox = (await originalTail.boundingBox())!;
  await page.mouse.move(copyBox.x + 24, copyBox.y + 10);
  await page.mouse.down();
  await page.mouse.move(tailBox.x + 24, tailBox.y + tailBox.height + 6, { steps: 16 });
  await page.mouse.up();
  await expect(page.locator('.t-parked-warning')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Speichern', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Rückgängig', exact: true }).click();
  await expect(page.locator('.t-parked-warning')).toContainText('4 lose Blöcke');
  await page.getByRole('button', { name: 'Wiederholen', exact: true }).click();
  await expect(page.locator('.t-parked-warning')).toHaveCount(0);
  const saved = await save(page, request, current.id);
  expect(saved.blocks).toHaveLength(8);
  const result = await compiled(request, current.id);
  expect(result.valid, JSON.stringify(result.issues)).toBeTruthy();
  expect(result.steps).toHaveLength(14);
  expect(new Set(result.steps.map(step => step.id)).size).toBe(14);
  const proposalOutputs = result.steps.filter(step => step.definition.id === 'vorschlag.anlegen').map(step => step.outputs.proposal);
  expect(proposalOutputs).toHaveLength(2);
  expect(proposalOutputs[0]).not.toBe(proposalOutputs[1]);
  await page.getByRole('button', { name: 'Fachlich freigeben', exact: true }).click();
  await page.getByRole('button', { name: 'Mit vorhandener Technik ausführen', exact: true }).click();
  await expect(page.locator('.t-run-inline')).toContainText('14 von 14 Schritten bestanden', { timeout: 90_000 });
  await page.screenshot({ path: testInfo.outputPath('native-scratch-duplikation.png'), fullPage: true });
});

test('Ungültige Geldangaben werden sichtbar beanstandet und können nicht freigegeben werden', async ({ page, request }) => {
  const current = await copyScenario(request);
  await openEditor(page, current);
  await page.getByLabel(/Versicherungssumme in EUR/).fill('15.000.50');
  await save(page, request, current.id);
  const result = await compiled(request, current.id);
  expect(result.valid).toBeFalsy();
  expect(result.issues.some(issue => issue.severity === 'error' && issue.message.includes('Versicherungssumme'))).toBeTruthy();
  await page.getByRole('button', { name: 'Fachlich freigeben', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('fachliche Fehler');
  await expect(page.getByRole('button', { name: 'Technik & Probelauf', exact: true })).toHaveCount(0);
});

test('Enthaltene Schritte lassen sich über die Tastaturansicht umordnen, duplizieren und wieder entfernen', async ({ page, request }, testInfo) => {
  const current = await copyScenario(request);
  await openEditor(page, current);
  await page.locator('.t-outline').getByRole('button', { name: /Tier oder Bestand anlegen/ }).click();
  await page.getByRole('button', { name: 'Block nach oben verschieben', exact: true }).click();
  await expect(page.locator('.t-outline button').nth(2)).toContainText('Tier oder Bestand anlegen');
  const reordered = await save(page, request, current.id);
  expect(reordered.blocks[0].children?.map(block => block.definition.id)).toEqual(['kunde.anlegen', 'tier.anlegen', 'betrieb.anlegen', 'vorschlag.anlegen']);
  expect((await compiled(request, current.id)).valid).toBeFalsy();
  await page.getByRole('button', { name: 'Block nach unten verschieben', exact: true }).click();
  await save(page, request, current.id);
  expect((await compiled(request, current.id)).valid).toBeTruthy();
  await page.locator('.t-outline').getByRole('button', { name: /Kunden anlegen/ }).click();
  await page.getByRole('button', { name: 'Block duplizieren', exact: true }).click();
  await expect(page.locator('.t-outline').getByRole('button', { name: /Kunden anlegen/ })).toHaveCount(2);
  await page.getByLabel(/Name des Kunden/).fill('Zweiter Kunde im Block');
  const duplicated = await save(page, request, current.id);
  const customers = duplicated.blocks[0].children!.filter(block => block.definition.id === 'kunde.anlegen');
  expect(customers).toHaveLength(2);
  expect(customers[0].id).not.toBe(customers[1].id);
  expect(customers[0].outputs?.customer).not.toBe(customers[1].outputs?.customer);
  expect(customers[1].inputs.name).toBe('Zweiter Kunde im Block');
  expect((await compiled(request, current.id)).valid).toBeTruthy();
  await page.reload();
  await page.getByRole('button', { name: 'Ablaufliste', exact: true }).click();
  await expect(page.locator('.t-outline').getByRole('button', { name: /Kunden anlegen/ })).toHaveCount(2);
  await page.locator('.t-outline').getByRole('button', { name: /Kunden anlegen/ }).nth(1).click();
  await expect(page.getByLabel(/Name des Kunden/)).toHaveValue('Zweiter Kunde im Block');
  await page.getByRole('button', { name: 'Block löschen', exact: true }).click();
  await save(page, request, current.id);
  await expect(page.locator('.t-outline').getByRole('button', { name: /Kunden anlegen/ })).toHaveCount(1);
  expect((await compiled(request, current.id)).steps).toHaveLength(7);
  await page.screenshot({ path: testInfo.outputPath('verschachtelte-bearbeitung.png'), fullPage: true });
});

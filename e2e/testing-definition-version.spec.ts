import { openDetails, workspaceNavigation } from './helpers/testing-workspace';
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

async function fixture(request: APIRequestContext) {
  const catalog = await (await request.get('/api/testing/catalog')).json();
  const base = catalog.definitions.find((item: any) => item.id === 'pruefung.vorschlagsstatus');
  const definition = { ...base, id: `versionierte.pruefung.${randomUUID()}`, name: `Versionsprüfung ${randomUUID().slice(0, 8)}`, semanticKey: `version.${randomUUID()}`, operation: undefined, bindingId: undefined, origin: 'human', inputs: [{ key: 'target', label: 'Vorgang', type: 'contract-ref', required: true }], outputs: [] };
  expect((await request.post('/api/testing/definitions', { data: { definition } })).ok()).toBeTruthy();
  const source = await (await request.get('/api/testing/scenarios/kuh-police-drucken')).json();
  const scenario = { ...source, id: `versionswechsel-${randomUUID()}`, title: definition.name, blocks: [{ ...source.blocks[0], outputs: { proposal: 'vorschlag', contract: 'vertrag' } }, { id: 'pruefung', definition: { id: definition.id, version: definition.version }, inputs: { target: { ref: 'vertrag', type: 'contract-ref' } } }] };
  const response = await request.put(`/api/testing/scenarios/${scenario.id}`, { data: { ...scenario, expectedRevision: 0 } });
  expect(response.ok()).toBeTruthy(); return { scenario: await response.json(), definition };
}
async function open(page: Page, id: string) { await page.goto(`/testing/editor/${id}`); await expect(page.getByLabel('Name des Testfalls', { exact: true })).toBeVisible(); await openDetails(page, '.t-editor-step'); await page.getByRole('button', { name: 'Ablaufliste', exact: true }).click(); await page.locator('.t-outline [data-block-path="pruefung"]').click(); }
async function correctDialog(page: Page) { const dialog = page.getByRole('dialog', { name: 'Gemeinsame Blockdefinition aktualisieren', exact: true }); await dialog.getByLabel('Datentyp der Eingabe 1', { exact: true }).selectOption('proposal-ref'); await dialog.getByRole('button', { name: 'Definition aktualisieren', exact: true }).click(); await expect(dialog).not.toBeVisible(); }

test('Eine Bibliothekskorrektur gilt ohne Versionswahl im vorhandenen Testfall', async ({ page, request }, testInfo) => {
  const { scenario, definition } = await fixture(request);
  await open(page, scenario.id);
  await page.locator('#testing-value-target').selectOption('vertrag');
  await workspaceNavigation(page, 'Blockbibliothek');
  await page.getByLabel('Blockbibliothek durchsuchen').fill(definition.name);
  await page.locator('.t-definition-card').click();
  await page.getByRole('button', { name: 'Definition aktualisieren', exact: true }).click();
  await correctDialog(page);
  await page.getByRole('link', { name: 'Testfall erstellen', exact: true }).click();
  await expect(page.getByLabel('Verwendete Blockversion', { exact: true })).toHaveCount(0);
  const picker = page.locator('#testing-value-target');
  await expect(picker.locator('option[value="vorschlag"]')).toHaveCount(1);
  await expect(picker.locator('option[value="vertrag"]')).toHaveCount(0);
  await picker.selectOption('vorschlag');
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Speichern', exact: true })).toBeDisabled();
  await page.reload();
  await openDetails(page, '.t-editor-step');
  await page.getByRole('button', { name: 'Ablaufliste', exact: true }).click();
  await page.locator('.t-outline [data-block-path="pruefung"]').click();
  await expect(picker).toHaveValue('vorschlag');
  const compiled = await (await request.get(`/api/testing/scenarios/${scenario.id}/compile`)).json();
  expect(compiled.issues.filter((issue: any) => issue.field === 'target')).toEqual([]);
  const catalog = await (await request.get('/api/testing/catalog')).json();
  expect(catalog.definitions.find((item: any) => item.id === definition.id && item.version === '1.0.0').inputs[0].type).toBe('contract-ref');
  await picker.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('korrigierte-blockversion-picker.png') });
});

test('Eine Korrektur im Inspector aktualisiert alle Verwendungen desselben Blocks', async ({ page, request }) => {
  const { scenario, definition } = await fixture(request);
  const other={...scenario,id:`weiterer-testfall-${randomUUID()}`,title:`Weiterer ${definition.name}`};
  expect((await request.put(`/api/testing/scenarios/${other.id}`,{data:{...other,expectedRevision:0}})).ok()).toBeTruthy();
  const second = { ...scenario.blocks[1], id: 'historische-pruefung' };
  expect((await request.put(`/api/testing/scenarios/${scenario.id}`, { data: { ...scenario, blocks: [...scenario.blocks, second], expectedRevision: scenario.revision } })).ok()).toBeTruthy();
  await open(page, scenario.id);
  await page.getByRole('button', { name: 'Blockdefinition bearbeiten', exact: true }).click();
  await correctDialog(page);
  await expect(page.getByLabel('Verwendete Blockversion', { exact: true })).toHaveCount(0);
  await page.locator('#testing-value-target').selectOption('vorschlag');
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Speichern', exact: true })).toBeDisabled();
  const compiled = await (await request.get(`/api/testing/scenarios/${scenario.id}/compile`)).json();
  expect(compiled.steps.filter((step:any)=>step.definition.id===definition.id).map((step:any)=>step.definition.version)).toEqual(['1.0.1','1.0.1']);
  expect(compiled.issues.some((issue:any)=>issue.field==='target')).toBeTruthy();
  const otherCompiled=await (await request.get(`/api/testing/scenarios/${other.id}/compile`)).json();
  expect(otherCompiled.steps.find((step:any)=>step.definition.id===definition.id)?.definition.version).toBe('1.0.1');
  expect(otherCompiled.scenario.blocks.find((block:any)=>block.definition.id===definition.id)?.definition.version).toBe('1.0.1');
});

test('Eine bereits korrigierte Definition akzeptiert ihre echte Vorschlagsquelle trotz alter Referenzmarkierung', async ({ page, request }) => {
  const { scenario, definition } = await fixture(request);
  const corrected = { ...definition, version: '1.0.1', supersedes: { id: definition.id, version: definition.version }, inputs: [{ ...definition.inputs[0], type: 'proposal-ref', default: { ref: 'vorschlag', type: 'contract-ref' } }] };
  expect((await request.post('/api/testing/definitions', { data: { definition: corrected } })).ok()).toBeTruthy();
  const blocks = [scenario.blocks[0], { ...scenario.blocks[1], definition: { id: definition.id, version: '1.0.1' }, inputs: { target: { ref: 'vorschlag', type: 'contract-ref' } } }];
  expect((await request.put(`/api/testing/scenarios/${scenario.id}`, { data: { ...scenario, blocks, expectedRevision: scenario.revision } })).ok()).toBeTruthy();
  await open(page, scenario.id);
  await expect(page.locator('#testing-value-target')).toHaveValue('vorschlag');
  await expect(page.locator('.t-inspector .t-result-reference')).toHaveAttribute('data-reference-status', 'available');
  const compiled = await (await request.get(`/api/testing/scenarios/${scenario.id}/compile`)).json();
  expect(compiled.issues.filter((issue: any) => issue.field === 'target')).toEqual([]);
  // The source is preserved; reading the corrected schema does not rewrite historical data.
  const saved = await (await request.get(`/api/testing/scenarios/${scenario.id}`)).json();
  expect(saved.blocks[1].inputs.target).toEqual({ ref: 'vorschlag', type: 'contract-ref' });
});

test('Neue Definition entsteht ohne technische Schlüssel mit bewusst gewählten Typen und atomarem Fachwissen', async ({ page, request }, testInfo) => {
  const { scenario } = await fixture(request);
  await page.goto(`/testing/editor/${scenario.id}`);
  await openDetails(page, '.t-editor-step');
  await page.getByRole('button', { name: 'Block hinzufügen', exact: true }).click();
  await page.getByRole('dialog', { name: 'Block hinzufügen', exact: true }).getByRole('button', { name: 'Neuen Block definieren', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Einen fachlichen Block definieren', exact: true });
  await expect(dialog.getByLabel('Blockart', { exact: true })).toHaveValue('');
  await expect(dialog.getByLabel(/Fachlicher Schlüssel|Semantische Version|Eingabeschlüssel/)).toHaveCount(0);
  await expect(dialog).not.toContainText('technische Bindung fehlt');
  const name = `Fachliche Grenzwertprüfung ${randomUUID().slice(0, 8)}`;
  await dialog.getByLabel('Name des Blocks', { exact: true }).fill(name);
  await dialog.getByLabel('Blockart', { exact: true }).selectOption('assertion');
  await dialog.getByRole('button', { name: 'Eingabe ergänzen', exact: true }).click();
  await expect(dialog.getByLabel('Datentyp der Eingabe 1', { exact: true })).toHaveValue('');
  await dialog.getByLabel('Bezeichnung der Eingabe 1', { exact: true }).fill('Maximale Höhe');
  await dialog.getByLabel('Datentyp der Eingabe 1', { exact: true }).selectOption('number');
  await dialog.getByLabel('Pflichteingabe 1', { exact: true }).check();
  await dialog.getByLabel('Art des Standardwerts für Maximale Höhe', { exact: true }).selectOption('literal');
  await expect(dialog.getByLabel('Standardwert für Maximale Höhe', { exact: true })).toHaveValue('');
  await dialog.getByLabel('Standardwert für Maximale Höhe', { exact: true }).fill('15.000,50');
  await dialog.getByRole('button', { name: 'Eingabe ergänzen', exact: true }).click();
  await dialog.getByLabel('Bezeichnung der Eingabe 2', { exact: true }).fill('Ist bestätigt');
  await dialog.getByLabel('Datentyp der Eingabe 2', { exact: true }).selectOption('boolean');
  await dialog.getByLabel('Art des Standardwerts für Ist bestätigt', { exact: true }).selectOption('literal');
  await expect(dialog.getByLabel('Standardwert für Ist bestätigt', { exact: true })).toHaveValue('');
  await dialog.getByLabel('Was muss vorher gegeben sein?', { exact: true }).fill('Ein fachlicher Vorgang liegt vor.');
  await dialog.getByLabel('Was soll der Block bewirken?', { exact: true }).fill('Der Grenzwert ist geprüft.');
  await dialog.getByRole('button', { name: 'Wissen hinzufügen', exact: true }).click();
  const knowledge = page.getByRole('dialog', { name: 'Wissen hinzufügen', exact: true });
  await knowledge.getByLabel('Vorhandenes Wissen suchen', { exact: true }).fill('Kein passender synthetischer Beleg');
  await expect(knowledge).toContainText('Kein passendes Wissen gefunden');
  await knowledge.getByRole('button', { name: 'Neue Wissensquelle hinzufügen', exact: true }).click();
  await dialog.getByLabel('Titel des Wissens', { exact: true }).fill(`${name}: Regel`);
  await dialog.getByLabel('Fachliche Beschreibung', { exact: true }).fill('Der Grenzwert wird anhand der angegebenen maximalen Höhe geprüft.');
  await page.screenshot({ path: testInfo.outputPath('fachliche-definition-ohne-schluessel.png'), fullPage: true });
  await dialog.getByRole('button', { name: 'Definieren und auf Arbeitsfläche platzieren', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const catalog = await (await request.get('/api/testing/catalog')).json();
  const definition = catalog.definitions.find((item: any) => item.name === name);
  expect(definition.version).toBe('1.0.0'); expect(definition.id).toMatch(/^fachlich\./); expect(definition.semanticKey).toBeTruthy();
  expect(definition.inputs[0]).toMatchObject({ key: 'maximaleHohe', type: 'number', required: true, default: 15000.5 });
  expect(definition.inputs[1]).toMatchObject({ key: 'istBestatigt', type: 'boolean' });
  expect(definition.inputs[1]).not.toHaveProperty('default');
  expect(definition.inputs[0]).not.toHaveProperty('generatedKey');
  const document = catalog.knowledge.find((item: any) => item.id === definition.knowledgeRefs[0]);
  expect(document.title).toBe(`${name}: Regel`);
  expect(document.definitionRefs).toContainEqual({ id: definition.id, version: definition.version });
});

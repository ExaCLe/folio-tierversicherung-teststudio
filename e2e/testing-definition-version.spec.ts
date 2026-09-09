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
async function defaultFixture(request: APIRequestContext, suffix: string, inputs: Record<string, unknown> = {}) {
  const catalog = await (await request.get('/api/testing/catalog')).json();
  const base = catalog.definitions.find((item: any) => item.id === 'pruefung.vorschlagsstatus');
  const definition = { ...base, id: `standardwert.${randomUUID()}`, name: `Standardwertprüfung ${suffix}`, semanticKey: `default.${randomUUID()}`, operation: undefined, bindingId: undefined, origin: 'human', inputs: [{ key: 'status', label: 'Erwarteter Status', type: 'text', required: false, default: 'Bisheriger Standard' }], outputs: [] };
  expect((await request.post('/api/testing/definitions', { data: { definition } })).ok()).toBeTruthy();
  const source = await (await request.get('/api/testing/scenarios/kuh-police-drucken')).json();
  const scenario = { ...source, id: `standardwert-${randomUUID()}`, title: `Testfall ${suffix}`, blocks: [{ id: 'status-pruefen', definition: { id: definition.id, version: definition.version }, inputs }] };
  const response = await request.put(`/api/testing/scenarios/${scenario.id}`, { data: { ...scenario, expectedRevision: 0 } });
  expect(response.ok()).toBeTruthy();
  return { scenario: await response.json(), definition };
}
async function editDefault(page: Page, name: string, value?: string) {
  await page.goto('/testing/library');
  await page.getByLabel('Blockbibliothek durchsuchen').fill(name);
  await page.locator('.t-definition-card').click();
  await page.getByRole('button', { name: 'Definition aktualisieren', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Gemeinsame Blockdefinition aktualisieren', exact: true });
  if (value === undefined) await dialog.getByLabel('Art des Standardwerts für Erwarteter Status', { exact: true }).selectOption('none');
  else await dialog.getByLabel('Standardwert für Erwarteter Status', { exact: true }).fill(value);
  await dialog.getByRole('button', { name: 'Definition aktualisieren', exact: true }).click();
  return page.getByRole('dialog', { name: 'Änderung der Blockdefinition prüfen', exact: true });
}
async function open(page: Page, id: string) { await page.goto(`/testing/editor/${id}`); await expect(page.getByLabel('Name des Testfalls', { exact: true })).toBeVisible(); await openDetails(page, '.t-editor-step'); await page.getByRole('button', { name: 'Ablaufliste', exact: true }).click(); await page.locator('.t-outline [data-block-path="pruefung"]').click(); }
async function openTypeChangePreview(page: Page) { const dialog = page.getByRole('dialog', { name: 'Gemeinsame Blockdefinition aktualisieren', exact: true }); await dialog.getByLabel('Datentyp der Eingabe 1', { exact: true }).selectOption('proposal-ref'); await dialog.getByRole('button', { name: 'Definition aktualisieren', exact: true }).click(); await expect(dialog).not.toBeVisible(); return page.getByRole('dialog', { name: 'Änderung der Blockdefinition prüfen', exact: true }); }

test('Eine inkompatible Bibliothekskorrektur nennt den Testfall und verlangt einen geprüften neuen Wert', async ({ page, request }, testInfo) => {
  const { scenario, definition } = await fixture(request);
  await open(page, scenario.id);
  await workspaceNavigation(page, 'Blockbibliothek');
  await page.getByLabel('Blockbibliothek durchsuchen').fill(definition.name);
  await page.locator('.t-definition-card').click();
  await page.getByRole('button', { name: 'Definition aktualisieren', exact: true }).click();
  const review = await openTypeChangePreview(page);
  await expect(review).toContainText('1 Testfall mit insgesamt 1 Ausprägung');
  await expect(review).toContainText(scenario.title);
  await expect(review).toContainText('pruefung');
  await expect(review).toContainText('wechselt von');
  await expect(review.getByRole('button', { name: 'Geprüfte Änderung übernehmen', exact: true })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath('blockierte-definitionskorrektur.png'), fullPage: true });
  await review.locator('#testing-value-definition-change-target').selectOption('vorschlag');
  await review.getByRole('button', { name: 'Wert übernehmen', exact: true }).click();
  await expect(review.getByRole('button', { name: 'Geprüfte Änderung übernehmen', exact: true })).toBeEnabled();
  await review.getByRole('button', { name: 'Geprüfte Änderung übernehmen', exact: true }).click();
  await expect(review).not.toBeVisible();
  const catalog = await (await request.get('/api/testing/catalog')).json();
  expect(catalog.definitions.find((item: any) => item.id === definition.id && item.version === '1.0.0').inputs[0].type).toBe('contract-ref');
  expect(catalog.definitions.find((item: any) => item.id === definition.id && item.version === '1.0.1').inputs[0].type).toBe('proposal-ref');
  const compiled = await (await request.get(`/api/testing/scenarios/${scenario.id}/compile`)).json();
  expect(compiled.steps.find((step: any) => step.definition.id === definition.id).inputs.target).toEqual({ ref: 'standard/vorbereiten/vorschlag::proposal', type: 'proposal-ref' });
  expect(compiled.issues.filter((issue: any) => issue.field === 'target')).toEqual([]);
});

test('Die Änderungsprüfung nennt alle direkten Verwendungen und Blockpfade', async ({ page, request }) => {
  const { scenario, definition } = await fixture(request);
  const other={...scenario,id:`weiterer-testfall-${randomUUID()}`,title:`Weiterer ${definition.name}`};
  expect((await request.put(`/api/testing/scenarios/${other.id}`,{data:{...other,expectedRevision:0}})).ok()).toBeTruthy();
  const second = { ...scenario.blocks[1], id: 'historische-pruefung' };
  expect((await request.put(`/api/testing/scenarios/${scenario.id}`, { data: { ...scenario, blocks: [...scenario.blocks, second], expectedRevision: scenario.revision } })).ok()).toBeTruthy();
  await open(page, scenario.id);
  const renamed = `${scenario.title} – lokal gespeichert`;
  await page.getByLabel('Name des Testfalls', { exact: true }).fill(renamed);
  await page.getByRole('button', { name: 'Blockdefinition bearbeiten', exact: true }).click();
  const review = await openTypeChangePreview(page);
  await expect(review).toContainText('2 Testfälle mit insgesamt 2 Ausprägungen');
  await expect(review).toContainText(renamed);
  await expect(review).toContainText(other.title);
  await expect(review.locator('code').filter({ hasText: /^pruefung$/ })).toHaveCount(2);
  await expect(review.locator('code').filter({ hasText: /^historische-pruefung$/ })).toHaveCount(1);
  await expect(review.getByText('Direkt verwendet', { exact: true })).toHaveCount(2);
  const savedBeforePreview = await (await request.get(`/api/testing/scenarios/${scenario.id}`)).json();
  expect(savedBeforePreview.title).toBe(renamed);
});

test('Ein geänderter Standardwert wird je Verwendung entschieden und abweichende Werte bleiben erhalten', async ({ page, request }) => {
  const suffix = randomUUID().slice(0, 8);
  const inherited = await defaultFixture(request, `${suffix} geerbt`);
  const explicit = await defaultFixture(request, `${suffix} bisheriger Standard ausdrücklich`, { status: 'Bisheriger Standard' });
  const different = await defaultFixture(request, `${suffix} abweichend`, { status: 'Eigener Wert' });
  // The fixtures intentionally start with separate definitions; point both additional scenarios at the shared definition under review.
  const explicitScenario = { ...explicit.scenario, blocks: [{ ...explicit.scenario.blocks[0], definition: { id: inherited.definition.id, version: inherited.definition.version } }] };
  const differentScenario = { ...different.scenario, blocks: [{ ...different.scenario.blocks[0], definition: { id: inherited.definition.id, version: inherited.definition.version } }] };
  expect((await request.put(`/api/testing/scenarios/${explicitScenario.id}`, { data: { ...explicitScenario, expectedRevision: explicitScenario.revision } })).ok()).toBeTruthy();
  expect((await request.put(`/api/testing/scenarios/${differentScenario.id}`, { data: { ...differentScenario, expectedRevision: differentScenario.revision } })).ok()).toBeTruthy();

  const review = await editDefault(page, inherited.definition.name, 'Neuer Standard');
  await expect(review).toContainText(inherited.scenario.title);
  await expect(review).toContainText(explicitScenario.title);
  await expect(review).toContainText(differentScenario.title);
  await expect(review.getByText('Welcher Wert soll für diese Teststelle gelten?', { exact: true })).toHaveCount(2);
  await expect(review.getByRole('button', { name: 'Geprüfte Änderung übernehmen', exact: true })).toBeDisabled();
  const inheritedChange = review.locator('.t-definition-change-scenario').filter({ hasText: inherited.scenario.title });
  const explicitChange = review.locator('.t-definition-change-scenario').filter({ hasText: explicitScenario.title });
  await expect(explicitChange.getByLabel('Bisherigen Wert ausdrücklich beibehalten', { exact: true })).toBeChecked();
  await inheritedChange.getByLabel('Neuen Standard übernehmen', { exact: true }).click();
  await expect(review.getByRole('button', { name: 'Geprüfte Änderung übernehmen', exact: true })).toBeEnabled();
  await review.getByRole('button', { name: 'Geprüfte Änderung übernehmen', exact: true }).click();
  await expect(review).not.toBeVisible();

  const inheritedSaved = await (await request.get(`/api/testing/scenarios/${inherited.scenario.id}`)).json();
  const explicitSaved = await (await request.get(`/api/testing/scenarios/${explicitScenario.id}`)).json();
  const differentSaved = await (await request.get(`/api/testing/scenarios/${differentScenario.id}`)).json();
  expect(inheritedSaved.blocks[0].inputs).not.toHaveProperty('status');
  expect(explicitSaved.blocks[0].inputs.status).toBe('Bisheriger Standard');
  expect(differentSaved.blocks[0].inputs.status).toBe('Eigener Wert');
  const compiled = await (await request.get(`/api/testing/scenarios/${inherited.scenario.id}/compile`)).json();
  expect(compiled.steps[0].inputs.status).toBe('Neuer Standard');
});

test('Beim Entfernen eines Standards zeigt die Prüfung den erhaltenen ausdrücklichen Wert', async ({ page, request }) => {
  const fixtureWithDefault = await defaultFixture(request, randomUUID().slice(0, 8));
  const review = await editDefault(page, fixtureWithDefault.definition.name);
  await expect(review).toContainText('Der bisher geerbte Standardwert wird ausdrücklich im Testfall gespeichert.');
  await expect(review).toContainText('Bisheriger Standard');
  await expect(review.getByText('Welcher Wert soll für diese Teststelle gelten?', { exact: true })).toHaveCount(0);
  await review.getByRole('button', { name: 'Geprüfte Änderung übernehmen', exact: true }).click();
  await expect(review).not.toBeVisible();
  const saved = await (await request.get(`/api/testing/scenarios/${fixtureWithDefault.scenario.id}`)).json();
  expect(saved.blocks[0].inputs.status).toBe('Bisheriger Standard');
});

test('Ein neues Pflichtfeld erhält vor der Übernahme einen geprüften Testwert', async ({ page, request }) => {
  const setup = await defaultFixture(request, randomUUID().slice(0, 8));
  await page.goto('/testing/library');
  await page.getByLabel('Blockbibliothek durchsuchen').fill(setup.definition.name);
  await page.locator('.t-definition-card').click();
  await page.getByRole('button', { name: 'Definition aktualisieren', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Gemeinsame Blockdefinition aktualisieren', exact: true });
  await editor.getByRole('button', { name: 'Eingabe ergänzen', exact: true }).click();
  await editor.getByLabel('Bezeichnung der Eingabe 2', { exact: true }).fill('Prüfgrund');
  await editor.getByLabel('Datentyp der Eingabe 2', { exact: true }).selectOption('text');
  await editor.getByLabel('Pflichteingabe 2', { exact: true }).check();
  await editor.getByRole('button', { name: 'Definition aktualisieren', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Änderung der Blockdefinition prüfen', exact: true });
  await expect(review).toContainText('Für das neue Pflichtfeld');
  await review.locator('#testing-value-definition-change-prufgrund').fill('Fachlich geprüft');
  await review.getByRole('button', { name: 'Wert übernehmen', exact: true }).click();
  await review.getByRole('button', { name: 'Geprüfte Änderung übernehmen', exact: true }).click();
  await expect(review).not.toBeVisible();
  const saved = await (await request.get(`/api/testing/scenarios/${setup.scenario.id}`)).json();
  expect(saved.blocks[0].inputs.prufgrund).toBe('Fachlich geprüft');
});

test('Ein entferntes belegtes Feld wird nur nach ausdrücklichem Verwerfen übernommen', async ({ page, request }) => {
  const setup = await defaultFixture(request, randomUUID().slice(0, 8), { status: 'Eigener Wert' });
  await page.goto('/testing/library');
  await page.getByLabel('Blockbibliothek durchsuchen').fill(setup.definition.name);
  await page.locator('.t-definition-card').click();
  await page.getByRole('button', { name: 'Definition aktualisieren', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Gemeinsame Blockdefinition aktualisieren', exact: true });
  await editor.getByRole('button', { name: 'Eingabe 1 entfernen', exact: true }).click();
  await editor.getByRole('button', { name: 'Definition aktualisieren', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Änderung der Blockdefinition prüfen', exact: true });
  await expect(review).toContainText('entfernt');
  await expect(review.getByRole('button', { name: 'Geprüfte Änderung übernehmen', exact: true })).toBeDisabled();
  await review.getByRole('button', { name: 'Bisherigen Feldwert geprüft verwerfen', exact: true }).click();
  await expect(review.getByRole('button', { name: 'Geprüfte Änderung übernehmen', exact: true })).toBeEnabled();
  await review.getByRole('button', { name: 'Geprüfte Änderung übernehmen', exact: true }).click();
  const saved = await (await request.get(`/api/testing/scenarios/${setup.scenario.id}`)).json();
  expect(saved.blocks[0].inputs).not.toHaveProperty('status');
});

test('Eine veraltete Vorschau verändert weder Definition noch zwischenzeitlich gespeicherten Testfall', async ({ request }) => {
  const setup = await defaultFixture(request, randomUUID().slice(0, 8));
  const definition = { ...setup.definition, version: '1.0.1', supersedes: { id: setup.definition.id, version: setup.definition.version }, inputs: [{ ...setup.definition.inputs[0], default: 'Neuer Standard' }] };
  const defaultDecisions = { [`${setup.scenario.id}:status-pruefen:status`]: 'neuen-standard-uebernehmen' };
  const previewResponse = await request.post('/api/testing/definitions/change-preview', { data: { definition, defaultDecisions } });
  expect(previewResponse.ok()).toBeTruthy();
  const preview = await previewResponse.json();
  expect(preview.blocked).toBeFalsy();

  const changedTitle = `${setup.scenario.title} – zwischenzeitlich geändert`;
  const changedResponse = await request.put(`/api/testing/scenarios/${setup.scenario.id}`, { data: { ...setup.scenario, title: changedTitle, expectedRevision: setup.scenario.revision } });
  expect(changedResponse.ok()).toBeTruthy();
  const apply = await request.post('/api/testing/definitions/change-apply', { data: { definition, defaultDecisions, previewId: preview.id } });
  expect(apply.status()).toBe(409);

  const catalog = await (await request.get('/api/testing/catalog')).json();
  expect(catalog.definitions.some((item: any) => item.id === definition.id && item.version === definition.version)).toBeFalsy();
  const saved = await (await request.get(`/api/testing/scenarios/${setup.scenario.id}`)).json();
  expect(saved.title).toBe(changedTitle);
  expect(saved.blocks[0].inputs).not.toHaveProperty('status');
});

test('Eine bereits korrigierte Definition akzeptiert ihre echte Vorschlagsquelle trotz alter Referenzmarkierung', async ({ page, request }) => {
  const { scenario, definition } = await fixture(request);
  const corrected = { ...definition, id: `korrigierte.pruefung.${randomUUID()}`, version: '1.0.0', supersedes: undefined, inputs: [{ ...definition.inputs[0], type: 'proposal-ref', default: { ref: 'vorschlag', type: 'contract-ref' } }] };
  expect((await request.post('/api/testing/definitions', { data: { definition: corrected } })).ok()).toBeTruthy();
  const blocks = [scenario.blocks[0], { ...scenario.blocks[1], definition: { id: corrected.id, version: corrected.version }, inputs: { target: { ref: 'vorschlag', type: 'contract-ref' } } }];
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

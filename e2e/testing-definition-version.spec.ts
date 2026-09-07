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
async function correctDialog(page: Page) { const dialog = page.getByRole('dialog', { name: 'Eine neue Blockversion definieren', exact: true }); await dialog.getByLabel('Datentyp der Eingabe 1', { exact: true }).selectOption('proposal-ref'); await dialog.getByRole('button', { name: 'Definition speichern', exact: true }).click(); await expect(dialog).not.toBeVisible(); }

test('Eine Bibliothekskorrektur wird sichtbar angeboten und gezielt in die Verwendung übernommen', async ({ page, request }, testInfo) => {
  const { scenario, definition } = await fixture(request);
  await open(page, scenario.id);
  await page.locator('#testing-value-target').selectOption('vertrag');
  await workspaceNavigation(page, 'Blockbibliothek');
  await page.getByLabel('Blockbibliothek durchsuchen').fill(definition.name);
  await page.locator('.t-definition-card').click();
  await page.getByRole('button', { name: 'Neue Version bearbeiten', exact: true }).click();
  await correctDialog(page);
  await page.getByRole('link', { name: 'Testfall erstellen', exact: true }).click();
  await expect(page.locator('.t-inspector')).toContainText('Version 1.0.0');
  await openDetails(page, '.t-definition-version');
  await expect(page.getByLabel('Verwendete Blockversion', { exact: true })).toHaveValue('1.0.0');
  await page.getByLabel('Verwendete Blockversion', { exact: true }).selectOption('1.0.1');
  const picker = page.locator('#testing-value-target');
  await expect(picker.locator('option[value="vorschlag"]')).toHaveCount(1);
  await expect(picker.locator('option[value="vertrag"]')).toHaveCount(0);
  await picker.selectOption('vorschlag');
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Speichern', exact: true })).toBeDisabled();
  await page.reload();
  await page.getByRole('button', { name: 'Ablaufliste', exact: true }).click();
  await page.locator('.t-outline [data-block-path="pruefung"]').click();
  await openDetails(page, '.t-definition-version');
  await expect(page.getByLabel('Verwendete Blockversion', { exact: true })).toHaveValue('1.0.1');
  await expect(picker).toHaveValue('vorschlag');
  const compiled = await (await request.get(`/api/testing/scenarios/${scenario.id}/compile`)).json();
  expect(compiled.issues.filter((issue: any) => issue.field === 'target')).toEqual([]);
  const catalog = await (await request.get('/api/testing/catalog')).json();
  expect(catalog.definitions.find((item: any) => item.id === definition.id && item.version === '1.0.0').inputs[0].type).toBe('contract-ref');
  await picker.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('korrigierte-blockversion-picker.png') });
});

test('Eine Korrektur im Inspector aktualisiert nur die ausdrücklich bearbeitete Verwendung', async ({ page, request }) => {
  const { scenario, definition } = await fixture(request);
  const second = { ...scenario.blocks[1], id: 'historische-pruefung' };
  expect((await request.put(`/api/testing/scenarios/${scenario.id}`, { data: { ...scenario, blocks: [...scenario.blocks, second], expectedRevision: scenario.revision } })).ok()).toBeTruthy();
  await open(page, scenario.id);
  await page.getByRole('button', { name: 'Blockdefinition bearbeiten', exact: true }).click();
  await correctDialog(page);
  await openDetails(page, '.t-definition-version');
  await expect(page.getByLabel('Verwendete Blockversion', { exact: true })).toHaveValue('1.0.1');
  await page.locator('#testing-value-target').selectOption('vorschlag');
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Speichern', exact: true })).toBeDisabled();
  const saved = await (await request.get(`/api/testing/scenarios/${scenario.id}`)).json();
  expect(saved.blocks[1]).toMatchObject({ definition: { id: definition.id, version: '1.0.1' }, inputs: { target: { ref: 'vorschlag', type: 'proposal-ref' } } });
  expect(saved.blocks[2]).toMatchObject({ definition: { id: definition.id, version: '1.0.0' }, inputs: { target: { ref: 'vertrag', type: 'contract-ref' } } });
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

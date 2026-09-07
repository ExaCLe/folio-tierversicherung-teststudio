import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { TestingCatalog, TestingScenario } from '../../shared/testing';
import { flattenBlocks } from '../../src/testing/model';
import { buildValueChanges, changesWithin } from '../../src/testing/valueChanges';

const catalog: TestingCatalog = { definitions: JSON.parse(readFileSync('catalog/agriculture/definitions.json', 'utf8')), bindings: [], knowledge: [], revision: 'test' };
const seed = () => JSON.parse(readFileSync('catalog/agriculture/scenarios.json', 'utf8'))[0] as TestingScenario;

test('Parameteränderungen und wirksame Unterblock-Overrides werden gegen die Bibliotheksversion verglichen', () => {
  const scenario = seed();
  scenario.blocks[0].inputs.customerName = 'QA Kundin';
  scenario.blocks[0].overrides = { betrieb: { state: 'Bayern' } };
  const snapshot = JSON.stringify({ scenario, catalog });
  const result = buildValueChanges(flattenBlocks(scenario.blocks, catalog), catalog);
  const changes = changesWithin(result.changes, scenario.blocks[0].id);
  const sum = changes.find(change => change.path.endsWith('/tier') && change.field === 'sumInsured');
  assert.equal(sum?.before, 3500);
  assert.equal(sum?.after, 15000);
  assert.equal(sum?.afterLabel, '15.000 EUR');
  const state = changes.find(change => change.path.endsWith('/betrieb') && change.field === 'state');
  assert.equal(state?.before, 'Niedersachsen');
  assert.equal(state?.after, 'Bayern');
  assert.equal(changes.find(change => change.path.endsWith('/kunde') && change.field === 'name')?.after, 'QA Kundin');
  assert.equal(JSON.stringify({ scenario, catalog }), snapshot);
});

test('Gespeicherte gleiche Werte sind keine Abweichung; überschriebene Parameter werden nur wirksam angezeigt', () => {
  const scenario = seed();
  scenario.blocks[0].inputs.sumInsured = 3500;
  scenario.blocks[0].overrides = { betrieb: { state: 'Niedersachsen' }, tier: { sumInsured: 3500 } };
  const result = buildValueChanges(flattenBlocks(scenario.blocks, catalog), catalog);
  assert.deepEqual(changesWithin(result.changes, scenario.blocks[0].id), []);
  scenario.blocks[0].inputs.sumInsured = 15000;
  const changed = changesWithin(buildValueChanges(flattenBlocks(scenario.blocks, catalog), catalog).changes, scenario.blocks[0].id);
  assert.equal(changed.some(change => change.path.endsWith('/tier') && change.field === 'sumInsured'), false);
  assert.equal(changed.some(change => change.path === scenario.blocks[0].id && change.field === 'sumInsured'), true);
});

test('Materialisierte Kinder werden gegen den unveränderten Definitionskörper verglichen', () => {
  const scenario = seed();
  const definition = catalog.definitions.find(item => item.id === scenario.blocks[0].definition.id)!;
  scenario.blocks[0].inputs.sumInsured = 3500;
  scenario.blocks[0].children = structuredClone(definition.body!);
  scenario.blocks[0].children.find(child => child.id === 'betrieb')!.inputs.state = 'Bayern';
  const result = changesWithin(buildValueChanges(flattenBlocks(scenario.blocks, catalog), catalog).changes, scenario.blocks[0].id);
  assert.equal(result.length, 1);
  assert.equal(result[0].field, 'state');
  assert.equal(result[0].before, 'Niedersachsen');
  assert.equal(result[0].after, 'Bayern');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { TestingBlockDefinition, TestingBlockInstance, TestingCatalog, TestingScenario } from '../../shared/testing';
import { flattenBlocks } from '../../src/testing/model';
import { buildReferenceIndex, describeReference, referenceChoices } from '../../src/testing/references';
import { compileTestingScenario } from './compiler';

const definitions = JSON.parse(readFileSync('catalog/agriculture/definitions.json', 'utf8')) as TestingBlockDefinition[];
const catalog: TestingCatalog = { definitions, bindings: [], knowledge: [], revision: 'test' };
const seeds = JSON.parse(readFileSync('catalog/agriculture/scenarios.json', 'utf8')) as TestingScenario[];
const block = (id: string, definition: string, inputs: TestingBlockInstance['inputs'] = {}, outputs?: Record<string, string>): TestingBlockInstance => ({ id, definition: { id: definition, version: '1.0.0' }, inputs, outputs });
const indexFor = (blocks: TestingBlockInstance[], parameters: TestingScenario['parameters'] = {}, c = catalog) => buildReferenceIndex(flattenBlocks(blocks, c), parameters);

test('Referenzanzeige stimmt bei wiederholten Bausteinen mit kompilierten Quellen überein', () => {
  const blocks = [block('eins', 'ablauf.kuh-vorschlag', { customerName: 'Klara Nord' }), block('zwei', 'ablauf.kuh-vorschlag', { customerName: 'Mara Süd' }), block('danach', 'angebot.berechnen', { proposalId: { ref: 'zwei.proposal' } })];
  const index = indexFor(blocks);
  const compiled = compileTestingScenario({ ...seeds[0], blocks }, catalog);
  for (const path of ['eins/betrieb', 'zwei/betrieb', 'danach']) {
    const input = path === 'danach' ? 'proposalId' : 'customerId';
    const resolved = describeReference(index, path, index.inputs.get(path)?.[input]);
    assert.equal(resolved.status, 'available');
    assert.equal(resolved.source?.key, (compiled.steps.find(step => step.path === path)?.inputs[input] as { ref: string }).ref);
  }
  assert.match(describeReference(index, 'zwei/betrieb', { ref: 'kunde' }).label, /Kunde „Mara Süd“.*Schritt 2\.1/);
  assert.equal(referenceChoices(index, 'danach', 'customer-ref').some(source => source.value === 'kunde'), false);
  assert.equal(referenceChoices(index, 'zwei/kunde', 'customer-ref').some(source => source.sourcePath === 'zwei/kunde'), false);
});

test('Nur vorherige Quellen des passenden Typs sind auswählbar; feste Werte bleiben feste Werte', () => {
  const index = indexFor([block('vorher', 'kunde.anlegen', {}, { customer: 'kunde' }), block('betrieb', 'betrieb.anlegen'), block('spaeter', 'kunde.anlegen', {}, { customer: 'zukuenftig' })]);
  assert.deepEqual(referenceChoices(index, 'betrieb', 'customer-ref').map(source => source.value), ['kunde']);
  assert.equal(describeReference(index, 'betrieb', { ref: 'zukuenftig' }, 'customer-ref').status, 'future');
  assert.equal(describeReference(index, 'betrieb', { ref: 'kunde' }, 'policy-ref').status, 'type');
  assert.equal(describeReference(index, 'betrieb', 'kunde', 'customer-ref').status, 'literal');
  assert.equal(describeReference(index, 'betrieb', { ref: 'externe-id' }, 'customer-ref').status, 'missing');
  assert.equal(describeReference(index, 'betrieb', { ref: 'spaeter::customer' }, 'customer-ref').status, 'future');
});

test('Workflow-Parameter behalten ihre Quelle, obwohl im inneren Ablauf gleiche Aliasse vorkommen', () => {
  const workflow: TestingBlockDefinition = { ...definitions.find(item => item.id === 'ablauf.kuh-vorschlag')!, id: 'workflow.parameter', inputs: [{ key: 'customer', label: 'Kunde', type: 'customer-ref' }], outputs: [], body: [block('lokal', 'kunde.anlegen', { name: 'Lokaler Kunde' }, { customer: 'kunde' }), block('betrieb', 'betrieb.anlegen', { customerId: { param: 'customer' } })], exports: {} };
  const c = { ...catalog, definitions: [...definitions, workflow] };
  const blocks = [block('extern', 'kunde.anlegen', { name: 'Externer Kunde' }, { customer: 'aussen' }), block('verwendung', workflow.id, { customer: { ref: 'aussen' } })];
  const index = indexFor(blocks, {}, c);
  const source = describeReference(index, 'verwendung/betrieb', index.inputs.get('verwendung/betrieb')?.customerId);
  assert.equal(source.source?.sourcePath, 'extern');
  assert.match(source.label, /Externer Kunde/);
  assert.equal(describeReference(index, 'verwendung/betrieb', { ref: 'kunde' }).source?.sourcePath, 'verwendung/lokal');
});

test('Rollenbereiche übernehmen nur neue Aliasse, Workflow-Ausgänge erst nach dem vollständigen Körper', () => {
  const role = block('rolle', 'rolle.als');
  role.children = [block('innerer', 'kunde.anlegen', { name: 'Innen' }, { customer: 'kunde' }), block('zweiter', 'kunde.anlegen', {}, { customer: 'neu' })];
  const blocks = [block('aussen', 'kunde.anlegen', { name: 'Außen' }, { customer: 'kunde' }), role, block('danach', 'betrieb.anlegen')];
  const index = indexFor(blocks);
  assert.equal(describeReference(index, 'danach', { ref: 'kunde' }).source?.sourcePath, 'aussen');
  assert.equal(describeReference(index, 'danach', { ref: 'neu' }).source?.sourcePath, 'rolle/zweiter');
  const workflowIndex = indexFor([block('workflow', 'ablauf.kuh-vorschlag')]);
  assert.equal(referenceChoices(workflowIndex, 'workflow/kunde').some(source => source.value === 'workflow.customer'), false);
});

test('Globale Parameter, lokale Änderungen und Listen liefern verständliche Namen ohne Mutationen', () => {
  const blocks = [block('kunde', 'kunde.anlegen', { name: { param: 'name' } }, { customer: 'kunde' }), block('betrieb', 'betrieb.anlegen', { customerId: { param: 'kundeParam' } }), block('workflow', 'ablauf.kuh-vorschlag')];
  blocks[2].overrides = { kunde: { name: 'Geänderter Name' } };
  const original = JSON.stringify(blocks);
  const index = indexFor(blocks, { name: 'Globaler Name', kundeParam: { ref: 'kunde' } });
  assert.match(describeReference(index, 'betrieb', index.inputs.get('betrieb')?.customerId).label, /Globaler Name/);
  assert.match(describeReference(index, 'workflow/betrieb', index.inputs.get('workflow/betrieb')?.customerId).label, /Geänderter Name/);
  assert.equal(JSON.stringify(blocks), original);
});

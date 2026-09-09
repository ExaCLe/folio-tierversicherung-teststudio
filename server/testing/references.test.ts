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

test('Ein Rollenbereich ohne ausdrückliche Rolle ist ungültig und erbt keinen Vermittler', () => {
  const role = block('rolle', 'rolle.als');
  role.children = [block('kunde', 'kunde.anlegen')];
  const compiled = compileTestingScenario({ ...structuredClone(seeds[0]), blocks: [role] }, catalog);
  assert(compiled.issues.some(issue => issue.code === 'INPUT_REQUIRED' && issue.path === 'rolle' && issue.field === 'role'));
  assert.equal(compiled.valid, false);
  assert.equal(compiled.steps[0].actor, '');
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

const { migrateDefinition } = await import('../../src/testing/definitionMigration');
const { loadTestingSourceCatalog } = await import('./catalog');
const { testingFingerprint } = await import('./compiler');
function migrationFixture(nested = false) {
  const c = loadTestingSourceCatalog();
  const base = c.definitions.find(item => item.id === 'pruefung.vorschlagsstatus')!;
  const before: TestingBlockDefinition = { ...structuredClone(base), id: 'fixture.pruefung', name: 'Korrigierbare Prüfung', inputs: [{ key: 'proposalId', label: 'Vorschlag', type: 'contract-ref', required: true }], version: '1.0.0' };
  const after: TestingBlockDefinition = { ...structuredClone(before), version: '1.0.1', supersedes: { id: before.id, version: before.version }, inputs: [{ ...before.inputs[0], type: 'proposal-ref' }] };
  c.definitions.push(before, after);
  const target = block('pruefung', before.id, { proposalId: { ref: 'vorschlag', type: 'contract-ref' } });
  const blocks = [block('vorbereitung', 'ablauf.kuh-vorschlag', {}, { proposal: 'vorschlag' }), ...(nested ? [{ ...block('rolle', 'rolle.als', { role: 'Vermittler' }), children: [target] }] : [target])];
  return { c, before, after, target, blocks, path: nested ? 'rolle/pruefung' : 'pruefung', scenario: { ...structuredClone(seeds[0]), blocks } };
}

test('Expliziter Versionswechsel verwendet neuen Feldtyp und behält Referenz sowie alte Version', () => {
  const { c, after, blocks, path, scenario } = migrationFixture();
  const beforeJSON = JSON.stringify({ c, blocks }), fingerprint = testingFingerprint(scenario, c);
  const compiledBefore = compileTestingScenario(scenario, c);
  assert(compiledBefore.issues.some(issue => issue.code === 'INPUT_REFERENCE_TYPE'));
  const migrated = migrateDefinition(blocks, path, c, after);
  assert.deepEqual(migrated[1].inputs.proposalId, blocks[1].inputs.proposalId);
  assert.equal(migrated[1].definition.version, '1.0.1');
  const compiledAfter = compileTestingScenario({ ...scenario, blocks: migrated }, c);
  assert.equal(compiledAfter.valid, true, JSON.stringify(compiledAfter.issues));
  const index = indexFor(migrated, {}, c);
  assert.equal(describeReference(index, path, index.inputs.get(path)!.proposalId, 'proposal-ref').status, 'available');
  assert.deepEqual(referenceChoices(index, path, 'proposal-ref').map(source => source.value), ['vorschlag']);
  assert.equal(JSON.stringify({ c, blocks }), beforeJSON);
  assert.equal(testingFingerprint(scenario, c), fingerprint);
  assert.equal(flattenBlocks(blocks, c).find(entry => entry.path === path)!.definition!.inputs[0].type, 'contract-ref');
});

test('Tatsächlich falsche Quelle wird bei Versionswechsel weder umgebunden noch passend markiert', () => {
  const { c, after, blocks, path, scenario } = migrationFixture();
  blocks[0] = block('vorbereitung', 'ablauf.kuh-standardvertrag', {}, { contract: 'vertrag' });
  blocks[1].inputs.proposalId = { ref: 'vertrag', type: 'contract-ref' };
  const migrated = migrateDefinition(blocks, path, c, after);
  assert.deepEqual(migrated[1].inputs.proposalId, blocks[1].inputs.proposalId);
  const issue = compileTestingScenario({ ...scenario, blocks: migrated }, c).issues.find(item => item.code === 'INPUT_REFERENCE_TYPE' && item.path === path);
  assert(issue); assert.match(issue.message, /Vertrag/); assert.match(issue.message, /Versicherungsvorschlag/);
});

test('Veralteter Definitionsdefault wird korrekt aufgelöst und bleibt ohne neuen lokalen Override geerbt', () => {
  const { c, after, blocks, path, scenario } = migrationFixture();
  after.inputs[0].default = { ref: 'vorschlag', type: 'contract-ref' };
  blocks[1].inputs = {};
  blocks.push({ ...structuredClone(blocks[1]), id: 'andere-verwendung' });
  const original = JSON.stringify({ c, blocks });
  const migrated = migrateDefinition(blocks, path, c, after);
  assert.deepEqual(migrated[1].inputs.proposalId, blocks[1].inputs.proposalId);
  assert.deepEqual(migrated[2], blocks[2]);
  assert.equal(Object.hasOwn(migrated[1].inputs,'proposalId'),false);
  assert.deepEqual(after.inputs[0].default, { ref: 'vorschlag', type: 'contract-ref' });
  assert(!compileTestingScenario({ ...scenario, blocks: migrated }, c).issues.some(issue => issue.path === path && ['REFERENCE_TYPE', 'INPUT_REFERENCE_TYPE'].includes(issue.code)));
  assert.equal(JSON.stringify({ c, blocks }), original);
});

test('Vererbter Block und äußerer Override werden gezielt migriert, andere Workflownutzung bleibt unverändert', () => {
  const { c, before, after, blocks, scenario } = migrationFixture();
  const workflow: TestingBlockDefinition = { ...structuredClone(c.definitions.find(item => item.kind === 'workflow')!), id: 'fixture.container', inputs: [], outputs: [], exports: {}, body: [block('pruefung', before.id, { proposalId: { ref: 'vorschlag', type: 'contract-ref' } })] };
  c.definitions.push(workflow);
  const first = { ...block('eins', workflow.id), overrides: { pruefung: { proposalId: { ref: 'vorschlag', type: 'contract-ref' as const } } } };
  blocks.splice(1, 1, first, { ...structuredClone(first), id: 'zwei' });
  const original = JSON.stringify({ c, blocks });
  const migrated = migrateDefinition(blocks, 'eins/pruefung', c, after);
  assert.equal(migrated[1].children![0].definition.version, after.version);
  assert.deepEqual(migrated[1].overrides!.pruefung.proposalId, first.overrides.pruefung.proposalId);
  assert.deepEqual(migrated[2], blocks[2]);
  assert.equal(workflow.body![0].definition.version, before.version);
  assert(!compileTestingScenario({ ...scenario, blocks: migrated }, c).issues.some(issue => issue.path === 'eins/pruefung' && ['REFERENCE_TYPE', 'INPUT_REFERENCE_TYPE'].includes(issue.code)));
  assert.equal(JSON.stringify({ c, blocks }), original);
});

test('Verschachteltes Referenzfeld unter mehreren Overrides löst den tatsächlich wirksamen Wert auf', () => {
  const { c, before, after, blocks, scenario } = migrationFixture();
  before.inputs = [{ key: 'details', label: 'Details', type: 'object', fields: [{ key: 'proposalId', label: 'Vorschlag', type: 'contract-ref' }] }];
  after.inputs = [{ ...structuredClone(before.inputs[0]), fields: [{ ...before.inputs[0].fields![0], type: 'proposal-ref' }] }];
  const target = block('pruefung', before.id, { details: { proposalId: { ref: 'vorschlag', type: 'contract-ref' }, extra: 'Erhalten' } });
  const inner = { ...block('innen', 'rolle.als', { role: 'Vermittler' }), children: [target], overrides: { pruefung: { details: { proposalId: { ref: 'unwirksam', type: 'contract-ref' as const } } } } };
  c.definitions.push({ ...structuredClone(c.definitions.find(item=>item.id==='rolle.als')!), id: 'fixture.aussere-rolle' });
  const outer = { ...block('aussen', 'fixture.aussere-rolle', { role: 'Vermittler' }), children: [inner], overrides: { 'innen/pruefung': { details: { proposalId: { ref: 'vorschlag', type: 'contract-ref' as const } } } } };
  blocks.splice(1, 1, outer);
  const migrated = migrateDefinition(blocks, 'aussen/innen/pruefung', c, after);
  assert.deepEqual(migrated[1].overrides!['innen/pruefung'].details, outer.overrides['innen/pruefung'].details);
  assert.deepEqual(migrated[1].children![0].overrides, inner.overrides);
  assert.deepEqual(migrated[1].children![0].children![0].inputs, target.inputs);
  assert(!compileTestingScenario({ ...scenario, blocks: migrated }, c).issues.some(issue => issue.path === 'aussen/innen/pruefung' && ['REFERENCE_TYPE', 'INPUT_REFERENCE_TYPE'].includes(issue.code)));
});

test('Parameterbindung bleibt erhalten und die konsumierende Felddefinition bestimmt den Typ', () => {
  const { c, after, blocks, path, scenario } = migrationFixture();
  blocks[1].inputs.proposalId = { param: 'auswahl' };
  const parameters = { auswahl: { ref: 'vorschlag', type: 'contract-ref' as const } }, original = JSON.stringify(parameters);
  const migrated = migrateDefinition(blocks, path, c, after, parameters);
  assert.deepEqual(migrated[1].inputs.proposalId, { param: 'auswahl' });
  assert.equal(JSON.stringify(parameters), original);
  const issues = compileTestingScenario({ ...scenario, blocks: migrated, parameters }, c).issues;
  assert(!issues.some(issue => ['REFERENCE_TYPE','INPUT_REFERENCE_TYPE'].includes(issue.code) && issue.path === path));
  const index=indexFor(migrated,parameters,c);assert.equal(describeReference(index,path,index.inputs.get(path)!.proposalId,'proposal-ref').status,'available');
});

test('Migration akzeptiert keine spätere oder fremde Quelle trotz passender Typmarkierung', () => {
  const { c, after, blocks, path, scenario } = migrationFixture();
  blocks.reverse();
  const migrated = migrateDefinition(blocks, path, c, after);
  assert.deepEqual(migrated[0].inputs.proposalId, { ref: 'vorschlag', type: 'contract-ref' });
  assert(compileTestingScenario({ ...scenario, blocks: migrated }, c).issues.some(issue => issue.code === 'REFERENCE_MISSING' && issue.path === path));
  assert.throws(() => migrateDefinition(blocks, 'fehlender/pfad', c, after), /ausgewählte Verwendung/);
});


test('Picker und Compiler prüfen Listenannotation weiterhin, skalares Schema normalisiert nur die Darstellung',()=>{
  const { c,after,blocks,path,scenario }=migrationFixture();const migrated=migrateDefinition(blocks,path,c,after),index=indexFor(migrated,{},c);
  const stale={ref:'vorschlag',type:'contract-ref' as const};
  assert.equal(describeReference(index,path,stale,'proposal-ref').status,'available');
  assert.equal(describeReference(index,path,stale).status,'type');
  assert.equal(describeReference(index,path,stale,'contract-ref',true).status,'type');
  assert.deepEqual(index.inputs.get(path)!.proposalId,compileTestingScenario({...scenario,blocks:migrated},c).steps.find(step=>step.path===path)!.inputs.proposalId);
});

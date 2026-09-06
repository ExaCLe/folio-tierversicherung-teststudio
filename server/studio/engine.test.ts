import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BlockDefinition, BlockInstance, RunRecord, Scenario, TextResolution } from '../../shared/blocks';
import { compileScenario, confirmInterpretation, interpretChange, validateScenario, StudioError } from './engine';
import { loadSeedScenarios, loadSourceCatalog } from './catalog';

const asOf = new Date('2026-09-06T12:00:00.000Z');
function visit(blocks: BlockInstance[], id: string): BlockInstance {
  for (const block of blocks) { if (block.id === id) return block; for (const children of [block.children, block.changes]) { if (!children) continue; try { return visit(children, id); } catch { /* Keep looking. */ } } }
  throw new Error(`Unknown block ${id}`);
}
function fixture(id = 'italy-referral'): { scenario: Scenario; resolutions: TextResolution[]; catalog: ReturnType<typeof loadSourceCatalog> } {
  const scenario = loadSeedScenarios().find(item => item.id === id)!, catalog = loadSourceCatalog(), resolutions: TextResolution[] = [];
  if (id === 'italy-referral') { const resolution = confirmInterpretation(interpretChange(scenario, 'warehouse-country-text', catalog), scenario, 'warehouse-country-text', catalog); resolutions.push(resolution); visit(scenario.blocks, 'warehouse-country-text').resolutionId = resolution.id; }
  return { scenario, catalog, resolutions };
}
test('all four independent seeds compile with exact dates and distinct business outcomes', () => {
  for (const id of ['standard-draft', 'italy-referral', 'mid-term-amendment', 'broker-approval-denied']) {
    const { scenario, ...options } = fixture(id), compiled = compileScenario(scenario, { ...options, asOf });
    assert.equal(compiled.validation.valid, true, id);
    assert.equal(compiled.resolvedConfigurations[0].configuration.inceptionDate, '2026-10-01');
    assert.equal(compiled.resolvedConfigurations[0].configuration.expiryDate, '2027-09-30');
    assert.ok(compiled.steps.length > 0);
    if (id === 'standard-draft') assert.deepEqual(compiled.steps.map(step => step.operation), ['createDraft', 'expectPolicy']);
    if (id === 'mid-term-amendment') { const amendment = compiled.steps.find(step => step.operation === 'amendPolicy')!; assert.equal(amendment.actor, 'Senior underwriter'); assert.equal(amendment.inputs.effectiveDate, '2026-11-01'); }
    if (id === 'broker-approval-denied') assert.deepEqual(compiled.steps.slice(-2).map(step => step.operation), ['attemptBrokerApproval', 'expectAccessDenied']);
  }
});
test('country interpretation updates only Warehouse and its full address before creation', () => {
  const { scenario, ...options } = fixture(), result = compileScenario(scenario, { ...options, asOf }).resolvedConfigurations[0];
  const warehouse = result.configuration.locations.find(location => location.name === 'Warehouse')!;
  assert.equal(warehouse.country, 'IT'); assert.deepEqual(warehouse.address, { line1: 'Via delle Officine 24', city: 'Milan', postcode: '20126' });
  assert.equal(result.configuration.customer.headquartersCountry, 'DE'); assert.equal(result.configuration.issuingMarket, 'DE'); assert.equal(result.configuration.locations[0].country, 'DE');
  assert.equal(result.defaults.locations[1].country, 'DE'); assert.deepEqual(result.referralLocations, ['Warehouse']);
});
test('unsupported or ambiguous text never guesses a change', () => {
  for (const text of ['Increase the coverage', 'Warehouse in France', 'Warehouse in Italy and delete Factory', 'Factory in Italy']) {
    const { scenario, catalog } = fixture(); visit(scenario.blocks, 'warehouse-country-text').inputs.text = text;
    assert.throws(() => interpretChange(scenario, 'warehouse-country-text', catalog), StudioError, text);
  }
});
test('supported amount vocabulary resolves explicit values and rejects contradictory values', () => {
  const { scenario, catalog } = fixture(), block = visit(scenario.blocks, 'warehouse-country-text');
  block.inputs.text = 'Set sum insured to EUR 2,000,000 and set flood limit to 1.5m';
  const result = interpretChange(scenario, block.id, catalog);
  assert.equal(result.changes.find(change => change.field.endsWith('sumInsured'))?.value, 2000000);
  assert.equal(result.changes.find(change => change.field.endsWith('Flood.limit'))?.value, 1500000);
  block.inputs.text = 'Warehouse in Italy and Warehouse in Germany';
  assert.throws(() => interpretChange(scenario, block.id, catalog), /conflicting values/);
});
test('confirmation binds exact text, location scope and full template content', () => {
  for (const mutation of ['text', 'scope', 'template'] as const) {
    const { scenario, ...options } = fixture();
    if (mutation === 'text') visit(scenario.blocks, 'warehouse-country-text').inputs.text = 'Warehouse in Germany';
    if (mutation === 'scope') visit(scenario.blocks, 'warehouse-scope').inputs.location = 'Factory';
    if (mutation === 'template') options.catalog.templates[0].configuration.locations[1].address.city = 'Berlin';
    const result = validateScenario(scenario, options);
    assert.ok(result.issues.some(issue => issue.code === 'STALE_TEXT_CONFIRMATION'), mutation);
  }
});
test('preview is not executable until explicit confirmation', () => {
  const { scenario, catalog } = fixture(), block = visit(scenario.blocks, 'warehouse-country-text');
  const resolution = interpretChange(scenario, block.id, catalog); block.resolutionId = resolution.id;
  assert.ok(validateScenario(scenario, { catalog, resolutions: [resolution] }).issues.some(issue => issue.code === 'UNCONFIRMED_TEXT'));
  block.inputs.text = 'Warehouse in Germany'; assert.throws(() => confirmInterpretation(resolution, scenario, block.id, catalog), /changed after preview/);
});
test('template overrides are legal but conflicting explicit modifiers fail', () => {
  const { scenario, ...options } = fixture(), scope = visit(scenario.blocks, 'warehouse-scope');
  scope.changes!.push({ id: 'conflicting-country', definition: { id: 'location.set-country', version: 1 }, inputs: { country: 'DE' } });
  assert.ok(validateScenario(scenario, options).issues.some(issue => issue.code === 'CONFLICTING_MODIFIERS'));
});
test('threshold applies per location and exactly EUR 500,000 avoids referral', () => {
  const { scenario, ...options } = fixture('standard-draft');
  visit(scenario.blocks, 'standard-create').changes = ['Factory', 'Warehouse'].map(name => ({ id: `scope-${name}`, definition: { id: 'context.location', version: 1 }, inputs: { location: name }, changes: [{ id: `flood-${name}`, definition: { id: 'location.add-flood', version: 1 }, inputs: { limit: 500000 } }] }));
  assert.deepEqual(compileScenario(scenario, options).resolvedConfigurations[0].referralLocations, []);
});
test('typed references and cross-policy location/quote mixups are rejected', () => {
  const { scenario, ...options } = fixture(); visit(scenario.blocks, 'approval').inputs.quote = { ref: 'warehouse' };
  assert.ok(validateScenario(scenario, options).issues.some(issue => issue.code === 'WRONG_REFERENCE_TYPE'));
  const { scenario: other, ...otherOptions } = fixture(); visit(other.blocks, 'approval').inputs.quote = { ref: 'does-not-exist' };
  assert.ok(validateScenario(other, otherOptions).issues.some(issue => issue.code === 'UNKNOWN_REFERENCE'));
});
test('ordinary approval needs senior role and affected-location survey; negative operation stays valid', () => {
  const { scenario, ...options } = fixture(); visit(scenario.blocks, 'underwriter').inputs.role = 'Broker';
  assert.ok(validateScenario(scenario, options).issues.some(issue => issue.code === 'ROLE_NOT_ALLOWED'));
  visit(scenario.blocks, 'underwriter').inputs.role = 'Senior underwriter'; visit(scenario.blocks, 'survey').inputs.location = { ref: 'factory' };
  assert.ok(validateScenario(scenario, options).issues.some(issue => issue.code === 'MISSING_SURVEY' && issue.message.includes('Warehouse')));
});
test('missing implementations and cyclic workflows are authoring failures', () => {
  const { scenario, ...options } = fixture('standard-draft'); options.catalog.implementations = [];
  assert.ok(validateScenario(scenario, options).issues.some(issue => issue.code === 'MISSING_IMPLEMENTATION'));
  const reuse = fixture('mid-term-amendment'), workflow = reuse.catalog.definitions.find(def => def.id === 'workflow.issue-referred')!;
  workflow.body = [{ id: 'recursive', definition: { id: workflow.id, version: 1 }, inputs: {}, outputs: { issuedPolicy: 'issuedPolicy', warehouse: 'warehouse', factory: 'factory', quote: 'quote' } }];
  assert.ok(validateScenario(reuse.scenario, reuse).issues.some(issue => issue.code === 'WORKFLOW_CYCLE'));
});
test('two workflow uses namespace private outputs and preserve distinct evidence paths', () => {
  const { scenario, ...options } = fixture('mid-term-amendment'); scenario.blocks = [scenario.blocks[0], structuredClone(scenario.blocks[0])];
  scenario.blocks[1].id = 'second-issued-start'; scenario.blocks[1].outputs = { issuedPolicy: 'secondPolicy', warehouse: 'secondWarehouse', factory: 'secondFactory', quote: 'secondQuote' };
  const compiled = compileScenario(scenario, options);
  assert.equal(new Set(compiled.steps.map(step => step.instanceId)).size, compiled.steps.length);
  assert.ok(compiled.steps.some(step => step.instanceId === 'second-issued-start/draft'));
  assert.notEqual(compiled.steps[0].outputs.policy, compiled.steps[6].outputs.policy);
});
test('source is deterministic, executable, and embeds the exact compiled plan', () => {
  const { scenario, ...options } = fixture(), a = compileScenario(scenario, { ...options, asOf }), b = compileScenario(scenario, { ...options, asOf });
  assert.equal(a.generatedSource, b.generatedSource); assert.equal(a.fingerprint, b.fingerprint);
  assert.match(a.generatedSource, /executeCompiledStep/); assert.match(a.generatedSource, /await test\.step/); assert.match(a.generatedSource, /FOLIO_REPLAY=1/); assert.match(a.generatedSource, /Via delle Officine 24/);
});
test('empty scenarios, malformed output maps and impossible calendar dates fail safely', () => {
  const { scenario, ...options } = fixture('standard-draft'); scenario.blocks = [];
  assert.ok(validateScenario(scenario, options).issues.some(issue => issue.code === 'EMPTY_SCENARIO'));
  const bad = fixture('standard-draft'); (visit(bad.scenario.blocks, 'standard-create') as any).outputs = null;
  assert.equal(validateScenario(bad.scenario, bad).valid, false);
  const date = fixture('mid-term-amendment'); visit(date.scenario.blocks, 'increase-inventory').inputs.effectiveDate = '2026-02-30';
  assert.ok(validateScenario(date.scenario, date).issues.some(issue => issue.code === 'INVALID_INPUT' && issue.field === 'effectiveDate'));
});

const temporary = mkdtempSync(join(tmpdir(), 'folio-studio-unit-'));
process.env.FOLIO_DATA_FILE = join(temporary, 'data.json');
const repository = await import('./repository');
const { db } = await import('../store');
repository.initializeStudio();
test.after(() => rmSync(temporary, { recursive: true, force: true }));
test('scenario saves retain prior revisions and reject stale editors', () => {
  const original = repository.duplicateScenario('standard-draft', 'Revision example');
  const updated = repository.saveScenario(original.id, { ...original, name: 'Updated name' });
  assert.equal(updated.revision, 2); assert.equal(repository.scenarioRevisions(original.id)[1].name, 'Revision example');
  assert.throws(() => repository.saveScenario(original.id, original), /now revision 2/);
});
test('promotion preserves confirmed text and creates a parameterized pinned workflow', () => {
  const source = repository.duplicateScenario('italy-referral', 'Promotion example');
  const result = repository.promoteSelection({ scenarioId: source.id, instanceIds: ['broker-draft', 'underwriter', 'broker-issue'], name: 'Reviewed referral reusable', parameters: [{ key: 'floodLimit', label: 'Flood limit', instanceId: 'warehouse-flood', input: 'limit' }], replaceSelection: true });
  assert.equal(result.scenario.blocks.length, 1); assert.equal(result.definition.inputs[0].key, 'floodLimit');
  const compiled = compileScenario(result.scenario, { catalog: repository.getCatalog(), resolutions: repository.allResolutions() });
  assert.equal(compiled.steps.length, 7); assert.equal(compiled.resolutionIds.length, 1);
  const changed = structuredClone(result.definition); changed.description = 'A new reviewed version.';
  const version = repository.publishVersion(changed.id, changed);
  assert.equal(version.definition.version, 2); assert.equal(repository.getScenario(source.id).blocks[0].definition.version, 1);
  assert.equal(repository.getCatalog().definitions.find(def => def.id === changed.id && def.version === 1)?.description, result.definition.description);
  const upgrade = repository.upgradeScenario(source.id, changed.id, 1, 2); assert.equal(upgrade.blocks[0].definition.version, 2);
});
test('publishing rejects self-cycles and malformed parameter contracts', () => {
  const original = repository.getCatalog().definitions.find(def => def.id === 'workflow.issue-referred')!;
  const cyclic: BlockDefinition = structuredClone(original); cyclic.body = [{ id: 'self', definition: { id: cyclic.id, version: 2 }, inputs: {}, outputs: { issuedPolicy: 'issuedPolicy', warehouse: 'warehouse', factory: 'factory', quote: 'quote' } }];
  assert.throws(() => repository.publishVersion(cyclic.id, cyclic), /cycle/);
  const malformed = structuredClone(original); (malformed.inputs[0] as any).type = 'Banana';
  assert.throws(() => repository.publishVersion(malformed.id, malformed), /supported value type/);
});
test('promoted external references still resolve inside another reusable workflow', () => {
  const scenario = repository.duplicateScenario('standard-draft', 'Nested external references');
  const actor = scenario.blocks[0];
  actor.children!.push({ id: 'request-after-draft', definition: { id: 'property.request-quote', version: 1 }, inputs: { policy: { ref: 'policy' } }, outputs: { quote: 'quote' } }, { id: 'straight-through-check', definition: { id: 'quote.expect-status', version: 1 }, inputs: { quote: { ref: 'quote' }, status: 'Quoted', reason: '' } });
  const saved = repository.saveScenario(scenario.id, scenario);
  const inner = repository.promoteSelection({ scenarioId: saved.id, instanceIds: ['request-after-draft', 'straight-through-check'], name: 'Quote an existing draft', parameters: [] });
  assert.equal(inner.definition.inputs[0].type, 'PolicyRef'); assert.deepEqual(inner.definition.inputs[0].default, { ref: 'policy' });
  const outer = repository.promoteSelection({ scenarioId: saved.id, instanceIds: ['standard-broker'], name: 'Draft with nested quote', parameters: [] });
  const compiled = compileScenario(outer.scenario, { catalog: repository.getCatalog(), resolutions: repository.allResolutions() });
  const creation = compiled.steps.find(step => step.operation === 'createDraft')!, quote = compiled.steps.find(step => step.operation === 'requestQuote')!;
  assert.deepEqual(quote.inputs.policy, { ref: creation.outputs.policy }); assert.equal(compiled.steps.length, 4);
  assert.ok(quote.ancestors.length >= 3); assert.ok(quote.instanceId.split('/').length >= 3);
});
test('malformed authoring requests fail with user errors instead of corrupting records', () => {
  assert.throws(() => repository.promoteSelection({ scenarioId: 'standard-draft', instanceIds: ['standard-broker'], name: 42, parameters: [] } as any), error => error instanceof StudioError && error.status === 400);
  assert.throws(() => repository.promoteSelection({ scenarioId: 'standard-draft', instanceIds: ['standard-broker'], name: 'Valid name', parameters: {} } as any), error => error instanceof StudioError && error.status === 400);
  assert.throws(() => repository.createScenario({ name: 'Malformed', blocks: null } as any), error => error instanceof StudioError && error.status === 400);
});
test('run graph points at the immutable executed revision after scenario edits', () => {
  const scenario = repository.duplicateScenario('standard-draft', 'Historical run');
  const compiled = compileScenario(scenario, { catalog: repository.getCatalog(), resolutions: repository.allResolutions() });
  const run: RunRecord = { id: 'run-history-test', scenarioId: scenario.id, scenarioName: scenario.name, scenarioRevision: 1, status: 'passed', startedAt: asOf.toISOString(), compiled, events: [], objectIds: {} };
  db.upsert(repository.collections.runs, run); repository.saveScenario(scenario.id, { ...scenario, name: 'Edited after run' });
  const graph = repository.dependencyGraph(scenario.id), link = graph.edges.find(edge => edge.source === 'run:run-history-test' && edge.relation === 'executed revision')!;
  assert.equal(link.target, `scenario:${scenario.id}@1`); assert.equal((graph.nodes.find(node => node.id === link.target)?.data as Scenario).name, 'Historical run');
  assert.ok(graph.nodes.some(node => node.id === `scenario:${scenario.id}@2`));
});

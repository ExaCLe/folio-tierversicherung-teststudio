import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestingAgentJob, TestingBlockDefinition, TestingReuseSuggestion, TestingRun, TestingScenario, TestingTechnicalBinding } from '../../shared/testing';

/** Route contract fixtures only. These tests neither invoke Codex nor claim real browser success. */
const temporary = mkdtempSync(join(tmpdir(), 'folio-testing-route-contract-'));
process.env.FOLIO_DATA_FILE = join(temporary, 'data.json');
process.env.FOLIO_AGENT_ARTIFACTS_ROOT = join(temporary, 'agent-artifacts');
process.env.FOLIO_TESTING_RUN_ROOT = join(temporary, 'run-artifacts');
process.env.FOLIO_AUTO_REUSE = '0';
process.env.FOLIO_CODEX_EXECUTABLE = join(temporary, 'intentionally-no-codex-executable');
const { db } = await import('../store');
const { createTestingRouter } = await import('./router');
const { getTestingCatalog, loadTestingSeedScenarios } = await import('./catalog');
const { compileTestingScenario, testingFingerprint } = await import('./compiler');
const repository = await import('./repository');
const { decodeReuse, REUSE_SCHEMA } = await import('./agents/schemas');
const router = createTestingRouter();
after(() => rmSync(temporary, { recursive: true, force: true }));

type RouteResponse<T = any> = { status: number; data: T };
async function request<T = any>(method: string, path: string, body: unknown = {}): Promise<RouteResponse<T>> {
  return new Promise((resolve, reject) => {
    const response = {
      statusCode: 200,
      status(code: number) { this.statusCode = code; return this; },
      json(data: T) { resolve({ status: this.statusCode, data: structuredClone(data) }); return this; },
    };
    router({ method, url: path, originalUrl: path, body, headers: {} } as never, response as never, (error?: unknown) => reject(error ?? new Error(`Kein Route-Handler für ${method} ${path}`)));
  });
}
const clone = <T>(value: T): T => structuredClone(value);
function scenarioFixture(id: string, source = 'kuh-police-drucken') {
  const base = loadTestingSeedScenarios().find(scenario => scenario.id === source)!;
  return repository.saveTestingScenario({ ...clone(base), id, title: `Vertragsfixture ${id}` }, 0);
}
function successfulRunFixture(scenario: TestingScenario, suffix: string) {
  const approval = repository.approveTestingScenario(scenario.id, scenario.revision, 'Vertragsfixture, keine reale Person');
  const compiled = compileTestingScenario(scenario, getTestingCatalog(), approval);
  assert.equal(compiled.valid, true);
  const run: TestingRun = { id: `fixture-run-${suffix}`, scenarioId: scenario.id, scenarioTitle: scenario.title, scenarioRevision: scenario.revision,
    status: 'passed', startedAt: '2026-09-06T10:00:00.000Z', finishedAt: '2026-09-06T10:00:01.000Z', compiled, steps: [],
    error: 'Nur gespeicherte Vertragsfixture; kein echter Browserlauf und kein KI-Nachweis.' };
  repository.saveTestingRun(run);
  return { approval, run };
}
function reuseFixture(scenario: TestingScenario, suffix: string, proposals: { id: string; parentPath?: string; instanceIds: string[]; name: string }[]) {
  const { approval, run } = successfulRunFixture(scenario, suffix);
  const suggestions: TestingReuseSuggestion[] = proposals.map(proposal => ({ ...proposal, scenarioId: scenario.id, scenarioRevision: scenario.revision,
    fingerprint: run.compiled.fingerprint, reason: 'Isolierter Vertragstest der verschachtelten Aufnahme.', parameters: [], status: 'suggested' }));
  repository.saveTestingRun({ ...run, reuseSuggestions: suggestions });
  const job: TestingAgentJob = { id: `fixture-reuse-${suffix}`, phase: 'reuse', model: 'luna', status: 'completed', prompt: 'Vertragsfixture ohne CLI-Aufruf.',
    scenarioId: scenario.id, scenarioRevision: scenario.revision, fingerprint: run.compiled.fingerprint, startedAt: run.startedAt, finishedAt: run.finishedAt, events: [], result: { runId: run.id, suggestions } };
  db.upsert('testingAgentJobs', job);
  return { approval, run, job, suggestions };
}

test('Schema und Decoder erhalten parentPath und erlauben ausdrücklich die oberste Ebene', () => {
  assert(REUSE_SCHEMA.properties.suggestions.items.properties.parentPath);
  const parsed = decodeReuse({ explanation: 'Vertragsfixture', suggestions: [
    { name: 'Verschachtelt', reason: '', parentPath: 'standard/vorbereiten', instanceIds: ['kunde', 'betrieb'], parameters: [] },
    { name: 'Oben', reason: '', parentPath: null, instanceIds: ['standard'], parameters: [] },
  ] });
  assert.equal(parsed.suggestions[0].parentPath, 'standard/vorbereiten');
  assert.equal(parsed.suggestions[1].parentPath, undefined);
});

test('Zwei verschachtelte Wiederverwendungsvorschläge werden einzeln angenommen und erhalten Fachstand sowie Laufhistorie', async () => {
  const scenario = scenarioFixture('verschachtelte-einzelannahmen');
  const { approval, run, job, suggestions } = reuseFixture(scenario, 'einzelannahmen', [
    { id: 'fixture-police', parentPath: 'sachbearbeitung', instanceIds: ['erneut', 'drucken'], name: 'Fixture erneute Police mit Druck' },
    { id: 'fixture-kunde-betrieb', parentPath: 'standard/vorbereiten', instanceIds: ['kunde', 'betrieb'], name: 'Fixture Kunde und Betrieb' },
  ]);
  const originalScenario = JSON.stringify(scenario), originalCompiled = JSON.stringify(run.compiled);
  const rejectedBatch = await request('POST', `/reuse/${job.id}/accept`, { proposalIds: suggestions.map(item => item.id) });
  assert.equal(rejectedBatch.status, 400);
  for (const suggestion of suggestions) {
    const result = await request('POST', `/reuse/${job.id}/accept`, { proposalIds: [suggestion.id] });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    const definition = result.data.definitions[0] as TestingBlockDefinition;
    assert.deepEqual(definition.body?.map(block => block.id), suggestion.instanceIds);
    assert.equal(repository.getTestingScenario(scenario.id).revision, scenario.revision);
    assert.equal(testingFingerprint(repository.getTestingScenario(scenario.id), getTestingCatalog()), run.compiled.fingerprint);
    assert.equal(repository.getTestingApproval(scenario.id)?.id, approval.id);
  }
  assert.equal(JSON.stringify(repository.getTestingScenario(scenario.id)), originalScenario);
  assert.equal(JSON.stringify(repository.getTestingRun(run.id).compiled), originalCompiled);
  assert.deepEqual(repository.getTestingRun(run.id).reuseSuggestions?.map(item => item.status), ['accepted', 'accepted']);
  assert.equal((db.find<TestingAgentJob>('testingAgentJobs', job.id)!.result as { suggestions: TestingReuseSuggestion[] }).suggestions.every(item => item.status === 'accepted'), true);
  const repeated = await request('POST', `/reuse/${job.id}/accept`, { proposalIds: [suggestions[0].id] });
  assert.equal(repeated.status, 409);
});

test('Wiederverwendung wird nach fachlicher Änderung ohne neue Veröffentlichung abgewiesen', async () => {
  const scenario = scenarioFixture('veraltete-wiederverwendung');
  const { job, suggestions } = reuseFixture(scenario, 'veraltet', [{ id: 'fixture-alt', parentPath: 'sachbearbeitung', instanceIds: ['erneut', 'drucken'], name: 'Soll nicht gespeichert werden' }]);
  repository.saveTestingScenario({ ...scenario, title: 'Fachlich geändert' }, scenario.revision);
  const before = readFileSync(process.env.FOLIO_DATA_FILE!, 'utf8');
  const result = await request('POST', `/reuse/${job.id}/accept`, { proposalIds: [suggestions[0].id] });
  assert.equal(result.status, 409); assert.equal(result.data.code, 'REUSE_STALE');
  assert.equal(readFileSync(process.env.FOLIO_DATA_FILE!, 'utf8'), before);
});

function duplicateFixture(id: string) {
  const base = getTestingCatalog().definitions.find(definition => definition.id === 'kunde.anlegen')!;
  const duplicate: TestingBlockDefinition = { ...clone(base), id: `fixture.kunde-${id}`, name: 'Gleichwertige Kundenanlage', origin: 'human' };
  repository.saveTestingDefinition(duplicate);
  const scenario = scenarioFixture(`dubletten-${id}`, 'kuh-direktionsanfrage');
  const workflow = getTestingCatalog().definitions.find(definition => definition.id === 'ablauf.kuh-vorschlag')!;
  const children = clone(workflow.body!);
  children[0].definition = { id: duplicate.id, version: duplicate.version };
  const nested = repository.saveTestingScenario({ ...scenario, blocks: [{ ...scenario.blocks[0], children }, ...scenario.blocks.slice(1)] }, scenario.revision);
  const { approval, run } = successfulRunFixture(nested, `dubletten-${id}`);
  const proposed = { id: duplicate.id, version: duplicate.version }, chosen = { id: base.id, version: base.version };
  const job: TestingAgentJob = { id: `fixture-duplicate-${id}`, phase: 'technical', model: 'sol', status: 'completed', prompt: 'Vertragsfixture ohne CLI-Aufruf.',
    scenarioId: nested.id, scenarioRevision: nested.revision, fingerprint: run.compiled.fingerprint, startedAt: run.startedAt, events: [],
    result: { needsBusinessReview: true, duplicateDecisions: [{ proposed, chosen, decision: 'reuse', compatible: true }] } };
  db.upsert('testingAgentJobs', job);
  return { scenario: nested, approval, run, job, proposed, chosen };
}

test('Die Dublettenroute ersetzt nach menschlicher Auswahl auch verschachtelte Verwendungen und verlangt neue Fachfreigabe', async () => {
  const fixture = duplicateFixture('verschachtelt');
  const originalCompiled = JSON.stringify(fixture.run.compiled);
  const result = await request('POST', `/jobs/${fixture.job.id}/resolve-duplicates`, { choices: [{ proposed: fixture.proposed, chosen: fixture.chosen }] });
  assert.equal(result.status, 200, JSON.stringify(result.data)); assert.equal(result.data.requiresApproval, true);
  const saved = repository.getTestingScenario(fixture.scenario.id);
  assert.equal(saved.revision, fixture.scenario.revision + 1); assert.deepEqual(saved.blocks[0].children?.[0].definition, fixture.chosen);
  const compiled = compileTestingScenario(saved, getTestingCatalog(), repository.getTestingApproval(saved.id));
  assert.equal(compiled.valid, true); assert.equal(compiled.executable, false); assert(compiled.issues.some(item => item.code === 'APPROVAL_STALE'));
  assert.equal(JSON.stringify(repository.getTestingRun(fixture.run.id).compiled), originalCompiled);
});

test('Nicht geprüfte oder veraltete Dublettenentscheidungen verändern den Fachablauf nicht', async () => {
  const fixture = duplicateFixture('ungueltig');
  const original = JSON.stringify(fixture.scenario);
  const unknown = await request('POST', `/jobs/${fixture.job.id}/resolve-duplicates`, { choices: [{ proposed: fixture.proposed, chosen: { id: 'tier.anlegen', version: '1.0.0' } }] });
  assert.equal(unknown.status, 400); assert.equal(JSON.stringify(repository.getTestingScenario(fixture.scenario.id)), original);
  repository.saveTestingScenario({ ...fixture.scenario, title: 'Neue Fassung' }, fixture.scenario.revision);
  const stale = await request('POST', `/jobs/${fixture.job.id}/resolve-duplicates`, { choices: [{ proposed: fixture.proposed, chosen: fixture.chosen }] });
  assert.equal(stale.status, 409);
});

test('Eine neue technische Bindungsrevision erhält Fachfreigabe und historischen Nachweis', async () => {
  const scenario = scenarioFixture('technische-revision', 'kuh-direktionsanfrage');
  const { approval, run } = successfulRunFixture(scenario, 'technische-revision');
  const originalCompiled = JSON.stringify(run.compiled);
  const previous = getTestingCatalog().bindings.filter(binding => binding.operation === 'createCustomer' && binding.status === 'ready').sort((a, b) => b.revision - a.revision)[0];
  const next: TestingTechnicalBinding = { ...clone(previous), revision: Math.max(...getTestingCatalog().bindings.filter(binding => binding.id === previous.id).map(binding => binding.revision)) + 1,
    name: 'Vertragsfixture einer Locator-Reparatur', changeReason: 'Nur Route-Vertrag, keine Behauptung eines erfolgreichen UI-Laufs.', createdAt: '2026-09-06T12:00:00Z' };
  const button = next.locators.find(locator => locator.method === 'role' && locator.role === 'button' && locator.value === 'Kunde speichern');
  assert(button); button.value = 'Kunde übernehmen';
  const result = await request('POST', '/bindings', { binding: next });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  const checked = await request('GET', `/scenarios/${scenario.id}/compile`);
  assert.equal(checked.data.fingerprint, approval.fingerprint); assert.equal(checked.data.executable, true);
  assert.equal(checked.data.bindings.find((binding: TestingTechnicalBinding) => binding.id === previous.id).revision, next.revision);
  assert.equal(JSON.stringify(repository.getTestingRun(run.id).compiled), originalCompiled);
  const impact = await request('GET', `/bindings/${previous.id}/impact`);
  assert(impact.data.historicalRuns.some((historical: { runId: string; bindingRevision: number }) => historical.runId === run.id && historical.bindingRevision === previous.revision));
});
test('Bearbeitete Wiederverwendung behält Name und Parameterauswahl beim Neuladen und besitzt eigenständige Defaults', async () => {
  const scenario = scenarioFixture('bearbeitete-wiederverwendung');
  const { run, job, suggestions } = reuseFixture(scenario, 'bearbeitete-wiederverwendung', [
    { id: 'fixture-bearbeitet', parentPath: 'standard/vorbereiten', instanceIds: ['kunde', 'betrieb'], name: 'Ursprünglicher KI-Vorschlag' },
  ]);
  const originalParameters = [
    { key: 'kundenname', label: 'Name des Kunden', instanceId: 'kunde', input: 'name' },
    { key: 'zugehoerigerKunde', label: 'Zugehöriger Kunde', instanceId: 'betrieb', input: 'customerId' },
    { key: 'bundesland', label: 'Bundesland', instanceId: 'betrieb', input: 'state' },
  ];
  suggestions[0].parameters = originalParameters;
  repository.saveTestingRun({ ...repository.getTestingRun(run.id), reuseSuggestions: suggestions });
  db.upsert('testingAgentJobs', { ...job, result: { runId: run.id, suggestions } });
  const chosenParameters = originalParameters.filter(parameter => parameter.key !== 'zugehoerigerKunde');
  const originalCompiled = JSON.stringify(run.compiled);
  const accepted = await request('POST', `/reuse/${job.id}/accept`, { proposalIds: [suggestions[0].id], edits: [{ id: suggestions[0].id, name: 'Menschlich geprüfte Kunden- und Betriebserfassung', parameters: chosenParameters }] });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.data));
  const definition = accepted.data.definitions[0] as TestingBlockDefinition;
  assert.equal(definition.inputs.find(input => input.key === 'kundenname')?.default, 'Johanna Bauer');
  assert.equal(definition.inputs.find(input => input.key === 'bundesland')?.default, 'Bayern');
  const standalone: TestingScenario = { ...scenario, id: 'unabhaengige-bibliotheksverwendung', parameters: undefined, blocks: [{ id: 'neuer-block', definition: { id: definition.id, version: definition.version }, inputs: {} }] };
  const compiled = compileTestingScenario(standalone, getTestingCatalog());
  assert.equal(compiled.valid, true, JSON.stringify(compiled.issues));
  assert.deepEqual(compiled.steps.find(step => step.operation === 'createFarm')?.inputs.customerId, { ref: 'neuer-block/kunde::customer', type: 'customer-ref' });
  const reloadedRun = await request('GET', `/runs/${run.id}`), reloadedJob = await request('GET', `/jobs/${job.id}`);
  for (const reloaded of [reloadedRun.data.reuseSuggestions[0], reloadedJob.data.result.suggestions[0]]) {
    assert.equal(reloaded.name, definition.name); assert.deepEqual(reloaded.parameters, chosenParameters); assert.equal(reloaded.status, 'accepted');
  }
  assert.equal(JSON.stringify(reloadedRun.data.compiled), originalCompiled);
  assert.equal(testingFingerprint(repository.getTestingScenario(scenario.id), getTestingCatalog()), run.compiled.fingerprint);
});

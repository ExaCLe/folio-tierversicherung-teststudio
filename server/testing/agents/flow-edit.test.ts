import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestingAgentJob, TestingBlockInstance, TestingBusinessDraft, TestingScenario, TestingScenarioEditProposal } from '../../../shared/testing';

// Synthetic CLI/route contract fixtures only: no model request or browser success claim.
const temporary = await mkdtemp(join(tmpdir(), 'folio-flow-edit-contract-'));
process.env.FOLIO_DATA_FILE = join(temporary, 'data.json');
process.env.FOLIO_AGENT_ARTIFACTS_ROOT = join(temporary, 'agents');
process.env.FOLIO_TESTING_RUN_ROOT = join(temporary, 'runs');
process.env.FOLIO_AUTO_REUSE = '0';
process.env.FOLIO_FLOW_FIXTURE = join(temporary, 'response.json');
process.env.FOLIO_CODEX_EXECUTABLE = join(temporary, 'synthetic-cli.mjs');
await writeFile(process.env.FOLIO_CODEX_EXECUTABLE, `#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
const args = process.argv.slice(2); for await (const chunk of process.stdin) {}
await new Promise(resolve => setTimeout(resolve, 100));
writeFileSync(args[args.indexOf('-o') + 1], readFileSync(process.env.FOLIO_FLOW_FIXTURE));
`, { mode: 0o700 });
const { db } = await import('../../store');
const repository = await import('../repository');
const { getTestingCatalog, loadTestingSeedScenarios } = await import('../catalog');
const { compileTestingScenario, testingFingerprint } = await import('../compiler');
const { startScenarioEditJob, getTestingJob, applyScenarioEditJob, dismissScenarioEditJob } = await import('./orchestrator');
const { decodeScenarioEdit, scenarioEditChanges, flowEntries } = await import('./flow-edit');
const { createTestingRouter } = await import('../router');
const router = createTestingRouter();
after(() => rm(temporary, { recursive: true, force: true }));
function fixture(id: string) {
  const base = structuredClone(loadTestingSeedScenarios().find(item => item.id === 'kuh-direktionsanfrage')!);
  return repository.saveTestingScenario({ ...base, id, parameters: { pruefwert: 'Direktionsprüfung' }, blocks: base.blocks.map(block => block.id === 'pruefung' ? { ...block, label: 'Meine Statuskontrolle', inputs: { ...block.inputs, expectedStatus: { param: 'pruefwert' } } } : block) }, 0);
}
function draftOf(scenario: TestingScenario): TestingBusinessDraft {
  return { title: scenario.title, expectedOutcome: scenario.expectedOutcome, blocks: structuredClone(scenario.blocks), knowledgeRefs: [...scenario.knowledgeRefs], newDefinitions: [], newKnowledge: [], explanation: 'Synthetischer Vorschlag ohne KI-Aufruf.', assumptions: [], openQuestions: [] };
}
function wireBlock(block: TestingBlockInstance): any {
  return { id: block.id, definition: block.definition, inputs: Object.entries(block.inputs).map(([key, value]) => ({ key, valueJson: JSON.stringify(value) })), outputs: Object.entries(block.outputs ?? {}).map(([key, name]) => ({ key, name })), childrenMode: block.children === undefined ? 'inherit' : 'replace', children: (block.children ?? []).map(wireBlock), overrides: Object.entries(block.overrides ?? {}).map(([path, values]) => ({ path, inputs: Object.entries(values).map(([key, value]) => ({ key, valueJson: JSON.stringify(value) })) })), note: block.note ?? '' };
}
const wireDraft = (draft: TestingBusinessDraft) => ({ ...draft, blocks: draft.blocks.map(wireBlock) });
async function completed(id: string) {
  for (let count = 0; count < 200; count++) {
    const job = getTestingJob(id);
    if (!['queued', 'running'].includes(job.status)) return job;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`Synthetischer Auftrag ${id} wurde nicht fertig.`);
}
async function proposal(scenario: TestingScenario, draft = draftOf(scenario)) {
  await writeFile(process.env.FOLIO_FLOW_FIXTURE!, JSON.stringify(wireDraft(draft)));
  const job = startScenarioEditJob({ scenarioId: scenario.id, revision: scenario.revision, model: 'luna', text: 'Bitte diesen Ablauf gezielt überarbeiten.' });
  const done = await completed(job.id); assert.equal(done.status, 'completed', done.error);
  return done;
}
function acceptance(job: TestingAgentJob) { return { jobId: job.id, expectedRevision: job.scenarioRevision!, fingerprint: job.fingerprint! }; }
async function request(method: string, path: string, body: unknown = {}): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => { const response = { statusCode: 200, status(code: number) { this.statusCode = code; return this; }, json(data: unknown) { resolve({ status: this.statusCode, data: structuredClone(data) }); return this; } };
    router({ method, url: path, originalUrl: path, body, headers: {} } as never, response as never, error => reject(error ?? new Error('Route fehlt'))); });
}

test('Gesamter Ablaufvorschlag bleibt unveröffentlicht; Übernahme erhält Identität, Parameter und historische Freigabe', async () => {
  const scenario = fixture('flow-preview');
  const approval = repository.approveTestingScenario(scenario.id, scenario.revision, 'Synthetische Freigabe');
  const draft = draftOf(scenario); draft.blocks.splice(1, 0, { id: 'vorher-pruefen', definition: { id: 'pruefung.vorschlagsstatus', version: '1.0.0' }, inputs: { proposalId: { ref: 'vorschlag' }, expectedStatus: 'Entwurf' } });
  const catalogBefore = JSON.stringify(getTestingCatalog());
  const job = await proposal(scenario, draft), value = job.result as TestingScenarioEditProposal;
  assert.equal(value.reviewStatus, 'pending'); assert.equal(value.applied, false); assert.equal(value.scope, 'scenario');
  assert.deepEqual(repository.getTestingScenario(scenario.id), scenario);
  assert.equal(JSON.stringify(getTestingCatalog()), catalogBefore);
  assert.equal(repository.getTestingApproval(scenario.id)!.id, approval.id);
  assert.deepEqual(value.changes.map(change => [change.kind, change.path]), [['add', 'vorher-pruefen']]);
  assert.equal(value.scenario.blocks.at(-1)!.label, 'Meine Statuskontrolle');
  assert.deepEqual(value.scenario.parameters, scenario.parameters);
  assert.equal(value.scenario.intent, scenario.intent);
  assert.equal(JSON.parse(await readFile(join(temporary, 'agents', job.id, 'validated-proposal.json'), 'utf8')).reviewStatus, 'pending');
  const adopted = await request('POST', `/jobs/${job.id}/apply-revision`, { expectedRevision: scenario.revision, fingerprint: job.fingerprint });
  assert.equal(adopted.status, 200); assert.equal(adopted.data.requiresApproval, true);
  assert.equal(adopted.data.scenario.id, scenario.id); assert.equal(adopted.data.scenario.revision, scenario.revision + 1);
  assert.equal(adopted.data.compiled.approval, undefined);
  assert.equal(repository.getTestingApproval(scenario.id)!.id, approval.id);
  assert.deepEqual((db.find<any>('testingScenarioRevisions', `${scenario.id}@${scenario.revision}`)).scenario, scenario);
  assert.equal((getTestingJob(job.id).result as TestingScenarioEditProposal).reviewStatus, 'applied');
  assert.throws(() => applyScenarioEditJob(acceptance(job)), /bereits übernommen/);
});

test('matrixMode keep erkennt Sollwerte einer gespeicherten Legacy-Matrix ohne role',async()=>{
  const scenario=fixture('flow-legacy-matrix');
  scenario.matrix={columns:[
    {id:'wert',label:'Versicherungssumme',target:{blockPath:'kuhvorschlag',inputPath:'sumInsured'},type:'money'},
    {id:'status',label:'Erwarteter Status',target:{blockPath:'pruefung',inputPath:'expectedStatus'},type:'choice'},
  ],rows:[
    {id:'fall-1',label:'10.000 EUR',enabled:true,values:{wert:10000,status:'Freigegeben'}},
    {id:'fall-2',label:'12.000 EUR',enabled:true,values:{wert:12000,status:'Direktionsprüfung'}},
  ]};
  const saved=repository.saveTestingScenario(scenario,scenario.revision),draft=draftOf(saved);
  draft.caseDesign={mode:'matrix',dimensions:['Versicherungssumme'],expectedCaseCount:2,expectedResults:['Freigegeben','Direktionsprüfung'],rationale:'Die bestehende Matrix bleibt unverändert.'};
  delete draft.matrix;
  const job=await proposal(saved,draft),value=job.result as TestingScenarioEditProposal;
  assert.equal(value.scenario.matrix?.rows.length,2);assert.deepEqual(value.scenario.matrix,saved.matrix);
});

test('Technische Fachlücke startet über die API einen geprüften Vorschlag auf der aktuellen Revision', async () => {
  const original = fixture('flow-technical-repair');
  const compiled = compileTestingScenario(original, getTestingCatalog());
  const affected = compiled.steps.find(step => Object.keys(step.inputs).length > 0)!;
  const issue = { kind: 'business-contract' as const, summary: 'Die freigegebene Erwartung kann im sicheren UI-Rezept nicht beobachtet werden.',
    affectedDefinitionRefs: [affected.definition], affectedInputKeys: [Object.keys(affected.inputs)[0]], blockPaths: [affected.path],
    suggestedBusinessRevision: 'Ersetze die nicht beobachtbare Erwartung durch eine fachlich gleichwertige sichtbare Prüfung.' };
  const source: TestingAgentJob = { id: 'fixture-technical-repair-source', phase: 'technical', model: 'sol', status: 'completed', prompt: 'Synthetische technische Prüfung.',
    scenarioId: original.id, scenarioRevision: original.revision, fingerprint: testingFingerprint(original, getTestingCatalog()), startedAt: original.createdAt, events: [],
    result: { plan: { unsupported: [issue] }, repairContext: { sourceJobId: 'fixture-technical-repair-source', scenarioId: original.id, scenarioRevision: original.revision,
      fingerprint: testingFingerprint(original, getTestingCatalog()), issues: [issue] } } };
  db.upsert('testingAgentJobs', source);
  const current = repository.saveTestingScenario({ ...original, title: 'Aktuelle fachliche Revision' }, original.revision);
  await writeFile(process.env.FOLIO_FLOW_FIXTURE!, JSON.stringify(wireDraft(draftOf(current))));
  const started = await request('POST', `/scenarios/${current.id}/jobs/${source.id}/revise-unsupported`, { issueIndex: 0, model: 'luna', instruction: 'Behalte die Rollenprüfung im Ablauf.' });
  assert.equal(started.status, 202, JSON.stringify(started.data));
  assert.equal(started.data.scenarioRevision, current.revision);
  const done = await completed(started.data.id), proposal = done.result as TestingScenarioEditProposal;
  assert.equal(done.status, 'completed', done.error); assert.equal(proposal.reviewStatus, 'pending'); assert.equal(proposal.applied, false);
  assert.equal(done.scenarioRevision, current.revision); assert.deepEqual(repository.getTestingScenario(current.id), current);
  assert.match(done.prompt, new RegExp(`Revision ${original.revision}`)); assert.match(done.prompt, new RegExp(`aktuelle gespeicherte Revision ${current.revision}`));
  assert.match(done.prompt, /Behalte die Rollenprüfung/);

  const other = fixture('flow-technical-repair-other');
  assert.equal((await request('POST', `/scenarios/${other.id}/jobs/${source.id}/revise-unsupported`, { issueIndex: 0, model: 'luna' })).status, 409);
  for (const [id, unsuitable] of [['legacy', 'Alte unstrukturierte Meldung'], ['capability', { ...issue, kind: 'technical-capability' }]] as const) {
    const job: TestingAgentJob = { ...source, id: `fixture-technical-${id}`, result: { repairContext: { sourceJobId: `fixture-technical-${id}`, scenarioId: current.id,
      scenarioRevision: current.revision, fingerprint: testingFingerprint(current, getTestingCatalog()), issues: [unsuitable] } } };
    db.upsert('testingAgentJobs', job);
    assert.equal((await request('POST', `/scenarios/${current.id}/jobs/${job.id}/revise-unsupported`, { issueIndex: 0, model: 'luna' })).status, 409);
  }
});

test('Verschachtelte lokale Einfügung und Reihenfolge werden ohne Änderung der gemeinsamen Definition geprüft', async () => {
  const scenario = fixture('flow-nested'), draft = draftOf(scenario), catalog = getTestingCatalog();
  const root = draft.blocks[0], definition = catalog.definitions.find(item => item.id === root.definition.id)!;
  root.children = structuredClone(definition.body!);
  const last = root.children.at(-1)!;
  root.children.push({ id: 'lokale-pruefung', definition: { id: 'pruefung.vorschlagsstatus', version: '1.0.0' }, inputs: { proposalId: { ref: Object.values(last.outputs!)[0] }, expectedStatus: 'Entwurf' } });
  const job = await proposal(scenario, draft), result = job.result as TestingScenarioEditProposal;
  assert(result.changes.some(change => change.path === `${root.id}/lokale-pruefung` && change.kind === 'add'));
  const saved = applyScenarioEditJob(acceptance(job)).scenario;
  assert.equal(saved.blocks[0].children![definition.body!.length].id, 'lokale-pruefung');
  assert.deepEqual(saved.blocks[0].inputs,scenario.blocks[0].inputs);assert.deepEqual(saved.blocks[0].outputs,scenario.blocks[0].outputs);
  for(let index=0;index<definition.body!.length;index++){assert.deepEqual(saved.blocks[0].children![index].inputs,definition.body![index].inputs);assert.deepEqual(saved.blocks[0].children![index].outputs??{},definition.body![index].outputs??{});}
  assert.deepEqual(getTestingCatalog().definitions.find(item => item.id === definition.id), definition);
  const independent = structuredClone(saved); independent.blocks.splice(2, 0, { ...structuredClone(independent.blocks.at(-1)!), id: 'weitere-pruefung' });
  const moved = structuredClone(independent); [moved.blocks[2], moved.blocks[3]] = [moved.blocks[3], moved.blocks[2]];
  assert(scenarioEditChanges(independent, moved, catalog).some(change => change.kind === 'move'));
  moved.blocks.splice(2, 1);
  assert(scenarioEditChanges(independent, moved, catalog).some(change => change.kind === 'remove'));
});

test('Explizit geleerter Workflow erbt nicht versehentlich wieder den Bibliotheksinhalt', () => {
  const scenario = fixture('flow-empty'), draft = draftOf(scenario); draft.blocks[0].children = [];
  const parsed = decodeScenarioEdit(wireDraft(draft));
  assert.deepEqual(parsed.blocks[0].children, []);
  assert.equal(flowEntries(parsed.blocks, getTestingCatalog()).filter(entry => entry.parent === parsed.blocks[0].id).length, 0);
  const changes = scenarioEditChanges(scenario, { ...scenario, blocks: parsed.blocks }, getTestingCatalog());
  assert(changes.some(change => change.kind === 'remove' && change.path.startsWith(`${scenario.blocks[0].id}/`)));
  const invalid = wireDraft(draft); invalid.blocks[0].childrenMode = 'inherit'; invalid.blocks[0].children = [wireBlock(draft.blocks[1])];
  assert.throws(() => decodeScenarioEdit(invalid), /inherit erlaubt keine lokalen/);
});

test('Veraltete Anforderung, Änderung während des Jobs und verspätete Übernahme sind gesperrt', async () => {
  const scenario = fixture('flow-stale');
  assert.throws(() => startScenarioEditJob({ scenarioId: scenario.id, revision: 0, text: 'Änderung prüfen', model: 'luna' }), /aktuelle gespeicherte/);
  const job = await proposal(scenario);
  assert.throws(() => applyScenarioEditJob({ ...acceptance(job), fingerprint: 'falsche-pruefung' }), /Ausgangsfassung/);
  repository.saveTestingScenario({ ...scenario, title: 'Inzwischen bearbeitet' }, scenario.revision);
  assert.throws(() => applyScenarioEditJob(acceptance(job)), /seit dem Änderungsvorschlag geändert/);
  const current = repository.getTestingScenario(scenario.id);
  await writeFile(process.env.FOLIO_FLOW_FIXTURE!, JSON.stringify(wireDraft(draftOf(current))));
  const active = startScenarioEditJob({ scenarioId: current.id, revision: current.revision, text: 'Parallel überarbeiten', model: 'luna' });
  repository.saveTestingScenario({ ...current, title: 'Während des Auftrags geändert' }, current.revision);
  const failed = await completed(active.id); assert.equal(failed.status, 'failed'); assert.match(failed.error!, /geändert/);
});

test('Verwerfen wird dauerhaft gespeichert und verhindert spätere Übernahme', async () => {
  const scenario = fixture('flow-dismiss'), job = await proposal(scenario);
  const dismissed = await request('POST', `/jobs/${job.id}/dismiss-revision`);
  assert.equal(dismissed.status, 200);
  assert.equal((getTestingJob(job.id).result as TestingScenarioEditProposal).reviewStatus, 'dismissed');
  assert.throws(() => applyScenarioEditJob(acceptance(job)), /verworfen/);
  assert.throws(() => dismissScenarioEditJob(job.id), /verworfen/);
  assert.deepEqual(repository.getTestingScenario(scenario.id), scenario);
});

test('Neue fachliche Definition und Wissen werden erst atomar mit dem geprüften Ablauf übernommen und bleiben technisch offen', async () => {
  const scenario = fixture('flow-new-definition'), catalog = getTestingCatalog(), draft = draftOf(scenario);
  const original = catalog.definitions.find(item => item.id === 'pruefung.vorschlagsstatus')!;
  const definition = { ...structuredClone(original), id: 'fixture.neue-pruefung', name: 'Synthetische neue Prüfung', semanticKey: 'fixture.checkNew', operation: 'fixtureCheckNew', bindingId: 'ui.fixtureCheckNew', origin: 'agent' as const, status: 'draft' as const };
  const knowledge = { ...structuredClone(catalog.knowledge[0]), id: 'fixture.neues-wissen', revision: 1, title: 'Synthetisches Wissen', definitionRefs: [{ id: definition.id, version: definition.version }], relatedKnowledge: [] };
  definition.knowledgeRefs = [knowledge.id]; draft.newKnowledge.push(knowledge);
  draft.newDefinitions.push(definition); draft.blocks.push({ id: 'neue-pruefung', definition: { id: definition.id, version: definition.version }, inputs: { proposalId: { ref: 'vorschlag' }, expectedStatus: 'Direktionsprüfung' } });
  const preview = repository.previewTestingScenarioEdit(scenario, draft, 'luna'); assert.equal(preview.compiled.valid, true);
  const persistedProposal = (id:string):TestingAgentJob => { const job:TestingAgentJob={ id, phase:'business',model:'luna',status:'completed',prompt:'Gespeicherte synthetische Prüffixture, keine Modellantwort.',scenarioId:scenario.id,scenarioRevision:scenario.revision,fingerprint:testingFingerprint(scenario,catalog),startedAt:scenario.createdAt,events:[],result:{scope:'scenario',applied:false,reviewStatus:'pending',before:scenario,scenario:preview.scenario,compiled:preview.compiled,draft,changes:[],contextHash:'fixture',attempts:1}};db.upsert('testingAgentJobs',job);return job; };
  const dismissed = persistedProposal('fixture-new-dismissed');
  const beforeReject=awaitFileSnapshot(); dismissScenarioEditJob(dismissed.id); assert.equal(awaitFileSnapshot(),beforeReject);
  assert.equal((await request('POST',`/jobs/${dismissed.id}/apply-revision`,acceptance(dismissed))).status,409);
  assert.equal((await request('POST',`/jobs/${dismissed.id}/dismiss-revision`)).status,409);
  const accepted = persistedProposal('fixture-new-accepted');
  assert.equal(getTestingCatalog().knowledge.some(item=>item.id===knowledge.id),false);
  assert.equal(getTestingCatalog().definitions.some(item=>item.id===definition.id),false);
  const response=await request('POST',`/jobs/${accepted.id}/apply-revision`,acceptance(accepted));assert.equal(response.status,200);
  const saved = response.data.scenario as TestingScenario;
  assert.equal((await request('POST',`/jobs/${accepted.id}/apply-revision`,acceptance(accepted))).status,409);
  assert.equal(getTestingCatalog().knowledge.some(item=>item.id===knowledge.id),true);
  assert.equal(saved.blocks.at(-1)!.definition.id, definition.id);
  assert.equal(getTestingCatalog().definitions.some(item => item.id === definition.id), true);
  assert.equal(getTestingCatalog().bindings.some(item => item.id === definition.bindingId), false);
  assert.equal(repository.getTestingApproval(saved.id), undefined);
  const invalid = draftOf(saved); invalid.newKnowledge.push({ ...getTestingCatalog().knowledge[0], id: 'fixture.invalid-knowledge', revision: 1, definitionRefs: [{ id: 'missing.definition', version: '1.0.0' }] });
  const before = awaitFileSnapshot();
  assert.throws(() => repository.applyTestingScenarioEdit(saved.id, invalid, 'luna', saved.revision, testingFingerprint(saved, getTestingCatalog())), /fehlende Definitionsversion/);
  assert.equal(awaitFileSnapshot(), before);
});
function awaitFileSnapshot() { return JSON.stringify({ scenarios: db.read('testingScenarios'), definitions: db.read('testingDefinitions'), knowledge: db.read('testingKnowledge'), revisions: db.read('testingScenarioRevisions') }); }

test('Ungültige Referenzen scheitern nach begrenzter Korrektur ohne fachliche Mutation', async () => {
  const scenario = fixture('flow-invalid'), draft = draftOf(scenario); draft.blocks.at(-1)!.inputs.proposalId = { ref: 'nichtvorhanden' };
  await writeFile(process.env.FOLIO_FLOW_FIXTURE!, JSON.stringify(wireDraft(draft)));
  const job = startScenarioEditJob({ scenarioId: scenario.id, revision: scenario.revision, text: 'Absichtlich ungültige Fixture', model: 'luna' });
  const done = await completed(job.id); assert.equal(done.status, 'failed'); assert.match(done.error!, /KI-Korrektur.*Vertrag/);
  assert.deepEqual(repository.getTestingScenario(scenario.id), scenario);
  assert.match(await readFile(join(temporary, 'agents', `${job.id}-korrektur`, 'validierungsfehler.txt'), 'utf8'), /pruefung: REFERENCE_MISSING/);
});

test('Unzweideutig in eine andere Rolle verschobener Block behält seine Bezeichnung und erscheint als Verschiebung',async()=>{
  const scenario=fixture('flow-cross-parent'),catalog=getTestingCatalog(),draft=draftOf(scenario);
  const context=catalog.definitions.find(item=>item.kind==='context')!;
  const check=draft.blocks.pop()!;
  draft.blocks.push({id:'weitere-rolle',definition:{id:context.id,version:context.version},inputs:{role:'Sachbearbeiter'},children:[check]});
  const job=await proposal(scenario,draft),result=job.result as TestingScenarioEditProposal;
  assert.equal(result.scenario.blocks.at(-1)!.children![0].label,'Meine Statuskontrolle');
  assert(result.changes.some(change=>change.kind==='move'&&change.path==='weitere-rolle/pruefung'));
  assert(!result.changes.some(change=>change.kind==='remove'&&change.path==='pruefung'));
});

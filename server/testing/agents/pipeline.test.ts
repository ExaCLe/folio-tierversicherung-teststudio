import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const temporary = await mkdtemp(resolve(tmpdir(), 'folio-pipeline-unit-'));
process.env.FOLIO_DATA_FILE = resolve(temporary, 'data.json');
process.env.FOLIO_AGENT_ARTIFACTS_ROOT = resolve(temporary, 'agents');
process.env.FOLIO_TESTING_RUN_ROOT = resolve(temporary, 'runs');
process.env.FOLIO_CLI_TEST_LOG = resolve(temporary, 'processes.jsonl');
const executable = resolve(temporary, 'codex-fixture.mjs');
await writeFile(executable, `#!/usr/bin/env node
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
let input = ''; for await (const chunk of process.stdin) input += chunk;
let settings = {}; try { settings = JSON.parse(input); } catch {}
const started = Date.now();
appendFileSync(process.env.FOLIO_CLI_TEST_LOG, JSON.stringify({type:'start',pid:process.pid,at:started,args})+'\\n');
process.stdout.write(JSON.stringify({type:'thread.started'})+'\\n');
await new Promise(resolve => setTimeout(resolve, settings.delay ?? 150));
if (!settings.noResult) {
 const schema = JSON.parse(readFileSync(args[args.indexOf('--output-schema')+1], 'utf8'));
 let output = {status:'bereit'};
 if (schema.properties?.reuseBindings) { const compiled=JSON.parse(readFileSync('freigegeben.json','utf8')); output={explanation:'Test des Prozessvertrags, kein KI-Nachweis.',reuseBindings:compiled.bindings.filter(x=>x.status==='ready').map(x=>({id:x.id,revision:x.revision})),newBindings:[],unsupported:[]}; }
 if (schema.properties?.decisions) output={explanation:'Test des Prozessvertrags, kein KI-Nachweis.',decisions:[],unresolved:[]};
 writeFileSync(args[args.indexOf('-o')+1], JSON.stringify(output));
}
appendFileSync(process.env.FOLIO_CLI_TEST_LOG, JSON.stringify({type:'end',pid:process.pid,at:Date.now()})+'\\n');
process.exit(settings.exitCode ?? 0);
`, { mode: 0o700 });
await chmod(executable, 0o700);
process.env.FOLIO_CODEX_EXECUTABLE = executable;
const { invokeCodex, redactCLIText } = await import('./cli');
const { getTestingCatalog } = await import('../catalog');
const { createStarterBindings } = await import('../bindings/seed');
const { validateTestingBinding } = await import('../bindings/validation');
const { compileTestingScenario, testingFingerprint } = await import('../compiler');
const repository = await import('../repository');
const orchestrator = await import('./orchestrator');
const { reviewWithCodex, validateDuplicateReview, validateReuseReview } = await import('./reviews');
const schema = { type: 'object', properties: { status: { type: 'string' } }, required: ['status'], additionalProperties: false };
const call = (id: string, prompt = '{}', signal?: AbortSignal) => invokeCodex({ id, model: 'luna', prompt, schema, files: { 'kontext.txt': 'Nur synthetische Testdaten.' }, signal });

test('CLI startet mit Argumentliste, read-only und exakt gewähltem Modell', async () => {
  await call('argumente');
  const manifest = JSON.parse(await readFile(resolve(temporary, 'agents/argumente/manifest.json'), 'utf8'));
  assert.equal(manifest.model, 'gpt-5.6-luna');
  assert.equal(manifest.args[manifest.args.indexOf('--sandbox') + 1], 'read-only');
  assert.equal(manifest.args[manifest.args.indexOf('-m') + 1], 'gpt-5.6-luna');
  assert.equal(manifest.args.at(-1), '-');
  assert(!manifest.args.some((arg: string) => arg.includes('bypass') || arg === '--ignore-rules'));
});
test('Globales Limit lässt höchstens zwei echte Kindprozesse zugleich zu', async () => {
  await writeFile(process.env.FOLIO_CLI_TEST_LOG!, '');
  await Promise.all(Array.from({ length: 5 }, (_, i) => call(`parallel-${i}`, '{"delay":250}')));
  const events = (await readFile(process.env.FOLIO_CLI_TEST_LOG!, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  let active = 0, maximum = 0;
  for (const event of events) { active += event.type === 'start' ? 1 : -1; maximum = Math.max(maximum, active); }
  assert.equal(maximum, 2); assert.equal(active, 0);
});
test('Abbruch in der Warteschlange startet keinen zusätzlichen Prozess', async () => {
  const first = call('lange-a', '{"delay":350}'), second = call('lange-b', '{"delay":350}');
  const controller = new AbortController(); const queued = call('abgebrochen', '{}', controller.signal); controller.abort();
  await assert.rejects(queued, /abgebrochen/); await Promise.all([first, second]);
  await assert.rejects(readFile(resolve(temporary, 'agents/abgebrochen/manifest.json')), /ENOENT/);
});
test('Abbruch während der Kontextvorbereitung wird vor spawn erneut geprüft', async () => {
  const controller = new AbortController();
  await assert.rejects(invokeCodex({ id: 'vor-spawn', model: 'sol', prompt: '{}', schema, files: { 'wissen.txt': 'Tierversicherung' }, signal: controller.signal,
    onEvent: event => { if (event.message.includes('wird als')) controller.abort(); } }), /vor dem CLI-Start abgebrochen/);
  const log = await readFile(process.env.FOLIO_CLI_TEST_LOG!, 'utf8'); assert(!log.includes('vor-spawn'));
});
test('Ein alter Ergebnisstand wird bei leerer neuer CLI-Antwort nicht angenommen', async () => {
  await call('wiederholung');
  await assert.rejects(call('wiederholung', '{"noResult":true}'), /kein gültiges JSON-Ergebnis/);
});
test('Zugangszeichenketten werden aus Diagnosen entfernt', () => {
  assert(!redactCLIText('Bearer abcdefghijklmnop access_token="synthetisch" sk-abcdefghijklmnopqrstuv').includes('abcdefghijklmnop'));
  assert(!redactCLIText('access_token="synthetisch"').includes('synthetisch'));
});
test('Technische Rezepte können nicht aus dem Portal navigieren oder Felder übergehen', () => {
  const catalog = getTestingCatalog(); const starter = createStarterBindings(catalog)[0];
  assert(starter);
  assert.throws(() => validateTestingBinding({ ...starter, recipe: [{ op: 'goto', value: 'https://example.test' }] }, catalog), /ausschließlich lokale/);
  assert.throws(() => validateTestingBinding({ ...starter, inputKeys: [...starter.inputKeys!, 'vergessenesFeld'] }, catalog), /weder gesetzt noch geprüft/);
  assert.throws(() => validateTestingBinding({ ...starter, recipe: [{ op: 'eval', value: 'process.exit()' }] }, catalog));
});
test('Neue manuelle Fachdefinition ohne operation und bindingId bleibt über semanticKey exakt verdrahtbar', () => {
  const catalog = getTestingCatalog();
  const base = catalog.definitions.find(item => item.id === 'kunde.anlegen')!;
  const { operation: _operation, bindingId: _binding, ...rest } = base;
  const definition = { ...rest, id: 'freie.definition', semanticKey: 'fachliche.kundenanlage', origin: 'human' as const };
  const starter = createStarterBindings(catalog).find(item => item.operation === 'createCustomer')!;
  const augmented = { ...catalog, definitions: [...catalog.definitions, definition] };
  const binding = validateTestingBinding({ ...starter, id: 'ui.freie-definition', operation: definition.semanticKey, definitionRefs: [{ id: definition.id, version: definition.version }] }, augmented);
  const scenario = { ...repository.getTestingScenario('kuh-direktionsanfrage'), id: 'freie-definition-test', blocks: [{ id: 'neu', definition: { id: definition.id, version: definition.version }, inputs: {} }] };
  const fingerprint = testingFingerprint(scenario, augmented);
  const wired = { ...augmented, bindings: [...augmented.bindings, binding] };
  const approval = { id: 'pruefung', scenarioId: scenario.id, scenarioRevision: scenario.revision, fingerprint, actor: 'Vertragstest', approvedAt: new Date().toISOString() };
  const compiled = compileTestingScenario(scenario, wired, approval); assert.equal(compiled.executable, true, JSON.stringify(compiled.issues)); assert.equal(compiled.steps[0].operation, definition.semanticKey);
  assert.equal(testingFingerprint(scenario, wired), fingerprint);
  assert.throws(() => validateTestingBinding({ ...binding, operation: 'kundenanlage' }, wired), /erwartet exakt operation=fachliche.kundenanlage/);
});
test('Prüfagenten geben Vertragsfehler einmal an dasselbe Modell zurück und behalten beide Antworten', async () => {
  let validations = 0;
  const result = await reviewWithCodex({ id: 'review-korrektur', model: 'sol', prompt: '{}', schema, files: {}, label: 'Vertragstest', validate: raw => {
    if (++validations === 1) throw new Error('Ein Schemafeldname fehlt.');
    return raw;
  } });
  assert.equal(result.attempts, 2);
  const first = JSON.parse(await readFile(resolve(temporary, 'agents/review-korrektur/manifest.json'), 'utf8'));
  const correction = JSON.parse(await readFile(resolve(temporary, 'agents/review-korrektur-korrektur/manifest.json'), 'utf8'));
  assert.equal(first.model, 'gpt-5.6-sol'); assert.equal(correction.model, first.model);
  assert.match(await readFile(resolve(temporary, 'agents/review-korrektur-korrektur/validierungsfehler.txt'), 'utf8'), /Schemafeldname/);
});
test('Dublettenprüfung bleibt beim freigegebenen Gegenstand und Wiederverwendung trennt Feldnamen von Werten', () => {
  const catalog = getTestingCatalog(), scenario = repository.getTestingScenario('kuh-direktionsanfrage');
  const compiled = compileTestingScenario(scenario, catalog);
  assert.throws(() => validateDuplicateReview({ explanation: '', decisions: [{ proposed: { id: 'kunde.anlegen', version: '1.0.0' }, decision: 'new', chosen: null, compatible: false, reason: '' }], unresolved: [] }, compiled, catalog), /decisions muss/);
  const raw = { explanation: '', suggestions: [{ name: 'Vorbereitung', reason: '', parentPath: null, instanceIds: ['kuhvorschlag'], parameters: [{ key: 'bundesland', label: 'Bundesland', instanceId: 'kuhvorschlag', input: 'Bayern' }] }] };
  assert.throws(() => validateReuseReview(raw, scenario, catalog), /Schemafeldnamen/);
  raw.suggestions[0].parameters[0].input = 'state';
  assert.equal(validateReuseReview(raw, scenario, catalog).suggestions[0].parameters[0].input, 'state');
});
test('Änderung während technischem und Dublettenauftrag verhindert jede Übernahme und Ausführung', async () => {
  for (const binding of createStarterBindings(getTestingCatalog())) repository.saveTestingBinding(binding);
  const scenario = repository.getTestingScenario('kuh-direktionsanfrage');
  repository.approveTestingScenario(scenario.id, scenario.revision);
  const bindingsBefore = JSON.stringify(getTestingCatalog().bindings);
  const job = orchestrator.startTechnicalJob({ scenarioId: scenario.id, revision: scenario.revision, model: 'luna' });
  repository.saveTestingScenario({ ...scenario, title: `${scenario.title} geändert` }, scenario.revision);
  const completed = await orchestrator.waitTestingJob(job.id);
  assert.equal(completed.status, 'failed'); assert.match(completed.error!, /geändert|veraltet/);
  assert.equal(JSON.stringify(getTestingCatalog().bindings), bindingsBefore);
  assert.equal(repository.listTestingRuns().length, 0);
});
test.after(async () => { await rm(temporary, { recursive: true, force: true }); });

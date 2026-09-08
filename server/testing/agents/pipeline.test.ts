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
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
const args = process.argv.slice(2);
let input = ''; for await (const chunk of process.stdin) input += chunk;
let settings = {}; try { settings = JSON.parse(input); } catch {}
const started = Date.now();
appendFileSync(process.env.FOLIO_CLI_TEST_LOG, JSON.stringify({type:'start',pid:process.pid,at:started,args})+'\\n');
process.stdout.write(JSON.stringify({type:'thread.started'})+'\\n');
if (process.env.FOLIO_DUPLICATE_DELAY && JSON.parse(readFileSync(args[args.indexOf('--output-schema')+1],'utf8')).properties?.decisions) await new Promise(resolve=>setTimeout(resolve,Number(process.env.FOLIO_DUPLICATE_DELAY)));
await new Promise(resolve => setTimeout(resolve, settings.delay ?? 150));
if (!settings.noResult) {
 const schema = JSON.parse(readFileSync(args[args.indexOf('--output-schema')+1], 'utf8'));
 let output = {status:'bereit'};
 if (schema.properties?.reuseBindings) { const compiled=JSON.parse(readFileSync('freigegeben.json','utf8')); output={explanation:'Test des Prozessvertrags, kein KI-Nachweis.',reuseBindings:compiled.bindings.filter(x=>x.status==='ready').map(x=>({id:x.id,revision:x.revision})),newBindings:[],unsupported:[]}; }
 if (schema.properties?.reuseBindings && existsSync('technischer-testplan.json')) { const fixture=JSON.parse(readFileSync('technischer-testplan.json','utf8')); output=process.cwd().endsWith('-korrektur') ? fixture.correction ?? fixture.initial : fixture.initial; }
 if (schema.properties?.decisions) output={explanation:'Test des Prozessvertrags, kein KI-Nachweis.',decisions:[],unresolved:[]};
 if (schema.properties?.decisions && process.env.FOLIO_DUPLICATE_PLAN) { const fixture=JSON.parse(readFileSync(process.env.FOLIO_DUPLICATE_PLAN,'utf8')); output=process.cwd().endsWith('-korrektur') ? fixture.correction : fixture.initial; }
 writeFileSync(args[args.indexOf('-o')+1], JSON.stringify(output));
}
appendFileSync(process.env.FOLIO_CLI_TEST_LOG, JSON.stringify({type:'end',pid:process.pid,at:Date.now()})+'\\n');
process.exit(settings.exitCode ?? 0);
`, { mode: 0o700 });
await chmod(executable, 0o700);
process.env.FOLIO_CODEX_EXECUTABLE = executable;
const { invokeCodex, redactCLIText } = await import('./cli');
const { AgentTerminationError, agentTermination } = await import('./termination');
const { getTestingCatalog } = await import('../catalog');
const { createStarterBindings } = await import('../bindings/seed');
const { validateTestingBinding } = await import('../bindings/validation');
const { compileTestingScenario, testingFingerprint } = await import('../compiler');
const repository = await import('../repository');
const orchestrator = await import('./orchestrator');
const { reviewWithCodex, validateDuplicateReview, validateReuseReview } = await import('./reviews');
const { planTechnicalWithCodex } = await import('./technical');
const { agentContext } = await import('./prompts');
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
test('Ein interner Budgetabbruch im laufenden CLI-Prozess bleibt Zeitlimit und behauptet keinen Nutzerabbruch',async()=>{
  const controller=new AbortController(),reason=new AgentTerminationError('time_limit','Die Anwendungserkundung hat ihr Zeitlimit von 360 Sekunden erreicht.',360_000);
  await assert.rejects(invokeCodex({id:'erkundungsbudget',model:'luna',prompt:'{"delay":3000}',schema,files:{},signal:controller.signal,onEvent:event=>{if(event.message==='Codex-Sitzung gestartet.')controller.abort(reason);}}),error=>{
    assert.equal(error,reason);assert.equal(agentTermination(error)?.cause,'time_limit');assert.equal(agentTermination(error)?.limitMs,360_000);assert.doesNotMatch((error as Error).message,/Menschen|Nutzer/);return true;
  });
  await assert.rejects(readFile(resolve(temporary,'agents/erkundungsbudget/process.json')),/ENOENT/);
  await assert.rejects(readFile(resolve(temporary,'agents/erkundungsbudget/result.json')),/ENOENT/);
});
test('Nur expliziter Nutzerabbruch wird als Nutzerabbruch bezeichnet; unbekanntes Signal bleibt neutral',async()=>{
  for(const cause of ['user_cancelled','parent_cancelled','interrupted']as const){
    const controller=new AbortController();const reason=cause==='interrupted'?undefined:new AgentTerminationError(cause,cause==='user_cancelled'?'Der Agentenlauf wurde vom Menschen abgebrochen.':'Der übergeordnete Auftrag wurde beendet.');
    await assert.rejects(invokeCodex({id:`stopp-${cause}`,model:'luna',prompt:'{"delay":3000}',schema,files:{},signal:controller.signal,onEvent:event=>{if(event.message==='Codex-Sitzung gestartet.')controller.abort(reason);}}),error=>{
      assert.equal(agentTermination(error)?.cause,cause);if(cause!=='user_cancelled')assert.doesNotMatch((error as Error).message,/Menschen|Nutzer/);return true;
    });
  }
});
test('Das interne CLI-Zeitlimit bleibt ein eigenständiger terminierter Fehler',async()=>{
  const previous=process.env.FOLIO_CODEX_TIMEOUT_MS;process.env.FOLIO_CODEX_TIMEOUT_MS='5000';
  try{await assert.rejects(call('cli-zeitlimit','{"delay":10000}'),error=>{assert.equal(agentTermination(error)?.cause,'time_limit');assert.equal(agentTermination(error)?.limitMs,5000);return true;});}
  finally{if(previous===undefined)delete process.env.FOLIO_CODEX_TIMEOUT_MS;else process.env.FOLIO_CODEX_TIMEOUT_MS=previous;}
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
test('unlessVisible erklärt alle drei Vertragsverletzungen am genauen Rezeptort und erhält gültige Öffnungsklicks', () => {
  const catalog = getTestingCatalog();
  const starter = createStarterBindings(catalog).find(item => item.operation === 'createCustomer')!;
  const openingIndex = starter.recipe!.findIndex(action => action.unlessVisible);
  const fillIndex = starter.recipe!.findIndex(action => action.op === 'fill');
  const saveIndex = starter.recipe!.findIndex(action => action.capture);
  const valid = validateTestingBinding(starter, catalog);
  assert.deepEqual(valid.recipe, starter.recipe);
  const malformed = structuredClone(starter);
  malformed.recipe![openingIndex].unlessVisible = 'Name des Kunden';
  // An unknown key with spaces fails the shape contract before semantic validation.
  assert.throws(() => validateTestingBinding(malformed, catalog));
  malformed.recipe![openingIndex].unlessVisible = 'unknownForm';
  malformed.recipe![fillIndex].unlessVisible = 'name';
  malformed.recipe![saveIndex].unlessVisible = 'name';
  assert.throws(() => validateTestingBinding(malformed, catalog), error => {
    const message = (error as Error).message;
    for (const index of [openingIndex, fillIndex, saveIndex]) assert(message.includes(`recipe[${index}]`), message);
    assert(message.includes(`${starter.id}@${starter.revision}`), message);
    assert.match(message, /unknownForm.*nicht definiert/);
    assert.match(message, /fill unzulässig/);
    assert.match(message, /capture.*nicht übersprungen/);
    assert.match(message, /Speicherklick muss ohne unlessVisible/);
    return true;
  });
  assert.equal(starter.recipe![saveIndex].unlessVisible, undefined);
  const mixed = structuredClone(starter);
  mixed.recipe![saveIndex].op = 'fill'; mixed.recipe![saveIndex].unlessVisible = 'unknownForm';
  assert.throws(() => validateTestingBinding(mixed, catalog), error => { const message = (error as Error).message; assert.match(message, /fill unzulässig/); assert.match(message, /unknownForm.*nicht definiert/); assert.match(message, /capture.*nicht übersprungen/); return true; });
});

test('Technische Korrektur erhält alle ungültigen Bindungen und bewahrt Speicheraktionen samt Antwortnachweis', async () => {
  const catalog = getTestingCatalog();
  const starter = createStarterBindings(catalog).find(item => item.operation === 'createCustomer')!;
  const corrected = ['fill', 'unknown', 'capture'].map(kind => ({ ...structuredClone(starter), id: `fixture-${kind}` }));
  const invalid = structuredClone(corrected);
  invalid[0].recipe!.find(action => action.op === 'fill')!.unlessVisible = 'name';
  invalid[1].recipe!.find(action => action.unlessVisible)!.unlessVisible = 'unknownForm';
  invalid[2].recipe!.find(action => action.capture)!.unlessVisible = 'name';
  const plan = (bindings: typeof corrected) => ({ explanation: 'Synthetischer Prozessvertragstest, kein KI-Funktionsnachweis.', reuseBindings: [], newBindings: bindings.map(binding => ({ bindingJson: JSON.stringify(binding), reason: 'Vertragstest' })), unsupported: [] });
  const compiled = compileTestingScenario(repository.getTestingScenario('kuh-direktionsanfrage'), catalog);
  const context = agentContext(catalog, compiled);
  assert.match(context['rezept-validierung.ts'], /openingIssues/);
  assert.match(context['rezept-ausfuehrung.ts'], /action\.unlessVisible/);
  const beforeBindings = JSON.stringify(getTestingCatalog().bindings);
  const result = await planTechnicalWithCodex({ id: 'technischer-oeffnungsfehler', model: 'luna', catalog, compiled,
    files: { 'freigegeben.json': JSON.stringify(compiled), 'technischer-testplan.json': JSON.stringify({ initial: plan(invalid), correction: plan(corrected) }) } });
  assert.deepEqual(result.value, plan(corrected));
  const path = resolve(temporary, 'agents/technischer-oeffnungsfehler-korrektur');
  const diagnostic = await readFile(resolve(path, 'validierungsfehler.txt'), 'utf8');
  for (const binding of invalid) assert(diagnostic.includes(binding.id), diagnostic);
  assert.match(diagnostic, /recipe\[\d+\]/);
  assert.match(diagnostic, /capture/);
  assert.deepEqual(JSON.parse(await readFile(resolve(path, 'vorherige-antwort.json'), 'utf8')), plan(invalid));
  assert.match(await readFile(resolve(path, 'prompt.md'), 'utf8'), /behebe alle gemeldeten Aktionen/);
  assert.match(await readFile(resolve(path, 'prompt.md'), 'utf8'), /Speicherklick.*ohne unlessVisible/);
  assert.equal(JSON.stringify(getTestingCatalog().bindings), beforeBindings);
  assert.equal(repository.listTestingRuns().length, 0);
});

test('Eine weiterhin ungültige technische Korrektur endet nach zwei Antworten ohne Übernahme', async () => {
  const catalog = getTestingCatalog();
  const starter = createStarterBindings(catalog).find(item => item.operation === 'createCustomer')!;
  const invalid = structuredClone(starter);
  invalid.recipe!.find(action => action.capture)!.unlessVisible = 'name';
  const plan = { explanation: 'Absichtlich ungültiges Fixture, kein KI-Auftrag.', reuseBindings: [], newBindings: [{ bindingJson: JSON.stringify(invalid), reason: 'Vertragstest' }], unsupported: [] };
  const compiled = compileTestingScenario(repository.getTestingScenario('kuh-direktionsanfrage'), catalog);
  const beforeBindings = JSON.stringify(getTestingCatalog().bindings);
  await assert.rejects(planTechnicalWithCodex({ id: 'technischer-oeffnungsfehler-bleibt', model: 'sol', catalog, compiled,
    files: { 'freigegeben.json': JSON.stringify(compiled), 'technischer-testplan.json': JSON.stringify({ initial: plan }) } }), /weiterhin ungültig.*[\s\S]*recipe\[.*[\s\S]*capture/);
  for (const name of ['technischer-oeffnungsfehler-bleibt', 'technischer-oeffnungsfehler-bleibt-korrektur']) assert.deepEqual(JSON.parse(await readFile(resolve(temporary, `agents/${name}/result.json`), 'utf8')), plan);
  await assert.rejects(readFile(resolve(temporary, 'agents/technischer-oeffnungsfehler-bleibt-korrektur-korrektur/manifest.json')), /ENOENT/);
  assert.equal(JSON.stringify(getTestingCatalog().bindings), beforeBindings);
  assert.equal(repository.listTestingRuns().length, 0);
});
test('Aktiviert und deaktiviert sind ausdrückliche UI-Assertions mit geschützten Nachweisen', () => {
  const catalog = getTestingCatalog();
  const base = catalog.definitions.find(item => item.id === 'pruefung.vorschlagsstatus')!;
  const definition = { ...base, id: 'qa.bedienbarkeit', semanticKey: 'qa.expectAvailability', operation: 'expectAvailability', bindingId: 'ui.qaAvailability',
    inputs: [{ key: 'proposalId', label: 'Vorschlag', type: 'proposal-ref' as const, required: true }, { key: 'expectedAllowed', label: 'Erwartete Berechtigung', type: 'boolean' as const, required: true }],
    outputs: [{ key: 'matched', label: 'Berechtigung geprüft', type: 'boolean' as const }] };
  const augmented = { ...catalog, definitions: [...catalog.definitions, definition] };
  const binding = { id: definition.bindingId, revision: 1, operation: definition.operation, name: 'Bedienbarkeit prüfen', status: 'ready', definitionRefs: [{ id: definition.id, version: definition.version }], knowledgeRefs: definition.knowledgeRefs,
    module: 'e2e/helpers/agriculture-driver.ts', export: 'executeTestingStep', createdAt: '2026-01-01T00:00:00.000Z', changeReason: 'Synthetischer Vertragstest', inputKeys: ['proposalId', 'expectedAllowed'],
    locators: [{ key: 'decision', method: 'label', value: 'Entscheidung', exact: true }], recipe: [{ op: 'goto', value: '/portal/vorschlaege/{{proposalId}}' },
      { op: 'expectEnabled', locatorKey: 'decision', when: { input: 'expectedAllowed', equals: true }, proof: { matched: 'matched' } },
      { op: 'expectDisabled', locatorKey: 'decision', when: { input: 'expectedAllowed', equals: false }, proof: { matched: 'matched' } }] };
  assert.deepEqual(validateTestingBinding(binding, augmented).recipe, binding.recipe);
  for (const index of [1, 2]) { const invalid = structuredClone(binding); Object.assign(invalid.recipe[index], { unlessVisible: 'decision' }); assert.throws(() => validateTestingBinding(invalid, augmented), /unlessVisible.*[\s\S]*unzulässig/); }
  const invalidProof = structuredClone(binding); invalidProof.recipe[1].proof = { matched: 'nichtDeklariert' };
  assert.throws(() => validateTestingBinding(invalidProof, augmented), /boolesches Ergebnis/);
});

test('Technischer Plan verdrahtet elementare Schritte und ersetzt keinen vorhandenen Workflow durch ein Vollrezept', async () => {
  const catalog = getTestingCatalog();
  const compiled = compileTestingScenario(repository.getTestingScenario('kuh-direktionsanfrage'), catalog);
  const workflow = compiled.definitions.find(definition => definition.kind === 'workflow')!;
  const starter = createStarterBindings(catalog).find(item => item.operation === 'createCustomer')!;
  const unrelated = createStarterBindings(catalog).find(item => item.operation === 'completeContract')!;
  const containerBinding = { ...starter, id: 'ui.qaContainer', operation: workflow.operation ?? workflow.semanticKey, definitionRefs: [{ id: workflow.id, version: workflow.version }] };
  const plan = (bindings: typeof starter[]) => ({ explanation: 'Synthetischer Plan, kein KI-Lauf.', reuseBindings: [], newBindings: bindings.map(binding => ({ bindingJson: JSON.stringify(binding), reason: 'Vertragstest' })), unsupported: [] });
  const corrected = plan([starter]);
  const result = await planTechnicalWithCodex({ id: 'elementare-pruefgegenstaende', model: 'luna', catalog, compiled,
    files: { 'freigegeben.json': JSON.stringify(compiled), 'technischer-testplan.json': JSON.stringify({ initial: plan([containerBinding, unrelated]), correction: corrected }) } });
  assert.deepEqual(result.value, corrected);
  const diagnostic = await readFile(resolve(temporary, 'agents/elementare-pruefgegenstaende-korrektur/validierungsfehler.txt'), 'utf8');
  assert.match(diagnostic, /zusammengesetzter Workflow oder Rollenblock/);
  assert.match(diagnostic, /keinem elementaren Schritt/);
  assert.match(diagnostic, /freigegeben.json.steps/);
  assert.equal(repository.listTestingRuns().length, 0);
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
  assert.throws(() => orchestrator.startTechnicalJob({ scenarioId: scenario.id, revision: scenario.revision, model: 'luna' }), /läuft bereits ein Auftrag/);
  repository.saveTestingScenario({ ...scenario, title: `${scenario.title} geändert` }, scenario.revision);
  const completed = await orchestrator.waitTestingJob(job.id);
  assert.equal(completed.status, 'failed'); assert.match(completed.error!, /geändert|veraltet/);
  assert.equal(JSON.stringify(getTestingCatalog().bindings), bindingsBefore);
  assert.equal(repository.listTestingRuns().length, 0);
});
test('Zwei Selbstvergleiche werden gemeinsam korrigiert; die echte Pipeline hält für fachliche Prüfung statt abzubrechen', async () => {
  const catalog=getTestingCatalog(),base=catalog.definitions.find(item=>item.id==='pruefung.vorschlagsstatus')!;
  const subjects=['fixture.freigabe','fixture.berechtigung'].map(id=>({...structuredClone(base),id,origin:'human' as const,name:`Synthetischer Prüfgegenstand ${id}`}));
  for(const definition of subjects)repository.saveTestingDefinition(definition);
  const source=repository.getTestingScenario('kuh-direktionsanfrage');
  const scenario=repository.saveTestingScenario({...source,id:'doppelte-selbstvergleiche',blocks:[...source.blocks,...subjects.map((definition,index)=>({id:`pruefung-${index}`,definition:{id:definition.id,version:definition.version},inputs:{proposalId:{ref:'vorschlag'},expectedStatus:'Direktionsprüfung'}}))]},0);
  repository.approveTestingScenario(scenario.id,scenario.revision);
  const initial={explanation:'Synthetische falsche Selbstauswahl, kein Modellnachweis.',decisions:subjects.map(definition=>({proposed:{id:definition.id,version:definition.version},decision:'reuse',chosen:{id:definition.id,version:definition.version},reason:'Synthetischer Selbstvergleich',compatible:true})),unresolved:[]};
  const correction={...initial,explanation:'Synthetische fachliche Überprüfung, noch keine automatische Übernahme.',decisions:[{...initial.decisions[0],decision:'extend',chosen:{id:base.id,version:base.version},compatible:false},{...initial.decisions[1],decision:'new',chosen:null,compatible:false}]};
  process.env.FOLIO_DUPLICATE_PLAN=resolve(temporary,'duplicate-plan.json');await writeFile(process.env.FOLIO_DUPLICATE_PLAN,JSON.stringify({initial,correction}));
  process.env.FOLIO_DUPLICATE_DELAY='600';
  const beforeBindings=JSON.stringify(getTestingCatalog().bindings),beforeRuns=JSON.stringify(repository.listTestingRuns());
  try {
    const started=orchestrator.startTechnicalJob({scenarioId:scenario.id,revision:scenario.revision,model:'luna'});
    const deadline=Date.now()+2500;
    while(!orchestrator.getTestingJob(started.id).workStages?.some(stage=>stage.stage==='wiring'&&stage.status==='completed')&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));
    const preparing=orchestrator.getTestingJob(started.id);
    assert.equal(preparing.status,'running');assert.equal(preparing.workStages?.find(stage=>stage.stage==='wiring')?.status,'completed');
    const waitingChild=orchestrator.getTestingJob(preparing.childJobIds![0]);assert.equal(waitingChild.status,'running');assert.equal(waitingChild.workStages?.find(stage=>stage.stage==='duplicates')?.status,'running');
    const finished=await orchestrator.waitTestingJob(started.id);
    assert.equal(finished.status,'completed',finished.error);
    const result=finished.result as {needsBusinessReview:boolean;duplicateJobId:string;duplicateDecisions:unknown[];run?:unknown};
    assert.equal(result.needsBusinessReview,true);assert.equal(result.run,undefined);assert.deepEqual(result.duplicateDecisions,correction.decisions);
    const duplicate=orchestrator.getTestingJob(result.duplicateJobId);assert.equal(duplicate.status,'completed');
    const directory=resolve(temporary,`agents/${duplicate.id}-korrektur`),diagnostic=await readFile(resolve(directory,'validierungsfehler.txt'),'utf8');
    for(const text of ['decisions[0]','decisions[1]',...subjects.map(item=>item.id)])assert(diagnostic.includes(text),diagnostic);
    assert.deepEqual(JSON.parse(await readFile(resolve(directory,'vorherige-antwort.json'),'utf8')),initial);
    const comparisons=JSON.parse(await readFile(resolve(directory,'vergleichskandidaten.json'),'utf8'));
    for(const row of comparisons)assert(row.candidates.every((candidate:any)=>candidate.id!==row.proposed.id||candidate.version!==row.proposed.version));
    const first=JSON.parse(await readFile(resolve(temporary,`agents/${duplicate.id}/manifest.json`),'utf8')),retry=JSON.parse(await readFile(resolve(directory,'manifest.json'),'utf8'));assert.equal(first.model,retry.model);
    assert.deepEqual(repository.getTestingScenario(scenario.id),scenario);assert.equal(JSON.stringify(getTestingCatalog().bindings),beforeBindings);assert.equal(JSON.stringify(repository.listTestingRuns()),beforeRuns);
  } finally { delete process.env.FOLIO_DUPLICATE_PLAN;delete process.env.FOLIO_DUPLICATE_DELAY; }
});
test.after(async () => { await rm(temporary, { recursive: true, force: true }); });

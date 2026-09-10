import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import type { TestingAgentConfiguration } from '../../../shared/testing';

const directory = mkdtempSync(join(tmpdir(), 'folio-provider-test-'));
process.env.FOLIO_DATA_FILE = join(directory, 'data.json');
process.env.FOLIO_AGENT_ARTIFACTS_ROOT = join(directory, 'agents');
const fixture = join(directory, 'fixture-cli.mjs');
writeFileSync(fixture, `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
const args = process.argv.slice(2); let prompt = '';
process.stdin.setEncoding('utf8'); process.stdin.on('data', chunk => prompt += chunk);
process.stdin.on('end', () => {
  writeFileSync('fixture-observed.json', JSON.stringify({ args, prompt, cwd: process.cwd() }));
  if (args[0] === 'exec') {
    writeFileSync(args[args.indexOf('-o') + 1], JSON.stringify({ provider: 'codex', model: args[args.indexOf('-m') + 1] }));
    if (prompt.includes('PUBLIC_STREAM')) {
      const first = JSON.stringify({ type: 'item.updated', item: { id: 'reason_1', type: 'reasoning', text: 'Regel wird geprüft.', encrypted_content: 'never-public' } });
      process.stdout.write(first.slice(0, 31)); process.stdout.write(first.slice(31) + '\\n');
      process.stdout.write(JSON.stringify({ type: 'item.completed', item: { id: 'reason_1', type: 'reasoning', text: 'Regel und Beispiel sind geprüft.' } }) + '\\n');
      process.stdout.write(JSON.stringify({ type: 'item.completed', item: { id: 'message_1', type: 'agent_message', text: 'Ich habe die beiden Belege verglichen.' } }) + '\\n');
      process.stdout.write(JSON.stringify({ type: 'item.completed', item: { id: 'hidden_1', type: 'reasoning', encrypted_content: 'ciphertext', summary: [{ text: 'Nicht als öffentliches Textfeld dokumentiert.' }] } }) + '\\n');
    }
    process.stdout.write(JSON.stringify({ type: 'turn.completed' }) + '\\n');
  } else {
    process.stdout.write(JSON.stringify({ type: 'system', subtype: 'init' }) + '\\n');
    const failed = prompt.includes('FAIL_RESULT') || prompt.includes('FAIL_EXIT');
    process.stdout.write(JSON.stringify({ type: 'result', subtype: failed ? 'error_during_execution' : 'success', is_error: failed, ...(failed ? { errors: ['Synthetischer Providerfehler'] } : {}),
      ...(prompt.includes('MISSING_STRUCTURED') ? { result: '{"fake":true}' } : { structured_output: { provider: 'claude', model: args[args.indexOf('--model') + 1] } }) }));
    if (prompt.includes('FAIL_EXIT')) process.exitCode = 1;
  }
});
`, { mode: 0o700 });
process.env.FOLIO_CODEX_EXECUTABLE = fixture;
process.env.FOLIO_CLAUDE_EXECUTABLE = fixture;
const settings = await import('./settings');
const cli = await import('./cli');
const processLaunch = await import('./process-launch');
after(() => { cli.stopCodexProcesses(); rmSync(directory, { recursive: true, force: true }); });
const input = (id: string, model: string, prompt = 'Isolierter Adaptertest.') => ({ id, model, prompt, schema: { type: 'object' }, files: { 'context.json': '{"fixture":true}' } });
function useClaude() {
  const current = settings.getTestingAgentSettings();
  return settings.saveTestingAgentSettings({ ...current, defaultModel: 'custom-claude', providers: { ...current.providers, claude: { executable: '', extraArgs: '--effort low --max-budget-usd 1' } }, models: [...current.models.filter(model => model.id !== 'custom-claude'), { id: 'custom-claude', label: 'Eigenes Claude', provider: 'claude', slug: 'claude-custom[1m]', extraArgs: '--effort high' }] });
}

test('Lokale Defaults und Codex-Aufruf bleiben mit Luna/Sol kompatibel', async () => {
  assert.equal(settings.getTestingAgentSettings().defaultModel, 'luna');
  assert.deepEqual(cli.CODEX_MODELS, { luna: 'gpt-5.6-luna', sol: 'gpt-5.6-sol' });
  const result = await cli.invokeCodex(input('codex-default', 'luna'));
  assert.deepEqual(result.value, { provider: 'codex', model: 'gpt-5.6-luna' });
  const manifest = JSON.parse(readFileSync(join(result.directory, 'manifest.json'), 'utf8'));
  assert.equal(manifest.provider, 'codex');
  assert.equal(manifest.args[manifest.args.indexOf('--sandbox') + 1], 'read-only');
  assert.equal(manifest.args.includes('--ignore-user-config'), true);
  assert.equal(manifest.args.at(-1), '-');
});

test('Providerabschluss und strukturiertes Ergebnis erscheinen nicht als ungeprüfte öffentliche Nachricht',async()=>{
  const events:any[]=[];
  await cli.invokeCodex({...input('codex-public-events','luna'),onEvent:(event:any)=>events.push(event)});
  assert(!events.some(event=>event.message==='Codex hat ein Ergebnis geliefert.'));
  const configuration=settings.resolveAgentConfiguration('luna');
  // Public prose remains useful progress; JSON-shaped agent output is withheld
  // until the orchestrator has decoded and validated it.
  assert(configuration.provider==='codex');
});

test('Codex übernimmt öffentliche Reasoning-Zusammenfassungen und Agententext mit stabilen IDs', async () => {
  const events:any[]=[];
  const result=await cli.invokeCodex({...input('codex-public-stream','luna','PUBLIC_STREAM'),onEvent:(event:any)=>events.push(event)});
  const publicEvents=events.filter(event=>event.publicDetail);
  assert.deepEqual(publicEvents.map(event=>[event.id,event.stream?.status,event.publicDetail.type,event.message]),[
    ['codex-public-stream:codex:reason_1','streaming','reasoning','Regel wird geprüft.'],
    ['codex-public-stream:codex:reason_1','completed','reasoning','Regel und Beispiel sind geprüft.'],
    ['codex-public-stream:codex:message_1','completed','message','Ich habe die beiden Belege verglichen.'],
  ]);
  assert(!JSON.stringify(publicEvents).includes('never-public'));
  assert(!JSON.stringify(publicEvents).includes('ciphertext'));
  const recorded=readFileSync(join(result.directory,'events.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line)).filter(event=>event.publicDetail);
  assert.deepEqual(recorded,publicEvents);
});

test('Providerparser ignorieren Rohdenken und ungeprüfte strukturierte Endausgaben', () => {
  assert.deepEqual(cli.codexPublicEvents({type:'item.completed',item:{id:'raw',type:'reasoning',encrypted_content:'secret'}}),[]);
  assert.deepEqual(cli.codexPublicEvents({type:'item.completed',item:{id:'json',type:'agent_message',text:'{"answer":true}'}}),[]);
  const claude=cli.claudePublicEvents({type:'assistant',message:{id:'msg_1',content:[{type:'thinking',thinking:'Öffentliche Begründung.',signature:'signed-private-reasoning'},{type:'text',text:'Öffentliche Antwort.'}]}});
  assert.equal(claude.length,2); assert.deepEqual(claude.map(event=>[event.id,event.publicDetail?.type,event.message]),[
    ['claude:msg_1:0','reasoning','Öffentliche Begründung.'],['claude:msg_1:1','message','Öffentliche Antwort.'],
  ]);
  assert(!JSON.stringify(claude).includes('signed-private-reasoning'));
  const item={type:'item.completed',item:{id:'item_0',type:'reasoning',text:'Zusammenfassung'}};
  assert.notEqual(cli.codexPublicEvents(item,'run-a:codex')[0].id,cli.codexPublicEvents(item,'run-b:codex')[0].id);
  const withoutMessageId=cli.claudePublicEvents({type:'assistant',message:{content:[{type:'text',text:'Begleittext ohne Provider-ID.'}]}});
  assert.equal(withoutMessageId.length,1); assert.equal(withoutMessageId[0].id,undefined); assert.equal(withoutMessageId[0].stream,undefined);
});

test('Provider-Metriken stammen nur aus abgeschlossenen Aufrufen und lassen unbekannte Werte weg', () => {
  assert.equal(cli.providerInvocationMetrics({type:'item.updated',usage:{input_tokens:999}}),undefined);
  assert.deepEqual(cli.providerInvocationMetrics({type:'turn.completed',usage:{input_tokens:120,cached_input_tokens:20,output_tokens:30}}),{requestCount:1,inputTokens:120,cachedInputTokens:20,outputTokens:30,totalTokens:150});
  assert.deepEqual(cli.providerInvocationMetrics({type:'turn.completed'}),{requestCount:1});
  assert.deepEqual(cli.providerInvocationMetrics({type:'result',num_turns:3,usage:{input_tokens:50,cache_read_input_tokens:10,cache_creation_input_tokens:5,output_tokens:12}}),{requestCount:1,inputTokens:50,cachedInputTokens:15,outputTokens:12,totalTokens:77});
});

test('Windows startet PATH-, CMD- und PowerShell-Shims ohne Shell', { skip: process.platform !== 'win32' }, async () => {
  const shimDirectory = join(directory, 'windows-shims');
  mkdirSync(shimDirectory);
  const shim = join(shimDirectory, 'folio-agent-fixture.cmd');
  const powershellShim = join(shimDirectory, 'folio-agent-fixture.ps1');
  writeFileSync(shim, '@ECHO off\r\n"%dp0%\\..\\fixture-cli.mjs" %*\r\n');
  writeFileSync(powershellShim, '$basedir=Split-Path $MyInvocation.MyCommand.Definition -Parent\n& "$basedir/../fixture-cli.mjs" $args\n');
  const previousPath = process.env.PATH, previousPathExt = process.env.PATHEXT;
  process.env.PATH = `${shimDirectory}${delimiter}${previousPath ?? ''}`;
  process.env.PATHEXT = '.COM;.EXE;.BAT;.CMD';
  try {
    const configuration = settings.resolveAgentConfiguration('luna');
    for (const [id, executable] of [['windows-path-shim', 'folio-agent-fixture'], ['windows-explicit-shim', shim], ['windows-powershell-shim', powershellShim]]) {
      const result = await cli.invokeCodex({ ...input(id, 'luna'), agentConfig: { ...configuration, executable } });
      assert.deepEqual(result.value, { provider: 'codex', model: 'gpt-5.6-luna' });
      const manifest = JSON.parse(readFileSync(join(result.directory, 'manifest.json'), 'utf8'));
      assert.equal(manifest.launchExecutable, process.execPath);
    }
  } finally {
    if (previousPath === undefined) delete process.env.PATH; else process.env.PATH = previousPath;
    if (previousPathExt === undefined) delete process.env.PATHEXT; else process.env.PATHEXT = previousPathExt;
  }
});

test('Claude übernimmt nur Verbindungsvariablen aus den isolierten Benutzereinstellungen', () => {
  const configDirectory = join(directory, 'claude-config');
  mkdirSync(configDirectory);
  writeFileSync(join(configDirectory, 'settings.json'), JSON.stringify({ env: {
    ANTHROPIC_API_KEY: 'settings-key', ANTHROPIC_AUTH_TOKEN: 'settings-token', ANTHROPIC_BASE_URL: 'https://gateway.example.test',
    CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: 'true', CLAUDE_CODE_USE_POWERSHELL_TOOL: 'true', BASH_ENV: 'nicht-uebernehmen',
  } }));
  const inherited = { PATH: 'parent-path', CLAUDE_CONFIG_DIR: configDirectory, ANTHROPIC_API_KEY: 'parent-key' };
  const claudeEnvironment = processLaunch.resolveAgentProcessEnvironment('claude', inherited);
  assert.equal(claudeEnvironment.ANTHROPIC_API_KEY, 'parent-key');
  assert.equal(claudeEnvironment.ANTHROPIC_AUTH_TOKEN, 'settings-token');
  assert.equal(claudeEnvironment.ANTHROPIC_BASE_URL, 'https://gateway.example.test');
  assert.equal(claudeEnvironment.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY, 'true');
  assert.equal(claudeEnvironment.CLAUDE_CODE_USE_POWERSHELL_TOOL, undefined);
  assert.equal(claudeEnvironment.BASH_ENV, undefined);
  const codexEnvironment = processLaunch.resolveAgentProcessEnvironment('codex', inherited);
  assert.equal(codexEnvironment.ANTHROPIC_AUTH_TOKEN, undefined);
});

test('Settings persistieren Revision/Provider/Slug und deduplizieren Argumente mit Modellvorrang', () => {
  const saved = useClaude();
  assert.deepEqual(settings.getTestingAgentSettings(), saved);
  const resolved = settings.resolveAgentConfiguration();
  assert.equal(resolved.provider, 'claude');
  assert.equal(resolved.modelSlug, 'claude-custom[1m]');
  assert.deepEqual(resolved.args, ['--effort', 'high', '--max-budget-usd', '1']);
  assert.throws(() => settings.saveTestingAgentSettings({ ...saved, revision: 0 }), /inzwischen geändert/);
  assert.throws(() => settings.resolveAgentConfiguration('unbekannt'), /nicht konfiguriert/);
});

test('Quoting wird ohne Shell ausgewertet; reservierte Flags und versteckte Konfigurationsausbrüche werden abgelehnt', () => {
  assert.deepEqual(settings.parseExtraArgs('--effort "high"'), ['--effort', 'high']);
  assert.deepEqual(settings.validateExtraArgs('codex', '-c \'model_reasoning_effort="high"\' -c model_verbosity=low'), ['-c', 'model_reasoning_effort="high"', '-c', 'model_verbosity="low"']);
  assert.deepEqual(settings.validateExtraArgs('claude', '--effort low --effort=high'), ['--effort', 'high']);
  for (const args of ['--tools Bash', '--model other', '--output-format text', '--dangerously-skip-permissions', '--plugin-dir /tmp/plugin', '--effort high; touch /tmp/never-run']) assert.throws(() => settings.validateExtraArgs('claude', args));
  for (const args of ['--sandbox danger-full-access', '-c approval_policy=never', '-c shell_environment_policy.inherit=all', '--output-schema /tmp/other', '-C /tmp']) assert.throws(() => settings.validateExtraArgs('codex', args));
  assert.throws(() => settings.parseExtraArgs('--effort "high'), /nicht geschlossen/);
  assert.throws(() => settings.parseExtraArgs(['--effort', 'high\n--tools Bash']));
});

test('Claude startet Print/Stream/Schema mit sicheren Lesewerkzeugen und übernimmt nur structured_output', async () => {
  const result = await cli.invokeCodex(input('claude-success', 'custom-claude', 'Prompt mit $() und `Text`, nur stdin.'));
  assert.deepEqual(result.value, { provider: 'claude', model: 'claude-custom[1m]' });
  const observed = JSON.parse(readFileSync(join(result.directory, 'fixture-observed.json'), 'utf8'));
  assert.equal(observed.args.includes('--safe-mode'), true);
  assert.equal(observed.args.includes('--bare'), false);
  assert.equal(observed.args[observed.args.indexOf('--tools') + 1], 'Read,Glob,Grep');
  assert.equal(observed.args[observed.args.indexOf('--permission-mode') + 1], 'dontAsk');
  assert.equal(observed.args[observed.args.indexOf('--output-format') + 1], 'stream-json');
  assert.equal(observed.args[observed.args.indexOf('--json-schema') + 1], '{"type":"object"}');
  assert.equal(observed.cwd, realpathSync(result.directory));
  assert.match(observed.prompt, /\$\(\)/);
  await assert.rejects(cli.invokeCodex(input('claude-error', 'custom-claude', 'FAIL_RESULT')), /fehlgeschlagenen Auftrag/);
  await assert.rejects(cli.invokeCodex(input('claude-error-exit', 'custom-claude', 'FAIL_EXIT')), /Fehlercode 1.*Synthetischer Providerfehler/);
  await assert.rejects(cli.invokeCodex(input('claude-missing', 'custom-claude', 'MISSING_STRUCTURED')), /kein structured_output/);
});

test('Ein Konfigurationssnapshot gilt nach Settingsänderung für Unteraufrufe und Korrekturen weiter', async () => {
  const snapshot = settings.resolveAgentConfiguration('custom-claude');
  await settings.withAgentConfiguration(snapshot, async () => {
    const current = settings.getTestingAgentSettings();
    settings.saveTestingAgentSettings({ ...current, models: current.models.map(model => model.id === 'custom-claude' ? { ...model, slug: 'changed-slug', extraArgs: '--effort low' } : model) });
    await Promise.resolve();
    assert.deepEqual(settings.resolveAgentConfiguration('custom-claude'), snapshot);
    const result = await cli.invokeCodex(input('claude-correction', 'custom-claude'));
    assert.equal(result.model, snapshot.modelSlug);
    const manifest = JSON.parse(readFileSync(join(result.directory, 'manifest.json'), 'utf8'));
    assert.equal(manifest.settingsRevision, snapshot.settingsRevision);
    assert.equal(manifest.args[manifest.args.indexOf('--effort') + 1], 'high');
  });
  assert.equal(settings.resolveAgentConfiguration('custom-claude').modelSlug, 'changed-slug');
  const hostile = { ...snapshot, args: ['--tools', 'Bash'] } as TestingAgentConfiguration;
  assert.throws(() => cli.buildAgentArguments(hostile, directory, {}, 'session'), /nicht freigegeben/);
});

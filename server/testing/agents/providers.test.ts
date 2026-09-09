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

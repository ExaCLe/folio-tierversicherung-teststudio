import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, appendFile, rm } from 'node:fs/promises';
import { existsSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import type { TestingAgentConfiguration, TestingAgentEvent, TestingModel } from '../../../shared/testing';

import { DEFAULT_CODEX_MODELS, providerExecutable, resolveAgentConfiguration, validateExtraArgs } from './settings';
import { AgentTerminationError, agentAbortError } from './termination';

export const CODEX_MODELS = DEFAULT_CODEX_MODELS;
export const AGENT_ARTIFACTS_ROOT = resolve(process.env.FOLIO_AGENT_ARTIFACTS_ROOT ?? '.local/testing/agents');
const processes = new Map<string, ChildProcess>();
let hooksInstalled = false;
let activeCalls = 0;
const waitingCalls: (() => void)[] = [];

export interface CodexInvocation {
  id: string; model: TestingModel; prompt: string; schema: Record<string, unknown>;
  files: Record<string, string>; signal?: AbortSignal;
  onEvent?: (event: TestingAgentEvent) => void;
  agentConfig?: TestingAgentConfiguration;
}
export interface CodexResult { value: unknown; directory: string; model: string; contextHash: string; provider?: 'codex' | 'claude'; }

export function redactCLIText(value: string): string {
  return value.replace(/\b(sk-[a-zA-Z0-9_-]{16,}|Bearer\s+[a-zA-Z0-9._-]+)\b/g, '[ZUGANGSDATEN ENTFERNT]')
    .replace(/("?(?:access_token|refresh_token|id_token|api_key)"?\s*[:=]\s*)"?[^\s",}]+"?/gi, '$1"[ENTFERNT]"');
}
export function codexExecutable(): string { return providerExecutable('codex'); }
export function codexConfiguration() {
  return { executable: codexExecutable(), models: CODEX_MODELS, timeoutMs: codexTimeout(), sandbox: 'read-only', maxConcurrentCalls: 2,
    invocation: 'codex exec --json --output-schema schema.json -o result.json -m MODELL -C ARBEITSVERZEICHNIS -',
    explanation: 'Der Prompt wird über stdin übergeben. -p bezeichnet ein Codex-Profil, keinen Prompt. Die bestehende lokale CLI-Anmeldung wird verwendet.' };
}
function codexTimeout(): number { const n = Number(process.env.FOLIO_CODEX_TIMEOUT_MS ?? 300_000); return Number.isFinite(n) ? Math.max(5_000, Math.min(n, 1_800_000)) : 300_000; }
function killTree(child: ChildProcess) {
  if (!child.pid) return;
  try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
  const timer = setTimeout(() => { try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* already gone */ } }, 2_000);
  timer.unref();
}
export function stopCodexProcesses() { for (const child of processes.values()) killTree(child); }
export function recoverCodexJobProcesses(jobId: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(jobId) || !existsSync(AGENT_ARTIFACTS_ROOT)) return;
  for (const entry of readdirSync(AGENT_ARTIFACTS_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory() || !(entry.name === jobId || entry.name.startsWith(`${jobId}-`))) continue;
    const directory = resolve(AGENT_ARTIFACTS_ROOT, entry.name), path = resolve(directory, 'process.json');
    if (!existsSync(path)) continue;
    try {
      const record = JSON.parse(readFileSync(path, 'utf8'));
      if (!Number.isInteger(record.pid) || record.pid < 2 || record.pid === process.pid) continue;
      const command = execFileSync('ps', ['-p', String(record.pid), '-o', 'command='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      // Verify the still-running executable and the unguessable exact invocation
      // directory before terminating a PID recovered after an abrupt server exit.
      const marker = record.provider === 'claude' ? record.sessionId : resolve(directory, 'schema.json');
      const executableName = typeof record.executable === 'string' ? basename(record.executable) : 'codex';
      if (!marker || !command.includes(executableName) || !command.includes(marker)) continue;
      try { process.kill(-record.pid, 'SIGTERM'); } catch { process.kill(record.pid, 'SIGTERM'); }
    } catch { /* The recorded process already exited. */ }
    finally { rmSync(path, { force: true }); }
  }
}
function installHooks() {
  if (hooksInstalled) return; hooksInstalled = true;
  process.once('exit', stopCodexProcesses);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { stopCodexProcesses(); process.exit(signal === 'SIGINT' ? 130 : 143); });
}
function eventMessage(event: any): Pick<TestingAgentEvent, 'kind' | 'message'> | undefined {
  if (event.type === 'thread.started') return { kind: 'status', message: 'Codex-Sitzung gestartet.' };
  if (event.type === 'turn.started') return { kind: 'status', message: 'Der Agent bearbeitet den Auftrag.' };
  if (event.type === 'turn.completed') return { kind: 'status', message: 'Codex hat ein Ergebnis geliefert.' };
  if (event.type === 'error' || event.type === 'turn.failed') return { kind: 'error', message: redactCLIText(String(event.message ?? event.error?.message ?? 'Codex hat den Auftrag abgebrochen.')).slice(0, 2000) };
  const item = event.item;
  if (!item) return undefined;
  if (item.type === 'agent_message' && event.type === 'item.completed') {
    const value = String(item.text ?? '');
    return { kind: 'message', message: value.trim().startsWith('{') ? 'Der Agent hat sein strukturiertes Ergebnis abgegeben. Die Anwendung prüft jetzt Schema und Verweise.' : redactCLIText(value).slice(0, 2000) };
  }
  if (item.type === 'command_execution' && event.type === 'item.started') return { kind: 'tool', message: `Kontext lesen: ${redactCLIText(String(item.command ?? 'Lokaler Lesevorgang')).slice(0, 600)}` };
  return undefined;
}

export function buildAgentArguments(configuration: TestingAgentConfiguration, directory: string, schema: Record<string, unknown>, sessionId: string): string[] {
  const extraArgs = validateExtraArgs(configuration.provider, configuration.args);
  if (configuration.provider === 'codex') return ['exec', ...extraArgs, '--ignore-user-config', '--ephemeral', '--json', '--color', 'never', '--sandbox', 'read-only',
    '-c', 'approval_policy="never"', '--skip-git-repo-check', '--output-schema', resolve(directory, 'schema.json'), '-o', resolve(directory, 'result.json'), '-m', configuration.modelSlug, '-C', directory, '-'];
  return [...extraArgs, '--print', '--output-format', 'stream-json', '--verbose', '--input-format', 'text', '--json-schema', JSON.stringify(schema), '--model', configuration.modelSlug,
    '--safe-mode', '--permission-mode', 'dontAsk', '--tools', 'Read,Glob,Grep', '--allowedTools', 'Read,Glob,Grep', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
    '--setting-sources', '', '--no-session-persistence', '--no-chrome', '--disable-slash-commands', '--session-id', sessionId];
}
export function extractClaudeStructuredOutput(event: unknown): unknown {
  if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error('Claude Code hat kein Ergebnisobjekt geliefert.');
  const result = event as Record<string, unknown>;
  if (result.type !== 'result' || result.is_error === true || result.subtype !== 'success') {
    const detail = Array.isArray(result.errors) ? result.errors.join(' ') : typeof result.result === 'string' ? result.result : String(result.subtype ?? 'Unbekannter Ergebnisstatus');
    throw new Error(`Claude Code meldet einen fehlgeschlagenen Auftrag: ${redactCLIText(detail).slice(0, 2000)}`);
  }
  if (!Object.hasOwn(result, 'structured_output') || result.structured_output === undefined) throw new Error('Claude Code hat kein structured_output gemäß JSON-Schema geliefert.');
  return result.structured_output;
}
function claudeEventMessage(event: any): Pick<TestingAgentEvent, 'kind' | 'message'> | undefined {
  if (event.type === 'system' && event.subtype === 'init') return { kind: 'status', message: 'Claude-Code-Sitzung mit ausschließlich lesenden Werkzeugen gestartet.' };
  if (event.type === 'assistant' && Array.isArray(event.message?.content)) {
    const tool = event.message.content.find((item: any) => item.type === 'tool_use');
    if (tool) return { kind: 'tool', message: `Kontext lesen: ${String(tool.name ?? 'Lesevorgang').slice(0, 80)}` };
  }
  if (event.type === 'result') return { kind: event.is_error || event.subtype !== 'success' ? 'error' : 'status', message: event.is_error || event.subtype !== 'success' ? 'Claude Code meldet einen fehlgeschlagenen Auftrag.' : 'Claude Code hat sein strukturiertes Ergebnis geliefert. Die Anwendung prüft jetzt Schema und Verweise.' };
  return undefined;
}

/** The CLI owns authentication. This adapter never reads or copies authentication files. */
export async function invokeCodex(input: CodexInvocation): Promise<CodexResult> {
  if (input.signal?.aborted) throw agentAbortError(input.signal);
  const configured = { ...input, agentConfig: input.agentConfig ?? resolveAgentConfiguration(input.model) };
  await new Promise<void>((done, reject) => {
    const start = () => { input.signal?.removeEventListener('abort', cancel); activeCalls += 1; done(); };
    const cancel = () => { const index = waitingCalls.indexOf(start); if (index >= 0) waitingCalls.splice(index, 1); reject(agentAbortError(input.signal)); };
    if (activeCalls < 2) start();
    else { waitingCalls.push(start); input.signal?.addEventListener('abort', cancel, { once: true }); input.onEvent?.({ id: randomUUID(), at: new Date().toISOString(), kind: 'status', message: 'Wartet auf einen der zwei lokalen Agentenplätze.' }); }
  });
  try { return await invokeCodexAcquired(configured); }
  finally { activeCalls -= 1; waitingCalls.shift()?.(); }
}
async function invokeCodexAcquired(input: CodexInvocation): Promise<CodexResult> {
  const configuration = input.agentConfig ?? resolveAgentConfiguration(input.model);
  const providerName = configuration.provider === 'claude' ? 'Claude Code' : 'Codex';
  if (!/^[a-zA-Z0-9_-]+$/.test(input.id)) throw new Error('Ungültige Agentenlauf-ID.');
  if (input.signal?.aborted) throw agentAbortError(input.signal);
  installHooks();
  const directory = resolve(AGENT_ARTIFACTS_ROOT, input.id);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await rm(resolve(directory, 'result.json'), { force: true });
  const names = Object.keys(input.files).sort();
  for (const name of names) {
    if (!/^[a-zA-Z0-9_.-]+$/.test(name)) throw new Error('Ungültiger Kontextdateiname.');
    await writeFile(resolve(directory, name), input.files[name], { mode: 0o600 });
  }
  const contextHash = createHash('sha256').update(names.map(name => `${name}\n${input.files[name]}`).join('\n')).digest('hex');
  await writeFile(resolve(directory, 'prompt.md'), input.prompt, { mode: 0o600 });
  await writeFile(resolve(directory, 'schema.json'), JSON.stringify(input.schema, null, 2), { mode: 0o600 });
  const sessionId = randomUUID();
  const args = buildAgentArguments(configuration, directory, input.schema, sessionId);
  await writeFile(resolve(directory, 'manifest.json'), JSON.stringify({ id: input.id, model: configuration.modelSlug, provider: configuration.provider, modelId: configuration.modelId,
    modelLabel: configuration.modelLabel, settingsRevision: configuration.settingsRevision, executable: configuration.executable, args,
    contextHash, files: names, createdAt: new Date().toISOString(), sandbox: configuration.provider === 'codex' ? 'read-only' : 'read-tools-only', timeoutMs: codexTimeout() }, null, 2), { mode: 0o600 });
  let queuedWrites = Promise.resolve();
  function publish(value: Pick<TestingAgentEvent, 'kind' | 'message'>) {
    const event = { id: randomUUID(), at: new Date().toISOString(), ...value };
    queuedWrites = queuedWrites.then(() => appendFile(resolve(directory, 'events.jsonl'), `${JSON.stringify(event)}\n`, { mode: 0o600 }));
    input.onEvent?.(event);
  }
  publish({ kind: 'status', message: `${configuration.modelLabel} wird als ${configuration.modelSlug} mit ${providerName} aufgerufen.` });
  let claudeResult: unknown;
  let resultCount = 0;
  let resultError: Error | undefined;
  const processLine = (line: string) => {
    let event: any; try { event = JSON.parse(line); } catch { return; }
    if (configuration.provider === 'claude') {
      if (event.type === 'result') {
        resultCount += 1;
        try { claudeResult = extractClaudeStructuredOutput(event); } catch (error) { resultError = error as Error; publish({ kind: 'error', message: resultError.message }); }
      }
      const message = claudeEventMessage(event); if (message && !(event.type === 'result' && resultError)) publish(message);
    } else { const message = eventMessage(event); if (message) publish(message); }
  };
  if (input.signal?.aborted) throw agentAbortError(input.signal,'Der Agentenlauf wurde vor dem CLI-Start abgebrochen; der Auslöser ist nicht bekannt.');
  await new Promise<void>((done, reject) => {
    const child = spawn(configuration.executable, args, { cwd: directory, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32', env: { ...process.env } });
    processes.set(input.id, child);
    if (child.pid) writeFileSync(resolve(directory, 'process.json'), JSON.stringify({ pid: child.pid, ownerPid: process.pid, startedAt: new Date().toISOString(), provider: configuration.provider, executable: configuration.executable, ...(configuration.provider === 'claude' ? { sessionId } : {}) }), { mode: 0o600 });
    let buffer = '', stderr = '', size = 0, overflow = false;
    let stopped:AgentTerminationError|undefined;
    const cancel = () => { stopped ??= agentAbortError(input.signal); killTree(child); };
    input.signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => { stopped ??= new AgentTerminationError('time_limit',`${providerName} hat das Zeitlimit von ${Math.round(codexTimeout() / 1000)} Sekunden überschritten.`,codexTimeout()); killTree(child); }, codexTimeout());
    child.stdout?.setEncoding('utf8'); child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      size += chunk.length;
      if (size > 8_000_000) { overflow = true; killTree(child); return; }
      buffer += chunk;
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        processLine(line);
      }
    });
    child.stderr?.on('data', (chunk: string) => { stderr = redactCLIText((stderr + chunk).slice(-12_000)); });
    child.stdin?.on('error', () => { /* close/error gives the authoritative process result */ });
    child.stdin?.end(input.prompt);
    child.once('error', error => reject(new Error(`${providerName} konnte nicht gestartet werden: ${error.message}. Prüfe den CLI-Pfad in den Einstellungen und die lokale Installation.`)));
    child.once('close', code => {
      if (buffer.trim()) processLine(buffer);
      clearTimeout(timer); input.signal?.removeEventListener('abort', cancel); processes.delete(input.id);
      rmSync(resolve(directory, 'process.json'), { force: true });
      if (stopped) reject(stopped);
      else if (overflow) reject(new AgentTerminationError('output_limit',`${providerName} hat das zulässige Ausgabevolumen überschritten.`));
      else if (code !== 0) reject(new Error(`${providerName} ist mit Fehlercode ${code ?? 'unbekannt'} beendet worden. ${resultError?.message || stderr.slice(-2500).trim() || 'Prüfen Sie die lokale Anmeldung und den Zugang zum gewählten Modell.'}`));
      else done();
    });
  });
  await queuedWrites;
  if (configuration.provider === 'claude') {
    if (resultError) throw resultError;
    if (resultCount !== 1 || claudeResult === undefined) throw new Error('Claude Code hat kein eindeutiges strukturiertes JSON-Ergebnis geliefert. Der Entwurf wurde nicht übernommen.');
    await writeFile(resolve(directory, 'result.json'), JSON.stringify(claudeResult, null, 2), { mode: 0o600 });
  }
  let value: unknown;
  try { value = JSON.parse(await readFile(resolve(directory, 'result.json'), 'utf8')); }
  catch { throw new Error(`${providerName} hat kein gültiges JSON-Ergebnis gemäß Ausgabevertrag geliefert. Der Entwurf wurde nicht übernommen.`); }
  return { value, directory, model: configuration.modelSlug, provider: configuration.provider, contextHash };
}

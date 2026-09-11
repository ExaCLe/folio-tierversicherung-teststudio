import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, appendFile, rm } from 'node:fs/promises';
import { existsSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import type { TestingAgentConfiguration, TestingAgentEvent, TestingAgentMetrics, TestingModel } from '../../../shared/testing';

import { DEFAULT_CODEX_MODELS, providerExecutable, resolveAgentConfiguration, validateExtraArgs } from './settings';
import { resolveAgentProcessEnvironment, resolveAgentProcessLaunch } from './process-launch';
import { AgentTerminationError, agentAbortError } from './termination';
import { startCodexMetricsReceiver } from './metrics-receiver';

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
type InvocationMetrics = Omit<TestingAgentMetrics, 'elapsedMs'> & { elapsedMs?: number };

const finiteMetric = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
export function providerInvocationMetrics(event: any): InvocationMetrics | undefined {
  if (event?.type === 'turn.completed') {
    const usage = event.usage ?? event.turn?.usage;
    if (!usage || typeof usage !== 'object') return { requestCount: 1 };
    const inputTokens=finiteMetric(usage.input_tokens),cachedInputTokens=finiteMetric(usage.cached_input_tokens),outputTokens=finiteMetric(usage.output_tokens),reportedTotal=finiteMetric(usage.total_tokens);
    const totalTokens=reportedTotal ?? (inputTokens !== undefined && outputTokens !== undefined ? inputTokens + outputTokens : undefined);
    return {requestCount:1,...(inputTokens!==undefined?{inputTokens}:{}),...(cachedInputTokens!==undefined?{cachedInputTokens}:{}),...(outputTokens!==undefined?{outputTokens}:{}),...(totalTokens!==undefined?{totalTokens}:{})};
  }
  if (event?.type === 'result') {
    const usage = event.usage;
    const requestCount=1;
    const modelTurnCount=finiteMetric(event.num_turns);
    if (!usage || typeof usage !== 'object') return { requestCount,...(modelTurnCount!==undefined?{modelTurnCount}:{}) };
    const inputTokens=finiteMetric(usage.input_tokens),cacheRead=finiteMetric(usage.cache_read_input_tokens),cacheCreation=finiteMetric(usage.cache_creation_input_tokens),cachedInputTokens=cacheRead!==undefined||cacheCreation!==undefined?(cacheRead??0)+(cacheCreation??0):undefined,outputTokens=finiteMetric(usage.output_tokens),reportedTotal=finiteMetric(usage.total_tokens);
    const totalTokens=reportedTotal ?? (inputTokens !== undefined && outputTokens !== undefined ? inputTokens + (cachedInputTokens??0) + outputTokens : undefined);
    return {requestCount,...(modelTurnCount!==undefined?{modelTurnCount}:{}),...(inputTokens!==undefined?{inputTokens}:{}),...(cachedInputTokens!==undefined?{cachedInputTokens}:{}),...(outputTokens!==undefined?{outputTokens}:{}),...(totalTokens!==undefined?{totalTokens}:{})};
  }
}

function mergeInvocationMetrics(current: InvocationMetrics | undefined, next: InvocationMetrics): InvocationMetrics {
  const merged: InvocationMetrics = { requestCount: Math.max(current?.requestCount ?? 0, next.requestCount) };
  for (const key of ['apiRequestCount','modelTurnCount','inputTokens','cachedInputTokens','outputTokens','totalTokens'] as const) { const value=next[key] ?? current?.[key]; if(value!==undefined)merged[key]=value; }
  return merged;
}

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
type PublicProviderEvent = Pick<TestingAgentEvent, 'kind' | 'message'> & Partial<TestingAgentEvent>;
function publicText(value: unknown, limit = 20_000): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = redactCLIText(value).trim();
  if (!text) return undefined;
  return text.length <= limit ? text : `${text.slice(0, limit)}\n[Ausgabe nach ${limit} Zeichen gekürzt.]`;
}
function providerEventId(provider: 'codex' | 'claude', value: unknown): string | undefined {
  return typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,300}$/.test(value) ? `${provider}:${value}` : undefined;
}
/** Convert only prose which Codex deliberately places in its public JSONL stream. */
export function codexPublicEvents(event: any, scope = 'codex'): PublicProviderEvent[] {
  if (event.type === 'thread.started') return [{ kind: 'status', message: 'Codex-Sitzung gestartet.' }];
  if (event.type === 'turn.started') return [{ kind: 'status', message: 'Der Agent bearbeitet den Auftrag.' }];
  // Completion and agent_message events are unvalidated provider output. The
  // orchestrator publishes a curated summary only after decoding and domain
  // validation have succeeded.
  if (event.type === 'turn.completed') return [];
  if (event.type === 'error' || event.type === 'turn.failed') return [{ kind: 'error', message: redactCLIText(String(event.message ?? event.error?.message ?? 'Codex hat den Auftrag abgebrochen.')).slice(0, 2000) }];
  const item = event.item;
  if (!item) return [];
  const streamId = providerEventId('codex', item.id)?.replace(/^codex/, scope);
  const stream = streamId ? { providerEventId: streamId, status: event.type === 'item.completed' ? 'completed' as const : 'streaming' as const } : undefined;
  if (item.type === 'reasoning' && /^item\.(?:started|updated|completed)$/.test(event.type)) {
    const value = publicText(item.text);
    return value ? [{ ...(streamId ? { id: streamId, stream } : {}), kind: 'message', message: value, publicDetail: { type: 'reasoning', label: 'Begründungszusammenfassung' } }] : [];
  }
  if (item.type === 'agent_message' && /^item\.(?:started|updated|completed)$/.test(event.type)) {
    const value = publicText(item.text);
    return value && !/^[\[{]/.test(value) ? [{ ...(streamId ? { id: streamId, stream } : {}), kind: 'message', message: value, publicDetail: { type: 'message', label: 'Agentenausgabe' } }] : [];
  }
  if (item.type === 'command_execution' && event.type === 'item.started') return [{ kind: 'tool', message: `Kontext lesen: ${redactCLIText(String(item.command ?? 'Lokaler Lesevorgang')).slice(0, 600)}` }];
  return [];
}

export function buildAgentArguments(configuration: TestingAgentConfiguration, directory: string, schema: Record<string, unknown>, sessionId: string,otelEndpoint?:string): string[] {
  const extraArgs = validateExtraArgs(configuration.provider, configuration.args);
  if (configuration.provider === 'codex') return ['exec', ...extraArgs, '--ignore-user-config', '--ephemeral', '--json', '--color', 'never', '--sandbox', 'read-only',
    '-c', 'approval_policy="never"', '-c', 'hide_agent_reasoning=false', '-c', 'model_reasoning_summary="auto"',...(otelEndpoint?['-c',`otel.exporter={ otlp-http = { endpoint = "${otelEndpoint}", protocol = "json" } }`,'-c','otel.log_user_prompt=false']:[]), '--skip-git-repo-check', '--output-schema', resolve(directory, 'schema.json'), '-o', resolve(directory, 'result.json'), '-m', configuration.modelSlug, '-C', directory, '-'];
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
/** Claude documents non-empty `thinking` text as a public reasoning summary. Its
 * encrypted `signature` is intentionally never copied. */
export function claudePublicEvents(event: any, scope = 'claude'): PublicProviderEvent[] {
  if (event.type === 'system' && event.subtype === 'init') return [{ kind: 'status', message: 'Claude-Code-Sitzung mit ausschließlich lesenden Werkzeugen gestartet.' }];
  if (event.type === 'assistant' && Array.isArray(event.message?.content)) {
    return event.message.content.flatMap((item: any, index: number): PublicProviderEvent[] => {
      if (item.type === 'tool_use') return [{ kind: 'tool', message: `Kontext lesen: ${String(item.name ?? 'Lesevorgang').slice(0, 80)}` }];
      const streamId = typeof event.message.id === 'string' ? providerEventId('claude', `${event.message.id}:${index}`)?.replace(/^claude/, scope) : undefined;
      if (item.type === 'thinking') {
        const value = publicText(item.thinking);
        return value ? [{ ...(streamId ? { id: streamId, stream: { providerEventId: streamId, status: 'completed' as const } } : {}), kind: 'message', message: value, publicDetail: { type: 'reasoning', label: 'Begründungszusammenfassung' } }] : [];
      }
      if (item.type !== 'text') return [];
      const value = publicText(item.text);
      return value && !/^[\[{]/.test(value) ? [{ ...(streamId ? { id: streamId, stream: { providerEventId: streamId, status: 'completed' as const } } : {}), kind: 'message', message: value, publicDetail: { type: 'message', label: 'Agentenausgabe' } }] : [];
    });
  }
  if (event.type === 'result') return event.is_error || event.subtype !== 'success' ? [{ kind: 'error', message: 'Claude Code meldet einen fehlgeschlagenen Auftrag.' }] : [];
  return [];
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
  await rm(resolve(directory, 'events.jsonl'), { force: true });
  const names = Object.keys(input.files).sort();
  for (const name of names) {
    if (!/^[a-zA-Z0-9_.-]+$/.test(name)) throw new Error('Ungültiger Kontextdateiname.');
    await writeFile(resolve(directory, name), input.files[name], { mode: 0o600 });
  }
  const contextHash = createHash('sha256').update(names.map(name => `${name}\n${input.files[name]}`).join('\n')).digest('hex');
  await writeFile(resolve(directory, 'prompt.md'), input.prompt, { mode: 0o600 });
  await writeFile(resolve(directory, 'schema.json'), JSON.stringify(input.schema, null, 2), { mode: 0o600 });
  const sessionId = randomUUID();
  const baseArgs=buildAgentArguments(configuration,directory,input.schema,sessionId);
  const metricsReceiver=configuration.provider==='codex'?await startCodexMetricsReceiver():undefined;
  const args = metricsReceiver?buildAgentArguments(configuration,directory,input.schema,sessionId,metricsReceiver.endpoint):baseArgs;
  let launch;
  try { launch = resolveAgentProcessLaunch(configuration.executable, args); }
  catch (cause) { await metricsReceiver?.close();throw new Error(`${providerName} konnte nicht gestartet werden: ${cause instanceof Error ? cause.message : String(cause)}`); }
  const persistedArgs=args.map(value=>metricsReceiver&&value.includes(metricsReceiver.endpoint)?value.replace(metricsReceiver.endpoint,'http://127.0.0.1:[LOKALER-METRIKEMPFÄNGER]'):value);
  try{await writeFile(resolve(directory, 'manifest.json'), JSON.stringify({ id: input.id, model: configuration.modelSlug, provider: configuration.provider, modelId: configuration.modelId,
    modelLabel: configuration.modelLabel, settingsRevision: configuration.settingsRevision, executable: configuration.executable, launchExecutable: launch.executable, args:persistedArgs,
    contextHash, files: names, createdAt: new Date().toISOString(), sandbox: configuration.provider === 'codex' ? 'read-only' : 'read-tools-only', timeoutMs: codexTimeout() }, null, 2), { mode: 0o600 });}catch(error){await metricsReceiver?.close();throw error;}
  let queuedWrites = Promise.resolve();
  function publish(value: PublicProviderEvent) {
    const event = { id: value.id ?? randomUUID(), at: new Date().toISOString(), ...value } as TestingAgentEvent;
    queuedWrites = queuedWrites.then(() => appendFile(resolve(directory, 'events.jsonl'), `${JSON.stringify(event)}\n`, { mode: 0o600 }));
    input.onEvent?.(event);
  }
  publish({ kind: 'status', message: `${configuration.modelLabel} wird als ${configuration.modelSlug} mit ${providerName} aufgerufen.` });
  let claudeResult: unknown;
  let resultCount = 0;
  let resultError: Error | undefined;
  let publicReasoningSeen = false;
  let publicMessageSeen = false;
  let invocationMetrics: InvocationMetrics = { requestCount: 1 };
  const processLine = (line: string) => {
    let event: any; try { event = JSON.parse(line); } catch { return; }
    const reportedMetrics=providerInvocationMetrics(event); if(reportedMetrics)invocationMetrics=mergeInvocationMetrics(invocationMetrics,reportedMetrics);
    if (configuration.provider === 'claude') {
      if (event.type === 'result') {
        resultCount += 1;
        try { claudeResult = extractClaudeStructuredOutput(event); } catch (error) { resultError = error as Error; publish({ kind: 'error', message: resultError.message }); }
      }
      if (!(event.type === 'result' && resultError)) for (const message of claudePublicEvents(event, `${input.id}:claude`)) { publicReasoningSeen ||= message.publicDetail?.type === 'reasoning'; publicMessageSeen ||= message.publicDetail?.type === 'message'; publish(message); }
    } else for (const message of codexPublicEvents(event, `${input.id}:codex`)) { publicReasoningSeen ||= message.publicDetail?.type === 'reasoning'; publicMessageSeen ||= message.publicDetail?.type === 'message'; publish(message); }
  };
  if (input.signal?.aborted){await metricsReceiver?.close();throw agentAbortError(input.signal,'Der Agentenlauf wurde vor dem CLI-Start abgebrochen; der Auslöser ist nicht bekannt.');}
  const invocationStarted=Date.now();
  publish({id:`${input.id}:metrics`,kind:'metrics',message:'Modellaufruf gestartet.',metrics:invocationMetrics});
  await new Promise<void>((done, reject) => {
    const child = spawn(launch.executable, launch.args, { cwd: directory, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32', env: resolveAgentProcessEnvironment(configuration.provider) });
    processes.set(input.id, child);
    if (child.pid) writeFileSync(resolve(directory, 'process.json'), JSON.stringify({ pid: child.pid, ownerPid: process.pid, startedAt: new Date().toISOString(), provider: configuration.provider, executable: launch.executable, ...(configuration.provider === 'claude' ? { sessionId } : {}) }), { mode: 0o600 });
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
  }).finally(async()=>{
    const apiRequestCount=await metricsReceiver?.close();
    if(apiRequestCount!==undefined)invocationMetrics={...invocationMetrics,apiRequestCount};
    invocationMetrics={...invocationMetrics,elapsedMs:Date.now()-invocationStarted};
    publish({id:`${input.id}:metrics`,kind:'metrics',message:'Modellaufruf beendet.',metrics:invocationMetrics});
  });
  if (!publicReasoningSeen) publish({ kind: 'status', message: configuration.provider === 'codex'
    ? 'Codex hat für diesen Lauf keine öffentliche Begründungszusammenfassung ausgegeben.'
    : 'Claude Code hat für diesen Lauf keine öffentliche Begründungszusammenfassung ausgegeben.' });
  if (!publicMessageSeen) publish({ kind: 'status', message: `${providerName} hat neben dem strukturierten Ergebnis keinen öffentlichen Begleittext ausgegeben.` });
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

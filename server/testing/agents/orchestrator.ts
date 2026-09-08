import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { TestingAgentJob, TestingBlockInstance, TestingCatalog, TestingCompiledScenario, TestingModel, TestingReuseSuggestion, TestingRun, TestingScenario, TestingScenarioEditProposal, TestingTechnicalPlan, TestingAgentStage, TestingAgentTermination } from '../../../shared/testing';
import { db } from '../../store';
import { getTestingCatalog } from '../catalog';
import { compileTestingMatrixRow, compileTestingScenario, findTestingDuplicates, stableTestingStringify, testingFingerprint } from '../compiler';
import { applyTestingScenarioEdit, createTestingRequestDraft, completeTestingRequestDraft, createTestingScenarioFromDraft, getTestingApproval, getTestingRun, getTestingScenario, listTestingRuns, previewTestingBusinessDraft, saveTestingBinding, saveTestingRun, saveTestingScenario, TestingModelError } from '../repository';
import { executeTestingMatrixRun, executeTestingRun } from '../runner';
import { validateTestingBinding } from '../bindings/validation';
import { invokeCodex, AGENT_ARTIFACTS_ROOT, recoverCodexJobProcesses } from './cli';
import { agentContext, businessPrompt, duplicatePrompt, reusePrompt, technicalPrompt } from './prompts';
import { BUSINESS_SCHEMA, decodeBusinessDraft, decodeDuplicates, decodeReuse, decodeTechnicalPlan, DUPLICATES_SCHEMA, REUSE_SCHEMA, TECHNICAL_SCHEMA, reuseSchemaFor, duplicateSchemaFor } from './schemas';
import { planBusinessWithCodex } from './business';
import { exploreBusinessKnowledge } from './exploration';
import { duplicateReviewContext } from './duplicate-context';
import { planScenarioEdit } from './flow-edit';
import { getTestingAgentSettings, resolveAgentConfiguration, withAgentConfiguration } from './settings';
import { planTechnicalWithCodex } from './technical';
import { reviewWithCodex, validateDuplicateReview, validateReuseReview } from './reviews';
import { AgentTerminationError, agentAbortError, agentTermination } from './termination';
import { nameScenario } from './naming';

const jobs = 'testingAgentJobs';
const controls = new Map<string, AbortController>();
const completions = new Map<string, Promise<TestingAgentJob>>();
const runningRuns = new Set<string>();
let initialized = false;
const now = () => new Date().toISOString();
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
export function initializeTestingPipeline() {
  if (initialized) return; initialized = true;
  for (const job of listTestingJobs()) if (job.status === 'queued' || job.status === 'running') { recoverCodexJobProcesses(job.id);const stopped=new AgentTerminationError('server_restart','Der lokale Server wurde während dieses Agentenlaufs neu gestartet. Bitte den Auftrag erneut starten.');updateJob(job.id,{status:'cancelled',finishedAt:now(),error:stopped.message,termination:stopped.termination}); }
  for (const run of listTestingRuns()) if (run.status === 'queued' || run.status === 'running') saveTestingRun({ ...run, status: 'failed', finishedAt: now(), error: 'Der lokale Server wurde während des Browserlaufs neu gestartet.' });
}
const saveJob = (job: TestingAgentJob) => db.upsert(jobs, structuredClone(job));
export function listTestingJobs(): TestingAgentJob[] { return db.read<TestingAgentJob>(jobs).sort((a, b) => b.startedAt.localeCompare(a.startedAt)); }
export function getTestingJob(id: string): TestingAgentJob { const job = db.find<TestingAgentJob>(jobs, id); if (!job) throw new TestingModelError('Der Agentenlauf wurde nicht gefunden.', 404); return job; }
export function cancelTestingJob(id: string,cause:'user_cancelled'|'parent_cancelled'='user_cancelled'): TestingAgentJob {
  const job = getTestingJob(id);
  if (!['queued', 'running'].includes(job.status)) return job;
  const stopped=new AgentTerminationError(cause,cause==='user_cancelled'?'Der Agentenlauf wurde vom Menschen abgebrochen.':'Der Unterauftrag wurde beendet, weil sein übergeordneter Auftrag beendet wurde.');
  controls.get(id)?.abort(stopped);
  for(const child of listTestingJobs().filter(item=>item.parentJobId===id))cancelTestingJob(child.id,'parent_cancelled');
  return updateJob(id,{status:'cancelled',finishedAt:now(),error:stopped.message,termination:stopped.termination});
}
function updateJob(id: string, patch: Partial<TestingAgentJob>) {
  const current=getTestingJob(id),at=now();let stages=[...(patch.workStages??current.workStages??[])];
  if(patch.stage&&patch.stage!==current.stage){
    stages=stages.map(item=>item.status==='running'?{...item,status:'completed' as const,finishedAt:at}:item);
    stages=[...stages.filter(item=>item.stage!==patch.stage),{stage:patch.stage,status:'running',startedAt:at}];
  }
  if(patch.status&&['completed','failed','cancelled'].includes(patch.status)){
    const result=patch.result as {needsKnowledge?:boolean;run?:TestingRun;compiled?:{valid:boolean};termination?:TestingAgentTermination}|undefined;
    const failed=patch.status!=='completed'||!!result?.needsKnowledge||!!result?.termination||result?.run?.status==='failed'||result?.compiled?.valid===false;
    stages=stages.map(item=>item.status==='running'?{...item,status:failed?'failed' as const:'completed' as const,finishedAt:at}:item);
  }
  return saveJob({...current,...patch,...(stages.length?{workStages:stages}:{})});
}
function addEvent(id: string, event: TestingAgentJob['events'][number]) { const job = getTestingJob(id); saveJob({ ...job, events: [...job.events.slice(-299), event] }); }
function status(id: string, text: string) { addEvent(id, { id: randomUUID(), at: now(), kind: 'status', message: text }); }
function launch(phase: TestingAgentJob['phase'], model: TestingModel, prompt: string, task: (job: TestingAgentJob, signal: AbortSignal) => Promise<unknown>, scenario?: TestingScenario, fingerprint?: string, initialResult?: unknown, metadata: {parentJobId?:string;stage?:TestingAgentStage}={}) {
  const agentConfig = resolveAgentConfiguration(model);
  if (listTestingJobs().filter(job => job.status === 'queued' || job.status === 'running').length >= 12) throw new TestingModelError('Es sind bereits zwölf Agentenaufträge offen. Bitte zuerst einen Auftrag abschließen oder abbrechen.', 429);
  const id = `agent-${randomUUID()}`, controller = new AbortController();
  const job: TestingAgentJob = { id, phase, ...metadata, model: agentConfig.modelId, agentConfig, status: 'queued', prompt, startedAt: now(), events: [], artifactDirectory: resolve(AGENT_ARTIFACTS_ROOT, id),
    ...(metadata.stage?{workStages:[{stage:metadata.stage,status:'running' as const,startedAt:now()}]}:{}),
    ...(scenario ? { scenarioId: scenario.id, scenarioRevision: scenario.revision } : {}), ...(fingerprint ? { fingerprint } : {}), ...(initialResult !== undefined ? { result: initialResult } : {}) };
  saveJob(job); controls.set(id, controller);
  if(metadata.parentJobId){const parent=getTestingJob(metadata.parentJobId);updateJob(parent.id,{childJobIds:[...(parent.childJobIds??[]),id]});}
  const promise = new Promise<TestingAgentJob>(done => setImmediate(() => {
    if (controller.signal.aborted) { controls.delete(id); completions.delete(id); done(getTestingJob(id)); return; }
    updateJob(id, { status: 'running' });
    void withAgentConfiguration(agentConfig, () => task(job, controller.signal)).then(async result => {
      await Promise.all(listTestingJobs().filter(item=>item.parentJobId===job.id).map(item=>waitTestingJob(item.id)));
      if (!controller.signal.aborted) updateJob(id, { status: 'completed', result, finishedAt: now(),...((result as {termination?:TestingAgentTermination})?.termination?{termination:(result as {termination:TestingAgentTermination}).termination}:{}) });
    }).catch(error => {
      const stopped=controller.signal.aborted?agentAbortError(controller.signal):error,termination=agentTermination(stopped);
      updateJob(id, { status: controller.signal.aborted ? 'cancelled' : 'failed', error: message(stopped), finishedAt: now(),...(termination?{termination}:{}) });
      addEvent(id, { id: randomUUID(), at: now(), kind: 'error', message: message(stopped) });
    }).finally(() => { controls.delete(id); done(getTestingJob(id)); completions.delete(id); });
  }));
  completions.set(id, promise);
  return { job, promise };
}
export async function waitTestingJob(id: string) { return await (completions.get(id) ?? Promise.resolve(getTestingJob(id))); }
function assertFresh(scenario: TestingScenario, fingerprint: string) {
  const current = getTestingScenario(scenario.id);
  if (current.revision !== scenario.revision || testingFingerprint(current, getTestingCatalog()) !== fingerprint) throw new TestingModelError('Der fachliche Testfall oder sein Wissensstand hat sich während des Agentenlaufs geändert. Das Ergebnis bleibt als veraltet gespeichert; bitte die aktuelle Fassung erneut prüfen und freigeben.', 409, 'AGENT_REVISION_STALE');
  return current;
}
function requireApproved(id: string, revision: number) {
  const scenario = getTestingScenario(id);
  if (scenario.revision !== revision) throw new TestingModelError('Dieser Auftrag bezieht sich auf eine veraltete Testfallrevision.', 409);
  const catalog = getTestingCatalog(), compiled = compileTestingScenario(scenario, catalog, getTestingApproval(id));
  if (!compiled.valid || !compiled.approval || compiled.approval.fingerprint !== compiled.fingerprint || compiled.approval.scenarioRevision !== revision) throw new TestingModelError('Bitte genau diese fachliche Fassung zuerst prüfen und freigeben.', 409);
  return { scenario, catalog, compiled };
}
function findBlock(blocks: TestingBlockInstance[], id: string): TestingBlockInstance | undefined {
  for (const block of blocks) { if (block.id === id) return block; const nested = findBlock(block.children ?? [], id); if (nested) return nested; }
  return undefined;
}
function replaceBlock(blocks: TestingBlockInstance[], id: string, replacement: TestingBlockInstance): TestingBlockInstance[] {
  return blocks.map(block => block.id === id ? replacement : block.children ? { ...block, children: replaceBlock(block.children, id, replacement) } : block);
}
export function startBusinessJob(input: { request: string; model: TestingModel; scenarioId?: string; revision?: number; instanceId?: string }) {
  if (typeof input.request !== 'string' || input.request.trim().length < 5 || input.request.length > 15_000) throw new TestingModelError('Bitte die fachliche Anforderung mit 5 bis 15.000 Zeichen beschreiben.');
  resolveAgentConfiguration(input.model);
  const catalog=getTestingCatalog(),existing=input.scenarioId?getTestingScenario(input.scenarioId):undefined;
  if(existing&&existing.revision!==input.revision)throw new TestingModelError('Die Anforderung wurde inzwischen geändert. Bitte den gespeicherten aktuellen Stand verwenden.',409);
  if(existing&&listTestingJobs().some(job=>job.scenarioId===existing.id&&!job.parentJobId&&['queued','running'].includes(job.status)))throw new TestingModelError('Für diesen Testfall läuft bereits ein Auftrag.',409);
  const isOverride=!!input.instanceId;
  if(isOverride&&(!existing||!findBlock(existing.blocks,input.instanceId!)))throw new TestingModelError('Die lokale Änderung braucht einen vorhandenen Zielblock.',409);
  if(existing&&!isOverride&&existing.blocks.length)throw new TestingModelError('Dieser Testfall enthält bereits einen Ablauf. Verwende die Ablaufüberarbeitung, um ihn gezielt zu ändern.',409);
  let baseline=existing?(!isOverride&&input.request!==existing.intent?saveTestingScenario({...existing,intent:input.request},existing.revision):existing):createTestingRequestDraft(input.request,input.model),fingerprint=testingFingerprint(baseline,catalog);
  const needsName=!isOverride&&(!existing||!existing.naming&&(existing.title==='Neuer Testfall'||existing.source==='agent'&&existing.title===existing.intent.trim().split('\n')[0].slice(0,100))||!!existing&&input.request!==existing.intent);
  return launch('business',input.model,input.request,async(job,signal)=>{
    let exploration:Awaited<ReturnType<typeof exploreBusinessKnowledge>>|undefined;
    let namingError:string|undefined;
    if(needsName){
      let naming:ReturnType<typeof launch>|undefined;
      try{
        const namingModel=getTestingAgentSettings().models.find(model=>model.provider==='codex'&&model.slug==='gpt-5.6-luna');
        if(namingModel)naming=launch('naming',namingModel.id,'Testtitel und Metadaten aus der Anforderung bestimmen.',async(child,childSignal)=>(await nameScenario({id:child.id,request:input.request,existingTitle:existing?.title,model:namingModel.id,signal:childSignal,onEvent:event=>addEvent(child.id,event)})).parsed,baseline,fingerprint,undefined,{parentJobId:job.id,stage:'naming'});
        else namingError='Die automatische Benennung ist nicht verfügbar: Es ist kein Luna-Modell eingerichtet. Der Testfall bleibt mit seinem bisherigen Titel bearbeitbar.';
      }catch(error){namingError=`Die automatische Benennung konnte nicht gestartet werden: ${message(error)} Der bisherige Titel bleibt bearbeitbar.`;}
      if(naming){
        const named=await naming.promise;
        assertFresh(baseline,fingerprint);
        if(signal.aborted)throw agentAbortError(signal);
        if(named.status==='completed'){
          const metadata=named.result as Awaited<ReturnType<typeof nameScenario>>['parsed'];
          const preserveTitle=!!existing&&existing.title!=='Neuer Testfall'&&!(existing.source==='agent'&&!existing.naming&&existing.title===existing.intent.trim().split('\n')[0].slice(0,100))&&metadata.titleSource!=='user-request';
          const title=preserveTitle?baseline.title:metadata.title;
          baseline=saveTestingScenario({...baseline,title,naming:{title,summary:metadata.summary,tags:metadata.tags,titleSource:preserveTitle?(existing?.naming?.title===title?existing.naming.titleSource:'human'):metadata.titleSource,jobId:named.id}},baseline.revision);
          fingerprint=testingFingerprint(baseline,getTestingCatalog());
          updateJob(job.id,{scenarioRevision:baseline.revision,fingerprint,result:{scenario:baseline,applied:false,namingJobId:named.id}});
        }else namingError=named.error??'Die automatische Benennung konnte nicht abgeschlossen werden.';
      }
      if(namingError){status(job.id,namingError);updateJob(job.id,{workStages:(getTestingJob(job.id).workStages??[]).map(stage=>stage.stage==='naming'?{...stage,status:'failed',finishedAt:now(),summary:namingError}:stage)});}
    }
    if(!isOverride){
      updateJob(job.id,{stage:'knowledge'});
      const child=launch('exploration',input.model,'Vorhandenes Wissen prüfen und fehlende Fähigkeiten in einer isolierten Anwendung erkunden.',async(childJob,childSignal)=>{
        const discovered=await exploreBusinessKnowledge({id:childJob.id,request:input.request,model:input.model,catalog,signal:childSignal,onStage:stage=>{updateJob(childJob.id,{stage});updateJob(job.id,{stage});},onProgress:progress=>{updateJob(childJob.id,{progress});updateJob(job.id,{progress});},onEvent:event=>addEvent(childJob.id,event)});
        assertFresh(baseline,fingerprint);return discovered;
      },baseline,fingerprint,undefined,{parentJobId:job.id,stage:'knowledge'});
      const completed=await child.promise;
      if(completed.status!=='completed'){
        const text=`Die Wissensprüfung konnte nicht abgeschlossen werden: ${completed.error??'Kein Ergebnis.'}`;
        if(completed.termination)throw new AgentTerminationError(completed.termination.cause,text,completed.termination.limitMs);
        throw new Error(text);
      }
      exploration=completed.result as Awaited<ReturnType<typeof exploreBusinessKnowledge>>;
      const unanswered=(exploration.questions??[]).filter(question=>question.status==='open').map(question=>question.text);
      const openQuestions=[...new Set([...exploration.openQuestions,...unanswered])];
      if(openQuestions.length)return {scenario:baseline,applied:false,needsKnowledge:true,explorationJobId:child.job.id,openQuestions,questions:exploration.questions??[],...(namingError?{namingError}:{}),...(exploration.termination?{termination:exploration.termination}:{})};
      if(!exploration.explored){for(const id of [job.id,child.job.id]){const stages=getTestingJob(id).workStages??[];updateJob(id,{workStages:[...stages,{stage:'exploring',status:'skipped',finishedAt:now(),summary:'Das vorhandene Fachwissen reicht; kein Browser wurde geöffnet.'}]});}}
    }
    updateJob(job.id,{stage:'planning'});
    const {result,draft,preview,attempts}=await planBusinessWithCodex({id:job.id,model:input.model,request:input.request,catalog:exploration?.catalog??catalog,scenario:isOverride?existing:undefined,instanceId:input.instanceId,files:exploration?{'erkundungsergebnis.json':JSON.stringify(exploration)}:undefined,signal,onStage:stage=>updateJob(job.id,{stage}),onEvent:event=>addEvent(job.id,event)});
    if(signal.aborted)throw new Error('Die Entwurfsplanung wurde abgebrochen.');
    assertFresh(baseline,fingerprint);
    if(isOverride){
      const target=findBlock(draft.blocks,input.instanceId!);if(!target)throw new Error('Die ID des Zielblocks fehlt. Die Ausnahme wurde nicht übernommen.');
      if(draft.newDefinitions.length||draft.newKnowledge.length)throw new Error('Die lokale Ausnahme würde gemeinsame Definitionen ändern. Bitte als neuen fachlichen Entwurf planen und erneut prüfen.');
      const updated={...baseline,blocks:replaceBlock(baseline.blocks,input.instanceId!,target)};
      return {scenario:updated,draft,compiled:compileTestingScenario(updated,catalog),applied:false,changes:[{path:input.instanceId,before:findBlock(baseline.blocks,input.instanceId!),after:target}],contextHash:result.contextHash,attempts};
    }
    if(exploration){
      const ids=new Set(exploration.newKnowledge.map(document=>document.id));
      if(draft.newKnowledge.some(document=>ids.has(document.id)))throw new Error('Die Planung darf belegtes Erkundungswissen nicht unter derselben Kennung neu definieren.');
      draft.newKnowledge=[...exploration.newKnowledge,...draft.newKnowledge];
      draft.knowledgeRefs=[...new Set([...draft.knowledgeRefs,...ids])];
    }
    draft.title=baseline.title;
    const scenario=completeTestingRequestDraft(baseline.id,draft,input.model,baseline.revision,fingerprint);
    return {scenario,draft,compiled:compileTestingScenario(scenario,getTestingCatalog()),duplicateReports:preview.duplicateReports,applied:true,contextHash:result.contextHash,attempts,explorationJobId:listTestingJobs().find(child=>child.parentJobId===job.id&&child.phase==='exploration')?.id,questions:exploration?.questions??[],...(namingError?{namingError}:{})};
  },baseline,fingerprint,{scenario:baseline,applied:false},{stage:isOverride?'planning':needsName?'naming':'knowledge'}).job;
}

export function startScenarioEditJob(input: { scenarioId: string; revision: number; text: string; model: TestingModel }) {
  if (typeof input.text !== 'string' || input.text.trim().length < 5 || input.text.length > 15_000) throw new TestingModelError('Bitte die gewünschte Ablaufänderung mit 5 bis 15.000 Zeichen beschreiben.');
  if (listTestingJobs().some(job => job.scenarioId === input.scenarioId && !job.parentJobId && ['queued', 'running'].includes(job.status))) throw new TestingModelError('Für diesen Testfall läuft bereits ein Auftrag.', 409);
  const scenario = getTestingScenario(input.scenarioId), catalog = getTestingCatalog();
  if (scenario.revision !== input.revision) throw new TestingModelError('Der Änderungsvorschlag benötigt die aktuelle gespeicherte Testfallrevision.', 409, 'AGENT_REVISION_STALE');
  const fingerprint = testingFingerprint(scenario, catalog);
  return launch('business', input.model, input.text, async (job, signal) => {
    const { result, parsed, attempts } = await planScenarioEdit({ id: job.id, model: input.model, request: input.text, scenario, catalog, signal, onEvent: event => addEvent(job.id, event) });
    if (signal.aborted) throw new Error('Die Ablaufüberarbeitung wurde abgebrochen.');
    assertFresh(scenario, fingerprint);
    const proposal: TestingScenarioEditProposal = { scope: 'scenario', applied: false, reviewStatus: 'pending', before: scenario, ...parsed, contextHash: result.contextHash, attempts };
    await writeFile(resolve(result.directory, 'validated-proposal.json'), JSON.stringify(proposal, null, 2));
    if (signal.aborted) throw new Error('Die Ablaufüberarbeitung wurde abgebrochen.');
    assertFresh(scenario, fingerprint);
    return proposal;
  }, scenario, fingerprint, { scope: 'scenario', applied: false }).job;
}
function scenarioEditProposal(job: TestingAgentJob): TestingScenarioEditProposal {
  const proposal = job.result as TestingScenarioEditProposal | undefined;
  if (job.phase !== 'business' || job.status !== 'completed' || proposal?.scope !== 'scenario' || !proposal.scenario || !job.scenarioId || !job.fingerprint) throw new TestingModelError('Dieser Auftrag enthält keinen abgeschlossenen Vorschlag zur Ablaufüberarbeitung.', 409);
  if (proposal.applied || proposal.reviewStatus !== 'pending') throw new TestingModelError('Dieser Änderungsvorschlag wurde bereits übernommen oder verworfen.', 409);
  return proposal;
}
export function applyScenarioEditJob(input: { jobId: string; expectedRevision: number; fingerprint: string }) {
  const job = getTestingJob(input.jobId), proposal = scenarioEditProposal(job);
  if (input.expectedRevision !== job.scenarioRevision || input.fingerprint !== job.fingerprint) throw new TestingModelError('Die Prüfung bezieht sich nicht auf die Ausgangsfassung dieses Vorschlags.', 409, 'AGENT_REVISION_STALE');
  const scenario = applyTestingScenarioEdit(job.scenarioId!, proposal.draft, job.model, input.expectedRevision, input.fingerprint);
  updateJob(job.id, { result: { ...proposal, applied: true, reviewStatus: 'applied', appliedRevision: scenario.revision } });
  return { scenario, compiled: compileTestingScenario(scenario, getTestingCatalog()), requiresApproval: true };
}
export function dismissScenarioEditJob(jobId: string) {
  const job = getTestingJob(jobId), proposal = scenarioEditProposal(job);
  return updateJob(job.id, { result: { ...proposal, reviewStatus: 'dismissed' } });
}

async function performReuse(run: TestingRun, model: TestingModel, parentJobId?:string) {
  if (run.status !== 'passed') throw new Error('Wiederverwendung wird ausschließlich nach einem erfolgreichen Browserlauf vorgeschlagen.');
  const scenario = assertFresh(run.compiled.scenario, run.compiled.fingerprint);
  const catalog = getTestingCatalog();
  return launch('reuse', model, 'Nach erfolgreichem Testlauf sinnvolle wiederverwendbare Blöcke vorschlagen.', async (job, signal) => {
    const { parsed, attempts } = await reviewWithCodex({ id: job.id, model, prompt: reusePrompt(), schema: reuseSchemaFor(run.compiled), files: agentContext(catalog, run.compiled, undefined, run), signal,
      label: 'Wiederverwendungsprüfung', validate: value => validateReuseReview(value, scenario, catalog), onEvent: event => addEvent(job.id, event) });
    assertFresh(scenario, run.compiled.fingerprint);
    if (signal.aborted) throw new Error('Die Wiederverwendungsprüfung wurde abgebrochen.');
    const suggestions: TestingReuseSuggestion[] = parsed.suggestions.map(item => ({ ...item, id: `vorschlag-${randomUUID()}`, scenarioId: scenario.id, scenarioRevision: scenario.revision, fingerprint: run.compiled.fingerprint, status: 'suggested' }));
    const currentRun = getTestingRun(run.id); saveTestingRun({ ...currentRun, reuseSuggestions: suggestions });
    return { runId: run.id, explanation: parsed.explanation, suggestions, attempts };
  }, scenario, run.compiled.fingerprint, { runId: run.id }, {parentJobId,stage:'reuse'});
}

export async function startReuseJob(input: { runId: string; model: TestingModel }) {
  const run = getTestingRun(input.runId);
  const active = listTestingJobs().find(job => job.phase === 'reuse' && ['queued', 'running'].includes(job.status) && job.scenarioId === run.scenarioId && job.fingerprint === run.compiled.fingerprint);
  if (active) throw new TestingModelError('Für diesen Fachstand läuft bereits eine Wiederverwendungsprüfung.', 409);
  return (await performReuse(run, input.model)).job;
}

async function runCompiled(compiled: TestingCompiledScenario, model: TestingModel, signal?: AbortSignal, parentJobId?: string, predeterminedId?: string) {
  if (runningRuns.size >= 2 && (!predeterminedId || !runningRuns.has(predeterminedId))) throw new TestingModelError('Es laufen bereits zwei Browserprüfungen.', 429);
  const id = predeterminedId ?? `testlauf-${randomUUID()}`; runningRuns.add(id);
  if(parentJobId)updateJob(parentJobId,{runId:id,stage:'running'});
  try {
    assertFresh(compiled.scenario, compiled.fingerprint);
    const matrix = compiled.scenario.matrix;
    const variants = matrix?.rows.filter(row => row.enabled).map(row => {
      const frozenCatalog = { revision: `run-${compiled.fingerprint}`, definitions: compiled.definitions, bindings: compiled.bindings, knowledge: compiled.knowledge };
      const variant = compileTestingMatrixRow(compiled, row.id, frozenCatalog);
      if (!variant.executable) throw new TestingModelError(`${row.label}: ${variant.issues.filter(issue => issue.severity === 'error' || issue.code === 'BINDING_MISSING').map(issue => issue.message).join(' ')}`, 400, 'MATRIX_ROW_INVALID');
      return { row, compiled: variant };
    });
    const update = (value: TestingRun) => { saveTestingRun(value); if (parentJobId) updateJob(parentJobId, { result: { ...((getTestingJob(parentJobId).result ?? {}) as object), run: value } }); };
    const run = variants ? await executeTestingMatrixRun(compiled, variants, { id, signal, onUpdate: update }) : await executeTestingRun(compiled, { id, signal, onUpdate: update });
    if (run.status !== 'passed') return { run };
    if (process.env.FOLIO_AUTO_REUSE === '0') return { run, reuseSkipped: 'Automatische KI-Nachprüfung ist für diese lokale Testserver-Konfiguration ausgeschaltet.' };
    if (signal?.aborted) return { run };
    try {
      if (parentJobId) status(parentJobId, 'Der Browserlauf ist erfolgreich. Ein eigener Agent prüft jetzt Wiederverwendung.');
      if(parentJobId)updateJob(parentJobId,{stage:'reuse'});
      const reuse = await performReuse(run, model, parentJobId);
      const cancelReuse = () => cancelTestingJob(reuse.job.id,'parent_cancelled'); signal?.addEventListener('abort', cancelReuse, { once: true });
      const completed = await reuse.promise; signal?.removeEventListener('abort', cancelReuse);
      return { run: getTestingRun(id), reuseJobId: completed.id, reuseSuggestions: getTestingRun(id).reuseSuggestions ?? [], ...(completed.status !== 'completed' ? { reuseError: completed.error } : {}) };
    } catch (error) { return { run, reuseError: message(error) }; }
  } finally { runningRuns.delete(id); }
}
export function startTechnicalJob(input: { scenarioId: string; revision: number; model: TestingModel; repairBindingId?: string }) {
  if (listTestingJobs().some(job => job.scenarioId === input.scenarioId && !job.parentJobId && ['queued', 'running'].includes(job.status))) throw new TestingModelError('Für diesen Testfall läuft bereits ein Auftrag.', 409);
  const { scenario, catalog, compiled } = requireApproved(input.scenarioId, input.revision);
  const failedRun = listTestingRuns().find(run => run.scenarioId === scenario.id && run.compiled.fingerprint === compiled.fingerprint && run.status === 'failed');
  return launch('technical', input.model, input.repairBindingId ? `Technische Bindung ${input.repairBindingId} anhand des kleinsten fehlgeschlagenen Blocks reparieren.` : 'Freigegebenen Fachablauf technisch verdrahten, Dubletten prüfen und im Browser ausführen.', async (job, signal) => {
    const files = agentContext(catalog, compiled, undefined, failedRun);
    status(job.id, 'Technische Verdrahtung und eine unabhängige Dublettenprüfung starten parallel.');
    const duplicate = launch('duplicates', input.model, 'Unabhängige Dublettenprüfung für die freigegebene Fachfassung.', async (duplicateJob, duplicateSignal) => {
      const { parsed } = await reviewWithCodex({ id: duplicateJob.id, model: input.model, prompt: duplicatePrompt(), schema: duplicateSchemaFor(compiled, catalog),
        files: { ...files, ...duplicateReviewContext(compiled, catalog) }, signal: duplicateSignal,
        label: 'Dublettenprüfung', validate: value => validateDuplicateReview(value, compiled, catalog), onEvent: event => { addEvent(duplicateJob.id, event); if (event.kind === 'status') status(job.id, `Dublettenprüfung: ${event.message}`); } });
      assertFresh(scenario, compiled.fingerprint); return parsed;
    }, scenario, compiled.fingerprint, undefined, {parentJobId:job.id,stage:'duplicates'});
    const abortChild = () => cancelTestingJob(duplicate.job.id,'parent_cancelled'); signal.addEventListener('abort', abortChild, { once: true });
    let technicalResult;
    try {
      const results = await Promise.all([planTechnicalWithCodex({ id: job.id, model: input.model, catalog, compiled, files, repairBindingId: input.repairBindingId, failedRun, signal, onEvent: event => addEvent(job.id, event) }).then(result=>{updateJob(job.id,{workStages:(getTestingJob(job.id).workStages??[]).map(stage=>stage.stage==='wiring'?{...stage,status:'completed',finishedAt:now(),summary:'Der technische Vorschlag ist geprüft; das Ergebnis des Bausteinvergleichs wird abgewartet.'}:stage)});return result;}), duplicate.promise]);
      technicalResult = results[0];
      if (results[1].status !== 'completed') throw new Error(`Die unabhängige Dublettenprüfung ist fehlgeschlagen: ${results[1].error ?? 'Kein Ergebnis.'}`);
    } catch (error) { cancelTestingJob(duplicate.job.id,'parent_cancelled'); throw error; }
    finally { signal.removeEventListener('abort', abortChild); }
    const technical = decodeTechnicalPlan(technicalResult.value);
    const duplicateResult = decodeDuplicates(getTestingJob(duplicate.job.id).result);
    assertFresh(scenario, compiled.fingerprint);
    if (signal.aborted) throw new Error('Die technische Übernahme wurde abgebrochen.');
    for (const ref of technical.reuseBindings) if (!catalog.bindings.some(item => item.id === ref.id && item.revision === ref.revision && item.status === 'ready')) throw new Error(`Der Agent wollte eine unbekannte oder nicht ausführbare Bindung wiederverwenden: ${ref.id}@${ref.revision}.`);
    const newBindings = technical.newBindings.map(item => validateTestingBinding(item.binding, getTestingCatalog()));
    if (new Set(newBindings.map(binding => `${binding.id}@${binding.revision}`)).size !== newBindings.length) throw new Error('Der Agent hat dieselbe technische Bindungsrevision mehrfach geliefert. Es wurde nichts übernommen.');
    for (const binding of newBindings) {
      if (input.repairBindingId && binding.id !== input.repairBindingId) throw new Error('Der Reparaturauftrag darf nur die betroffene technische Bindung ändern.');
      const previous = getTestingCatalog().bindings.filter(item => item.id === binding.id);
      if (previous.some(item => item.revision >= binding.revision)) throw new Error(`Die technische Revision ${binding.id}@${binding.revision} ist bereits vorhanden. Der Agent muss eine neue Revision liefern.`);
    }
    const reports = compiled.definitions.filter(item => item.origin !== 'seed').map(definition => findTestingDuplicates(definition, catalog));
    const reviewDuplicates = duplicateResult.decisions.filter(item => item.decision !== 'new');
    const duplicateIssue = (summary: string, proposed?: { id: string; version: string }) => {
      const ref = proposed;
      const affected = ref ? compiled.steps.filter(step => step.definition.id === ref.id && step.definition.version === ref.version) : [];
      return { kind: 'duplicate-review' as const, summary, affectedDefinitionRefs: ref ? [ref] : [], affectedInputKeys: [], blockPaths: affected.map(step => step.path) };
    };
    const unsupported = [...technical.unsupported, ...duplicateResult.unresolved.map(summary => duplicateIssue(summary)),
      ...reviewDuplicates.map(item => duplicateIssue(`Fachliche Prüfung erforderlich: ${item.proposed.id} sollte ${item.decision === 'reuse' ? 'durch einen vorhandenen Block ersetzt' : 'als Erweiterung eines vorhandenen Blocks geprüft'} werden. ${item.reason}`, item.proposed))];
    const plan: TestingTechnicalPlan = { scenarioId: scenario.id, fingerprint: compiled.fingerprint, bindings: newBindings,
      duplicateReports: reports, explanation: `${technical.explanation}\n\n${duplicateResult.explanation}`, unsupported };
    await writeFile(resolve(technicalResult.directory, 'validated-plan.json'), JSON.stringify({ plan, duplicateResult }, null, 2));
    if (unsupported.length) return { plan, duplicateJobId: duplicate.job.id, needsBusinessReview: reviewDuplicates.length > 0, duplicateDecisions: duplicateResult.decisions,
      repairContext: { sourceJobId: job.id, scenarioId: scenario.id, scenarioRevision: scenario.revision, fingerprint: compiled.fingerprint, issues: unsupported } };
    assertFresh(scenario, compiled.fingerprint);
    if (signal.aborted) throw new Error('Die technische Übernahme wurde abgebrochen.');
    // Compile against exactly the revisions selected by this agent. A later global
    // revision cannot silently replace the inspected implementation in this run.
    const selectedBindings = [...technical.reuseBindings.map(ref => catalog.bindings.find(item => item.id === ref.id && item.revision === ref.revision)!), ...newBindings];
    const wired = compileTestingScenario(scenario, { ...getTestingCatalog(), bindings: selectedBindings }, getTestingApproval(scenario.id));
    if (!wired.executable) throw new Error(`Die technische Verdrahtung ist unvollständig: ${wired.issues.map(issue => issue.message).join(' ')}`);
    const persisted = db.read<TestingCatalog['bindings'][number]>('testingBindings');
    for (const binding of newBindings) if (getTestingCatalog().bindings.some(item => item.id === binding.id && item.revision >= binding.revision)) throw new Error(`Die Bindung ${binding.id} wurde während der Prüfung bereits geändert. Bitte erneut prüfen.`);
    if (newBindings.length) db.replace('testingBindings', [...persisted, ...newBindings]);
    updateJob(job.id, { result: { plan, duplicateJobId: duplicate.job.id } });
    status(job.id, 'Die freigegebene Fassung ist verdrahtet. Die echte Portalprüfung startet jetzt in Chromium.');
    const execution = await runCompiled(wired, input.model, signal, job.id);
    return { plan, duplicateJobId: duplicate.job.id, ...execution };
  }, scenario, compiled.fingerprint, undefined, {stage:'wiring'}).job;
}
export function startDirectRun(input: { scenarioId: string; revision: number; model?: TestingModel }) {
  const { scenario, compiled } = requireApproved(input.scenarioId, input.revision);
  if (!compiled.executable) throw new TestingModelError('Die technischen Bindungen fehlen noch. Bitte zuerst die technische Phase starten.', 409);
  if (runningRuns.size >= 2) throw new TestingModelError('Es laufen bereits zwei Browserprüfungen.', 429);
  const settings = getTestingAgentSettings();
  const reuseModel = input.model ?? (settings.models.some(item => item.id === scenario.model) ? scenario.model : settings.defaultModel);
  const configuration = process.env.FOLIO_AUTO_REUSE === '0' ? undefined : resolveAgentConfiguration(reuseModel);
  const id = `testlauf-${randomUUID()}`;
  const run: TestingRun = { id, scenarioId: scenario.id, scenarioRevision: scenario.revision, scenarioTitle: scenario.title, compiled, status: 'queued', startedAt: now(), steps: [], ...(scenario.matrix ? { mode: 'matrix' as const, matrixRows: scenario.matrix.rows.filter(row => row.enabled).map((row, index) => ({ rowId: row.id, rowLabel: row.label, index, status: 'queued' as const, values: structuredClone(row.values) })), summary: { total: scenario.matrix.rows.filter(row => row.enabled).length, passed: 0, failed: 0, skipped: 0 } } : {}) };
  saveTestingRun(run);
  runningRuns.add(id);
  setImmediate(() => { const execute = () => runCompiled(compiled, reuseModel ?? settings.defaultModel, undefined, undefined, id); void (configuration ? withAgentConfiguration(configuration, execute) : execute()).catch(error => saveTestingRun({ ...getTestingRun(id), status: 'failed', finishedAt: now(), error: message(error) })); });
  return run;
}

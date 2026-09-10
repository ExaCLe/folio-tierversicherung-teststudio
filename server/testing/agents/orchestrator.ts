import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { TestingAgentEvent, TestingAgentJob, TestingBlockInstance, TestingCatalog, TestingCompiledScenario, TestingModel, TestingReuseSuggestion, TestingRun, TestingScenario, TestingScenarioEditProposal, TestingTechnicalPlan, TestingAgentStage, TestingAgentTermination } from '../../../shared/testing';
import { normalizeTestingWorkStages, transitionTestingWorkStages } from '../../../shared/testing-work-stages';
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
const jobListeners = new Set<(job:TestingAgentJob)=>void>();
const steeringBatches = new Map<string,{messages:string[];targetJobId:string;waiters:{resolve:(value:TestingSteeringResult)=>void;reject:(error:unknown)=>void}[]}>();
let initialized = false;
const now = () => new Date().toISOString();
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
export function initializeTestingPipeline() {
  if (initialized) return; initialized = true;
  for (const job of listTestingJobs()) if (job.status === 'queued' || job.status === 'running') { recoverCodexJobProcesses(job.id);const stopped=new AgentTerminationError('server_restart','Der lokale Server wurde während dieses Agentenlaufs neu gestartet. Bitte den Auftrag erneut starten.');updateJob(job.id,{status:'cancelled',finishedAt:now(),error:stopped.message,termination:stopped.termination}); }
  for (const run of listTestingRuns()) if (run.status === 'queued' || run.status === 'running') saveTestingRun({ ...run, status: 'failed', finishedAt: now(), error: 'Der lokale Server wurde während des Browserlaufs neu gestartet.' });
}
const saveJob = (job: TestingAgentJob) => { const saved=db.upsert(jobs, structuredClone(job)); for(const listener of jobListeners)listener(structuredClone(saved)); return saved; };
export function subscribeTestingJobs(listener:(job:TestingAgentJob)=>void){jobListeners.add(listener);return()=>jobListeners.delete(listener);}
export function listTestingJobs(): TestingAgentJob[] { return db.read<TestingAgentJob>(jobs).sort((a, b) => b.startedAt.localeCompare(a.startedAt)); }
export function getTestingJob(id: string): TestingAgentJob { const job = db.find<TestingAgentJob>(jobs, id); if (!job) throw new TestingModelError('Der Agentenlauf wurde nicht gefunden.', 404); return job; }
export function cancelTestingJob(id: string,cause:'user_cancelled'|'parent_cancelled'|'interrupted'='user_cancelled'): TestingAgentJob {
  const job = getTestingJob(id);
  if (!['queued', 'running'].includes(job.status)) return job;
  const stopped=new AgentTerminationError(cause,cause==='user_cancelled'?'Der Agentenlauf wurde vom Menschen abgebrochen.':cause==='parent_cancelled'?'Der Unterauftrag wurde beendet, weil sein übergeordneter Auftrag beendet wurde.':'Der Agentenlauf wurde durch eine neue Nachricht ersetzt und wird mit ihr neu geplant.');
  controls.get(id)?.abort(stopped);
  for(const child of listTestingJobs().filter(item=>item.parentJobId===id))cancelTestingJob(child.id,'parent_cancelled');
  return updateJob(id,{status:'cancelled',finishedAt:now(),error:stopped.message,termination:stopped.termination});
}
export interface TestingSteeringResult { state:'replanning';targetJobId:string;successorJobId:string;message:string }
/** CLI print/exec invocations cannot accept another turn after stdin closes.
 * Steering therefore supersedes the current root job and starts a fresh,
 * revision-guarded plan. Requests arriving in the same event-loop window share
 * one successor so a double submit does not create competing jobs. */
export function steerTestingJob(input:{jobId:string;message:string;model?:TestingModel}):Promise<TestingSteeringResult>{
  const message=input.message.trim();
  if(message.length<1||message.length>15_000)return Promise.reject(new TestingModelError('Die neue Nachricht muss 1 bis 15.000 Zeichen enthalten.'));
  const target=getTestingJob(input.jobId);
  if(!target.scenarioId)return Promise.reject(new TestingModelError('Dieser Auftrag gehört zu keinem Testfall und kann nicht neu geplant werden.',409));
  const active=listTestingJobs().find(job=>job.scenarioId===target.scenarioId&&!job.parentJobId&&['queued','running'].includes(job.status));
  if(!active)return Promise.reject(new TestingModelError('Der angesprochene Agentenlauf arbeitet nicht mehr. Lade den aktuellen Stand und sende die Nachricht erneut.',409,'AGENT_REVISION_STALE'));
  const key=target.scenarioId,existing=steeringBatches.get(key);
  if(existing){existing.messages.push(message);return new Promise((resolve,reject)=>existing.waiters.push({resolve,reject}));}
  const batch={messages:[message],targetJobId:active.id,waiters:[] as {resolve:(value:TestingSteeringResult)=>void;reject:(error:unknown)=>void}[]};steeringBatches.set(key,batch);
  const promise=new Promise<TestingSteeringResult>((resolve,reject)=>batch.waiters.push({resolve,reject}));
  setImmediate(()=>void (async()=>{
    try{
      const current=listTestingJobs().find(job=>job.scenarioId===key&&!job.parentJobId&&['queued','running'].includes(job.status));
      if(!current)throw new TestingModelError('Der angesprochene Agentenlauf arbeitet nicht mehr. Lade den aktuellen Stand und sende die Nachricht erneut.',409,'AGENT_REVISION_STALE');
      const answered=((current.result as {questions?:{text?:string;answer?:string}[]}|undefined)?.questions??[]).filter(item=>item.text&&item.answer).map(item=>`Frage: ${item.text}\nAntwort: ${item.answer}`).join('\n');
      const instruction=batch.messages.map((text,index)=>`${index+1}. ${text}`).join('\n');
      const request=`${current.prompt}${answered?`\n\nBereits geklärter fachlicher Kontext:\n${answered}`:''}\n\nNeue Hinweise während der laufenden Bearbeitung:\n${instruction}`;
      if(request.length>15_000)throw new TestingModelError('Der bisherige Arbeitsauftrag und die neuen Hinweise überschreiten zusammen 15.000 Zeichen. Der laufende Auftrag bleibt erhalten; kürze bitte den Nachtrag.',400,'STEERING_TOO_LARGE');
      cancelTestingJob(current.id,'interrupted');await waitTestingJob(current.id);
      const scenario=getTestingScenario(key);
      const model=input.model??current?.model??target.model;
      const successor=scenario.blocks.length
        ? startScenarioEditJob({scenarioId:key,revision:scenario.revision,text:request,model})
        : startBusinessJob({scenarioId:key,revision:scenario.revision,request,model});
      const result={state:'replanning' as const,targetJobId:batch.targetJobId,successorJobId:successor.id,message:'Die laufende, nicht interaktiv fortsetzbare CLI-Ausführung wurde ersetzt. Ein neuer Auftrag plant alle angenommenen Hinweise auf dem aktuellen Stand ein.'};
      for(const waiter of batch.waiters)waiter.resolve(result);
    }catch(error){for(const waiter of batch.waiters)waiter.reject(error);}
    finally{steeringBatches.delete(key);}
  })());
  return promise;
}
function updateJob(id: string, patch: Partial<TestingAgentJob>) {
  const current=getTestingJob(id),at=now();
  const supplied=patch.workStages ? normalizeTestingWorkStages(patch.workStages) : current.workStages ?? [];
  let terminalStatus:'completed'|'failed'|undefined;
  if(patch.status&&['completed','failed','cancelled'].includes(patch.status)){
    const result=patch.result as {needsKnowledge?:boolean;run?:TestingRun;compiled?:{valid:boolean};termination?:TestingAgentTermination}|undefined;
    const failed=patch.status!=='completed'||!!result?.needsKnowledge||!!result?.termination||result?.run?.status==='failed'||result?.compiled?.valid===false;
    terminalStatus=failed?'failed':'completed';
  }
  const stages=transitionTestingWorkStages({stages:supplied,currentStage:current.stage,nextStage:patch.stage,terminalStatus,at});
  const terminal=patch.status&&['completed','failed','cancelled'].includes(patch.status);
  const metrics=terminal?{...(patch.metrics??current.metrics??{requestCount:0,elapsedMs:0}),elapsedMs:Math.max(0,new Date(patch.finishedAt??at).getTime()-new Date(current.startedAt).getTime())}:patch.metrics;
  return saveJob({...current,...patch,...(metrics?{metrics}:{}),...(stages.length?{workStages:stages}:{})});
}
export function addTestingAgentEvent(id: string, event: TestingAgentJob['events'][number]) { const job = getTestingJob(id),isPublic=!['tool','metrics'].includes(event.kind)&&(!!event.publicDetail||event.kind==='message'||event.kind==='error'),context=isPublic&&!event.context?{jobId:job.id,phase:job.phase,taskLabel:taskLabel(job.phase),modelId:job.model,...(job.agentConfig?.modelLabel?{modelLabel:job.agentConfig.modelLabel}:{}),...(job.agentConfig?.provider?{provider:job.agentConfig.provider}:{}),...(job.stage?{stage:job.stage}:{})}:event.context;const next={...event,...(context?{context}:{})};const index=job.events.findIndex(candidate=>candidate.id===event.id||!!event.stream?.providerEventId&&candidate.stream?.providerEventId===event.stream.providerEventId);const retainedMetrics=job.events.filter(candidate=>candidate.kind==='metrics'),retainedActivity=job.events.filter(candidate=>candidate.kind!=='metrics');const events=index<0?event.kind==='metrics'?[...job.events,next]:[...retainedMetrics,...retainedActivity.slice(-299),next]:job.events.map((candidate,position)=>position===index?{...next,at:candidate.at}:candidate);const metricEvents=events.filter(candidate=>candidate.kind==='metrics'&&candidate.metrics);const sum=(key:'requestCount'|'inputTokens'|'cachedInputTokens'|'outputTokens'|'totalTokens')=>{const values=metricEvents.map(candidate=>candidate.metrics?.[key]).filter((value):value is number=>value!==undefined);return values.length?values.reduce((total,value)=>total+value,0):undefined;};const requestCount=sum('requestCount')??0;const metrics={...(job.metrics??{elapsedMs:Math.max(0,Date.now()-new Date(job.startedAt).getTime()),requestCount:0}),requestCount,...Object.fromEntries((['inputTokens','cachedInputTokens','outputTokens','totalTokens'] as const).flatMap(key=>{const value=sum(key);return value===undefined?[]:[[key,value]];}))};saveJob({ ...job, events,metrics }); }
const addEvent=addTestingAgentEvent;
function status(id: string, text: string) { addEvent(id, { id: randomUUID(), at: now(), kind: 'status', message: text }); }
const taskLabel=(phase:TestingAgentJob['phase'])=>phase==='exploration'?'Fachwissen prüfen':phase==='business'?'Fachlichen Ablauf planen':phase==='technical'?'Technisch vorbereiten':phase==='duplicates'?'Wiederverwendung prüfen':phase==='reuse'?'Bausteine vorschlagen':'Testfall benennen';
export function addValidatedSummary(id:string,input:{title:string;summary:string;facts?:{label:string;value:string}[];sources?:TestingAgentEvent['sources'];data?:unknown}){
  const job=getTestingJob(id),summary=input.summary.trim().slice(0,5000);if(!summary)return;
  const context:NonNullable<TestingAgentEvent['context']>={jobId:job.id,phase:job.phase,taskLabel:taskLabel(job.phase),modelId:job.model,...(job.agentConfig?.modelLabel?{modelLabel:job.agentConfig.modelLabel}:{}),...(job.agentConfig?.provider?{provider:job.agentConfig.provider}:{}),...(job.stage?{stage:job.stage}:{})};
  addEvent(id,{id:randomUUID(),at:now(),kind:'message',message:summary,context,sources:input.sources?.slice(0,40),content:{type:'validated-summary',title:input.title.slice(0,200),summary,facts:input.facts?.filter(item=>item.label&&item.value).slice(0,12).map(item=>({label:item.label.slice(0,200),value:item.value.slice(0,1000)}))},publicDetail:{type:'result',label:input.title.slice(0,200),data:input.data??{summary,facts:input.facts?.filter(item=>item.label&&item.value).slice(0,12)}}});
}
function publishValidatedResult(id:string,result:unknown){
  const job=getTestingJob(id),value=result as {title?:string;summary?:string;explanation?:string;draft?:{explanation?:string;assumptions?:string[]};plan?:{explanation?:string;unsupported?:{summary:string;suggestedBusinessRevision?:string}[]};scenario?:TestingScenario;compiled?:{valid?:boolean};attempts?:{valid:boolean}[]|number;catalog?:TestingCatalog;knowledgeIds?:string[];newKnowledge?:{id:string;title:string}[];evidence?:{id:string;path:string;screenshot:string}[];questions?:{text:string;status:string;answer?:string}[];suggestions?:{name:string;reason:string}[];decisions?:{reason?:string}[];duplicateDecisions?:{reason?:string}[]}|undefined;
  if(job.phase==='business'&&value?.draft&&(value.compiled?.valid!==true||Array.isArray(value.attempts)&&value.attempts.at(-1)?.valid!==true))return;
  const summary=value?.draft?.explanation?.trim()||value?.plan?.explanation?.trim()||value?.explanation?.trim()||value?.summary?.trim()||(job.phase==='naming'&&value?.title?`Der Testfall heißt „${value.title}“.`:undefined);if(!summary)return;
  const facts=[...(value?.draft?.assumptions??[]).map((item,index)=>({label:`Annahme ${index+1}`,value:item})),...(value?.questions??[]).map(item=>({label:item.status==='open'?'Offene Frage':'Beantwortete Frage',value:item.status==='open'?item.text:item.answer||item.text})),...(value?.suggestions??[]).map(item=>({label:item.name,value:item.reason})),...((value?.decisions??value?.duplicateDecisions)??[]).flatMap(item=>item.reason?[{label:'Entscheidung',value:item.reason}]:[]),...(value?.plan?.unsupported??[]).map(item=>({label:'Technische Grenze',value:item.suggestedBusinessRevision?`${item.summary} Nächster fachlicher Schritt: ${item.suggestedBusinessRevision}`:item.summary}))];
  const sources:NonNullable<TestingAgentEvent['sources']>=[...(value?.knowledgeIds??value?.scenario?.knowledgeRefs??[]).flatMap(ref=>{const document=value?.catalog?.knowledge.find(item=>item.id===ref);return document?[{label:document.title,kind:'knowledge' as const,ref}]:[]}),...(value?.newKnowledge??[]).map(item=>({label:item.title,kind:'knowledge' as const,ref:item.id})),...(value?.evidence??[]).map(item=>({label:`Browserbeobachtung ${item.id}: ${item.path}`,kind:'portal-evidence' as const,ref:item.screenshot})),...(value?.scenario?[{label:value.scenario.title,kind:'scenario' as const,ref:`${value.scenario.id}@${value.scenario.revision}`}]:[])];
  const technicalData=job.phase==='technical'?{plan:value?.plan,...('technicalStatus' in (value??{})?{technicalStatus:(value as any).technicalStatus}:{}),...('nextAction' in (value??{})?{nextAction:(value as any).nextAction}:{}),...('prepared' in (value??{})?{prepared:(value as any).prepared}:{}),...('preparedBindingRefs' in (value??{})?{preparedBindingRefs:(value as any).preparedBindingRefs}:{})}:undefined;
  addValidatedSummary(id,{title:job.phase==='exploration'?'Ergebnis der Wissensprüfung':job.phase==='business'?'Validierter fachlicher Entwurf':job.phase==='technical'?'Validierter technischer Plan':job.phase==='duplicates'?'Validierte Dublettenprüfung':job.phase==='reuse'?'Vorschläge zur Wiederverwendung':job.phase==='naming'?'Validierter Testfallname':'Validiertes Agentenergebnis',summary,facts,sources,...(technicalData?{data:technicalData}:{})});
}
function launch(phase: TestingAgentJob['phase'], model: TestingModel, prompt: string, task: (job: TestingAgentJob, signal: AbortSignal) => Promise<unknown>, scenario?: TestingScenario, fingerprint?: string, initialResult?: unknown, metadata: {parentJobId?:string;stage?:TestingAgentStage}={}) {
  const agentConfig = resolveAgentConfiguration(model);
  if (listTestingJobs().filter(job => job.status === 'queued' || job.status === 'running').length >= 12) throw new TestingModelError('Es sind bereits zwölf Agentenaufträge offen. Bitte zuerst einen Auftrag abschließen oder abbrechen.', 429);
  const id = `agent-${randomUUID()}`, controller = new AbortController();
  const job: TestingAgentJob = { id, phase, ...metadata, model: agentConfig.modelId, agentConfig, status: 'queued', prompt, startedAt: now(), events: [], metrics:{elapsedMs:0,requestCount:0}, artifactDirectory: resolve(AGENT_ARTIFACTS_ROOT, id),
    ...(metadata.stage?{workStages:[{stage:metadata.stage,status:'running' as const,startedAt:now()}]}:{}),
    ...(scenario ? { scenarioId: scenario.id, scenarioRevision: scenario.revision } : {}), ...(fingerprint ? { fingerprint } : {}), ...(initialResult !== undefined ? { result: initialResult } : {}) };
  saveJob(job); controls.set(id, controller);
  if(metadata.parentJobId){const parent=getTestingJob(metadata.parentJobId);updateJob(parent.id,{childJobIds:[...(parent.childJobIds??[]),id]});}
  const promise = new Promise<TestingAgentJob>(done => setImmediate(() => {
    if (controller.signal.aborted) { controls.delete(id); completions.delete(id); done(getTestingJob(id)); return; }
    updateJob(id, { status: 'running' });
    void withAgentConfiguration(agentConfig, () => task(job, controller.signal)).then(async result => {
      await Promise.all(listTestingJobs().filter(item=>item.parentJobId===job.id).map(item=>waitTestingJob(item.id)));
      if (!controller.signal.aborted) {publishValidatedResult(id,result);updateJob(id, { status: 'completed', result, finishedAt: now(),...((result as {termination?:TestingAgentTermination})?.termination?{termination:(result as {termination:TestingAgentTermination}).termination}:{}) });}
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
export function startBusinessJob(input: { request: string; model: TestingModel; scenarioId?: string; revision?: number; instanceId?: string; preserveIntent?:boolean }) {
  if (typeof input.request !== 'string' || input.request.trim().length < 5 || input.request.length > 15_000) throw new TestingModelError('Bitte die fachliche Anforderung mit 5 bis 15.000 Zeichen beschreiben.');
  resolveAgentConfiguration(input.model);
  const catalog=getTestingCatalog(),existing=input.scenarioId?getTestingScenario(input.scenarioId):undefined;
  if(existing&&existing.revision!==input.revision)throw new TestingModelError('Die Anforderung wurde inzwischen geändert. Bitte den gespeicherten aktuellen Stand verwenden.',409);
  if(existing&&listTestingJobs().some(job=>job.scenarioId===existing.id&&!job.parentJobId&&['queued','running'].includes(job.status)))throw new TestingModelError('Für diesen Testfall läuft bereits ein Auftrag.',409);
  const isOverride=!!input.instanceId;
  if(isOverride&&(!existing||!findBlock(existing.blocks,input.instanceId!)))throw new TestingModelError('Die lokale Änderung braucht einen vorhandenen Zielblock.',409);
  if(existing&&!isOverride&&existing.blocks.length)throw new TestingModelError('Dieser Testfall enthält bereits einen Ablauf. Verwende die Ablaufüberarbeitung, um ihn gezielt zu ändern.',409);
  let baseline=existing?(!isOverride&&!input.preserveIntent&&input.request!==existing.intent?saveTestingScenario({...existing,intent:input.request},existing.revision):existing):createTestingRequestDraft(input.request,input.model),fingerprint=testingFingerprint(baseline,catalog);
  const needsName=!isOverride&&(!existing||!existing.naming&&(existing.title==='Neuer Testfall'||existing.source==='agent'&&existing.title===existing.intent.trim().split('\n')[0].slice(0,100))||!!existing&&input.request!==existing.intent);
  return launch('business',input.model,input.request,async(job,signal)=>{
    let exploration:Awaited<ReturnType<typeof exploreBusinessKnowledge>>|undefined;
    let namingError:string|undefined;
    if(needsName){
      let naming:ReturnType<typeof launch>|undefined;
      try{
        naming=launch('naming',input.model,'Testtitel und Metadaten aus der Anforderung bestimmen.',async(child,childSignal)=>(await nameScenario({id:child.id,request:input.request,existingTitle:existing?.title,model:input.model,signal:childSignal,onEvent:event=>addEvent(child.id,event)})).parsed,baseline,fingerprint,undefined,{parentJobId:job.id,stage:'naming'});
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
    const {result,draft,preview,attempts}=await planBusinessWithCodex({id:job.id,model:input.model,request:input.request,catalog:exploration?.catalog??catalog,scenario:isOverride?existing:undefined,instanceId:input.instanceId,files:exploration?{'erkundungsergebnis.json':JSON.stringify(exploration)}:undefined,signal,onStage:stage=>updateJob(job.id,{stage}),onEvent:event=>addEvent(job.id,event),onValidatedPreview:validatedFlowPreview=>updateJob(job.id,{result:{...((getTestingJob(job.id).result??{}) as object),validatedFlowPreview}})});
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
  }, scenario, fingerprint, { scope: 'scenario', applied: false }, { stage: 'revising' }).job;
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
export function startTechnicalJob(input: { scenarioId: string; revision: number; model: TestingModel; repairBindingId?: string; prepareOnly?:boolean }) {
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
      duplicateReports: reports, explanation: technical.explanation, unsupported };
    await writeFile(resolve(technicalResult.directory, 'validated-plan.json'), JSON.stringify({ plan, duplicateResult }, null, 2));
    if (unsupported.length) return { plan, duplicateJobId: duplicate.job.id, technicalStatus:'blocked' as const, needsBusinessReview: reviewDuplicates.length > 0, duplicateDecisions: duplicateResult.decisions,
      nextAction:{kind:'revise-business' as const,instruction:unsupported.map(issue=>typeof issue==='string'?issue:'suggestedBusinessRevision' in issue&&issue.suggestedBusinessRevision?issue.suggestedBusinessRevision:issue.summary).join('\n')},
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
    if(input.prepareOnly){status(job.id,'Die technische Vorbereitung ist geprüft und gespeichert. Der Browserlauf kann separat gestartet werden.');return {plan,duplicateJobId:duplicate.job.id,prepared:true,preparedBindingRefs:wired.bindings.map(binding=>({id:binding.id,revision:binding.revision}))};}
    status(job.id, 'Die freigegebene Fassung ist verdrahtet. Die echte Portalprüfung startet jetzt in Chromium.');
    const execution = await runCompiled(wired, input.model, signal, job.id);
    return { plan, duplicateJobId: duplicate.job.id, ...execution };
  }, scenario, compiled.fingerprint, undefined, {stage:'wiring'}).job;
}
export function startPreparedRun(input:{jobId:string;scenarioId:string;revision:number;model:TestingModel}){
  const prepared=getTestingJob(input.jobId),result=prepared.result as {prepared?:boolean;preparedBindingRefs?:{id:string;revision:number}[]}|undefined;
  if(prepared.phase!=='technical'||prepared.status!=='completed'||!result?.prepared||!result.preparedBindingRefs?.length||prepared.scenarioId!==input.scenarioId||prepared.scenarioRevision!==input.revision)throw new TestingModelError('Für diese Fachfassung liegt keine abgeschlossene technische Vorbereitung vor.',409,'TECHNICAL_PREPARATION_MISSING');
  const {scenario,catalog}=requireApproved(input.scenarioId,input.revision);
  if(testingFingerprint(scenario,catalog)!==prepared.fingerprint)throw new TestingModelError('Die Fachfassung oder ihr Wissensstand hat sich seit der technischen Vorbereitung geändert.',409,'AGENT_REVISION_STALE');
  const selected=result.preparedBindingRefs.map(ref=>catalog.bindings.find(binding=>binding.id===ref.id&&binding.revision===ref.revision));
  if(selected.some(binding=>!binding))throw new TestingModelError('Eine geprüfte technische Bindungsrevision ist nicht mehr verfügbar.',409,'TECHNICAL_PREPARATION_STALE');
  const compiled=compileTestingScenario(scenario,{...catalog,bindings:selected as TestingCatalog['bindings']},getTestingApproval(scenario.id));
  if(!compiled.executable)throw new TestingModelError('Die gespeicherte technische Vorbereitung ist nicht mehr ausführbar.',409,'TECHNICAL_PREPARATION_STALE');
  if(runningRuns.size>=2)throw new TestingModelError('Es laufen bereits zwei Browserprüfungen.',429);
  const configuration=resolveAgentConfiguration(input.model);
  const id=`testlauf-${randomUUID()}`,run:TestingRun={id,scenarioId:scenario.id,scenarioRevision:scenario.revision,scenarioTitle:scenario.title,compiled,status:'queued',startedAt:now(),steps:[],...(scenario.matrix?{mode:'matrix' as const,matrixRows:scenario.matrix.rows.filter(row=>row.enabled).map((row,index)=>({rowId:row.id,rowLabel:row.label,index,status:'queued' as const,values:structuredClone(row.values)})),summary:{total:scenario.matrix.rows.filter(row=>row.enabled).length,passed:0,failed:0,skipped:0}}:{})};
  saveTestingRun(run);runningRuns.add(id);setImmediate(()=>void Promise.resolve().then(()=>withAgentConfiguration(configuration,()=>runCompiled(compiled,input.model,undefined,undefined,id))).catch(error=>{runningRuns.delete(id);saveTestingRun({...getTestingRun(id),status:'failed',finishedAt:now(),error:message(error)});}));return run;
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

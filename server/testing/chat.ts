import { randomUUID } from 'node:crypto';
import type { TestingAgentJob, TestingModel, TestingScenario, TestingScenarioEditProposal } from '../../shared/testing';
import type { TestingChatCommandRequest, TestingChatConversation, TestingChatEntry, TestingChatSnapshot, TestingChatStreamEvent } from '../../shared/testing-chat';
import { db } from '../store';
import { compileTestingScenario } from './compiler';
import { deriveTestingLifecycle } from './lifecycle';
import { approveTestingScenario, getTestingApproval, getTestingScenario, listTestingRuns, saveTestingScenario, subscribeTestingRuns, TestingModelError } from './repository';
import { applyScenarioEditJob, cancelTestingJob, dismissScenarioEditJob, listTestingJobs, startBusinessJob, startPreparedRun, startScenarioEditJob, startTechnicalJob, subscribeTestingJobs } from './agents/orchestrator';
import { getTestingCatalog } from './catalog';

const conversations='testingChatConversations',entries='testingChatEntries';
const listeners=new Map<string,Set<(event:TestingChatStreamEvent)=>void>>();
const now=()=>new Date().toISOString();
const clone=<T>(value:T):T=>structuredClone(value);
let subscribed=false;

function readConversation(id:string){const value=db.find<TestingChatConversation>(conversations,id);if(!value)throw new TestingModelError('Diese Unterhaltung wurde nicht gefunden.',404,'CHAT_NOT_FOUND');return value;}
function emit(id:string,event:TestingChatStreamEvent){for(const listener of listeners.get(id)??[])listener(clone(event));}
function persistConversation(value:TestingChatConversation,notify=true){const saved=db.upsert(conversations,clone(value));if(notify)emit(saved.id,{type:'state',sequence:saved.eventSequence,revision:saved.revision});return saved;}
function append(id:string,input:Omit<TestingChatEntry,'id'|'at'> & {id?:string;at?:string}){
  const conversation=readConversation(id),entry:TestingChatEntry={id:input.id??randomUUID(),at:input.at??now(),...input};
  if(db.find<TestingChatEntry>(entries,entry.id))return entry;
  db.upsert(entries,entry);const entryIds=[...conversation.entryIds.slice(-499),entry.id];
  const saved=persistConversation({...conversation,entryIds,eventSequence:conversation.eventSequence+1,updatedAt:now()},false);
  emit(id,{type:'entry',sequence:saved.eventSequence,revision:saved.revision,entry});return entry;
}
export function testingChatPublicJobEntry(job:TestingAgentJob,event:TestingAgentJob['events'][number]):TestingChatEntry|undefined{
  if(event.kind==='tool')return undefined;
  return {id:`${job.id}:${event.id}`,at:event.at,kind:event.kind==='error'?'error':event.kind==='message'?'agent_summary':'status',message:event.message,jobId:job.id,...(job.scenarioRevision?{scenarioRevision:job.scenarioRevision}:{}),...(job.runId?{runId:job.runId}:{})};
}
function onJob(job:TestingAgentJob){
  for(const conversation of db.read<TestingChatConversation>(conversations).filter(value=>value.activeJobId===job.id||(!job.parentJobId&&!!job.scenarioId&&value.scenarioId===job.scenarioId))){
    for(const event of job.events){const entry=testingChatPublicJobEntry(job,event);if(entry)append(conversation.id,entry);}
    let current=readConversation(conversation.id);
    const patch:Partial<TestingChatConversation>={...(job.scenarioId?{scenarioId:job.scenarioId}:{})};
    if(['queued','running'].includes(job.status))patch.activeJobId=job.id;else if(current.activeJobId===job.id)patch.activeJobId=undefined;
    if(job.status==='completed'){
      const result=job.result as {openQuestions?:string[];questions?:{id:string;text:string;status:string}[];scenario?:{revision:number};run?:{id:string}}|undefined;
      const structured=result?.questions?.filter(value=>value.status==='open')??[];
      for(const question of structured)append(conversation.id,{id:`${job.id}:question:${question.id}`,kind:'question',message:question.text,jobId:job.id});
      for(const [index,question] of (result?.openQuestions??[]).entries())if(!structured.some(value=>value.text===question))append(conversation.id,{id:`${job.id}:question:open-${index}`,kind:'question',message:question,jobId:job.id});
      const summary=result?.openQuestions?.length?'Die Wissensprüfung braucht Antworten, bevor die Planung fortgesetzt werden kann.':job.phase==='technical'&&'prepared' in (result??{})?'Die technische Vorbereitung ist abgeschlossen.':job.phase==='business'?'Der fachliche Vorschlag ist bereit zur Prüfung.':'Der Auftrag ist abgeschlossen.';
      append(conversation.id,{id:`${job.id}:completed`,kind:'agent_summary',message:summary,jobId:job.id,...(result?.run?.id?{runId:result.run.id}:{})});
    }
    current=readConversation(conversation.id);persistConversation({...current,...patch,eventSequence:current.eventSequence+1,updatedAt:now()});
  }
}
function onRun(run:ReturnType<typeof listTestingRuns>[number]){for(const conversation of db.read<TestingChatConversation>(conversations).filter(value=>value.scenarioId===run.scenarioId)){const current=readConversation(conversation.id);const terminal=['passed','failed'].includes(run.status);if(terminal)append(conversation.id,{id:`${run.id}:${run.status}`,kind:run.status==='passed'?'evidence':'error',message:run.status==='passed'?'Der Browserlauf ist erfolgreich abgeschlossen.':'Der Browserlauf ist fehlgeschlagen.',runId:run.id,scenarioRevision:run.scenarioRevision});const latest=readConversation(conversation.id);persistConversation({...latest,eventSequence:latest.eventSequence+1,updatedAt:now()});}}
export function initializeTestingChat(){if(subscribed)return;subscribed=true;subscribeTestingJobs(onJob);subscribeTestingRuns(onRun);}

function proposal(job:TestingAgentJob|undefined){
  const value=job?.result as TestingScenarioEditProposal|undefined;
  if(!job||job.phase!=='business'||job.status!=='completed'||value?.scope!=='scenario'||value.reviewStatus!=='pending'||!job.fingerprint||!job.scenarioRevision)return undefined;
  return {jobId:job.id,fingerprint:job.fingerprint,expectedRevision:job.scenarioRevision,scenario:value.scenario,changes:value.changes};
}
export function getTestingChatSnapshot(id:string):TestingChatSnapshot{
  const conversation=readConversation(id),scenario=conversation.scenarioId?getTestingScenario(conversation.scenarioId):undefined;
  const jobs=listTestingJobs(),scenarioFingerprint=scenario?compileTestingScenario(scenario,getTestingCatalog()).fingerprint:undefined;
  const linkedActive=conversation.activeJobId?jobs.find(job=>job.id===conversation.activeJobId&&['queued','running'].includes(job.status)):undefined;
  const activeJob=linkedActive??jobs.find(job=>!job.parentJobId&&job.scenarioId===scenario?.id&&job.fingerprint===scenarioFingerprint&&['queued','running'].includes(job.status));
  const candidate=[...jobs].filter(job=>job.scenarioId===scenario?.id).sort((a,b)=>b.startedAt.localeCompare(a.startedAt)).find(job=>proposal(job));
  const proposed=proposal(candidate),runs=scenario?listTestingRuns().filter(run=>run.scenarioId===scenario.id):[];
  const latestRun=runs.sort((a,b)=>b.startedAt.localeCompare(a.startedAt))[0],currentRun=latestRun?.scenarioRevision===scenario?.revision&&latestRun.compiled.fingerprint===scenarioFingerprint;
  const lifecycle=scenario?deriveTestingLifecycle(scenario,getTestingCatalog(),jobs,runs,getTestingApproval(scenario.id)):undefined;
  const timeline=conversation.entryIds.map(entryId=>db.find<TestingChatEntry>(entries,entryId)).filter((entry):entry is TestingChatEntry=>!!entry);
  const allowed:TestingChatSnapshot['allowedCommands']=[];
  if(activeJob&&['queued','running'].includes(activeJob.status))allowed.push('cancel');
  else if(currentRun&&latestRun&&['queued','running'].includes(latestRun.status)){} 
  else if(proposed)allowed.push('apply','reject','revise','message');
  else if(!scenario||scenario.blocks.length===0)allowed.push('explore','resume','message');
  else {
    allowed.push('revise','message','save');const compiled=compileTestingScenario(scenario,getTestingCatalog(),getTestingApproval(scenario.id));
    if(!compiled.approval||compiled.approval.scenarioRevision!==scenario.revision||compiled.approval.fingerprint!==compiled.fingerprint)allowed.push('approve');
    else {const prepared=jobs.find(job=>job.phase==='technical'&&job.status==='completed'&&job.scenarioId===scenario.id&&job.scenarioRevision===scenario.revision&&job.fingerprint===compiled.fingerprint&&(job.result as {prepared?:boolean}|undefined)?.prepared);if(prepared)allowed.push('run');else allowed.push('prepare');}
  }
  const latestTechnical=scenario?jobs.find(job=>job.phase==='technical'&&job.status==='completed'&&job.scenarioId===scenario.id&&job.scenarioRevision===scenario.revision&&job.fingerprint===scenarioFingerprint):undefined;
  const technicalAttention=latestTechnical&&Array.isArray((latestTechnical.result as any)?.repairContext?.issues)?latestTechnical:undefined;
  return {conversation:clone(conversation),timeline,scenario,proposed,lifecycle,
    ...(activeJob?{activeJob:{id:activeJob.id,phase:activeJob.phase,status:activeJob.status,stage:activeJob.stage,startedAt:activeJob.startedAt,finishedAt:activeJob.finishedAt,error:activeJob.error,progress:activeJob.progress,workStages:activeJob.workStages,runId:activeJob.runId}}:{}),
    ...(latestRun?{latestRun:{id:latestRun.id,status:latestRun.status,startedAt:latestRun.startedAt,finishedAt:latestRun.finishedAt,error:latestRun.error,steps:latestRun.steps,artifacts:latestRun.artifacts,summary:latestRun.summary,matrixRows:latestRun.matrixRows,scenarioRevision:latestRun.scenarioRevision,fingerprint:latestRun.compiled.fingerprint,isCurrent:!!currentRun}}:{}),
    allowedCommands:allowed,confirmedFlow:scenario?{scenarioRevision:scenario.revision,blocks:scenario.blocks}:null,...(scenario&&scenarioFingerprint?{scenarioState:{revision:scenario.revision,fingerprint:scenarioFingerprint}}:{}),...(technicalAttention?{technicalReview:{jobId:technicalAttention.id,issues:(technicalAttention.result as any).repairContext.issues,needsBusinessReview:!!(technicalAttention.result as any).needsBusinessReview}}:{}),...(activeJob?.stage?{runningStage:activeJob.stage}:{})};
}

function text(payload:Record<string,unknown>|undefined){const value=payload?.text;if(typeof value!=='string'||value.trim().length<5||value.length>15_000)throw new TestingModelError('Die Nachricht muss zwischen 5 und 15.000 Zeichen lang sein.');return value.trim();}
export function buildTestingChatResumeRequest(id:string,scenario:TestingScenario){
  const conversation=readConversation(id),timeline=conversation.entryIds.map(entryId=>db.find<TestingChatEntry>(entries,entryId)).filter((entry):entry is TestingChatEntry=>!!entry);
  const relevant=timeline.filter(entry=>entry.kind==='question'||entry.kind==='user').map(entry=>`${entry.kind==='question'?'Offene Rückfrage des Agenten':'Antwort des Menschen'}: ${entry.message}`);
  const header='\n\nBisherige Rückfragen und Antworten aus dieser Unterhaltung:\n',maximum=15_000,reservedContext=6_000;
  const intent=scenario.intent.slice(0,Math.max(0,maximum-header.length-reservedContext));let context=relevant.join('\n');
  const capacity=maximum-header.length-intent.length;if(context.length>capacity)context=context.slice(-capacity);
  return `${intent}${header}${context}`.slice(0,maximum);
}
function updateAfterCommand(conversation:TestingChatConversation,requestId:string,job?:TestingAgentJob){return persistConversation({...conversation,revision:conversation.revision+1,eventSequence:conversation.eventSequence+1,updatedAt:now(),...(job?{activeJobId:job.id,scenarioId:job.scenarioId??conversation.scenarioId}:{}),handledRequests:[...(conversation.handledRequests??[]).slice(-99),{id:requestId,revision:conversation.revision+1}]});}
export function createTestingChatConversation(input:{message?:string;model:TestingModel;scenarioId?:string;requestId:string}){
  const retried=db.read<TestingChatConversation>(conversations).find(value=>value.handledRequests?.some(request=>request.id===input.requestId));
  if(retried)return getTestingChatSnapshot(retried.id);
  const existing=input.scenarioId?db.read<TestingChatConversation>(conversations).find(value=>value.scenarioId===input.scenarioId):undefined;
  if(existing)return input.message?commandTestingChat(existing.id,{command:'message',expectedRevision:existing.revision,requestId:input.requestId,payload:{text:input.message}}):getTestingChatSnapshot(existing.id);
  if(!input.scenarioId&&!input.message)throw new TestingModelError('Eine neue Unterhaltung braucht eine fachliche Anforderung.');
  const createdAt=now(),id=`chat-${randomUUID()}`;
  const conversation:TestingChatConversation={id,revision:1,eventSequence:0,createdAt,updatedAt:createdAt,model:input.model,scenarioId:input.scenarioId,entryIds:[],handledRequests:[]};
  persistConversation(conversation,false);
  if(!input.message)return getTestingChatSnapshot(id);
  append(id,{kind:'user',message:input.message});const job=startBusinessJob({request:input.message,model:input.model,...(input.scenarioId?{scenarioId:input.scenarioId,revision:getTestingScenario(input.scenarioId).revision}:{})});
  updateAfterCommand(readConversation(id),input.requestId,job);return getTestingChatSnapshot(id);
}
export function commandTestingChat(id:string,input:TestingChatCommandRequest & {requestId:string}){
  let conversation=readConversation(id);const handled=conversation.handledRequests?.find(item=>item.id===input.requestId);if(handled)return getTestingChatSnapshot(id);
  if(conversation.revision!==input.expectedRevision)throw new TestingModelError('Die Unterhaltung wurde zwischenzeitlich geändert. Lade den aktuellen Stand.',409,'CHAT_REVISION_CONFLICT');
  const snapshot=getTestingChatSnapshot(id);if(!snapshot.allowedCommands.includes(input.command))throw new TestingModelError('Diese Aktion ist im aktuellen Stand nicht erlaubt.',409,'CHAT_COMMAND_NOT_ALLOWED');
  const scenario=snapshot.scenario;let job:TestingAgentJob|undefined;const selectedModel=typeof input.payload?.model==='string'?input.payload.model as TestingModel:conversation.model;
  if(scenario&&['message','explore','resume','revise','save','approve','prepare','run'].includes(input.command)){
    if(input.payload?.expectedScenarioRevision!==scenario.revision||input.payload?.fingerprint!==snapshot.scenarioState?.fingerprint)throw new TestingModelError('Der fachliche Ablauf oder sein Wissensstand wurde außerhalb dieser Unterhaltung geändert. Lade den aktuellen Stand.',409,'SCENARIO_STATE_CONFLICT');
  }
  if(['message','explore','resume'].includes(input.command)){
    const message=text(input.payload);append(id,{kind:'user',message});conversation=readConversation(id);
    if(scenario?.blocks.length)job=startScenarioEditJob({scenarioId:scenario.id,revision:scenario.revision,text:message,model:selectedModel});
    else job=startBusinessJob({request:scenario?buildTestingChatResumeRequest(id,scenario):message,model:selectedModel,...(scenario?{scenarioId:scenario.id,revision:scenario.revision,preserveIntent:true}:{})});
  } else if(input.command==='revise') {const message=text(input.payload);append(id,{kind:'user',message});conversation=readConversation(id);job=startScenarioEditJob({scenarioId:scenario!.id,revision:scenario!.revision,text:message,model:selectedModel});}
  else if(input.command==='save'){const candidate=input.payload?.scenario;if(!candidate||typeof candidate!=='object'||Array.isArray(candidate)||(candidate as {revision?:number}).revision!==scenario!.revision)throw new TestingModelError('Zum Speichern werden der vollständige fachliche Ablauf und seine aktuelle Revision benötigt.',409,'REVISION_CONFLICT');const saved=saveTestingScenario({...candidate,id:scenario!.id} as TestingScenario,scenario!.revision);append(id,{kind:'change',message:'Die manuell bearbeitete fachliche Fassung wurde gespeichert.',scenarioRevision:saved.revision});conversation=readConversation(id);}
  else if(input.command==='apply'){const applied=applyScenarioEditJob({jobId:snapshot.proposed!.jobId,expectedRevision:snapshot.proposed!.expectedRevision,fingerprint:snapshot.proposed!.fingerprint});append(id,{kind:'change',message:'Der geprüfte Änderungsvorschlag wurde in den fachlichen Ablauf übernommen.',jobId:snapshot.proposed!.jobId,scenarioRevision:applied.scenario.revision});conversation=readConversation(id);}
  else if(input.command==='reject'){dismissScenarioEditJob(snapshot.proposed!.jobId);append(id,{kind:'change',message:'Der Änderungsvorschlag wurde verworfen.',jobId:snapshot.proposed!.jobId});conversation=readConversation(id);}
  else if(input.command==='approve'){approveTestingScenario(scenario!.id,scenario!.revision,'Fachliche Prüfung im Chat',typeof input.payload?.comment==='string'?input.payload.comment:undefined);append(id,{kind:'approval',message:'Die aktuelle fachliche Fassung wurde freigegeben.',scenarioRevision:scenario!.revision});conversation=readConversation(id);}
  else if(input.command==='prepare')job=startTechnicalJob({scenarioId:scenario!.id,revision:scenario!.revision,model:selectedModel,prepareOnly:true});
  else if(input.command==='run'){const prepared=listTestingJobs().find(candidate=>candidate.phase==='technical'&&candidate.status==='completed'&&candidate.scenarioId===scenario!.id&&candidate.scenarioRevision===scenario!.revision&&(candidate.result as {prepared?:boolean}|undefined)?.prepared);if(!prepared)throw new TestingModelError('Bitte diese Fassung zuerst technisch vorbereiten.',409,'TECHNICAL_PREPARATION_MISSING');const run=startPreparedRun({jobId:prepared.id,scenarioId:scenario!.id,revision:scenario!.revision,model:selectedModel});append(id,{kind:'evidence',message:'Der echte Browserlauf wurde gestartet.',runId:run.id,scenarioRevision:scenario!.revision});conversation=readConversation(id);}
  else if(input.command==='cancel'){cancelTestingJob(snapshot.activeJob!.id);append(id,{kind:'status',message:'Der laufende Auftrag wurde abgebrochen.',jobId:snapshot.activeJob!.id});conversation=readConversation(id);}
  if(job)conversation={...conversation,model:selectedModel};updateAfterCommand(conversation,input.requestId,job);return getTestingChatSnapshot(id);
}
export function subscribeTestingChat(id:string,listener:(event:TestingChatStreamEvent)=>void){readConversation(id);const set=listeners.get(id)??new Set();set.add(listener);listeners.set(id,set);return()=>{set.delete(listener);if(!set.size)listeners.delete(id);};}

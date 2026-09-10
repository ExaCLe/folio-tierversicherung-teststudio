import { randomUUID } from 'node:crypto';
import type { TestingAgentJob, TestingModel, TestingScenario, TestingScenarioEditProposal } from '../../shared/testing';
import type { TestingChatCommandRequest, TestingChatConversation, TestingChatEntry, TestingChatQuestion, TestingChatSnapshot, TestingChatStreamEvent, TestingChatTask } from '../../shared/testing-chat';
import { db } from '../store';
import { compileTestingScenario } from './compiler';
import { deriveTestingLifecycle } from './lifecycle';
import { approveTestingScenario, getTestingApproval, getTestingScenario, listTestingRuns, saveTestingScenario, subscribeTestingRuns, TestingModelError } from './repository';
import { applyScenarioEditJob, cancelTestingJob, dismissScenarioEditJob, listTestingJobs, startBusinessJob, startPreparedRun, startScenarioEditJob, startTechnicalJob, steerTestingJob, subscribeTestingJobs } from './agents/orchestrator';
import { getTestingCatalog } from './catalog';

const conversations='testingChatConversations',entries='testingChatEntries',questions='testingChatQuestions';
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
function replaceEntry(conversationId:string,entry:TestingChatEntry){db.upsert(entries,clone(entry));const conversation=readConversation(conversationId),saved=persistConversation({...conversation,eventSequence:conversation.eventSequence+1,updatedAt:now()},false);emit(conversationId,{type:'entry',sequence:saved.eventSequence,revision:saved.revision,entry:clone(entry)});}
/** Persist task-card detail without presenting it as a conversational reply. */
function upsertTaskDetail(conversationId:string,entry:TestingChatEntry){const conversation=readConversation(conversationId),exists=!!db.find<TestingChatEntry>(entries,entry.id);db.upsert(entries,clone(entry));const saved=persistConversation({...conversation,entryIds:exists?conversation.entryIds:[...conversation.entryIds.slice(-499),entry.id],eventSequence:conversation.eventSequence+1,updatedAt:now()},false);emit(conversationId,{type:'state',sequence:saved.eventSequence,revision:saved.revision});}
function linkJob(conversationId:string,jobId:string){const conversation=readConversation(conversationId);persistConversation({...conversation,activeJobId:jobId,jobIds:[...new Set([...(conversation.jobIds??[]),jobId])],eventSequence:conversation.eventSequence+1,updatedAt:now()});}
export function testingChatPublicJobEntry(job:TestingAgentJob,event:TestingAgentJob['events'][number]):TestingChatEntry|undefined{
  if(event.kind==='tool')return undefined;
  const publicEvent=event as typeof event&Pick<TestingChatEntry,'context'|'sources'|'content'>;
  const message=(event.kind==='error'?publicJobError(job,event.message):event.message).trim();if(!message)return undefined;
  // Routine lifecycle text belongs to task state, not the detail log. Status is
  // public only when its producer deliberately classified it (for example an
  // automatic validation report).
  if(event.kind==='status'&&!event.publicDetail)return undefined;
  if(event.kind==='message'&&!publicEvent.content&&!event.publicDetail&&/^[\[{]/.test(message))return undefined;
  const context=publicEvent.context??jobContext(job);
  const detail=event.publicDetail??(event.kind==='message'?{type:'message' as const,label:'Agentenantwort'}:event.kind==='error'?{type:'validation' as const,label:'Fehler'}:{type:'validation' as const,label:'Aktivitätsstatus'});
  return {id:`${job.id}:${event.id}`,at:event.at,kind:event.kind==='error'?'error':event.kind==='message'?'agent_summary':'status',message,jobId:job.id,
    detail,...(context?{context}:{}),...(publicEvent.sources?.length?{sources:publicEvent.sources}:{}),...(publicEvent.content?{content:publicEvent.content}:{}),
    ...(job.scenarioRevision?{scenarioRevision:job.scenarioRevision}:{}),...(job.runId?{runId:job.runId}:{})};
}
function publicJobError(job:TestingAgentJob,error:string){
  if(job.phase==='exploration'&&/(passt nicht zum Vertrag|KI-Korrektur verletzt den Vertrag|Korrigiere alle folgenden Vertragsfehler gemeinsam:)/i.test(error))return 'Die Wissensprüfung konnte kein verlässliches Ergebnis erstellen. Starte sie erneut.';
  return error;
}
function jobContext(job:TestingAgentJob):NonNullable<TestingChatEntry['context']>{return {jobId:job.id,phase:job.phase,taskLabel:job.phase==='exploration'?'Fachwissen prüfen':job.phase==='business'?'Fachlichen Ablauf planen':job.phase==='technical'?'Technisch vorbereiten':job.phase==='duplicates'?'Wiederverwendung prüfen':job.phase==='reuse'?'Bausteine vorschlagen':'Testfall benennen',modelId:job.model,...(job.agentConfig?.modelLabel?{modelLabel:job.agentConfig.modelLabel}:{}),...(job.agentConfig?.provider?{provider:job.agentConfig.provider}:{}),...(job.stage?{stage:job.stage}:{})};}
const agentColors:Record<TestingAgentJob['phase'],string>={business:'#635bff',exploration:'#0f9f8f',technical:'#e56b25',duplicates:'#b14d8c',reuse:'#2878c7',naming:'#8a63d2'};
function publicDetails(job:TestingAgentJob,suppressErrors=false):TestingChatTask['publicDetails']{
  const details:TestingChatTask['publicDetails']=[];
  for(const event of job.events){if(suppressErrors&&event.kind==='error')continue;const entry=testingChatPublicJobEntry(job,event);if(!entry)continue;details.push({id:event.id,at:event.at,kind:event.kind==='error'?'error':entry.detail?.type==='result'?'result':'progress',message:entry.message,detail:entry.detail!,...(entry.sources?{sources:entry.sources}:{}),...(entry.context?{context:entry.context}:{})});}
  const completed=completionEntry(job);if(completed&&!details.some(detail=>detail.message===completed.message))details.push({id:`${job.id}:result`,at:job.finishedAt??job.startedAt,kind:'result',message:completed.message,detail:completed.detail??{type:'result',label:'Ergebnis'}});
  const error=job.error?publicJobError(job,job.error):undefined;
  if(!suppressErrors&&error&&!details.some(detail=>detail.message===error))details.push({id:`${job.id}:error`,at:job.finishedAt??job.startedAt,kind:'error',message:error,detail:{type:'validation',label:'Fehler'}});
  return details;
}
function blockingChild(job:TestingAgentJob,jobs:TestingAgentJob[]){
  if(job.status!=='failed'||!job.error)return undefined;
  return jobs.find(candidate=>candidate.parentJobId===job.id&&candidate.status==='failed'&&!!candidate.error&&job.error!.includes(candidate.error!));
}
function task(job:TestingAgentJob,jobs:TestingAgentJob[],chatQuestions:TestingChatQuestion[]):TestingChatTask{
  const context=jobContext(job),activeChild=jobs.find(candidate=>candidate.parentJobId===job.id&&['queued','running'].includes(candidate.status)),blockedBy=blockingChild(job,jobs),needsAnswer=chatQuestions.some(question=>question.jobId===job.id&&question.status==='open');
  const status:TestingChatTask['status']=blockedBy?'blocked':activeChild?'queued':job.status==='queued'?'not_started':job.status;
  const activityState:TestingChatTask['activityState']=blockedBy?'blocked':job.status==='failed'?'failed':job.status==='cancelled'?'cancelled':needsAnswer?'attention':job.status==='completed'?'done':activeChild?'waiting':job.status==='queued'?'not_started':'working';
  const details=publicDetails(job,!!blockedBy),executionAt=details[0]?.at??job.workStages?.find(stage=>stage.startedAt&&stage.stage!=='knowledge'&&stage.stage!=='naming')?.startedAt;
  return {id:job.id,...(job.parentJobId?{parentJobId:job.parentJobId}:{}),...(activeChild?{waitingForJobId:activeChild.id}:{}),...(blockedBy?{blockedByJobId:blockedBy.id}:{}),purpose:context.taskLabel,agent:{name:job.agentConfig?.modelLabel??(job.model==='luna'?'Luna':'Sol'),modelId:job.model,...(job.agentConfig?.provider?{provider:job.agentConfig.provider}:{}),color:agentColors[job.phase]},status,activityState,...(job.stage?{stage:job.stage}:{}),startedAt:job.startedAt,...(executionAt?{executionAt}:{}),...(job.finishedAt?{finishedAt:job.finishedAt}:{}),publicDetails:details};
}
function rootJobId(job:TestingAgentJob,jobs:TestingAgentJob[]){let current=job,seen=new Set<string>();while(current.parentJobId&&!seen.has(current.id)){seen.add(current.id);const parent=jobs.find(candidate=>candidate.id===current.parentJobId);if(!parent)break;current=parent;}return current.id;}
function conversationJobs(conversation:TestingChatConversation,jobs:TestingAgentJob[],currentRootId?:string){const entryJobIds=conversation.entryIds.map(id=>db.find<TestingChatEntry>(entries,id)?.jobId).filter((id):id is string=>!!id),roots=new Set([...(conversation.jobIds??[]),...(conversation.activeJobId?[conversation.activeJobId]:[]),...entryJobIds,...(currentRootId?[currentRootId]:[])]);return jobs.filter(job=>roots.has(rootJobId(job,jobs))).sort((a,b)=>a.startedAt.localeCompare(b.startedAt));}
function conversationQuestions(id:string,conversation:TestingChatConversation){
  const stored=db.read<TestingChatQuestion&{questionId?:string;conversationId?:string}>(questions).filter(question=>question.conversationId===id).map(({questionId,conversationId:_,...question})=>({...question,id:questionId??question.id}));
  const timeline=conversation.entryIds.map(entryId=>db.find<TestingChatEntry>(entries,entryId)).filter((entry):entry is TestingChatEntry=>!!entry),lastHuman=timeline.reduce((index,entry,current)=>entry.kind==='user'?current:index,-1),known=new Set(stored.map(question=>question.id));
  const legacy=timeline.filter((entry,index)=>entry.kind==='question'&&index>lastHuman&&!known.has(entry.id)).map(entry=>({id:entry.id,jobId:entry.jobId??'legacy',kind:'clarification' as const,text:entry.message,why:'Diese frühere Rückfrage braucht noch eine ausdrückliche Zuordnung.',status:'open' as const}));
  return [...stored,...legacy];
}
function completionEntry(job:TestingAgentJob):Omit<TestingChatEntry,'id'|'at'>|undefined{
  const result=job.result as {draft?:{explanation?:string;assumptions?:string[];openQuestions?:string[]};explanation?:string;scenario?:TestingScenario;compiled?:{valid?:boolean};attempts?:{valid:boolean}[]|number;questions?:{text:string;status:string}[];suggestions?:{name:string;reason:string}[];duplicateDecisions?:{reason?:string}[];run?:{id:string}}|undefined;
  if(job.phase==='business'&&result?.draft&&(result.compiled?.valid!==true||Array.isArray(result.attempts)&&result.attempts.at(-1)?.valid!==true))return undefined;
  const summary=result?.draft?.explanation?.trim()||result?.explanation?.trim();if(!summary)return undefined;
  const facts=[...(result?.draft?.assumptions??[]).slice(0,4).map((value,index)=>({label:`Annahme ${index+1}`,value})),...(result?.suggestions??[]).slice(0,4).map(value=>({label:value.name,value:value.reason}))];
  const sources=[...(result?.scenario?.knowledgeRefs??[]).map(ref=>({label:`Wissensquelle ${ref}`,kind:'knowledge' as const,ref})),...(result?.scenario?[{label:result.scenario.title,kind:'scenario' as const,ref:`${result.scenario.id}@${result.scenario.revision}`}]:[])];
  const title=job.phase==='exploration'?'Ergebnis der Wissensprüfung':job.phase==='business'?'Validierter fachlicher Entwurf':'Validiertes Agentenergebnis';
  return {kind:'agent_summary',message:summary,jobId:job.id,context:jobContext(job),content:{type:'validated-summary',title,summary,...(facts.length?{facts}:{})},detail:{type:'result',label:title,data:{summary,...(facts.length?{facts}:{})}},...(sources.length?{sources}:{}),...(job.scenarioRevision?{scenarioRevision:job.scenarioRevision}:{}),...(result?.run?.id?{runId:result.run.id}:{})};
}
function onJob(job:TestingAgentJob){
  const jobs=listTestingJobs(),rootId=rootJobId(job,jobs);
  for(const conversation of db.read<TestingChatConversation>(conversations).filter(value=>value.activeJobId===rootId||value.jobIds?.includes(rootId))){
    let current=readConversation(conversation.id);
    for(const event of job.events){const projected=testingChatPublicJobEntry(job,event);if(!projected)continue;const existing=db.find<TestingChatEntry>(entries,projected.id);if(!existing||JSON.stringify(existing)!==JSON.stringify(projected))upsertTaskDetail(conversation.id,projected);}
    const patch:Partial<TestingChatConversation>={...(job.scenarioId?{scenarioId:job.scenarioId}:{}),jobIds:[...new Set([...(current.jobIds??[]),rootId])]};
    if(!job.parentJobId&&['queued','running'].includes(job.status))patch.activeJobId=job.id;else if(!job.parentJobId&&current.activeJobId===job.id)patch.activeJobId=undefined;
    if(job.status==='completed'){
      const result=job.result as {openQuestions?:string[];questions?:{id:string;text:string;why?:string;status:string;answer?:string}[];scenario?:{revision:number};run?:{id:string}}|undefined;
      const structured=(result?.questions as ({id:string;text:string;why?:string;status:string;answer?:string;kind?:string}[]|undefined))?.filter(value=>value.status==='open'&&value.kind==='clarification'&&!!value.why?.trim())??[];
      for(const question of structured){const publicId=`${rootId}:${question.id}`,storedId=`${conversation.id}:${publicId}`,existing=db.find<TestingChatQuestion&{id:string}>(questions,storedId);db.upsert(questions,{...existing,id:storedId,questionId:publicId,conversationId:conversation.id,jobId:existing?.jobId??job.id,kind:'clarification',text:question.text,why:question.why!.trim(),status:existing?.status??'open'});}
      const validated=job.events.filter(event=>event.kind==='message'&&!!event.content).at(-1),meaningful=validated?{kind:'agent_summary' as const,message:validated.content!.summary,jobId:job.id,context:validated.context??jobContext(job),content:validated.content,sources:validated.sources,detail:validated.publicDetail}:completionEntry(job);
      if(meaningful)append(conversation.id,{id:`${job.id}:completed`,...meaningful});
      else if(result?.openQuestions?.length)append(conversation.id,{id:`${job.id}:completed`,kind:'status',message:'Die Wissensprüfung braucht Antworten, bevor die Planung fortgesetzt werden kann.',jobId:job.id,context:jobContext(job)});
    } else if(job.status==='failed'&&job.error&&!blockingChild(job,jobs))append(conversation.id,{id:`${job.id}:failed`,kind:'error',message:publicJobError(job,job.error),jobId:job.id,context:jobContext(job)});
    current=readConversation(conversation.id);persistConversation({...current,...patch,eventSequence:current.eventSequence+1,updatedAt:now()});
  }
}
function onRun(run:ReturnType<typeof listTestingRuns>[number]){for(const conversation of db.read<TestingChatConversation>(conversations).filter(value=>value.scenarioId===run.scenarioId)){const current=readConversation(conversation.id);const terminal=['passed','failed'].includes(run.status);if(terminal)append(conversation.id,{id:`${run.id}:${run.status}`,kind:run.status==='passed'?'evidence':'error',message:run.status==='passed'?'Der Browserlauf ist erfolgreich abgeschlossen.':'Der Browserlauf ist fehlgeschlagen.',runId:run.id,scenarioRevision:run.scenarioRevision});
    if(terminal){const deferred=current.entryIds.map(id=>db.find<TestingChatEntry>(entries,id)).filter((entry):entry is TestingChatEntry=>!!entry&&entry.delivery?.state==='routing'&&entry.delivery.targetLabel==='Browserlauf');if(deferred.length)try{const scenario=getTestingScenario(run.scenarioId),job=startScenarioEditJob({scenarioId:scenario.id,revision:scenario.revision,text:`Hinweise nach dem Browserlauf:\n${deferred.map((entry,index)=>`${index+1}. ${entry.message}`).join('\n')}`,model:current.model});linkJob(conversation.id,job.id);for(const entry of deferred)replaceEntry(conversation.id,{...entry,delivery:{state:'replanning',targetLabel:'Neuer Planungsauftrag',successorJobId:job.id,detail:'Der Browserlauf ist beendet. Ein neuer Auftrag übernimmt die gespeicherten Hinweise.'}});}catch(error){for(const entry of deferred)replaceEntry(conversation.id,{...entry,delivery:{state:'rejected',targetLabel:'Neuplanung nach Browserlauf',detail:error instanceof Error?error.message:'Die gespeicherten Hinweise konnten noch nicht neu geplant werden.'}});}}
    const latest=readConversation(conversation.id);persistConversation({...latest,eventSequence:latest.eventSequence+1,updatedAt:now()});}}
export function recoverTestingChatDeliveries(){
  const jobs=listTestingJobs();for(const conversation of db.read<TestingChatConversation>(conversations)){for(const entryId of conversation.entryIds){const entry=db.find<TestingChatEntry>(entries,entryId);if(!entry?.delivery||!['routing','replanning'].includes(entry.delivery.state))continue;const successor=entry.delivery.successorJobId?jobs.find(job=>job.id===entry.delivery!.successorJobId):undefined;if(!successor||successor.status==='cancelled'||successor.termination?.cause==='server_restart')replaceEntry(conversation.id,{...entry,delivery:{...entry.delivery,state:'rejected',detail:'Die Neuplanung wurde durch einen Serverneustart unterbrochen. Die Nachricht bleibt erhalten und kann erneut gesendet werden.'}});}}
}
export function initializeTestingChat(){if(subscribed)return;subscribed=true;subscribeTestingJobs(job=>{try{onJob(job);}catch(error){console.error('Chat-Projektion für Agentenauftrag fehlgeschlagen:',error);}});subscribeTestingRuns(run=>{try{onRun(run);}catch(error){console.error('Chat-Projektion für Browserlauf fehlgeschlagen:',error);}});recoverTestingChatDeliveries();}

function proposal(job:TestingAgentJob|undefined){
  const value=job?.result as TestingScenarioEditProposal|undefined;
  if(!job||job.phase!=='business'||job.status!=='completed'||value?.scope!=='scenario'||value.reviewStatus!=='pending'||!job.fingerprint||!job.scenarioRevision)return undefined;
  return {jobId:job.id,fingerprint:job.fingerprint,expectedRevision:job.scenarioRevision,scenario:value.scenario,changes:value.changes};
}
function validatedFlowPreview(job:TestingAgentJob|undefined):TestingChatSnapshot['validatedFlowPreview']{
  if(!job)return undefined;const result=job.result as {scenario?:TestingScenario;compiled?:{valid?:boolean};attempts?:{valid:boolean}[]|number;validatedFlowPreview?:{scenario:TestingScenario;newDefinitions?:NonNullable<TestingChatSnapshot['validatedFlowPreview']>['newDefinitions'];newKnowledge?:NonNullable<TestingChatSnapshot['validatedFlowPreview']>['newKnowledge'];validation:'structural'|'business'}}|undefined;
  const explicit=result?.validatedFlowPreview,scenario=explicit?.scenario??result?.scenario;
  const validated=explicit?explicit.validation==='structural'||explicit.validation==='business':result?.compiled?.valid===true&&(!Array.isArray(result.attempts)||result.attempts.at(-1)?.valid===true);
  if(!scenario||!scenario.blocks.length||!validated)return undefined;
  return {jobId:job.id,scenarioRevision:scenario.revision,title:scenario.title,expectedOutcome:scenario.expectedOutcome,blocks:scenario.blocks,knowledgeRefs:scenario.knowledgeRefs,newDefinitions:explicit?.newDefinitions??[],newKnowledge:explicit?.newKnowledge??[],status:explicit?.validation==='business'?'ready':'provisional',readonly:true};
}
export function getTestingChatSnapshot(id:string):TestingChatSnapshot{
  const conversation=readConversation(id),scenario=conversation.scenarioId?getTestingScenario(conversation.scenarioId):undefined;
  const jobs=listTestingJobs(),scenarioFingerprint=scenario?compileTestingScenario(scenario,getTestingCatalog()).fingerprint:undefined;
  const linkedActive=conversation.activeJobId?jobs.find(job=>job.id===conversation.activeJobId&&!job.parentJobId&&['queued','running'].includes(job.status)):undefined;
  const activeJob=linkedActive??jobs.find(job=>!job.parentJobId&&job.scenarioId===scenario?.id&&job.fingerprint===scenarioFingerprint&&['queued','running'].includes(job.status));
  const linkedJobs=conversationJobs(conversation,jobs,activeJob?.id);
  const latestBusiness=[...jobs].filter(job=>job.scenarioId===scenario?.id&&job.phase==='business').sort((a,b)=>b.startedAt.localeCompare(a.startedAt))[0];
  const proposed=proposal(latestBusiness),runs=scenario?listTestingRuns().filter(run=>run.scenarioId===scenario.id):[];
  const previewCandidate=activeJob&&['business','exploration'].includes(activeJob.phase)?activeJob:undefined;
  const latestRun=runs.sort((a,b)=>b.startedAt.localeCompare(a.startedAt))[0],currentRun=latestRun?.scenarioRevision===scenario?.revision&&latestRun.compiled.fingerprint===scenarioFingerprint;
  const lifecycle=scenario?deriveTestingLifecycle(scenario,getTestingCatalog(),jobs,runs,getTestingApproval(scenario.id)):undefined;
  const propagatedParentIds=new Set(linkedJobs.filter(job=>!!blockingChild(job,linkedJobs)).map(job=>job.id));
  const timeline=conversation.entryIds.map(entryId=>db.find<TestingChatEntry>(entries,entryId)).filter((entry):entry is TestingChatEntry=>!!entry&&entry.kind!=='status'&&entry.kind!=='question'&&!(entry.kind==='error'&&entry.jobId&&propagatedParentIds.has(entry.jobId))&&!(entry.kind==='agent_summary'&&entry.jobId&&entry.id!==`${entry.jobId}:completed`)).map(entry=>{
    if(entry.kind!=='error'||!entry.jobId)return entry;const owner=linkedJobs.find(job=>job.id===entry.jobId);return owner?{...entry,message:publicJobError(owner,entry.message)}:entry;
  });
  const chatQuestions=conversationQuestions(id,conversation);
  const allowed:TestingChatSnapshot['allowedCommands']=[];
  if(activeJob&&['queued','running'].includes(activeJob.status))allowed.push('cancel','message');
  else if(currentRun&&latestRun&&['queued','running'].includes(latestRun.status))allowed.push('message');
  else if(proposed)allowed.push('apply','reject','revise','message');
  else if(chatQuestions.some(question=>question.status==='open')){allowed.push('answer','message');if(chatQuestions.some(question=>question.jobId==='legacy'))allowed.push('resume');}
  else if(!scenario||scenario.blocks.length===0)allowed.push('explore','resume','message');
  else {
    allowed.push('revise','message','save');const compiled=compileTestingScenario(scenario,getTestingCatalog(),getTestingApproval(scenario.id));
    if(!compiled.approval||compiled.approval.scenarioRevision!==scenario.revision||compiled.approval.fingerprint!==compiled.fingerprint)allowed.push('approve');
    else {const prepared=jobs.find(job=>job.phase==='technical'&&job.status==='completed'&&job.scenarioId===scenario.id&&job.scenarioRevision===scenario.revision&&job.fingerprint===compiled.fingerprint&&(job.result as {prepared?:boolean}|undefined)?.prepared);if(prepared)allowed.push('run');else allowed.push('prepare');}
  }
  const latestTechnical=scenario?jobs.find(job=>job.phase==='technical'&&job.status==='completed'&&job.scenarioId===scenario.id&&job.scenarioRevision===scenario.revision&&job.fingerprint===scenarioFingerprint):undefined;
  const technicalAttention=latestTechnical&&Array.isArray((latestTechnical.result as any)?.repairContext?.issues)?latestTechnical:undefined;
  const tasks=linkedJobs.map(job=>task(job,linkedJobs,chatQuestions)).sort((a,b)=>a.executionAt&&b.executionAt?a.executionAt.localeCompare(b.executionAt):a.executionAt?-1:b.executionAt?1:a.startedAt.localeCompare(b.startedAt));
  return {conversation:clone(conversation),timeline,tasks,questions:chatQuestions,scenario,proposed,lifecycle,
    ...(activeJob?{activeJob:{id:activeJob.id,phase:activeJob.phase,status:activeJob.status,stage:activeJob.stage,startedAt:activeJob.startedAt,finishedAt:activeJob.finishedAt,error:activeJob.error,progress:activeJob.progress,workStages:activeJob.workStages,runId:activeJob.runId}}:{}),
    ...(latestRun?{latestRun:{id:latestRun.id,status:latestRun.status,startedAt:latestRun.startedAt,finishedAt:latestRun.finishedAt,error:latestRun.error,steps:latestRun.steps,artifacts:latestRun.artifacts,summary:latestRun.summary,matrixRows:latestRun.matrixRows,scenarioRevision:latestRun.scenarioRevision,fingerprint:latestRun.compiled.fingerprint,isCurrent:!!currentRun}}:{}),
    allowedCommands:allowed,confirmedFlow:scenario?{scenarioRevision:scenario.revision,blocks:scenario.blocks}:null,...(validatedFlowPreview(previewCandidate)?{validatedFlowPreview:validatedFlowPreview(previewCandidate)}:{}),...(scenario&&scenarioFingerprint?{scenarioState:{revision:scenario.revision,fingerprint:scenarioFingerprint}}:{}),...(technicalAttention?{technicalReview:{jobId:technicalAttention.id,issues:(technicalAttention.result as any).repairContext.issues,needsBusinessReview:!!(technicalAttention.result as any).needsBusinessReview}}:{}),...(activeJob?.stage?{runningStage:activeJob.stage}:{})};
}

function text(payload:Record<string,unknown>|undefined){const value=payload?.text;if(typeof value!=='string'||value.trim().length<5||value.length>15_000)throw new TestingModelError('Die Nachricht muss zwischen 5 und 15.000 Zeichen lang sein.');return value.trim();}
export function buildTestingChatResumeRequest(id:string,scenario:TestingScenario){
  const conversation=readConversation(id),timeline=conversation.entryIds.map(entryId=>db.find<TestingChatEntry>(entries,entryId)).filter((entry):entry is TestingChatEntry=>!!entry);
  const answered=db.read<TestingChatQuestion&{questionId?:string;conversationId?:string}>(questions).filter(question=>question.conversationId===id&&question.status==='answered').map(question=>`Beantwortete Rückfrage ${question.questionId??question.id}: ${question.text}\nAntwort: ${question.answer}`);
  const open=db.read<TestingChatQuestion&{questionId?:string;conversationId?:string}>(questions).filter(question=>question.conversationId===id&&question.status==='open').map(question=>`Noch offene Rückfrage ${question.questionId??question.id}: ${question.text}`);
  const lastHuman=timeline.reduce((index,entry,current)=>entry.kind==='user'?current:index,-1),legacy=timeline.flatMap((entry,index)=>entry.kind==='question'?[`${index>lastHuman?'Offene Rückfrage des Agenten':'Frühere Frage des Agenten'}: ${entry.message}`]:entry.kind==='user'?[`Antwort des Menschen: ${entry.message}`]:[]);
  const relevant=[...legacy,...answered,...open];
  const header='\n\nBisherige Rückfragen und Antworten aus dieser Unterhaltung:\n',maximum=15_000,reservedContext=6_000;
  const intent=scenario.intent.slice(0,Math.max(0,maximum-header.length-reservedContext));let context=relevant.join('\n');
  const capacity=maximum-header.length-intent.length;if(context.length>capacity)throw new TestingModelError('Die Antworten sind zusammen zu lang, um die Planung vollständig fortzusetzen. Kürze bitte die Antworten; es wurde nichts abgeschnitten.',400,'CHAT_ANSWERS_TOO_LARGE');
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
  const conversation:TestingChatConversation={id,revision:1,eventSequence:0,createdAt,updatedAt:createdAt,model:input.model,scenarioId:input.scenarioId,entryIds:[],handledRequests:[],jobIds:[]};
  persistConversation(conversation,false);
  if(!input.message)return getTestingChatSnapshot(id);
  append(id,{kind:'user',message:input.message});const job=startBusinessJob({request:input.message,model:input.model,...(input.scenarioId?{scenarioId:input.scenarioId,revision:getTestingScenario(input.scenarioId).revision}:{})});
  updateAfterCommand({...readConversation(id),jobIds:[job.id]},input.requestId,job);return getTestingChatSnapshot(id);
}
export function commandTestingChat(id:string,input:TestingChatCommandRequest & {requestId:string}){
  let conversation=readConversation(id);const handled=conversation.handledRequests?.find(item=>item.id===input.requestId);if(handled)return getTestingChatSnapshot(id);
  if(conversation.revision!==input.expectedRevision)throw new TestingModelError('Die Unterhaltung wurde zwischenzeitlich geändert. Lade den aktuellen Stand.',409,'CHAT_REVISION_CONFLICT');
  const snapshot=getTestingChatSnapshot(id);if(!snapshot.allowedCommands.includes(input.command))throw new TestingModelError('Diese Aktion ist im aktuellen Stand nicht erlaubt.',409,'CHAT_COMMAND_NOT_ALLOWED');
  const scenario=snapshot.scenario;let job:TestingAgentJob|undefined;const selectedModel=typeof input.payload?.model==='string'?input.payload.model as TestingModel:conversation.model;
  if(scenario&&['message','explore','resume','answer','revise','save','approve','prepare','run'].includes(input.command)){
    if(input.payload?.expectedScenarioRevision!==scenario.revision||input.payload?.fingerprint!==snapshot.scenarioState?.fingerprint)throw new TestingModelError('Der fachliche Ablauf oder sein Wissensstand wurde außerhalb dieser Unterhaltung geändert. Lade den aktuellen Stand.',409,'SCENARIO_STATE_CONFLICT');
  }
  if(input.command==='message'&&snapshot.activeJob){
    const message=text(input.payload),entry=append(id,{id:`steering:${input.requestId}`,kind:'user',message,jobId:snapshot.activeJob.id,delivery:{state:'routing',targetLabel:'Laufende Planung',detail:'Die Nachricht wird in einen neuen, revisionstreuen Auftrag übernommen.'}});conversation=readConversation(id);updateAfterCommand(conversation,input.requestId);
    void steerTestingJob({jobId:snapshot.activeJob.id,message,model:selectedModel}).then(result=>{linkJob(id,result.successorJobId);replaceEntry(id,{...entry,delivery:{state:'replanning',targetLabel:'Neuer Planungsauftrag',successorJobId:result.successorJobId,detail:result.message}});}).catch(error=>replaceEntry(id,{...entry,delivery:{state:'rejected',targetLabel:'Neuplanung',detail:error instanceof Error?error.message:'Die Nachricht konnte nicht in einen neuen Auftrag übernommen werden. Bitte erneut senden.'}}));
    return getTestingChatSnapshot(id);
  }
  if(input.command==='message'&&snapshot.latestRun?.isCurrent&&['queued','running'].includes(snapshot.latestRun.status)){
    const message=text(input.payload);append(id,{id:`run-message:${input.requestId}`,kind:'user',message,runId:snapshot.latestRun.id,delivery:{state:'routing',targetLabel:'Browserlauf',detail:'Die Nachricht ist gespeichert. Nach dem Browserlauf startet damit eine neue fachliche Planung.'}});conversation=readConversation(id);updateAfterCommand(conversation,input.requestId);return getTestingChatSnapshot(id);
  }
  if(['message','explore','resume'].includes(input.command)){
    const message=text(input.payload);append(id,{kind:'user',message});conversation=readConversation(id);
    if(scenario?.blocks.length)job=startScenarioEditJob({scenarioId:scenario.id,revision:scenario.revision,text:message,model:selectedModel});
    else job=startBusinessJob({request:scenario?buildTestingChatResumeRequest(id,scenario):message,model:selectedModel,...(scenario?{scenarioId:scenario.id,revision:scenario.revision,preserveIntent:true}:{})});
  } else if(input.command==='answer') {
    const answers=input.payload?.answers;if(!Array.isArray(answers)||answers.length===0)throw new TestingModelError('Mindestens eine Antwort wird benötigt.');
    const normalized=answers.map(value=>{if(!value||typeof value!=='object'||Array.isArray(value))throw new TestingModelError('Jede Antwort braucht eine Frage-ID und Text.');const questionId=(value as any).questionId,answer=(value as any).answer;if(typeof questionId!=='string'||typeof answer!=='string'||!answer.trim()||answer.length>5_000)throw new TestingModelError('Jede Antwort braucht eine Frage-ID und höchstens 5.000 Zeichen Text.');return {questionId,answer:answer.trim()};});
    if(new Set(normalized.map(value=>value.questionId)).size!==normalized.length)throw new TestingModelError('Eine Frage darf im Antwortpaket nur einmal vorkommen.');
    const persisted=db.read<TestingChatQuestion&{questionId?:string;conversationId?:string}>(questions),available=conversationQuestions(id,conversation),records=normalized.map(value=>available.find(question=>question.id===value.questionId));
    if(records.some(question=>!question||question.status!=='open'))throw new TestingModelError('Mindestens eine Frage ist unbekannt oder bereits beantwortet.',409,'CHAT_QUESTION_CONFLICT');
    const answeredAt=now(),updates=records.map((question,index)=>({id:`${id}:${question!.id}`,questionId:question!.id,conversationId:id,jobId:question!.jobId,kind:'clarification' as const,text:question!.text,why:question!.why,status:'answered' as const,answer:normalized[index].answer,answeredAt}));db.replace(questions,[...persisted.filter(record=>!updates.some(update=>update.id===record.id)),...updates]);
    const remaining=available.filter(question=>question.status==='open'&&!normalized.some(answer=>answer.questionId===question.id));
    conversation=readConversation(id);if(!remaining.length){try{const request=buildTestingChatResumeRequest(id,scenario!);job=scenario!.blocks.length?startScenarioEditJob({scenarioId:scenario!.id,revision:scenario!.revision,text:request,model:selectedModel}):startBusinessJob({request,model:selectedModel,scenarioId:scenario!.id,revision:scenario!.revision,preserveIntent:true});}catch(error){db.replace(questions,persisted);throw error;}}
  } else if(input.command==='revise') {const message=text(input.payload);append(id,{kind:'user',message});conversation=readConversation(id);job=startScenarioEditJob({scenarioId:scenario!.id,revision:scenario!.revision,text:message,model:selectedModel});}
  else if(input.command==='save'){const candidate=input.payload?.scenario;if(!candidate||typeof candidate!=='object'||Array.isArray(candidate)||(candidate as {revision?:number}).revision!==scenario!.revision)throw new TestingModelError('Zum Speichern werden der vollständige fachliche Ablauf und seine aktuelle Revision benötigt.',409,'REVISION_CONFLICT');const saved=saveTestingScenario({...candidate,id:scenario!.id} as TestingScenario,scenario!.revision);append(id,{kind:'change',message:'Die manuell bearbeitete fachliche Fassung wurde gespeichert.',scenarioRevision:saved.revision});conversation=readConversation(id);}
  else if(input.command==='apply'){const applied=applyScenarioEditJob({jobId:snapshot.proposed!.jobId,expectedRevision:snapshot.proposed!.expectedRevision,fingerprint:snapshot.proposed!.fingerprint});append(id,{kind:'user_action',message:'Du hast den geprüften Änderungsvorschlag in den fachlichen Ablauf übernommen.',jobId:snapshot.proposed!.jobId,scenarioRevision:applied.scenario.revision});conversation=readConversation(id);}
  else if(input.command==='reject'){dismissScenarioEditJob(snapshot.proposed!.jobId);append(id,{kind:'user_action',message:'Du hast den Änderungsvorschlag verworfen.',jobId:snapshot.proposed!.jobId});conversation=readConversation(id);}
  else if(input.command==='approve'){approveTestingScenario(scenario!.id,scenario!.revision,'Fachliche Prüfung im Chat',typeof input.payload?.comment==='string'?input.payload.comment:undefined);append(id,{kind:'user_action',message:'Du hast die aktuelle fachliche Fassung freigegeben.',scenarioRevision:scenario!.revision});conversation=readConversation(id);}
  else if(input.command==='prepare')job=startTechnicalJob({scenarioId:scenario!.id,revision:scenario!.revision,model:selectedModel,prepareOnly:true});
  else if(input.command==='run'){const prepared=listTestingJobs().find(candidate=>candidate.phase==='technical'&&candidate.status==='completed'&&candidate.scenarioId===scenario!.id&&candidate.scenarioRevision===scenario!.revision&&(candidate.result as {prepared?:boolean}|undefined)?.prepared);if(!prepared)throw new TestingModelError('Bitte diese Fassung zuerst technisch vorbereiten.',409,'TECHNICAL_PREPARATION_MISSING');const run=startPreparedRun({jobId:prepared.id,scenarioId:scenario!.id,revision:scenario!.revision,model:selectedModel});append(id,{kind:'evidence',message:'Der echte Browserlauf wurde gestartet.',runId:run.id,scenarioRevision:scenario!.revision});conversation=readConversation(id);}
  else if(input.command==='cancel'){cancelTestingJob(snapshot.activeJob!.id);append(id,{kind:'status',message:'Der laufende Auftrag wurde abgebrochen.',jobId:snapshot.activeJob!.id});conversation=readConversation(id);}
  if(job)conversation={...conversation,model:selectedModel,jobIds:[...new Set([...(conversation.jobIds??[]),job.id])]};updateAfterCommand(conversation,input.requestId,job);return getTestingChatSnapshot(id);
}
export function subscribeTestingChat(id:string,listener:(event:TestingChatStreamEvent)=>void){readConversation(id);const set=listeners.get(id)??new Set();set.add(listener);listeners.set(id,set);return()=>{set.delete(listener);if(!set.size)listeners.delete(id);};}

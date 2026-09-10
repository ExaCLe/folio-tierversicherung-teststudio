import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { TestingAgentJob, TestingScenario } from '../../shared/testing';

const temporary=mkdtempSync(join(tmpdir(),'folio-chat-public-events-'));
process.env.FOLIO_DATA_FILE=join(temporary,'data.json');
process.env.FOLIO_AGENT_ARTIFACTS_ROOT=join(temporary,'agents');
const {db}=await import('../store');
const chat=await import('./chat');
const orchestrator=await import('./agents/orchestrator');
const {getTestingCatalog}=await import('./catalog');
const {testingFingerprint}=await import('./compiler');
after(()=>rmSync(temporary,{recursive:true,force:true}));

const at='2026-09-10T12:00:00.000Z';
function conversation(id:string,scenarioId:string){db.upsert('testingChatConversations',{id,revision:1,eventSequence:0,createdAt:at,updatedAt:at,model:'luna',scenarioId,activeJobId:'parent',entryIds:[],handledRequests:[]});}
function scenario(id:string,blocks:TestingScenario['blocks']):TestingScenario{return {id,title:'Validierter Vertragsentwurf',intent:'Einen fachlichen Ablauf prüfen.',revision:1,blocks,expectedOutcome:'Der erwartete Zustand ist belegt.',knowledgeRefs:['wissen-vertrag'],source:'agent',model:'luna',createdAt:at,updatedAt:at};}

test('kuratierte Unterauftrag-Ausgabe bleibt über SSE und erneutes Laden mit Herkunft erhalten',()=>{
  const scenarioId='public-child-scenario';db.upsert('testingScenarios',scenario(scenarioId,[]));conversation('public-child-chat',scenarioId);
  const parent:TestingAgentJob={id:'parent',phase:'business',model:'luna',status:'running',prompt:'Fixture',scenarioId,scenarioRevision:1,startedAt:at,events:[]};
  const child:TestingAgentJob={id:'child',parentJobId:'parent',phase:'exploration',model:'luna',status:'running',prompt:'Fixture',scenarioId,scenarioRevision:1,startedAt:at,events:[],agentConfig:{provider:'codex',modelId:'luna',modelLabel:'Luna lokal',modelSlug:'luna',executable:'fixture',args:[],settingsRevision:1}};
  db.upsert('testingAgentJobs',parent);db.upsert('testingAgentJobs',child);chat.initializeTestingChat();
  const streamed:unknown[]=[];const unsubscribe=chat.subscribeTestingChat('public-child-chat',event=>streamed.push(event));
  orchestrator.addValidatedSummary('child',{title:'Ergebnis der Wissensprüfung',summary:'Die Rollenregel ist durch vorhandenes Wissen belegt.',facts:[{label:'Beantwortete Frage',value:'Die Direktion darf freigeben.'}],sources:[{label:'Rollenregel',kind:'knowledge',ref:'wissen-vertrag'}]});
  db.upsert<TestingAgentJob>('testingAgentJobs',{...orchestrator.getTestingJob('child'),status:'completed',finishedAt:at,result:{explanation:'Die Rollenregel ist vollständig geprüft.'}});orchestrator.addValidatedSummary('child',{title:'Abgeschlossene Wissensprüfung',summary:'Die Rollenregel ist vollständig geprüft.',sources:[{label:'Rollenregel',kind:'knowledge',ref:'wissen-vertrag'}]});
  unsubscribe();
  db.upsert<TestingAgentJob>('testingAgentJobs',{...child,id:'child-running',status:'running'});orchestrator.addValidatedSummary('child-running',{title:'Weiterer Zwischenstand',summary:'Der Unterauftrag arbeitet weiter.'});
  const entry=chat.getTestingChatSnapshot('public-child-chat').timeline.find(item=>item.jobId==='child')!;
  assert.equal(entry.content?.summary,'Die Rollenregel ist vollständig geprüft.');assert.equal(entry.context?.modelLabel,'Luna lokal');assert.equal(entry.context?.taskLabel,'Fachwissen prüfen');assert.equal(entry.sources?.[0].ref,'wissen-vertrag');
  assert(streamed.some((event:any)=>event.type==='entry'&&event.entry.id===entry.id));assert(chat.getTestingChatSnapshot('public-child-chat').timeline.some(item=>item.content?.summary==='Die Rollenregel ist vollständig geprüft.'));
  assert.equal(chat.getTestingChatSnapshot('public-child-chat').activeJob?.id,'parent');
  const tasks=chat.getTestingChatSnapshot('public-child-chat').tasks;assert.deepEqual(tasks.map(item=>[item.id,item.parentJobId,item.activityState]),[['child','parent','done'],['child-running','parent','working'],['parent',undefined,'waiting']]);
  assert.equal(tasks.find(item=>item.id==='child')?.agent.name,'Luna lokal');assert(tasks.find(item=>item.id==='child')?.publicDetails.some(detail=>detail.message==='Die Rollenregel ist vollständig geprüft.'));
  chat.commandTestingChat('public-child-chat',{command:'cancel',expectedRevision:1,requestId:'cancel-root'});assert.equal(orchestrator.getTestingJob('parent').status,'cancelled');assert.equal(orchestrator.getTestingJob('child').status,'completed');assert.equal(orchestrator.getTestingJob('child-running').status,'cancelled');
});

test('persistierte Unterauftragsfehler bleiben nach Reload dem verursachenden Auftrag zugeordnet',()=>{
  const scenarioId='persisted-failure-scenario',chatId='persisted-failure-chat',childError='Wissenserkundung: Auch die KI-Korrektur verletzt den Vertrag: questions.0.requestQuote';
  db.upsert('testingScenarios',scenario(scenarioId,[]));
  db.upsert<TestingAgentJob>('testingAgentJobs',{id:'failed-parent',phase:'business',model:'luna',status:'failed',prompt:'Fixture',scenarioId,scenarioRevision:1,startedAt:at,finishedAt:at,childJobIds:['failed-exploration'],events:[{id:'parent-raw-error',at,kind:'error',message:`Die Wissensprüfung konnte nicht abgeschlossen werden: ${childError}`}],error:`Die Wissensprüfung konnte nicht abgeschlossen werden: ${childError}`});
  db.upsert<TestingAgentJob>('testingAgentJobs',{id:'failed-exploration',parentJobId:'failed-parent',phase:'exploration',stage:'knowledge',model:'luna',status:'failed',prompt:'Fixture',scenarioId,scenarioRevision:1,startedAt:at,finishedAt:at,events:[{id:'child-raw-error',at,kind:'error',message:childError}],error:childError});
  db.upsert('testingChatEntries',{id:'failed-exploration:failed',at,kind:'error',message:childError,jobId:'failed-exploration'});
  db.upsert('testingChatEntries',{id:'failed-parent:failed',at,kind:'error',message:`Die Wissensprüfung konnte nicht abgeschlossen werden: ${childError}`,jobId:'failed-parent'});
  db.upsert('testingChatConversations',{id:chatId,revision:1,eventSequence:2,createdAt:at,updatedAt:at,model:'luna',scenarioId,entryIds:['failed-exploration:failed','failed-parent:failed'],handledRequests:[],jobIds:['failed-parent']});

  const snapshot=chat.getTestingChatSnapshot(chatId),parent=snapshot.tasks.find(item=>item.id==='failed-parent')!,child=snapshot.tasks.find(item=>item.id==='failed-exploration')!;
  assert.equal(parent.status,'blocked');assert.equal(parent.activityState,'blocked');assert.equal(parent.blockedByJobId,child.id);assert.equal(parent.publicDetails.some(detail=>detail.kind==='error'),false);
  assert.equal(child.status,'failed');assert.equal(child.activityState,'failed');assert.deepEqual(child.publicDetails.filter(detail=>detail.kind==='error').map(detail=>detail.message),['Die Wissensprüfung konnte kein verlässliches Ergebnis erstellen. Starte sie erneut.']);
  assert.deepEqual(snapshot.timeline.filter(entry=>entry.kind==='error').map(entry=>[entry.jobId,entry.message]),[['failed-exploration','Die Wissensprüfung konnte kein verlässliches Ergebnis erstellen. Starte sie erneut.']]);
});

test('Wartezustand, noch nicht gestarteter Auftrag und unabhängiger Elternfehler bleiben unterscheidbar',()=>{
  const scenarioId='truthful-state-scenario',chatId='truthful-state-chat';db.upsert('testingScenarios',scenario(scenarioId,[]));
  const parent:TestingAgentJob={id:'waiting-parent',phase:'business',model:'luna',status:'running',prompt:'Fixture',scenarioId,scenarioRevision:1,startedAt:at,childJobIds:['queued-child'],events:[]};
  const queued:TestingAgentJob={id:'queued-child',parentJobId:parent.id,phase:'exploration',model:'luna',status:'queued',prompt:'Fixture',scenarioId,scenarioRevision:1,startedAt:at,events:[]};
  db.upsert('testingAgentJobs',parent);db.upsert('testingAgentJobs',queued);db.upsert('testingChatConversations',{id:chatId,revision:1,eventSequence:0,createdAt:at,updatedAt:at,model:'luna',scenarioId,activeJobId:parent.id,entryIds:[],handledRequests:[],jobIds:[parent.id]});
  let snapshot=chat.getTestingChatSnapshot(chatId),parentTask=snapshot.tasks.find(item=>item.id===parent.id)!,queuedTask=snapshot.tasks.find(item=>item.id===queued.id)!;
  assert.equal(parentTask.status,'queued');assert.equal(parentTask.activityState,'waiting');assert.equal(parentTask.waitingForJobId,queued.id);assert.equal(queuedTask.status,'not_started');assert.equal(queuedTask.activityState,'not_started');

  const ownError='Die Entwurfsplanung ist nach erfolgreicher Wissensprüfung fehlgeschlagen.';
  db.upsert<TestingAgentJob>('testingAgentJobs',{...parent,status:'failed',finishedAt:at,error:ownError,events:[{id:'own-error',at,kind:'error',message:ownError}]});
  db.upsert<TestingAgentJob>('testingAgentJobs',{...queued,status:'failed',finishedAt:at,error:'Ein älterer, anderer Unterauftragsfehler.',events:[]});
  db.upsert('testingChatQuestions',{id:`${chatId}:stale-open`,questionId:'stale-open',conversationId:chatId,jobId:parent.id,kind:'clarification',text:'Eine ältere offene Frage?',why:'Regression für die Zustandspriorität.',status:'open'});
  snapshot=chat.getTestingChatSnapshot(chatId);parentTask=snapshot.tasks.find(item=>item.id===parent.id)!;
  assert.equal(parentTask.status,'failed');assert.equal(parentTask.activityState,'failed');assert(parentTask.publicDetails.some(detail=>detail.kind==='error'&&detail.message===ownError));
  db.upsert<TestingAgentJob>('testingAgentJobs',{...parent,status:'completed',finishedAt:at,result:{openQuestions:['Eine ältere offene Frage?']},events:[]});
  parentTask=chat.getTestingChatSnapshot(chatId).tasks.find(item=>item.id===parent.id)!;assert.equal(parentTask.status,'completed');assert.equal(parentTask.activityState,'attention');
});

test('historische und generische Statusmeldungen erscheinen weder als Chatantwort noch als Aufgabendetail',()=>{
  const scenarioId='history-scenario';db.upsert('testingScenarios',scenario(scenarioId,[]));conversation('history-chat',scenarioId);db.upsert('testingChatConversations',{...db.find<any>('testingChatConversations','history-chat'),activeJobId:'history-parent'});
  db.upsert<TestingAgentJob>('testingAgentJobs',{id:'history-parent',phase:'business',model:'luna',status:'running',prompt:'Aktuell',scenarioId,scenarioRevision:1,startedAt:at,events:[{id:'progress',at,kind:'status',message:'Drei Wissensquellen geprüft.'}]});
  db.upsert<TestingAgentJob>('testingAgentJobs',{id:'old-job',phase:'business',model:'luna',status:'completed',prompt:'Alt',scenarioId,scenarioRevision:1,startedAt:'2026-01-01',finishedAt:'2026-01-01',events:[{id:'old-status',at:'2026-01-01',kind:'status',message:'Alte Browserbeobachtung 17 erfasst.'}]});
  const snapshot=chat.getTestingChatSnapshot('history-chat');assert.deepEqual(snapshot.tasks.map(item=>item.id),['history-parent']);assert.equal(snapshot.timeline.some(item=>item.message.includes('Browserbeobachtung')),false);assert.deepEqual(snapshot.tasks[0].publicDetails,[]);
});

test('Legacy-Migration erhält alle nach der letzten Antwort noch offenen Rückfragen',()=>{
  const scenarioId='legacy-questions-scenario',chatId='legacy-questions-chat';db.upsert('testingScenarios',scenario(scenarioId,[]));
  const rows=[
    {id:'legacy-answer',at,kind:'user',message:'Die bisherige Angabe ist bestätigt.'},
    {id:'legacy-question-one',at,kind:'question',message:'Welches Bundesland gilt?',jobId:'legacy-origin'},
    {id:'legacy-question-two',at,kind:'question',message:'Welche Versicherungssumme gilt?',jobId:'legacy-origin'},
  ];
  for(const row of rows)db.upsert('testingChatEntries',row);db.upsert('testingChatConversations',{id:chatId,revision:1,eventSequence:3,createdAt:at,updatedAt:at,model:'luna',scenarioId,entryIds:rows.map(row=>row.id),handledRequests:[]});
  const snapshot=chat.getTestingChatSnapshot(chatId);assert.deepEqual(snapshot.questions.map(question=>question.id),['legacy-question-one','legacy-question-two']);assert(snapshot.allowedCommands.includes('answer'));
});

test('beantwortete Legacy-Fragen werden im Wiederaufnahmekontext nicht erneut als offen bezeichnet',()=>{
  const scenarioId='legacy-resolved-scenario',chatId='legacy-resolved-chat',current=scenario(scenarioId,[]);db.upsert('testingScenarios',current);
  db.upsert('testingChatEntries',{id:'resolved-question',at,kind:'question',message:'Welches Bundesland gilt?'});db.upsert('testingChatEntries',{id:'resolved-answer',at,kind:'user',message:'Bayern.'});
  db.upsert('testingChatConversations',{id:chatId,revision:1,eventSequence:2,createdAt:at,updatedAt:at,model:'luna',scenarioId,entryIds:['resolved-question','resolved-answer'],handledRequests:[]});
  const prompt=chat.buildTestingChatResumeRequest(chatId,current);assert(prompt.includes('Frühere Frage des Agenten: Welches Bundesland gilt?'));assert(prompt.includes('Antwort des Menschen: Bayern.'));assert(!prompt.includes('Offene Rückfrage des Agenten: Welches Bundesland gilt?'));
});

test('Antwortpakete werden atomar nach Frage-ID gespeichert und starten erst nach der letzten Antwort genau einen Auftrag',async()=>{
  const scenarioId='answers-scenario',chatId='answers-chat';db.upsert('testingScenarios',scenario(scenarioId,[]));db.upsert('testingChatConversations',{id:chatId,revision:1,eventSequence:0,createdAt:at,updatedAt:at,model:'luna',scenarioId,entryIds:[],handledRequests:[],jobIds:['questions-origin']});
  db.replace('testingChatQuestions',[
    {id:`${chatId}:bundesland`,questionId:'bundesland',conversationId:chatId,jobId:'questions-origin',kind:'clarification',text:'Welches Bundesland gilt?',why:'Davon hängt der Grenzwert ab.',status:'open'},
    {id:`${chatId}:summe`,questionId:'summe',conversationId:chatId,jobId:'questions-origin',kind:'clarification',text:'Welche Summe gilt?',why:'Davon hängt die Prüfung ab.',status:'open'},
  ]);
  const state=chat.getTestingChatSnapshot(chatId).scenarioState!,guard={expectedScenarioRevision:state.revision,fingerprint:state.fingerprint};
  assert.throws(()=>chat.commandTestingChat(chatId,{command:'answer',expectedRevision:1,requestId:'bad-batch',payload:{...guard,answers:[{questionId:'bundesland',answer:'Bayern'},{questionId:'fehlt',answer:'12.000 Euro'}]}}),(error:any)=>error.code==='CHAT_QUESTION_CONFLICT');assert(chat.getTestingChatSnapshot(chatId).questions.every(item=>item.status==='open'));
  const first=chat.commandTestingChat(chatId,{command:'answer',expectedRevision:1,requestId:'answer-one',payload:{...guard,answers:[{questionId:'bundesland',answer:'Bayern'}]}});assert.equal(first.activeJob,undefined);assert.equal(first.questions.find(item=>item.id==='bundesland')?.answer,'Bayern');
  assert.throws(()=>chat.commandTestingChat(chatId,{command:'answer',expectedRevision:2,requestId:'answer-bad-model',payload:{...guard,model:'nicht-konfiguriert',answers:[{questionId:'summe',answer:'12.000 Euro'}]}}));assert.equal(chat.getTestingChatSnapshot(chatId).questions.find(item=>item.id==='summe')?.status,'open');
  const before=db.read<TestingAgentJob>('testingAgentJobs').length,second=chat.commandTestingChat(chatId,{command:'answer',expectedRevision:2,requestId:'answer-last',payload:{...guard,answers:[{questionId:'summe',answer:'12.000 Euro'}]}}),after=db.read<TestingAgentJob>('testingAgentJobs').length;assert.equal(after,before+1);assert(second.activeJob);assert(second.questions.every(item=>item.status==='answered'));
  const retry=chat.commandTestingChat(chatId,{command:'answer',expectedRevision:2,requestId:'answer-last',payload:{...guard,answers:[{questionId:'summe',answer:'12.000 Euro'}]}});assert.equal(db.read<TestingAgentJob>('testingAgentJobs').length,after);assert.equal(retry.activeJob?.id,second.activeJob?.id);
  if(second.activeJob){chat.commandTestingChat(chatId,{command:'cancel',expectedRevision:second.conversation.revision,requestId:'cancel-answer-job'});await orchestrator.waitTestingJob(second.activeJob.id);}
});

test('Snapshot zeigt nur validierte Entwürfe und kennzeichnet offenes Business-Gate als vorläufig',()=>{
  const scenarioId='preview-scenario',draft=scenario(scenarioId,[{id:'schritt',definition:{id:'kunde.anlegen',version:'1.0.0'},inputs:{}}]);db.upsert('testingScenarios',scenario(scenarioId,[]));conversation('preview-chat',scenarioId);
  db.upsert<TestingAgentJob>('testingAgentJobs',{id:'parent',phase:'business',model:'luna',status:'running',prompt:'Fixture',scenarioId,scenarioRevision:1,startedAt:at,events:[],result:{validatedFlowPreview:{scenario:draft,validation:'structural',provisional:true}}});
  const preview=chat.getTestingChatSnapshot('preview-chat').validatedFlowPreview;assert.equal(preview?.status,'provisional');assert.equal(preview?.readonly,true);assert.equal(preview?.blocks.length,1);
  db.upsert<TestingAgentJob>('testingAgentJobs',{id:'newer-invalid',phase:'business',model:'luna',status:'running',prompt:'Fixture',scenarioId,scenarioRevision:1,startedAt:'2026-09-10T13:00:00.000Z',events:[],result:{scenario:{...draft,title:'Ungeprüft'},compiled:{valid:false}}});
  assert.equal(chat.getTestingChatSnapshot('preview-chat').validatedFlowPreview?.title,'Validierter Vertragsentwurf');
  db.upsert<TestingAgentJob>('testingAgentJobs',{id:'parent',phase:'business',model:'luna',status:'failed',prompt:'Fixture',scenarioId,scenarioRevision:1,startedAt:at,finishedAt:at,events:[],result:{validatedFlowPreview:{scenario:draft,validation:'structural',provisional:true}}});
  assert.equal(chat.getTestingChatSnapshot('preview-chat').validatedFlowPreview,undefined);
});

test('CLI-Rauschen und rohe Daten bleiben draußen; öffentliche Prosa behält Agentenkontext',()=>{
  const job={id:'privacy-job',phase:'business',model:'luna',status:'running',prompt:'Fixture',startedAt:at,events:[],agentConfig:{provider:'codex',modelId:'luna',modelLabel:'Luna lokal',modelSlug:'luna',executable:'fixture',args:[],settingsRevision:1}} as TestingAgentJob;
  assert.equal(chat.testingChatPublicJobEntry(job,{id:'tool',at,kind:'tool',message:'private call'}),undefined);
  assert.equal(chat.testingChatPublicJobEntry(job,{id:'session',at,kind:'status',message:'Codex-Sitzung gestartet.'}),undefined);
  assert.equal(chat.testingChatPublicJobEntry(job,{id:'working',at,kind:'status',message:'Der Agent bearbeitet den Auftrag.'}),undefined);
  assert.equal(chat.testingChatPublicJobEntry(job,{id:'config',at,kind:'status',message:'Luna lokal wird als luna mit Codex aufgerufen.'}),undefined);
  assert.equal(chat.testingChatPublicJobEntry(job,{id:'raw',at,kind:'message',message:'{"private":"data"}'}),undefined);
  const publicEntry=chat.testingChatPublicJobEntry(job,{id:'public',at,kind:'message',message:'Die Rollenregel deckt den beantragten Ablauf ab.'})!;
  assert.equal(publicEntry.message,'Die Rollenregel deckt den beantragten Ablauf ab.');assert.equal(publicEntry.context?.jobId,'privacy-job');assert.equal(publicEntry.context?.modelLabel,'Luna lokal');assert.equal(publicEntry.context?.taskLabel,'Fachlichen Ablauf planen');
  const exploration={...job,id:'privacy-exploration',phase:'exploration' as const};
  assert.equal(chat.testingChatPublicJobEntry(exploration,{id:'domain-error',at,kind:'error',message:'Der Versicherungsvertrag wurde im Portal nicht gefunden.'})?.message,'Der Versicherungsvertrag wurde im Portal nicht gefunden.');
  assert.equal(chat.testingChatPublicJobEntry(exploration,{id:'provider-error',at,kind:'error',message:'Der Provider meldet einen fachlichen Vertragsfehler.'})?.message,'Der Provider meldet einen fachlichen Vertragsfehler.');
});

test('öffentliche Providerausgabe behält die verfügbare Länge und einen vorhandenen Kürzungshinweis',()=>{
  const job={id:'long-public-job',phase:'business',model:'luna',status:'running',prompt:'Fixture',startedAt:at,events:[]} as TestingAgentJob;
  const message=`${'a'.repeat(20_000)}\n[Ausgabe nach 20000 Zeichen gekürzt.]`,entry=chat.testingChatPublicJobEntry(job,{id:'long-public',at,kind:'message',message,publicDetail:{type:'message',label:'Agentenausgabe'}})!;
  assert.equal(entry.message,message);assert.match(entry.message,/Ausgabe nach 20000 Zeichen gekürzt/);
});

test('öffentliche Provider-Aktualisierungen ersetzen dieselbe stabile Aktivität live und nach Reload',()=>{
  const scenarioId='stream-update-scenario',chatId='stream-update-chat';db.upsert('testingScenarios',scenario(scenarioId,[]));conversation(chatId,scenarioId);
  const job:TestingAgentJob={id:'stream-job',phase:'business',model:'luna',status:'running',prompt:'Fixture',scenarioId,scenarioRevision:1,startedAt:at,events:[]};
  db.upsert('testingAgentJobs',job);db.upsert('testingChatConversations',{...db.find<any>('testingChatConversations',chatId),activeJobId:job.id,jobIds:[job.id]});
  const streamed:any[]=[];const unsubscribe=chat.subscribeTestingChat(chatId,event=>streamed.push(event));
  orchestrator.addTestingAgentEvent(job.id,{id:'provider-summary',at,kind:'message',message:'Prüfe Rollenregel …',publicDetail:{type:'reasoning',label:'Überlegung'},stream:{providerEventId:'provider-17',status:'streaming'}});
  orchestrator.addTestingAgentEvent(job.id,{id:'provider-summary',at:'2026-09-10T12:00:01.000Z',kind:'message',message:'Die Rollenregel gilt für Vermittler und Innendienst.',publicDetail:{type:'reasoning',label:'Überlegung'},stream:{providerEventId:'provider-17',status:'completed'}});
  unsubscribe();const stored=orchestrator.getTestingJob(job.id).events.filter(event=>event.stream?.providerEventId==='provider-17'),snapshot=chat.getTestingChatSnapshot(chatId),details=snapshot.tasks.find(item=>item.id===job.id)!.publicDetails.filter(item=>item.id==='provider-summary');
  assert.equal(stored.length,1);assert.equal(stored[0].at,at);assert.equal(stored[0].message,'Die Rollenregel gilt für Vermittler und Innendienst.');assert.equal(details.length,1);assert.equal(details[0].detail?.type,'reasoning');assert.equal(details[0].context?.jobId,job.id);assert.equal(snapshot.timeline.filter(entry=>entry.id===`${job.id}:provider-summary`).length,0);assert.equal(streamed.filter(event=>event.type==='entry'&&(event as any).entry.id===`${job.id}:provider-summary`).length,0);assert(streamed.filter(event=>event.type==='state').length>=2);
});

test('Aufrufmetriken bleiben trotz gekürzter Aktivität vollständig und erscheinen im Chat-Snapshot',()=>{
  const scenarioId='metrics-scenario',chatId='metrics-chat';db.upsert('testingScenarios',scenario(scenarioId,[]));conversation(chatId,scenarioId);
  const job:TestingAgentJob={id:'metrics-job',phase:'technical',model:'luna',status:'running',prompt:'Fixture',scenarioId,scenarioRevision:1,startedAt:at,events:[],metrics:{elapsedMs:0,requestCount:0}};
  db.upsert('testingAgentJobs',job);db.upsert('testingChatConversations',{...db.find<any>('testingChatConversations',chatId),activeJobId:job.id,jobIds:[job.id]});
  orchestrator.addTestingAgentEvent(job.id,{id:'call-1:metrics',at,kind:'metrics',message:'Modellaufruf beendet.',metrics:{requestCount:1,inputTokens:10,outputTokens:2,totalTokens:12}});
  for(let index=0;index<305;index++)orchestrator.addTestingAgentEvent(job.id,{id:`tool-${index}`,at,kind:'tool',message:`Werkzeug ${index}`});
  orchestrator.addTestingAgentEvent(job.id,{id:'call-2:metrics',at,kind:'metrics',message:'Modellaufruf beendet.',metrics:{requestCount:1,inputTokens:20,cachedInputTokens:5,outputTokens:3,totalTokens:23}});
  const saved=orchestrator.getTestingJob(job.id),task=chat.getTestingChatSnapshot(chatId).tasks.find(item=>item.id===job.id)!;
  assert.equal(saved.events.filter(event=>event.kind==='metrics').length,2);assert.deepEqual(saved.metrics,{elapsedMs:0,requestCount:2,inputTokens:30,cachedInputTokens:5,outputTokens:5,totalTokens:35});assert.deepEqual(task.metrics,saved.metrics);
});

test('Nur der neueste technische Versuch bestimmt den offenen Prüfbedarf',()=>{
  const scenarioId='technical-retry-scenario',chatId='technical-retry-chat',current=scenario(scenarioId,[]),fingerprint=testingFingerprint(current,getTestingCatalog());db.upsert('testingScenarios',current);conversation(chatId,scenarioId);
  const common={phase:'technical' as const,model:'luna',status:'completed' as const,prompt:'Fixture',scenarioId,scenarioRevision:1,fingerprint,events:[],finishedAt:'2026-09-10T13:00:02.000Z'};
  db.upsert<TestingAgentJob>('testingAgentJobs',{...common,id:'technical-old-blocked',startedAt:'2026-09-10T13:00:00.000Z',result:{technicalStatus:'blocked',repairContext:{issues:[{summary:'Alter Prüfbedarf'}]}}});
  db.upsert<TestingAgentJob>('testingAgentJobs',{...common,id:'technical-new-prepared',startedAt:'2026-09-10T13:00:01.000Z',result:{prepared:true}});
  db.upsert('testingChatConversations',{...db.find<any>('testingChatConversations',chatId),jobIds:['technical-old-blocked','technical-new-prepared']});
  assert.equal(chat.getTestingChatSnapshot(chatId).technicalReview,undefined);
});

test('Historische Fehler und exakt kopierte Dublettenbegründungen werden nur in der Ansicht bereinigt',()=>{
  const scenarioId='historical-projection-scenario',chatId='historical-projection-chat',current=scenario(scenarioId,[]);db.upsert('testingScenarios',current);conversation(chatId,scenarioId);
  const duplicateExplanation='Kein vorhandener Baustein ist fachlich gleichwertig.',technicalExplanation='Die UI-Berechtigung ist technisch geprüft.',error='Die strukturierte Antwort verletzt den Ausgabevertrag.';
  const parent:TestingAgentJob={id:'historical-technical',phase:'technical',model:'luna',status:'failed',prompt:'Fixture',scenarioId,scenarioRevision:1,startedAt:at,finishedAt:at,events:[],error,childJobIds:['historical-duplicates']};
  const child:TestingAgentJob={id:'historical-duplicates',parentJobId:parent.id,phase:'duplicates',model:'luna',status:'completed',prompt:'Fixture',scenarioId,scenarioRevision:1,startedAt:at,finishedAt:at,events:[],result:{explanation:duplicateExplanation}};
  db.upsert('testingAgentJobs',parent);db.upsert('testingAgentJobs',child);
  const copied=`${technicalExplanation}\n\n${duplicateExplanation}`;
  const summary={id:`${parent.id}:completed`,at,kind:'agent_summary' as const,message:copied,jobId:parent.id,content:{type:'validated-summary' as const,title:'Technik',summary:copied},detail:{type:'result' as const,label:'Technik',data:{summary:copied}}},eventError={id:`${parent.id}:provider-error`,at,kind:'error' as const,message:error,jobId:parent.id},terminalError={id:`${parent.id}:failed`,at,kind:'error' as const,message:error,jobId:parent.id};
  for(const entry of [summary,eventError,terminalError])db.upsert('testingChatEntries',entry);db.upsert('testingChatConversations',{...db.find<any>('testingChatConversations',chatId),jobIds:[parent.id],entryIds:[summary.id,eventError.id,terminalError.id]});
  const snapshot=chat.getTestingChatSnapshot(chatId),visibleSummary=snapshot.timeline.find(entry=>entry.kind==='agent_summary')!;
  assert.equal(visibleSummary.message,technicalExplanation);assert.equal(visibleSummary.content?.summary,technicalExplanation);assert.equal((visibleSummary.detail?.data as any).summary,technicalExplanation);assert.equal(snapshot.timeline.filter(entry=>entry.kind==='error').length,1);
  assert.equal(db.find<any>('testingChatEntries',summary.id).message,copied);assert.equal(db.find<any>('testingChatEntries',terminalError.id).message,error);
});

test('Nachricht während eines Laufs wird zuerst gespeichert und revisionstreu neu geplant',async()=>{
  const scenarioId='steering-scenario',current=scenario(scenarioId,[]);db.upsert('testingScenarios',current);conversation('steering-chat',scenarioId);
  db.upsert<TestingAgentJob>('testingAgentJobs',{id:'parent',phase:'business',model:'luna',status:'running',prompt:'Fixture',scenarioId,scenarioRevision:1,startedAt:at,events:[]});
  const state=chat.getTestingChatSnapshot('steering-chat');assert(state.allowedCommands.includes('message'));const streamed:any[]=[];const unsubscribe=chat.subscribeTestingChat('steering-chat',event=>streamed.push(event));
  const immediate=chat.commandTestingChat('steering-chat',{command:'message',expectedRevision:1,requestId:'steer-1',payload:{text:'Plane die Rollenwechsel bitte als einen gemeinsamen Ablauf.',expectedScenarioRevision:state.scenarioState!.revision,fingerprint:state.scenarioState!.fingerprint}});
  assert.equal(immediate.timeline.at(-1)?.delivery?.state,'routing');assert.equal(immediate.timeline.at(-1)?.message,'Plane die Rollenwechsel bitte als einen gemeinsamen Ablauf.');
  await new Promise<void>(resolve=>setImmediate(()=>setImmediate(resolve)));
  const routed=chat.getTestingChatSnapshot('steering-chat'),entry=routed.timeline.find(item=>item.id==='steering:steer-1')!;
  assert.equal(entry.delivery?.state,'replanning');assert(entry.delivery?.successorJobId);assert.equal(routed.conversation.revision,2);assert.equal(routed.activeJob?.id,entry.delivery?.successorJobId);assert(routed.tasks.some(task=>task.id===entry.delivery?.successorJobId));
  unsubscribe();assert.deepEqual(streamed.filter(event=>event.type==='entry'&&event.entry.id===entry.id).map(event=>event.entry.delivery.state),['routing','replanning']);
  if(entry.delivery?.successorJobId){orchestrator.cancelTestingJob(entry.delivery.successorJobId);await orchestrator.waitTestingJob(entry.delivery.successorJobId);}
});

test('Neuerer verworfener Auftrag lässt keinen alten Änderungsvorschlag wieder erscheinen',()=>{
  const scenarioId='proposal-freshness',current=scenario(scenarioId,[]);db.upsert('testingScenarios',current);conversation('proposal-chat',scenarioId);
  const proposal={scope:'scenario',applied:false,reviewStatus:'pending',scenario:{...current,blocks:[{id:'alt',definition:{id:'kunde.anlegen',version:'1.0.0'},inputs:{}}]},changes:[]};
  db.upsert<TestingAgentJob>('testingAgentJobs',{id:'old-proposal',phase:'business',model:'luna',status:'completed',prompt:'Fixture',scenarioId,scenarioRevision:1,fingerprint:'old',startedAt:at,finishedAt:at,events:[],result:proposal});
  db.upsert<TestingAgentJob>('testingAgentJobs',{id:'new-rejected',phase:'business',model:'luna',status:'completed',prompt:'Fixture',scenarioId,scenarioRevision:1,fingerprint:'new',startedAt:'2026-09-10T13:00:00.000Z',finishedAt:'2026-09-10T13:00:01.000Z',events:[],result:{...proposal,reviewStatus:'dismissed'}});
  assert.equal(chat.getTestingChatSnapshot('proposal-chat').proposed,undefined);
});

test('Neustart markiert eine nicht dispatchte Routing-Nachricht als retryfähig',()=>{
  const scenarioId='recovery-scenario';db.upsert('testingScenarios',scenario(scenarioId,[]));conversation('recovery-chat',scenarioId);
  db.upsert('testingChatEntries',{id:'pending-route',at,kind:'user',message:'Diese Nachricht muss erhalten bleiben.',delivery:{state:'routing'}});const stored=db.find<any>('testingChatConversations','recovery-chat');db.upsert('testingChatConversations',{...stored,entryIds:['pending-route']});
  chat.recoverTestingChatDeliveries();const entry=chat.getTestingChatSnapshot('recovery-chat').timeline[0];assert.equal(entry.message,'Diese Nachricht muss erhalten bleiben.');assert.equal(entry.delivery?.state,'rejected');assert.match(entry.delivery?.detail??'',/erneut gesendet/);
});

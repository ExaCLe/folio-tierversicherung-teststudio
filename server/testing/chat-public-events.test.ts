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
  orchestrator.addValidatedSummary('child',{title:'Ergebnis der Wissensprüfung',summary:'Die Rollenregel ist durch vorhandenes Wissen belegt.',facts:[{label:'Beantwortete Frage',value:'Die Direktion darf freigeben.'}],sources:[{label:'Rollenregel',kind:'knowledge',ref:'wissen-vertrag'}]});unsubscribe();
  db.upsert<TestingAgentJob>('testingAgentJobs',{...orchestrator.getTestingJob('child'),status:'completed',finishedAt:at,result:{explanation:'Die Rollenregel ist vollständig geprüft.'}});orchestrator.addValidatedSummary('child',{title:'Abgeschlossene Wissensprüfung',summary:'Die Rollenregel ist vollständig geprüft.',sources:[{label:'Rollenregel',kind:'knowledge',ref:'wissen-vertrag'}]});
  db.upsert<TestingAgentJob>('testingAgentJobs',{...child,id:'child-running',status:'running'});orchestrator.addValidatedSummary('child-running',{title:'Weiterer Zwischenstand',summary:'Der Unterauftrag arbeitet weiter.'});
  const entry=chat.getTestingChatSnapshot('public-child-chat').timeline.find(item=>item.jobId==='child')!;
  assert.equal(entry.content?.summary,'Die Rollenregel ist durch vorhandenes Wissen belegt.');assert.equal(entry.context?.modelLabel,'Luna lokal');assert.equal(entry.context?.taskLabel,'Fachwissen prüfen');assert.equal(entry.sources?.[0].ref,'wissen-vertrag');
  assert(streamed.some((event:any)=>event.type==='entry'&&event.entry.id===entry.id));assert(chat.getTestingChatSnapshot('public-child-chat').timeline.some(item=>item.content?.summary==='Die Rollenregel ist vollständig geprüft.'));
  assert.equal(chat.getTestingChatSnapshot('public-child-chat').activeJob?.id,'parent');
  chat.commandTestingChat('public-child-chat',{command:'cancel',expectedRevision:1,requestId:'cancel-root'});assert.equal(orchestrator.getTestingJob('parent').status,'cancelled');assert.equal(orchestrator.getTestingJob('child').status,'completed');assert.equal(orchestrator.getTestingJob('child-running').status,'cancelled');
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
});

test('Nachricht während eines Laufs wird zuerst gespeichert und revisionstreu neu geplant',async()=>{
  const scenarioId='steering-scenario',current=scenario(scenarioId,[]);db.upsert('testingScenarios',current);conversation('steering-chat',scenarioId);
  db.upsert<TestingAgentJob>('testingAgentJobs',{id:'parent',phase:'business',model:'luna',status:'running',prompt:'Fixture',scenarioId,scenarioRevision:1,startedAt:at,events:[]});
  const state=chat.getTestingChatSnapshot('steering-chat');assert(state.allowedCommands.includes('message'));const streamed:any[]=[];const unsubscribe=chat.subscribeTestingChat('steering-chat',event=>streamed.push(event));
  const immediate=chat.commandTestingChat('steering-chat',{command:'message',expectedRevision:1,requestId:'steer-1',payload:{text:'Plane die Rollenwechsel bitte als einen gemeinsamen Ablauf.',expectedScenarioRevision:state.scenarioState!.revision,fingerprint:state.scenarioState!.fingerprint}});
  assert.equal(immediate.timeline.at(-1)?.delivery?.state,'routing');assert.equal(immediate.timeline.at(-1)?.message,'Plane die Rollenwechsel bitte als einen gemeinsamen Ablauf.');
  await new Promise<void>(resolve=>setImmediate(()=>setImmediate(resolve)));
  const routed=chat.getTestingChatSnapshot('steering-chat'),entry=routed.timeline.find(item=>item.id==='steering:steer-1')!;
  assert.equal(entry.delivery?.state,'replanning');assert(entry.delivery?.successorJobId);assert.equal(routed.conversation.revision,2);
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

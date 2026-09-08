import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {TestingAgentJob,TestingBlockInstance,TestingRun} from '../../../shared/testing';

// Isolated persistence/process contracts. No model request or portal success claim.
const directory=await mkdtemp(join(tmpdir(),'folio-business-lifecycle-'));
process.env.FOLIO_DATA_FILE=join(directory,'folio.json');process.env.FOLIO_AGENT_ARTIFACTS_ROOT=join(directory,'agents');process.env.FOLIO_TESTING_RUN_ROOT=join(directory,'runs');
process.env.FOLIO_CODEX_EXECUTABLE=join(directory,'fixture.mjs');process.env.FOLIO_BUSINESS_FIXTURE=join(directory,'response.json');
await writeFile(process.env.FOLIO_CODEX_EXECUTABLE,`#!/usr/bin/env node
import{readFileSync,writeFileSync}from'node:fs';const args=process.argv.slice(2);for await(const chunk of process.stdin){}await new Promise(resolve=>setTimeout(resolve,100));
if(process.env.FOLIO_BUSINESS_MODE==='fail')process.exit(1);
const schema=JSON.parse(readFileSync(args[args.indexOf('--output-schema')+1],'utf8'));let response;
if(schema.properties.requestedTitleQuote){if(process.env.FOLIO_BUSINESS_MODE==='naming-fail')process.exit(1);const context=JSON.parse(readFileSync('anforderung.json','utf8'));const requested=context.request.includes('Titel: Gewünschter Fachtest');response={title:requested?'Gewünschter Fachtest':'Fachliche Anforderung nachvollziehbar prüfen',summary:'Synthetische Zusammenfassung der Testabsicht.',tags:['Fachprüfung'],titleSource:requested?'user-request':'agent',requestedTitleQuote:requested?'Gewünschter Fachtest':null};}
else if(schema.properties.knowledgeIds){const docs=JSON.parse(readFileSync('wissen.json','utf8'));const unanswered=process.env.FOLIO_BUSINESS_MODE==='question';response={decision:'finish',explanation:'Synthetische Wissensprüfung, keine KI-Erkundung.',knowledgeIds:[docs[0].id],gaps:unanswered?['Welche zusätzliche fachliche Regel gilt?']:[],questions:[{id:'anforderung-1',text:'Welche fachlichen Regeln gelten für die Anforderung?',requiresBrowser:false,status:'answered',answer:'Die synthetische Wissensprüfung verwendet die bereitgestellte Regel.',knowledgeIds:[docs[0].id],evidenceIds:[]},...(unanswered?[{id:'zusatzregel',text:'Welche zusätzliche fachliche Regel gilt?',requiresBrowser:false,status:'open',answer:'',knowledgeIds:[],evidenceIds:[]}]:[])],action:null,findings:[]};}
else response=JSON.parse(readFileSync(process.env.FOLIO_BUSINESS_FIXTURE,'utf8'));
writeFileSync(args[args.indexOf('-o')+1],JSON.stringify(response));
`,{mode:0o700});
const repository=await import('../repository');
const {getTestingCatalog,loadTestingSeedScenarios}=await import('../catalog');
const orchestrator=await import('./orchestrator');
const {createTestingRouter}=await import('../router');
const {deriveTestingLifecycle}=await import('../lifecycle');
const {testingFingerprint,compileTestingScenario}=await import('../compiler');
const {validateScenarioNaming}=await import('./naming');
const router=createTestingRouter();
const seed=loadTestingSeedScenarios().find(item=>item.id==='kuh-direktionsanfrage')!;
const wire=(block:TestingBlockInstance):unknown=>({id:block.id,definition:block.definition,inputs:Object.entries(block.inputs).map(([key,value])=>({key,valueJson:JSON.stringify(value)})),outputs:Object.entries(block.outputs??{}).map(([key,name])=>({key,name})),children:(block.children??[]).map(wire),overrides:Object.entries(block.overrides??{}).map(([path,inputs])=>({path,inputs:Object.entries(inputs).map(([key,value])=>({key,valueJson:JSON.stringify(value)}))})),note:block.note??''});
await writeFile(process.env.FOLIO_BUSINESS_FIXTURE,JSON.stringify({title:'Synthetischer fachlicher Entwurf',expectedOutcome:seed.expectedOutcome,blocks:seed.blocks.map(wire),knowledgeRefs:seed.knowledgeRefs,newDefinitions:[],newKnowledge:[],explanation:'Testfixture',assumptions:[],openQuestions:[]}));
after(()=>rm(directory,{recursive:true,force:true}));
async function request(method:string,path:string,body:unknown={}):Promise<{status:number;data:any}>{return new Promise((resolve,reject)=>{const res={statusCode:200,status(code:number){this.statusCode=code;return this;},json(data:unknown){resolve({status:this.statusCode,data:structuredClone(data)});return this;}};router({method,url:path,originalUrl:path,body,headers:{}}as never,res as never,error=>reject(error??new Error('Route fehlt')));});}
const lifecycle=(id:string)=>deriveTestingLifecycle(repository.getTestingScenario(id),getTestingCatalog(),orchestrator.listTestingJobs(),repository.listTestingRuns(),repository.getTestingApproval(id));

test('Anforderung existiert vor dem ersten Agentenergebnis und wird unter derselben ID zur passenden Revision',async()=>{
  const response=await request('POST','/jobs/business',{request:'Eine Kuh soll eine Direktionsprüfung auslösen.',model:'luna'});assert.equal(response.status,202);
  const initial=response.data as TestingAgentJob,scenario=repository.getTestingScenario(initial.scenarioId!);
  assert.equal(scenario.revision,1);assert.deepEqual(scenario.blocks,[]);assert.equal(scenario.intent,initial.prompt);assert.equal(initial.scenarioRevision,1);
  assert.equal((await request('GET','/bootstrap')).data.scenarios.some((item:any)=>item.id===scenario.id),true);
  assert.equal((await request('POST',`/scenarios/${scenario.id}/plan`,{revision:1,model:'luna'})).status,409);
  assert.equal(lifecycle(scenario.id).status,'running');
  const completed=await orchestrator.waitTestingJob(initial.id);assert.equal(completed.status,'completed',completed.error);
  const saved=repository.getTestingScenario(scenario.id);assert.equal(saved.revision,3);assert(saved.blocks.length);assert.equal(saved.intent,scenario.intent);
  assert.equal((completed.result as any).applied,true);assert.equal(completed.childJobIds!.length,2);
  const child=orchestrator.listTestingJobs().find(item=>item.parentJobId===completed.id&&item.phase==='exploration')!;assert.equal(child.parentJobId,completed.id);assert.equal(child.phase,'exploration');assert.equal(child.status,'completed');
  assert.deepEqual(child.agentConfig,completed.agentConfig);assert.equal((child.result as any).explored,false);assert.deepEqual((child.result as any).evidence,[]);
  for(const stage of ['naming','knowledge','planning','validating'])assert.equal(completed.workStages?.find(item=>item.stage===stage)?.status,'completed');
  assert.equal(completed.workStages?.find(item=>item.stage==='exploring')?.status,'skipped');
  assert.equal(child.progress?.status,'finished');assert.equal(child.progress?.observationCount,0);
  assert.deepEqual((completed.result as any).questions,(child.result as any).questions);assert.equal((completed.result as any).questions[0].status,'answered');
  const state=lifecycle(scenario.id);assert.equal(state.phase,'review');assert.equal(state.currentJobId,initial.id);assert.equal(state.nextAction,'approve');
  const persisted=JSON.parse(await readFile(process.env.FOLIO_DATA_FILE!,'utf8'));assert(persisted.testingScenarioRevisions.some((row:any)=>row.id===`${scenario.id}@1`));
});

test('Fehlgeschlagene und abgebrochene Planung lassen sich mit derselben gespeicherten Anforderung wiederaufnehmen',async()=>{
  process.env.FOLIO_BUSINESS_MODE='fail';const failed=orchestrator.startBusinessJob({request:'Eine fehlgeschlagene Planung wird erneut gestartet.',model:'luna'});assert.equal((await orchestrator.waitTestingJob(failed.id)).status,'failed');
  assert.equal(repository.getTestingScenario(failed.scenarioId!).revision,1);assert.equal(lifecycle(failed.scenarioId!).nextAction,'retry-business');
  delete process.env.FOLIO_BUSINESS_MODE;const resumed=await request('POST',`/scenarios/${failed.scenarioId}/plan`,{revision:1,model:'luna'});assert.equal(resumed.data.scenarioId,failed.scenarioId);assert.equal((await orchestrator.waitTestingJob(resumed.data.id)).status,'completed');
  const cancelled=orchestrator.startBusinessJob({request:'Eine abgebrochene Planung bleibt als Anforderung erhalten.',model:'luna'});orchestrator.cancelTestingJob(cancelled.id);await orchestrator.waitTestingJob(cancelled.id);
  assert.equal(orchestrator.getTestingJob(cancelled.id).termination?.cause,'user_cancelled');
  assert.equal(repository.getTestingScenario(cancelled.scenarioId!).revision,1);assert.equal(lifecycle(cancelled.scenarioId!).status,'cancelled');
  const retry=await request('POST',`/scenarios/${cancelled.scenarioId}/plan`,{revision:1,model:'luna'});assert.equal(retry.data.scenarioId,cancelled.scenarioId);assert.equal((await orchestrator.waitTestingJob(retry.data.id)).status,'completed');
});
test('Luna benennt den neutralen Entwurf und eine ausdrückliche Titelvorgabe bleibt auch nach Planung erhalten',async()=>{
  const job=orchestrator.startBusinessJob({request:'Titel: Gewünschter Fachtest. Prüfe die fachlichen Rollen.',model:'luna'});
  assert.equal(repository.getTestingScenario(job.scenarioId!).title,'Neuer Testfall');
  const done=await orchestrator.waitTestingJob(job.id);assert.equal(done.status,'completed',done.error);
  const saved=repository.getTestingScenario(job.scenarioId!);assert.equal(saved.title,'Gewünschter Fachtest');
  assert.equal(saved.naming?.titleSource,'user-request');assert.equal(saved.naming?.summary,'Synthetische Zusammenfassung der Testabsicht.');
  const naming=orchestrator.getTestingJob(saved.naming!.jobId);assert.equal(naming.phase,'naming');assert.equal(naming.agentConfig?.modelSlug,'gpt-5.6-luna');assert.equal(naming.parentJobId,done.id);
  const renamed=repository.saveTestingScenario({...saved,title:'Vom Menschen nachträglich benannt'},saved.revision);assert.equal(renamed.naming?.title,renamed.title);assert.equal(renamed.naming?.titleSource,'human');assert.equal(renamed.naming?.jobId,naming.id);assert.equal(repository.listTestingScenarioRevisions().find(item=>item.id===saved.id&&item.revision===saved.revision)?.naming?.titleSource,'user-request');
});
test('Wiederaufnahme eines benannten oder von Menschen betitelten Entwurfs ruft keinen neuen Benennungsagenten auf',async()=>{
  const initial=repository.createTestingRequestDraft('Eine gespeicherte manuelle Benennung bleibt beim Planen erhalten.','luna');
  const saved=repository.saveTestingScenario({...initial,title:'Mein bewusst gewählter Titel'},initial.revision);
  const job=orchestrator.startBusinessJob({request:saved.intent,scenarioId:saved.id,revision:saved.revision,model:'luna'}),done=await orchestrator.waitTestingJob(job.id);
  assert.equal(done.status,'completed',done.error);assert.equal(repository.getTestingScenario(saved.id).title,saved.title);
  assert(!orchestrator.listTestingJobs().some(child=>child.parentJobId===done.id&&child.phase==='naming'));
});
test('Ausfall der optionalen Luna-Benennung lässt den vorhandenen Titel und die fachliche Planung benutzbar',async()=>{
  process.env.FOLIO_BUSINESS_MODE='naming-fail';
  try{const job=orchestrator.startBusinessJob({request:'Auch ohne Benennung soll ein fachlicher Entwurf entstehen.',model:'luna'}),done=await orchestrator.waitTestingJob(job.id);assert.equal(done.status,'completed',done.error);assert((done.result as any).namingError);const saved=repository.getTestingScenario(job.scenarioId!);assert.equal(saved.title,'Neuer Testfall');assert(saved.blocks.length);assert.equal(saved.naming,undefined);}
  finally{delete process.env.FOLIO_BUSINESS_MODE;}
});
test('Eine ergänzte Anforderung aktualisiert Metadaten, ohne einen vorhandenen menschlichen Titel umzubenennen',async()=>{
  const initial=repository.createTestingRequestDraft('Prüfe zunächst eine einzelne fachliche Regel.','luna');
  const saved=repository.saveTestingScenario({...initial,title:'Mein dauerhaft gewählter Testtitel'},initial.revision);
  const job=orchestrator.startBusinessJob({request:saved.intent+' Ergänze die Rollenprüfung.',scenarioId:saved.id,revision:saved.revision,model:'luna'}),done=await orchestrator.waitTestingJob(job.id);
  assert.equal(done.status,'completed',done.error);
  const result=repository.getTestingScenario(saved.id);assert.equal(result.title,saved.title);assert.equal(result.naming?.title,result.title);assert.equal(result.naming?.titleSource,'human');assert(result.naming?.summary);
});
test('Ohne eingerichtetes Luna-Profil bleibt die gewählte Planung mit neutralem Titel möglich',async()=>{
  const settings=await import('./settings');const original=settings.getTestingAgentSettings();
  const other=original.models.find(model=>model.slug!=='gpt-5.6-luna')!;
  settings.saveTestingAgentSettings({...original,defaultModel:other.id,models:original.models.filter(model=>model.slug!=='gpt-5.6-luna')});
  try{
    const job=orchestrator.startBusinessJob({request:'Der Benutzer kann einen anderen Planungsagenten ohne Luna verwenden.',model:other.id}),done=await orchestrator.waitTestingJob(job.id);
    assert.equal(done.status,'completed',done.error);assert.equal(repository.getTestingScenario(job.scenarioId!).title,'Neuer Testfall');assert.match((done.result as any).namingError,/kein Luna-Modell/);
    assert(!orchestrator.listTestingJobs().some(child=>child.parentJobId===job.id&&child.phase==='naming'));assert.equal(done.workStages?.find(stage=>stage.stage==='naming')?.status,'failed');
  }finally{settings.saveTestingAgentSettings({...original,revision:settings.getTestingAgentSettings().revision});}
});
test('Eine behauptete menschliche Titelvorgabe braucht ein wortgetreues Zitat aus der Anforderung',()=>{
  const value={title:'Erfundener Titel',summary:'Zusammenfassung',tags:[],titleSource:'user-request',requestedTitleQuote:'Erfundener Titel'};
  assert.throws(()=>validateScenarioNaming(value,'Prüfe eine fachliche Regel.'),/wortgetreu/);
  assert.throws(()=>validateScenarioNaming({...value,title:'Umformulierter Titel'},'Titel: Erfundener Titel'),/wortgetreu/);
});

test('Ein Nutzerabbruch kennzeichnet den Hauptauftrag und beendet den Unterauftrag mit eigenem Grund',async()=>{
  const job=orchestrator.startBusinessJob({request:'Synthetische Prüfung der Abbruchzuordnung.',model:'luna'});
  const deadline=Date.now()+2000;
  while(!orchestrator.getTestingJob(job.id).childJobIds?.length&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,5));
  const childId=orchestrator.getTestingJob(job.id).childJobIds?.[0];assert(childId);
  orchestrator.cancelTestingJob(job.id);
  const [parent,child]=await Promise.all([orchestrator.waitTestingJob(job.id),orchestrator.waitTestingJob(childId)]);
  assert.equal(parent.status,'cancelled');assert.equal(parent.termination?.cause,'user_cancelled');
  assert.equal(child.status,'cancelled');assert.equal(child.termination?.cause,'parent_cancelled');
  assert.doesNotMatch(child.error??'',/vom Menschen/);assert.equal(repository.getTestingScenario(job.scenarioId!).blocks.length,0);
});
test('Änderungen während der Wissensprüfung werden nie durch ein asynchrones Ergebnis überschrieben',async()=>{
  const job=orchestrator.startBusinessJob({request:'Der Mensch bearbeitet die Anforderung während der Planung.',model:'luna'}),before=repository.getTestingScenario(job.scenarioId!);
  const edited=repository.saveTestingScenario({...before,intent:'Neue gespeicherte Anforderung des Menschen.',title:'Bewusste Änderung'},before.revision);
  const finished=await orchestrator.waitTestingJob(job.id);assert.equal(finished.status,'failed');assert.match(finished.error!,/geändert/);assert.deepEqual(repository.getTestingScenario(edited.id),edited);
});

test('Offene Wissensfragen beenden die Erkundung sichtbar ohne erfundenen Entwurf',async()=>{
  process.env.FOLIO_BUSINESS_MODE='question';try{const job=orchestrator.startBusinessJob({request:'Eine noch nicht dokumentierte Zusatzregel prüfen.',model:'luna'}),done=await orchestrator.waitTestingJob(job.id);assert.equal(done.status,'completed',done.error);assert.equal((done.result as any).needsKnowledge,true);assert.deepEqual((done.result as any).questions.filter((question:any)=>question.status==='open').map((question:any)=>question.id),['zusatzregel']);assert.deepEqual((done.result as any).openQuestions,['Welche zusätzliche fachliche Regel gilt?']);assert.deepEqual(repository.getTestingScenario(job.scenarioId!).blocks,[]);assert.equal(lifecycle(job.scenarioId!).status,'attention');assert.equal(lifecycle(job.scenarioId!).phase,'exploration');await assert.rejects(readFile(join(directory,'agents',job.id,'result.json')),/ENOENT/);}finally{delete process.env.FOLIO_BUSINESS_MODE;}
});

test('Definition und neue Wissensbelege werden atomar mit Rückverweisen übernommen oder vollständig abgewiesen',async()=>{
  const c=getTestingCatalog(),original=c.definitions.find(item=>item.id==='pruefung.vorschlagsstatus')!,definition={...structuredClone(original),id:'fixture.inline-wissen',name:'Fachprüfung mit eigenem Wissen',origin:'human',knowledgeRefs:['fixture.inline-regel']};
  const doc={id:'fixture.inline-regel',revision:1,title:'Eigene fachliche Regel',kind:'rule',summary:'Synthetischer Wissensbeleg',content:'Nur synthetische Regel für den API-Vertragstest.',definitionRefs:[{id:definition.id,version:definition.version}],relatedKnowledge:[],requiredFields:[],preconditions:[],postconditions:[],origin:'human'};
  const before=await readFile(process.env.FOLIO_DATA_FILE!,'utf8');
  const invalid=await request('POST','/definitions',{definition,newKnowledge:[{...doc,relatedKnowledge:['nicht-vorhanden']}]});assert.equal(invalid.status,400);assert.equal(await readFile(process.env.FOLIO_DATA_FILE!,'utf8'),before);
  const good=await request('POST','/definitions',{definition,newKnowledge:[doc]});assert.equal(good.status,201);
  assert(getTestingCatalog().knowledge.find(item=>item.id===doc.id)!.definitionRefs.some(ref=>ref.id===definition.id));
  const after=await readFile(process.env.FOLIO_DATA_FILE!,'utf8');
  const collision=await request('POST','/definitions',{definition:{...definition,name:'Verbotene Änderung'},newKnowledge:[{...doc,id:'fixture.verwaistes-wissen'}]});assert.equal(collision.status,409);assert.equal(await readFile(process.env.FOLIO_DATA_FILE!,'utf8'),after);
  const knowledgeCollision=await request('POST','/definitions',{definition:{...definition,id:'fixture.weiterer-block'},newKnowledge:[{...doc,content:'Andere Bedeutung'}]});assert.equal(knowledgeCollision.status,409);assert.equal(await readFile(process.env.FOLIO_DATA_FILE!,'utf8'),after);
});

test('Lifecycle trennt beendete Prozesse, fachliche Blocker, exakte Läufe und optionale laufende Nachprüfung',()=>{
  const catalog=getTestingCatalog(),scenario={...seed,id:'synthetischer-lifecycle'},fingerprint=testingFingerprint(scenario,catalog),compiled=compileTestingScenario(scenario,catalog);
  const run:TestingRun={id:'synthetischer-lauf',scenarioId:scenario.id,scenarioTitle:scenario.title,scenarioRevision:scenario.revision,status:'passed',startedAt:'2026-01-01',compiled,steps:[]};
  const job:TestingAgentJob={id:'synthetischer-auftrag',phase:'technical',model:'luna',status:'completed',prompt:'Synthetischer Lebenszyklusvertrag, kein Testnachweis.',scenarioId:scenario.id,scenarioRevision:scenario.revision,fingerprint,startedAt:'2026-01-02',events:[],result:{needsBusinessReview:true}};
  assert.equal(deriveTestingLifecycle(scenario,catalog,[job],[run]).status,'attention');assert.equal(deriveTestingLifecycle(scenario,catalog,[job],[run]).runId,undefined);
  job.result={plan:{unsupported:['Eine technische Fähigkeit fehlt.']}};assert.equal(deriveTestingLifecycle(scenario,catalog,[job],[run]).phase,'technical');
  job.result={run:{...run,status:'failed'}};job.runId=run.id;const failed={...run,status:'failed' as const};assert.equal(deriveTestingLifecycle(scenario,catalog,[job],[failed]).status,'failed');
  const child:TestingAgentJob={...job,id:'synthetischer-kindauftrag',parentJobId:job.id,phase:'reuse',stage:'reuse',status:'running',result:{runId:run.id}};job.result={run};job.status='running';job.childJobIds=[child.id];
  const analyzing=deriveTestingLifecycle(scenario,catalog,[job,child],[run]);assert.equal(analyzing.status,'ready');assert.equal(analyzing.runStatus,'passed');assert.equal(analyzing.analysisRunning,true);assert.deepEqual(analyzing.childJobIds,[child.id]);
  const changed={...scenario,revision:2};const fresh=deriveTestingLifecycle(changed,catalog,[job,child],[run]);assert.equal(fresh.runId,undefined);assert.notEqual(fresh.status,'ready');
});
test('Ein neuer direkter Lauf überholt ältere abgeschlossene Technikaufträge, aber keine neuere Prüfung',()=>{
  const catalog=getTestingCatalog(),scenario={...seed,id:'direkter-folgelauf'},compiled=compileTestingScenario(scenario,catalog);
  const oldRun:TestingRun={id:'alter-lauf',scenarioId:scenario.id,scenarioTitle:scenario.title,scenarioRevision:scenario.revision,status:'passed',startedAt:'2026-01-01',compiled,steps:[]};
  const oldJob:TestingAgentJob={id:'alter-technikauftrag',phase:'technical',model:'luna',status:'completed',prompt:'Synthetischer Auftrag.',scenarioId:scenario.id,scenarioRevision:scenario.revision,fingerprint:compiled.fingerprint,startedAt:'2026-01-01',events:[],runId:oldRun.id,result:{run:oldRun}};
  const direct={...oldRun,id:'direkter-neuer-lauf',startedAt:'2026-01-03',status:'running' as const};
  const running=deriveTestingLifecycle(scenario,catalog,[oldJob],[oldRun,direct]);
  assert.equal(running.runId,direct.id);assert.equal(running.status,'running');assert.equal(running.currentJobId,undefined);
  assert.equal(deriveTestingLifecycle(scenario,catalog,[oldJob],[oldRun,{...direct,status:'failed'}]).status,'failed');
  const later={...oldJob,id:'neuer-technikauftrag',startedAt:'2026-01-04',runId:undefined,result:{needsBusinessReview:true}};
  const blocked=deriveTestingLifecycle(scenario,catalog,[oldJob,later],[oldRun,{...direct,status:'passed'}]);
  assert.equal(blocked.runId,undefined);assert.equal(blocked.status,'attention');assert.equal(blocked.currentJobId,later.id);
  const preparing=deriveTestingLifecycle(scenario,catalog,[oldJob,{...later,status:'running'}],[oldRun,direct]);
  assert.equal(preparing.runId,undefined);assert.equal(preparing.currentJobId,later.id);
});

test('Ergänzte Anforderung wird beim erneuten Planstart sofort mit Revisionsschutz gespeichert',async()=>{
  process.env.FOLIO_BUSINESS_MODE='question';const started=orchestrator.startBusinessJob({request:'Die ursprüngliche Anforderung mit offener Frage.',model:'luna'});await orchestrator.waitTestingJob(started.id);delete process.env.FOLIO_BUSINESS_MODE;
  const before=repository.getTestingScenario(started.scenarioId!),text='Die fachliche Regel ist ergänzt und soll geplant werden.';
  const resumed=orchestrator.startBusinessJob({scenarioId:before.id,revision:before.revision,request:text,model:'luna'});
  assert.equal(repository.getTestingScenario(before.id).intent,text);assert.equal(resumed.scenarioRevision,before.revision+1);
  const done=await orchestrator.waitTestingJob(resumed.id);assert.equal(done.status,'completed',done.error);assert.equal(repository.getTestingScenario(before.id).intent,text);
});

test('Fehler einer optionalen Einzelanalyse verändern einen belegten Browsererfolg nicht',()=>{
  const catalog=getTestingCatalog(),scenario={...seed,id:'synthetischer-analysefehler'},fingerprint=testingFingerprint(scenario,catalog),compiled=compileTestingScenario(scenario,catalog);
  const run:TestingRun={id:'belegter-fixture-lauf',scenarioId:scenario.id,scenarioTitle:scenario.title,scenarioRevision:scenario.revision,status:'passed',startedAt:'2026-01-01',compiled,steps:[]};
  const job:TestingAgentJob={id:'optionale-fixture-analyse',phase:'reuse',model:'luna',status:'failed',prompt:'Synthetischer Lebenszyklusvertrag',scenarioId:scenario.id,scenarioRevision:scenario.revision,fingerprint,startedAt:'2026-01-02',events:[],result:{runId:run.id},error:'Analyse fehlgeschlagen'};
  for(const status of ['failed','cancelled','completed']as const){const state=deriveTestingLifecycle(scenario,catalog,[{...job,status}],[run]);assert.equal(state.status,'ready');assert.equal(state.runStatus,'passed');assert.equal(state.nextAction,'inspect-run');assert.equal(state.analysisAttention,status!=='completed');}
  const parent={...job,phase:'technical'as const,status:'completed'as const,result:{run,reuseError:'Analyse fehlgeschlagen'}};const state=deriveTestingLifecycle(scenario,catalog,[parent],[run]);assert.equal(state.status,'ready');assert.equal(state.analysisAttention,true);
  const invalid={...scenario,blocks:[{id:'ohne-vorschlag',definition:{id:'angebot.berechnen',version:'1.0.0'},inputs:{proposalId:{ref:'nicht-vorhanden'}}}]};assert.equal(deriveTestingLifecycle(invalid,catalog,[],[]).nextAction,'review');
});

test('Ein erster fachlich fehlerhafter Entwurf bleibt editierbar und bekommt keine Freigabe',async()=>{
  const previous=await readFile(process.env.FOLIO_BUSINESS_FIXTURE!,'utf8'),invalid=JSON.parse(previous);invalid.blocks.at(-1).inputs.find((input:any)=>input.key==='proposalId').valueJson=JSON.stringify({ref:'nicht-angelegter-vorschlag'});
  await writeFile(process.env.FOLIO_BUSINESS_FIXTURE!,JSON.stringify(invalid));
  try{const job=orchestrator.startBusinessJob({request:'Die erste Planung enthält noch eine zu korrigierende Referenz.',model:'luna'}),completed=await orchestrator.waitTestingJob(job.id);assert.equal(completed.status,'completed',completed.error);const scenario=repository.getTestingScenario(job.scenarioId!);assert.equal(scenario.revision,3);assert(scenario.blocks.length);assert.equal((completed.result as any).compiled.valid,false);assert.equal(repository.getTestingApproval(scenario.id),undefined);assert.equal(lifecycle(scenario.id).phase,'review');assert.equal(lifecycle(scenario.id).nextAction,'review');}finally{await writeFile(process.env.FOLIO_BUSINESS_FIXTURE!,previous);}
});

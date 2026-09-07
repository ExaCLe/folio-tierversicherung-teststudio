import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestingCatalog } from '../../../shared/testing';

const directory = mkdtempSync(join(tmpdir(), 'folio-exploration-test-'));
const database = join(directory, 'parent-data.json');
writeFileSync(database, '{}');
process.env.FOLIO_DATA_FILE = database;
process.env.FOLIO_AGENT_ARTIFACTS_ROOT = join(directory, 'agents');
const executable = join(directory, 'synthetic-cli.mjs');
writeFileSync(executable, `#!/usr/bin/env node
import {writeFileSync} from 'node:fs';
let prompt='';process.stdin.on('data',v=>prompt+=v);process.stdin.on('end',()=>{
 const args=process.argv.slice(2),inline=JSON.parse(prompt.split('BEGIN_EXPLORATION_CONTEXT_JSON\\n')[1].split('\\nEND_EXPLORATION_CONTEXT_JSON')[0]),state={round:inline.round,evidence:inline.currentObservation?[inline.currentObservation]:[]};\n if(!inline.coverage||!Array.isArray(inline.knowledge)||!Array.isArray(inline.definitions))throw new Error('Inlinekontext fehlt');
 let result={decision:'finish',explanation:'Synthetische Wissensprüfung.',knowledgeIds:['wissen.fixture'],gaps:[],action:null,findings:[]};
 if(!prompt.includes('NUR_VORHANDEN')) {
   const current=state.evidence.at(-1),round=state.round;
   const action=(op,name,value=null,path=null)=>({op,targetId:name?current.targets.find(t=>t.name===name)?.id:'',path,value,checked:null});
   result.knowledgeIds=[];
   if(round===0) Object.assign(result,{decision:'explore',gaps:['Bedienung der Kundenanlage ist unbekannt.']});
   else if(round===1) Object.assign(result,{decision:'act',action:action('click','Neuer Versicherungsvorschlag')});
   else if(round===2) Object.assign(result,{decision:'act',action:action('click','Neuen Kunden erfassen')});
   else if(round>=3&&round<=8) {const fields=[['Name des Kunden','Erkundung Testperson'],['E-Mail','erkundung@example.test'],['Telefon','030 5550123'],['Kundenstraße','Testweg 1'],['Kundenpostleitzahl','10115'],['Kundenort','Berlin']];Object.assign(result,{decision:'act',action:action('fill',...fields[round-3])});}
   else if(round===9) Object.assign(result,{decision:'act',action:action('click','Kunde speichern')});
   else if(round===10) Object.assign(result,{decision:'act',action:action('select','Benutzerrolle','Direktion')});
   else Object.assign(result,{findings:[{title:'Beobachtete Kundenanlage',summary:'Ein Kundenformular wurde beobachtet.',content:'Die Kundenanlage zeigt das Feld Name des Kunden. Bei der Rolle Direktion ist die Eingabe deaktiviert.',evidenceIds:[current.id]}]});
   if(prompt.includes('FALSCHER_BELEG')&&round>0) Object.assign(result,{decision:'finish',action:null,findings:[{title:'Unbelegt',summary:'Unbelegt',content:'Unbelegt',evidenceIds:['frei-erfunden']} ]});
 }
 if(prompt.includes('KORREKTUR_TEST')&&!process.cwd().endsWith('-korrektur')) result.knowledgeIds=['unbekannt'];
 writeFileSync(args[args.indexOf('-o')+1],JSON.stringify(result));process.stdout.write(JSON.stringify({type:'turn.completed'})+'\\n');
});
`, { mode: 0o700 });
process.env.FOLIO_CODEX_EXECUTABLE = executable;
const { exploreBusinessKnowledge, explorationRequestAllowed, performExplorationAction, explorationPromptContext } = await import('./exploration');
const { startPortalSandbox } = await import('./portal-sandbox');
const { chromium } = await import('@playwright/test');
const { stopCodexProcesses } = await import('./cli');
const catalog: TestingCatalog = { revision: 'fixture', definitions: [], bindings: [], knowledge: [{ id: 'wissen.fixture', revision: 1,
  title: 'Synthetisches Ausgangswissen', kind: 'rule', summary: 'Beispielregel.', content: 'Das Formular enthält Pflichtfelder.', definitionRefs: [], relatedKnowledge: [],
  requiredFields: [], preconditions: [], postconditions: [], origin: 'human' }] };
after(() => { stopCodexProcesses(); rmSync(directory, { recursive: true, force: true }); });

test('Ausreichendes vorhandenes Wissen erzeugt keine erfundenen Browserbelege', async () => {
  const stages:string[]=[];
  const result = await exploreBusinessKnowledge({ id:'knowledge-only', request:'NUR_VORHANDEN', model:'luna', catalog, onStage: stage=>stages.push(stage) });
  assert.deepEqual(stages,['knowledge']); assert.equal(result.explored,false);assert.deepEqual(result.newKnowledge,[]);assert.deepEqual(result.evidence,[]);
  assert.deepEqual(result.catalog,catalog);
});

test('Inlinekontext enthält vollständigen Wissensindex, relevante begrenzte Auszüge und aktuelle Ziele ohne Dateizugriff', () => {
  const knowledge = Array.from({length:100},(_,index)=>({...catalog.knowledge[0],id:`wissen.${index}`,title:`Regel ${index}`,summary:'Allgemeine Ausgangsregel.',content:'Beispiel '.repeat(1200)}));
  knowledge.push({...catalog.knowledge[0],id:'wissen.relevant',revision:2,title:'Pferdegesundheit',summary:'Tierärztlicher Beleg zur Pferdegesundheit.',content:'Pferdegesundheit braucht einen tierärztlichen Beleg.'});
  const observation={id:'beleg-002',action:'readSnapshot',path:'/portal',snapshot:'Vollständige aktuelle Beobachtung',screenshot:'/synthetic.png',observedAt:'2026-01-01',targets:[{id:'aktuelles-ziel',role:'button' as const,name:'Öffnen'}],paths:['/portal']};
  const previous={...observation,id:'beleg-001',snapshot:'Vorige Beobachtung '.repeat(100)};
  const context=explorationPromptContext('Pferdegesundheit prüfen',{...catalog,knowledge},2,['Tierärztlicher Beleg'],[previous,observation]);
  assert.equal(context.knowledgeIndex.length,101);
  assert(context.knowledge.some(item=>item.id==='wissen.relevant'));
  assert(context.coverage.omittedKnowledgeDocuments>0);
  assert(context.knowledge.every(item=>item.content.length<=6000));
  assert.deepEqual(context.currentObservation,observation);
  assert.equal(context.previousObservations[0].snapshot.length,800);
  assert.equal(context.previousObservations[0].snapshotTruncated,true);
  assert.equal(context.browserOpen,true);assert.equal(context.round,2);
  assert.deepEqual(context.gaps,['Tierärztlicher Beleg']);
});

test('Künstliche CLI-Aktionen erkunden die echte isolierte Portaloberfläche mit Belegen', { timeout: 90_000 }, async () => {
  const before = readFileSync(database,'utf8'), stages:string[]=[];
  const result = await exploreBusinessKnowledge({ id:'browser-fixture',request:'KUNDENANLAGE',model:'luna',catalog,onStage:stage=>stages.push(stage) });
  assert.deepEqual(stages,['knowledge','exploring']); assert.equal(result.explored,true);assert.equal(result.evidence.length,11);
  assert(result.evidence.every(item=>!item.error),JSON.stringify(result.evidence.map(({error})=>error)));
  assert.match(result.evidence.at(-1)!.snapshot,/Erkundung Testperson/);
  assert.match(result.evidence.at(-1)!.snapshot,/disabled/);
  assert.equal(result.newKnowledge.length,1);assert.match(result.newKnowledge[0].content,/beleg-011/);
  assert(existsSync(join(directory,'agents/browser-fixture/exploration-011.png')));
  assert.match(result.evidence[9].snapshot,/Kunde wurde gespeichert|Kunde gespeichert|KU-/);
  assert.equal(readFileSync(database,'utf8'),before,'Parent-Datenbank bleibt unverändert.');
  assert.equal(catalog.knowledge.length,1,'Gemeinsamer Katalog wird nicht verändert.');
});

test('Ungültige Wissensverweise erhalten genau eine Korrektur mit Fehlerbericht', async () => {
  const result=await exploreBusinessKnowledge({id:'knowledge-correction',request:'NUR_VORHANDEN KORREKTUR_TEST',model:'luna',catalog});
  assert.equal(result.explored,false);
  const report=readFileSync(join(directory,'agents/knowledge-correction-observation-0-korrektur/validierungsfehler.txt'),'utf8');
  assert.match(report,/knowledgeIds/);
  assert(existsSync(join(directory,'agents/knowledge-correction-observation-0/result.json')));
});

test('Erfundene Browserbelege bleiben nach einer Korrektur ein Fehler', {timeout:60_000}, async()=>{
  await assert.rejects(exploreBusinessKnowledge({id:'invalid-evidence',request:'FALSCHER_BELEG',model:'luna',catalog}),/Auch die KI-Korrektur.*nicht beobachteten Beleg/s);
  assert(existsSync(join(directory,'agents/invalid-evidence/exploration-001.png')));
  assert(!existsSync(join(directory,'agents/invalid-evidence/exploration-result.json')));
});

test('Abbruch während einer echten Browsererkundung beendet den begrenzten Ablauf', {timeout:60_000}, async()=>{
  const controller=new AbortController();
  await assert.rejects(exploreBusinessKnowledge({id:'abort-browser',request:'KUNDENANLAGE',model:'luna',catalog,signal:controller.signal,
    onEvent:event=>{if(event.message.startsWith('Browserbeobachtung 1 erfasst'))controller.abort();}}),/abgebrochen/);
  assert(existsSync(join(directory,'agents/abort-browser/exploration-001.png')));
  assert(!existsSync(join(directory,'agents/abort-browser-observation-1/result.json')),'Nach Abbruch startet kein weiterer Modellaufruf.');
});

test('Fremdorigin, APIs als Navigation und nicht beobachtete Ziele werden abgewiesen; Childräumung ist idempotent', { timeout: 60_000 }, async () => {
  const sandbox = await startPortalSandbox(); const browser=await chromium.launch({headless:true});
  try {
    const context=await browser.newContext({serviceWorkers:'block'});
    await context.route('**/*',route=>explorationRequestAllowed(route.request().url(),sandbox.origin)?route.continue():route.abort('blockedbyclient'));
    const blockedPage=await context.newPage();
    await assert.rejects(blockedPage.goto('http://127.0.0.1:1/portal'),/ERR_BLOCKED_BY_CLIENT/);
    await blockedPage.close();
    const page=await context.newPage();
    await page.goto(sandbox.origin+'/portal',{waitUntil:'networkidle'});
    const observation={id:'beleg-001',action:'readSnapshot',path:'/portal',snapshot:'',screenshot:'',observedAt:'',targets:[],paths:['/portal']};
    await assert.rejects(performExplorationAction(page,{op:'click',targetId:'erfunden',path:null,value:null,checked:null},observation,sandbox.origin),/aktuellen Browserbeobachtung/);
    for(const path of ['/api/agriculture/customers','/@fs/etc/passwd','https://example.test/portal']) await assert.rejects(performExplorationAction(page,{op:'goto',targetId:null,path,value:null,checked:null},observation,sandbox.origin),/nicht.*angeboten/);
    assert(!explorationRequestAllowed('http://127.0.0.1:3001/api/agriculture/customers',sandbox.origin));
    assert(!explorationRequestAllowed(sandbox.origin+'/api/testing/bootstrap',sandbox.origin));
  } finally { await browser.close(); await sandbox.close(); await sandbox.close(); }
  assert(!existsSync(sandbox.directory));await assert.rejects(fetch(sandbox.origin+'/portal'));
});

test('Timeout/Abbruch beendet isolierten Server und entfernt seine synthetische Datenbank', { timeout: 60_000 }, async () => {
  const controller=new AbortController(),sandbox=await startPortalSandbox(controller.signal);
  controller.abort(); await sandbox.close();assert(!existsSync(sandbox.directory));await assert.rejects(fetch(sandbox.origin+'/portal'));
  await assert.rejects(startPortalSandbox(AbortSignal.timeout(1)),/abgebrochen|beendet/);
});

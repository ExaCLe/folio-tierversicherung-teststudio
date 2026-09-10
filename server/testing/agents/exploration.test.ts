import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestingAgentProgress, TestingCatalog, TestingExplorationQuestion } from '../../../shared/testing';

const directory = mkdtempSync(join(tmpdir(), 'folio-exploration-test-'));
const database = join(directory, 'parent-data.json');
writeFileSync(database, '{}');
process.env.FOLIO_DATA_FILE = database;
process.env.FOLIO_AGENT_ARTIFACTS_ROOT = join(directory, 'agents');
const executable = join(directory, 'synthetic-cli.mjs');
writeFileSync(executable, `#!/usr/bin/env node
import {writeFileSync,readFileSync} from 'node:fs';
let prompt='';process.stdin.on('data',v=>prompt+=v);process.stdin.on('end',()=>{
 const args=process.argv.slice(2),inline=JSON.parse(prompt.split('BEGIN_EXPLORATION_CONTEXT_JSON\\n')[1].split('\\nEND_EXPLORATION_CONTEXT_JSON')[0]),state={round:inline.round,evidence:inline.currentObservation?[inline.currentObservation]:[]};\n if(!inline.coverage||!Array.isArray(inline.knowledge)||!Array.isArray(inline.definitions))throw new Error('Inlinekontext fehlt');
 let result={decision:'finish',explanation:'Synthetische Wissensprüfung.',knowledgeIds:['wissen.fixture'],gaps:[],action:null,findings:[]};
 if(!prompt.includes('NUR_VORHANDEN')) {
   const current=state.evidence.at(-1),round=state.round;
   const action=(op,name,value=null,path=null)=>({op,targetId:name?current.targets.find(t=>t.name===name)?.id:'',path,value,checked:null});
   result.knowledgeIds=[]; result.gaps=['Bedienung der Kundenanlage ist noch zu prüfen.'];
   if(round===0) Object.assign(result,{decision:'explore',gaps:['Bedienung der Kundenanlage ist unbekannt.']});
   else if(round===1) Object.assign(result,{decision:'act',action:action('click','Neuer Versicherungsvorschlag')});
   else if(round===2) Object.assign(result,{decision:'act',action:action('click','Neuen Kunden erfassen')});
   else if(round>=3&&round<=8) {const fields=[['Name des Kunden','Erkundung Testperson'],['E-Mail','erkundung@example.test'],['Telefon','030 5550123'],['Kundenstraße','Testweg 1'],['Kundenpostleitzahl','10115'],['Kundenort','Berlin']];Object.assign(result,{decision:'act',action:action('fill',...fields[round-3])});}
   else if(round===9) Object.assign(result,{decision:'act',action:action('click','Kunde speichern')});
   else if(round===10) Object.assign(result,{decision:'act',action:action('select','Benutzerrolle','Direktion')});
   else Object.assign(result,{gaps:[],findings:[{title:'Beobachtete Kundenanlage',summary:'Ein Kundenformular wurde beobachtet.',content:'Die Kundenanlage zeigt das Feld Name des Kunden. Bei der Rolle Direktion ist die Eingabe deaktiviert.',evidenceIds:[current.id]}]});
   if(prompt.includes('FALSCHER_BELEG')&&round>0) Object.assign(result,{decision:'finish',action:null,findings:[{title:'Unbelegt',summary:'Unbelegt',content:'Unbelegt',evidenceIds:['frei-erfunden']} ]});
 }
 if(prompt.includes('ROLLEN_SCHLEIFE')&&state.round>0){
   const current=inline.currentObservation;
   if(inline.completion.finishRequired&&!prompt.includes('ABSCHLUSS_IGNORIEREN')) result={decision:'finish',explanation:'Die beobachteten Rollenwechsel sind ausgewertet.',knowledgeIds:[],gaps:[],action:null,findings:[{title:'Beobachtete Rollenwahl',summary:'Die Benutzerrolle lässt sich wechseln.',content:'Die Rollenwahl zeigt Direktion und Vermittler. Dies belegt die Auswahl, keine fachliche Freigabeberechtigung.',evidenceIds:inline.previousObservations.map(e=>e.id).concat(current.id)}]};
   else result={decision:'act',explanation:'Synthetischer wiederholter Rollenwechsel.',knowledgeIds:[],gaps:['Beobachtete Rollenwahl auswerten.'],findings:[],action:{op:'select',targetId:current.targets.find(t=>t.name==='Benutzerrolle').id,path:null,value:state.round%2?'Direktion':'Vermittler',checked:null}};
 }
 if(prompt.includes('LEERE_AKTIONSFRAGE')&&state.round===1&&!process.cwd().endsWith('-korrektur'))result.gaps=[];
 if(prompt.includes('BLOCK_ID_TEST')) {
   const schema=JSON.parse(readFileSync(args[args.indexOf('--output-schema')+1],'utf8'));
   if(schema.properties.knowledgeIds.items.enum.includes('pruefung.vorschlagsstatus'))throw new Error('Baustein als Wissens-ID erlaubt');
   if(!process.cwd().endsWith('-korrektur')||prompt.includes('IMMER_FALSCH'))result.knowledgeIds=['pruefung.vorschlagsstatus'];
 }
 if(prompt.includes('KORREKTUR_TEST')&&!process.cwd().endsWith('-korrektur')) result.knowledgeIds=['unbekannt'];
 const questions=inline.questions.length?inline.questions:[{id:'prueffrage-1',text:'Die angeforderte synthetische Prüfung vollständig belegen.',kind:'research',why:'',requestQuote:'',requiresBrowser:!prompt.includes('NUR_VORHANDEN')}];
 result.questions=questions.map(question=>({...question,status:result.decision==='finish'&&!result.gaps.length?'answered':'open',answer:result.decision==='finish'&&!result.gaps.length?result.explanation:'',knowledgeIds:result.decision==='finish'?result.knowledgeIds:[],evidenceIds:result.decision==='finish'?result.findings.flatMap(finding=>finding.evidenceIds):[]}));
 if(prompt.includes('TEXT_KORREKTUR')&&state.round===1&&!process.cwd().endsWith('-korrektur'))result.questions[0].text='Versehentlich veränderte Frage';
 writeFileSync(args[args.indexOf('-o')+1],JSON.stringify(result));process.stdout.write(JSON.stringify({type:'turn.completed'})+'\\n');
});
`, { mode: 0o700 });
process.env.FOLIO_CODEX_EXECUTABLE = executable;
const { exploreBusinessKnowledge, explorationRequestAllowed, performExplorationAction, explorationPromptContext, explorationCompletion, explorationSchema, explorationTargets, validateExplorationQuestions } = await import('./exploration');
const { startPortalSandbox } = await import('./portal-sandbox');
const { chromium } = await import('@playwright/test');
const { stopCodexProcesses } = await import('./cli');
const { AgentTerminationError } = await import('./termination');
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
  assert.equal(context.previousObservations[0].snapshot,previous.snapshot);
  assert.equal(context.previousObservations[0].snapshotTruncated,false);
  assert.equal(context.browserOpen,true);assert.equal(context.round,2);
  assert.deepEqual(context.gaps,['Tierärztlicher Beleg']);
});

test('Künstliche CLI-Aktionen erkunden die echte isolierte Portaloberfläche mit Belegen', { timeout: 90_000 }, async () => {
  const before = readFileSync(database,'utf8'), stages:string[]=[], progress:TestingAgentProgress[]=[];
  const result = await exploreBusinessKnowledge({ id:'browser-fixture',request:'KUNDENANLAGE LEERE_AKTIONSFRAGE TEXT_KORREKTUR',model:'luna',catalog,onStage:stage=>stages.push(stage),onProgress:value=>progress.push(value) });
  assert.deepEqual(stages,['knowledge','exploring']); assert.equal(result.explored,true);assert.equal(result.evidence.length,11);
  assert(result.evidence.every(item=>!item.error),JSON.stringify(result.evidence.map(({error})=>error)));
  assert.match(result.evidence.at(-1)!.snapshot,/Erkundung Testperson/);
  assert.match(result.evidence.at(-1)!.snapshot,/disabled/);
  assert.equal(result.newKnowledge.length,1);assert.match(result.newKnowledge[0].content,/beleg-011/);
  assert(existsSync(join(directory,'agents/browser-fixture/exploration-011.png')));
  assert.equal(result.evidence[0].screenshot,'/api/testing/jobs/browser-fixture/artifacts/exploration-001.png');
  assert.match(result.evidence[9].snapshot,/Kunde wurde gespeichert|Kunde gespeichert|KU-/);
  assert.equal(readFileSync(database,'utf8'),before,'Parent-Datenbank bleibt unverändert.');
  assert.equal(catalog.knowledge.length,1,'Gemeinsamer Katalog wird nicht verändert.');
  assert.match(readFileSync(join(directory,'agents/browser-fixture-observation-1-korrektur/validierungsfehler.txt'),'utf8'),/konkrete noch offene Wissenslücke/);
  assert(progress.some(item=>item.status==='waiting-model'&&item.observationCount===0));
  assert(progress.some(item=>item.status==='acting'&&item.summary.includes('Neuen Kunden erfassen')));
  assert.equal(progress.filter(item=>item.status==='observed').length,result.evidence.length);
  assert.equal(progress.at(-1)?.status,'finished');
  assert.equal(progress.at(-1)?.observationCount,result.evidence.length);
  assert.equal(result.questions[0].text,'Die angeforderte synthetische Prüfung vollständig belegen.');
  assert.equal(result.questions[0].status,'answered');
  assert(result.questions[0].requiresBrowser);
  assert(result.questions[0].evidenceIds.length>0);
  assert(progress.some(item=>item.questions?.[0]?.status==='open'));
  assert.equal(progress.at(-1)?.questions?.[0]?.status,'answered');
});

test('Begrenzte History behält alte Rollen, Sperren und Ergebnisse hinter langem Navigationsvorspann', () => {
  const navigation = Array.from({length: 250}, (_,i) => `- link "Navigation ${i}"`).join('\n');
  const state = (id: string, role: string, control: string) => ({ id, path: '/portal/vorschlag', action: 'readSnapshot',
    snapshot: `${navigation}\n- combobox "Benutzerrolle":\n  - option "${role}" [selected]\n- button "Direktionsprüfung bestätigen"${control}\n- status: Die Direktionsprüfung wurde bestätigt.`,
    screenshot: `/${id}.png`, observedAt: '', targets: [], paths: ['/portal'] });
  const evidence = Array.from({length: 31}, (_,index) => state(`beleg-${index}`, index === 2 ? 'Sachbearbeiter' : 'Direktion', index === 2 ? ' [disabled]' : ''));
  const context = explorationPromptContext('Rollenberechtigung Direktionsprüfung bestätigen', catalog, 30, ['Alle Rollen prüfen'], evidence);
  const old = context.previousObservations[2];
  assert.match(old.snapshot, /Sachbearbeiter.*selected/);
  assert.match(old.snapshot, /Direktionsprüfung bestätigen.*disabled/);
  assert.match(context.previousObservations[6].snapshot, /Direktionsprüfung wurde bestätigt/);
  assert(old.snapshotTruncated);
  assert(context.previousObservations.reduce((sum,item)=>sum+item.snapshot.length,0) <= 60_000);
  assert.equal(context.currentObservation,evidence.at(-1));
});

test('Abschlusssteuerung erkennt leere Fragen, Budget und wiederkehrende Zustände ohne Erfolg zu behaupten', () => {
  const state = (id:string,snapshot:string) => ({id,snapshot,path:'/portal',action:'readSnapshot',screenshot:'',observedAt:'',targets:[],paths:[]});
  const evidence=[state('1','Vermittler'),state('2','Direktion'),state('3','Vermittler'),state('4','Direktion'),state('5','Vermittler')];
  assert.equal(explorationCompletion(evidence,['Rollenberechtigung prüfen'],5).reason,'no_progress');
  assert.deepEqual(explorationCompletion(evidence,['Rollenberechtigung prüfen'],5).repeatedStateIds,['1','3','5']);
  assert.equal(explorationCompletion([evidence[0]],[],1).reason,'no_open_gaps');
  assert.equal(explorationCompletion([evidence[0]],['Ungeklärt'],32).reason,'action_limit');
  assert.equal(explorationCompletion([evidence[0]],['Ungeklärt'],1,40_000).reason,'time_limit');
  assert.equal(explorationCompletion(evidence.slice(0,4),['Ungeklärt'],4).finishRequired,false);
});

test('Vollständige Teilfragen bleiben stabil; offene Vergleiche und fehlende Browserbelege verhindern grünen Abschluss',()=>{
  const question=(id:string):TestingExplorationQuestion=>({id,text:`Vergleich ${id} unter derselben Vorbedingung prüfen.`,kind:'research',why:'',requestQuote:'',requiresBrowser:true,status:'open',answer:'',knowledgeIds:[],evidenceIds:[]});
  const previous=[question('eins'),question('zwei'),question('drei')];
  const evidence=[{id:'beleg-001',action:'readSnapshot',path:'/portal',snapshot:'Synthetischer Zustand',screenshot:'',observedAt:'',targets:[],paths:[]}];
  const answered={...previous[0],status:'answered' as const,answer:'Beobachtete Antwort.',evidenceIds:['beleg-001']};
  assert.throws(()=>validateExplorationQuestions([answered,previous[1]],previous,catalog.knowledge,evidence,'finish',[]),/drei.*fehlt[\s\S]*offene Erkundungsfragen/);
  assert.throws(()=>validateExplorationQuestions([answered,previous[1],previous[2]],previous,catalog.knowledge,evidence,'finish',[]),/offene Erkundungsfragen/);
  assert.throws(()=>validateExplorationQuestions([{...answered,evidenceIds:[],knowledgeIds:['wissen.fixture']}],previous.slice(0,1),catalog.knowledge,evidence,'finish',[]),/Dokumentation allein reicht nicht/);
  assert.throws(()=>validateExplorationQuestions([{...answered,requiresBrowser:false}],previous.slice(0,1),catalog.knowledge,evidence,'finish',[]),/ursprünglichen Text und requiresBrowser/);
  assert.throws(()=>validateExplorationQuestions([{...answered,evidenceIds:['erfunden']}],previous.slice(0,1),catalog.knowledge,evidence,'finish',[]),/nicht beobachteter Browserbeleg/);
  assert.doesNotThrow(()=>validateExplorationQuestions([answered,previous[1],previous[2]],previous,catalog.knowledge,evidence,'finish',['Zwei Vergleiche bleiben offen.']));
  assert.doesNotThrow(()=>validateExplorationQuestions([...previous,question('neu')],previous,catalog.knowledge,evidence,'act',['Noch offen.']));
  assert.doesNotThrow(()=>validateExplorationQuestions(previous,[answered,previous[1],previous[2]],catalog.knowledge,evidence,'act',['Ein neuer Widerspruch muss untersucht werden.']));
  assert.equal(previous[0].status,'open','Die Validierung verändert das übernommene Ledger nicht.');
});

test('Explizite Rollenregeln sind gesetztes Soll; nur echte fehlende Fachentscheidungen werden Nutzerfragen',()=>{
  const request='Direktion darf offene Direktionsanfragen freigeben; Sachbearbeiter und Vermittler dürfen nicht.';
  const requirement:TestingExplorationQuestion={id:'rollen-soll',text:'Wer darf eine offene Direktionsanfrage freigeben?',kind:'requirement',why:'',
    requestQuote:'Direktion darf offene Direktionsanfragen freigeben; Sachbearbeiter und Vermittler dürfen nicht.',requiresBrowser:false,status:'answered',
    answer:'Nur die Direktion darf freigeben.',knowledgeIds:[],evidenceIds:[]};
  assert.doesNotThrow(()=>validateExplorationQuestions([requirement],[],catalog.knowledge,[],'finish',[],request));
  assert.throws(()=>validateExplorationQuestions([{...requirement,kind:'clarification',status:'open',answer:'',requestQuote:'',why:''}],[],catalog.knowledge,[],'finish',[],request),/Klärungsfrage braucht.*konkret fehlende/);
  const unknown:TestingExplorationQuestion={id:'ablehnungsgrund',text:'Welcher Ablehnungsgrund soll erwartet werden?',kind:'clarification',
    why:'Ohne den Grund fehlt der fachliche Sollwert der Begründungsassertion.',requestQuote:'',requiresBrowser:false,status:'open',answer:'',knowledgeIds:[],evidenceIds:[]};
  assert.doesNotThrow(()=>validateExplorationQuestions([requirement,unknown],[],catalog.knowledge,[],'finish',[unknown.text],request));
  const context=explorationPromptContext(request,catalog,0,[],[]);
  assert.match(context.clarificationPolicy.expectedTruth,/nicht beim Menschen bestätigen lassen/);
  assert.match(context.clarificationPolicy.userQuestionGate,/wichtige fachliche Entscheidung/);
});

test('Wiederholte Rollenwechsel führen zur belegten Abschlussantwort statt weiteren Browseraktionen', {timeout:90_000}, async()=>{
  const result=await exploreBusinessKnowledge({id:'loop-summary',request:'ROLLEN_SCHLEIFE',model:'luna',catalog});
  assert(result.evidence.length <= 6);
  assert.equal(result.newKnowledge.length,1);
  assert.deepEqual(result.openQuestions,[]);
  assert.match(result.newKnowledge[0].content,/keine fachliche Freigabeberechtigung/);
  assert(!result.termination);
  const last=JSON.parse(readFileSync(join(directory,`agents/loop-summary-observation-${result.evidence.length}/prompt-kontext.json`),'utf8'));
  assert.equal(last.completion.reason,'no_progress');
});

test('Ignorierte Abschlussaufforderung stoppt nach einer Korrektur mit Belegen und offener Frage', {timeout:90_000}, async()=>{
  const result=await exploreBusinessKnowledge({id:'loop-incomplete',request:'ROLLEN_SCHLEIFE ABSCHLUSS_IGNORIEREN',model:'luna',catalog});
  assert(result.evidence.length <= 6);
  assert.equal(result.newKnowledge.length,0);
  assert.deepEqual(result.openQuestions,[]);
  assert(result.researchGaps.length>0);
  assert.equal(result.termination?.cause,'no_progress');
  assert(existsSync(join(directory,`agents/loop-incomplete-observation-${result.evidence.length}-korrektur/result.json`)));
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

test('Internes Zeitlimit wird als unvollständige Prüfung statt menschlichem Abbruch gespeichert', async context=>{
  context.mock.timers.enable({apis:['setTimeout']});
  try {
    const result=await exploreBusinessKnowledge({id:'internal-deadline',request:'NUR_VORHANDEN',model:'luna',catalog,
      onProgress:value=>{if(value.status==='waiting-model')context.mock.timers.tick(360_000);}});
    assert.equal(result.termination?.cause,'time_limit');
    assert.deepEqual(result.openQuestions,[]);
    assert(result.researchGaps.length>0);
    assert.deepEqual(result.newKnowledge,[]);
    assert.doesNotMatch(result.explanation,/Menschen/);
    assert(existsSync(join(directory,'agents/internal-deadline/exploration-result.json')));
  } finally {context.mock.timers.reset();}
});

test('Expliziter Nutzerabbruch behält seine Ursache und erzeugt kein abgeschlossenes Erkundungsergebnis', async()=>{
  const controller=new AbortController();
  controller.abort(new AgentTerminationError('user_cancelled','Der Auftrag wurde vom Menschen abgebrochen.'));
  await assert.rejects(exploreBusinessKnowledge({id:'explicit-user-abort',request:'NUR_VORHANDEN',model:'luna',catalog,signal:controller.signal}),
    error=>error instanceof AgentTerminationError&&error.termination.cause==='user_cancelled');
  assert(!existsSync(join(directory,'agents/explicit-user-abort/exploration-result.json')));
});

test('Reales Portal bietet seinen eindeutigen Vorgangsbutton mit Doppelpunkt als bedienbares Ziel an', {timeout:60_000}, async()=>{
  const sandbox=await startPortalSandbox(),browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage();await page.goto(sandbox.origin+'/portal/direktion',{waitUntil:'networkidle'});
    const snapshot=await page.locator('body').ariaSnapshot();
    assert.match(snapshot,/- 'button ".*:.*Vorgang öffnen/);
    const targets=await explorationTargets(page,snapshot,'portal-001');
    assert(!targets.some(target=>target.name==='Anfrage öffnen'),'Gleichnamige Tabellenbuttons bleiben gesperrt.');
    const target=targets.find(target=>target.role==='button'&&target.name.includes(':')&&target.name.endsWith('Vorgang öffnen ›'));
    assert(target,'Der eindeutige sichtbare Button darf durch YAML-Zitierung nicht verschwinden.');
    const observation={id:'portal-001',snapshot,path:'/portal/direktion',action:'readSnapshot',screenshot:'',observedAt:'',targets,paths:['/portal/direktion']};
    await performExplorationAction(page,{op:'click',targetId:target.id,path:null,value:null,checked:null},observation,sandbox.origin);
    assert(await page.getByRole('button',{name:'Entscheidung speichern',exact:true}).isDisabled());
  }finally{await browser.close();await sandbox.close();}
});

test('Echte Accessibility-Snapshots erhalten Apostrophe, Anführungszeichen und Backslashes ohne mehrdeutige Ziele', async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage();
    await page.setContent('<button>O\'Brien: &quot;Freigeben&quot; \\ bestätigen</button><button>Einfach öffnen</button><button>Doppelt</button><button>Doppelt</button><button hidden>Unsichtbar: öffnen</button>');
    const targets=await explorationTargets(page,await page.locator('body').ariaSnapshot(),'quotes-001');
    assert.deepEqual(targets.map(target=>target.name),['O\'Brien: "Freigeben" \\ bestätigen','Einfach öffnen']);
    await page.getByRole('button',{name:targets[0].name,exact:true}).click();
  }finally{await browser.close();}
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

test('Erkundungsschema trennt Wissens-IDs von Bausteinen und erlaubt findings erst mit echten Belegen',()=>{
  const schema=explorationSchema(catalog.knowledge,[]) as any;
  const ids=[...new Set(catalog.knowledge.map(item=>item.id))];
  assert.deepEqual(schema.properties.knowledgeIds.items.enum,ids);
  assert.deepEqual(schema.properties.questions.items.properties.knowledgeIds.items.enum,ids);
  assert.equal(schema.properties.knowledgeIds.items.enum.includes('pruefung.vorschlagsstatus'),false);
  assert.equal(schema.properties.findings.maxItems,0);
  assert.equal(schema.properties.questions.items.properties.evidenceIds.maxItems,0);
  const empty=explorationSchema([],[]) as any;
  assert.equal(empty.properties.knowledgeIds.maxItems,0);
  assert.equal(empty.properties.questions.items.properties.knowledgeIds.maxItems,0);
  const observed=explorationSchema(catalog.knowledge,[{id:'beleg-001',action:'readSnapshot',path:'/portal',snapshot:'',screenshot:'',observedAt:'',targets:[],paths:[]}]) as any;
  assert.deepEqual(observed.properties.findings.items.properties.evidenceIds.items.enum,['beleg-001']);
  assert.equal(observed.properties.findings.items.properties.evidenceIds.minItems,1);
  assert.equal(observed.properties.findings.maxItems,12);
});

test('Baustein-ID aus dem Fehlerbericht wird konkret korrigiert und niemals als Wissensbeleg übernommen',async()=>{
  const result=await exploreBusinessKnowledge({id:'block-reference',request:'NUR_VORHANDEN BLOCK_ID_TEST',model:'luna',catalog});
  assert.deepEqual(result.knowledgeIds,['wissen.fixture']);
  const report=readFileSync(join(directory,'agents/block-reference-observation-0-korrektur/validierungsfehler.txt'),'utf8');
  assert.match(report,/pruefung\.vorschlagsstatus/);
  assert.match(report,/Erlaubte Wissens-IDs: wissen\.fixture/);
  assert.match(report,/Baustein-IDs/);
  const question={id:'question',text:'Offene Frage',kind:'research' as const,why:'',requestQuote:'',requiresBrowser:true,status:'open' as const,answer:'',knowledgeIds:['pruefung.vorschlagsstatus'],evidenceIds:[]};
  assert.throws(()=>validateExplorationQuestions([question],[],catalog.knowledge,[],'explore',['Offene Frage']),/question\.knowledgeIds.*pruefung\.vorschlagsstatus.*wissen\.fixture/);
  await assert.rejects(exploreBusinessKnowledge({id:'block-reference-invalid',request:'NUR_VORHANDEN BLOCK_ID_TEST IMMER_FALSCH',model:'luna',catalog}),/Auch die KI-Korrektur.*pruefung\.vorschlagsstatus/s);
});

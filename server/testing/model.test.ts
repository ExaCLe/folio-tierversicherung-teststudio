import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {TestingApproval,TestingBlockDefinition,TestingBlockInstance,TestingBusinessDraft,TestingCatalog,TestingRun,TestingScenario,TestingTechnicalBinding} from '../../shared/testing';
import {compileTestingScenario,findTestingDuplicates,testingFingerprint} from './compiler';

const directory=mkdtempSync(join(tmpdir(),'folio-tiermodell-'));
process.env.FOLIO_DATA_FILE=join(directory,'daten.json');
const {loadTestingSourceCatalog,loadTestingSeedScenarios,getTestingCatalog}=await import('./catalog');
const repository=await import('./repository');
const {buildTestingGraph,getTestingImpact}=await import('./graph');
after(()=>rmSync(directory,{recursive:true,force:true}));
const clone=<T>(value:T):T=>structuredClone(value);
const catalog=()=>loadTestingSourceCatalog();
const seeds=()=>loadTestingSeedScenarios();
const def=(c:TestingCatalog,id:string)=>c.definitions.find(d=>d.id===id)!;
const ref=(name:string)=>({ref:name});
const inst=(id:string,definition:string,inputs:TestingBlockInstance['inputs']={},outputs?:Record<string,string>):TestingBlockInstance=>({id,definition:{id:definition,version:'1.0.0'},inputs,...(outputs?{outputs}:{})});
function ready(c:TestingCatalog):TestingCatalog {return {...clone(c),bindings:c.bindings.map(b=>({...b,revision:2,status:'ready',inputKeys:def(c,b.definitionRefs[0].id).inputs.map(i=>i.key)}))};}
const approval=(s:TestingScenario,c:TestingCatalog):TestingApproval=>({id:'pruefung',scenarioId:s.id,scenarioRevision:s.revision,fingerprint:testingFingerprint(s,c),actor:'Fachprüferin',approvedAt:'2026-09-06T12:00:00Z'});

test('Die beiden Beispiele enden beim beabsichtigten Fachzustand und behalten getrennte Rollen',()=>{
  const c=catalog();const [direktion,druck]=seeds().map(s=>compileTestingScenario(s,c));
  assert.equal(direktion.valid,true);assert.equal(direktion.steps.length,7);assert.equal(direktion.steps.find(s=>s.operation==='createAnimal')?.inputs.sumInsured,15000);
  assert.equal(direktion.steps.at(-1)?.inputs.expectedStatus,'Direktionsprüfung');assert.equal(direktion.steps.some(s=>s.operation==='completeContract'),false);
  assert.equal(druck.valid,true);assert.equal(druck.steps.length,10);assert.equal(druck.steps.filter(s=>s.actor==='Sachbearbeiter').length,3);
  assert.equal(druck.steps.find(s=>s.operation==='createFarm')?.inputs.state,'Bayern');
});
test('Freigabe bindet lokale Werte, Definitionskörper und Regeln, aber keine technischen Revisionen',()=>{
  const s=seeds()[0],c=ready(catalog()),a=approval(s,c);assert.equal(compileTestingScenario(s,c,a).executable,true);
  const local=clone(s);local.blocks[0].overrides={tier:{sumInsured:16000}};assert.notEqual(testingFingerprint(local,c),a.fingerprint);assert.equal(compileTestingScenario(local,c,a).executable,false);
  const localBody=clone(s);localBody.blocks[0].children=clone(def(c,'ablauf.kuh-vorschlag').body!);localBody.blocks[0].children![0].inputs.name='Anderer Kunde';assert.notEqual(testingFingerprint(localBody,c),a.fingerprint);
  const knowledge=clone(c);knowledge.knowledge.find(k=>k.id==='regel.direktionsanfrage')!.content+='\nNeue fachliche Grenze.';assert.notEqual(testingFingerprint(s,knowledge),a.fingerprint);
  const technical=clone(c);technical.bindings.push({...technical.bindings[0],revision:3,locators:[{key:'speichern',method:'role',role:'button',value:'Kunde übernehmen'}]});assert.equal(testingFingerprint(s,technical),a.fingerprint);assert.equal(compileTestingScenario(s,technical,a).bindings.find(b=>b.id===technical.bindings[0].id)?.revision,3);
});
test('Nur Wissensrückverweise ändern keine Fachfreigabe; der eingefrorene Wissensstand bleibt nachweisbar',()=>{
  const s=seeds()[0],c=catalog(),before=testingFingerprint(s,c);const changed=clone(c);const doc=changed.knowledge.find(d=>d.id==='fach.kunde-betrieb')!;doc.revision++;doc.definitionRefs.push({id:'neuer.block',version:'1.0.0'});assert.equal(testingFingerprint(s,changed),before);
  doc.requiredFields.push('neuesPflichtfeld');assert.notEqual(testingFingerprint(s,changed),before);
});
test('Zusätzliche Eingaben brauchen ein Schema und anschließend technische Abdeckung',()=>{
  const s=clone(seeds()[0]),c=ready(catalog());s.blocks[0].inputs.neuesFeld=5;assert.equal(compileTestingScenario(s,c).issues.some(i=>i.code==='INPUT_UNKNOWN'),true);
  const atomic:TestingScenario={...seeds()[0],blocks:[inst('kunde','kunde.anlegen',{zusatz:5})]};const edited=clone(c);def(edited,'kunde.anlegen').inputs.push({key:'zusatz',label:'Zusatzwert',type:'number'});
  const result=compileTestingScenario(atomic,edited,approval(atomic,edited));assert.equal(result.valid,true);assert.equal(result.executable,false);assert.equal(result.issues.find(i=>i.code==='BINDING_INPUT_MISSING')?.severity,'info');
});
test('Wiederholte verschachtelte Workflows besitzen lokale Ergebnisnamen',()=>{
  const s:TestingScenario={...seeds()[0],blocks:[inst('kunde','kunde.anlegen',{}, {customer:'kunde'}),inst('erster','ablauf.kuh-vorschlag',{}, {proposal:'ersterVorschlag'}),inst('zweiter','ablauf.kuh-vorschlag',{}, {proposal:'zweiterVorschlag'}),inst('vertrag','ablauf.standard-kuhvertrag',{}, {policy:'police'})]};
  const c=compileTestingScenario(s,catalog());assert.equal(c.valid,true,JSON.stringify(c.issues));
  assert.deepEqual(c.steps.find(step=>step.path==='erster/betrieb')?.inputs.customerId,{ref:'erster/kunde::customer',type:'customer-ref'});
  assert.deepEqual(c.steps.find(step=>step.path==='zweiter/betrieb')?.inputs.customerId,{ref:'zweiter/kunde::customer',type:'customer-ref'});
  assert.deepEqual(c.steps.find(step=>step.path==='vertrag/vorbereiten/betrieb')?.inputs.customerId,{ref:'vertrag/vorbereiten/kunde::customer',type:'customer-ref'});
});
test('Doppelte Ergebnisnamen auf gleicher Ebene und vorwärts gerichtete Referenzen sind Fehler',()=>{
  const s={...seeds()[0],blocks:[inst('eins','kunde.anlegen',{}, {customer:'kunde'}),inst('zwei','kunde.anlegen',{}, {customer:'kunde'})]};assert.equal(compileTestingScenario(s,catalog()).issues.some(i=>i.code==='OUTPUT_COLLISION'),true);
  s.blocks=[inst('betrieb','betrieb.anlegen',{customerId:ref('später')}),inst('kunde','kunde.anlegen',{}, {customer:'später'})];assert.equal(compileTestingScenario(s,catalog()).issues.some(i=>i.code==='REFERENCE_MISSING'),true);
});
test('Parameterketten lösen Referenzen auf und beenden Kreise mit einem fachlichen Fehler',()=>{
  const s:TestingScenario={...seeds()[0],parameters:{a:{param:'b'},b:ref('kunde')},blocks:[inst('kunde','kunde.anlegen',{}, {customer:'kunde'}),inst('betrieb','betrieb.anlegen',{customerId:{param:'a'}})]};
  const c=compileTestingScenario(s,catalog());assert.equal(c.valid,true);assert.deepEqual(c.steps[1].inputs.customerId,{ref:'kunde::customer',type:'customer-ref'});
  s.parameters={a:{param:'b'},b:{param:'a'}};assert.equal(compileTestingScenario(s,catalog()).issues.some(i=>i.code==='PARAMETER_CYCLE'),true);
  s.parameters={};s.blocks[1].inputs.customerId={param:'constructor'};assert.equal(compileTestingScenario(s,catalog()).issues.some(i=>i.code==='PARAMETER_MISSING'),true);
});
test('Ein leerer Katalog kann neue fachliche Fähigkeiten aufnehmen und erst nach Verdrahtung ausführen',()=>{
  const c:TestingCatalog={revision:'leer',definitions:[],bindings:[],knowledge:[]};
  const newDefinition:TestingBlockDefinition={id:'neu.bestaetigung',version:'1.0.0',name:'Neue Bestätigung prüfen',description:'Prüft das neue fachliche Merkmal.',kind:'assertion',category:'Neues Feature',semanticKey:'agriculture.new-confirmation',operation:'brandNewConfirmation',inputs:[{key:'expected',label:'Erwartete Meldung',type:'text',required:true}],outputs:[],knowledgeRefs:['wissen.neues-feature'],preconditions:['Neues Feature ist sichtbar.'],postconditions:['Erwartete Meldung ist sichtbar.'],status:'draft',createdAt:'2026-09-06',origin:'agent'};
  const draft:TestingBusinessDraft={title:'Ein neuer Testfall',expectedOutcome:'Neue Bestätigung ist sichtbar.',blocks:[inst('pruefen',newDefinition.id,{expected:'Tierdaten übernommen'})],knowledgeRefs:['wissen.neues-feature'],newDefinitions:[newDefinition],newKnowledge:[{id:'wissen.neues-feature',revision:1,title:'Neues Feature',kind:'rule',summary:'Die Übernahme wird bestätigt.',content:'Die Meldung lautet Tierdaten übernommen.',definitionRefs:[{id:newDefinition.id,version:newDefinition.version}],relatedKnowledge:[],requiredFields:['expected'],preconditions:[],postconditions:['Meldung sichtbar.'],origin:'agent'}],explanation:'Die Fähigkeit wurde neu definiert.',assumptions:[],openQuestions:[]};
  const preview=repository.previewTestingBusinessDraft('Neue Bestätigung prüfen',draft,'luna',c);assert.equal(preview.compiled.valid,true);assert.equal(preview.compiled.executable,false);assert.equal(preview.compiled.issues.some(i=>i.code==='BINDING_MISSING'),true);
  const binding:TestingTechnicalBinding={id:'neu.technische-bestaetigung',revision:1,operation:'brandNewConfirmation',name:'Neue Bestätigung im Portal',status:'ready',definitionRefs:[{id:newDefinition.id,version:'1.0.0'}],knowledgeRefs:[],module:'generischer-rezepttreiber',export:'execute',locators:[{key:'bestaetigung',method:'testId',value:'new-confirmation'}],recipe:[{op:'expectText',locatorKey:'bestaetigung',value:{param:'expected'}}],inputKeys:['expected'],changeReason:'Erste technische Bindung.',createdAt:'2026-09-06'};
  preview.catalog.bindings.push(binding);const compiled=compileTestingScenario(preview.scenario,preview.catalog,approval(preview.scenario,preview.catalog));assert.equal(compiled.executable,true);assert.equal(compiled.steps[0].operation,'brandNewConfirmation');assert.equal(compiled.steps[0].binding?.id,binding.id);
  // This is a model readiness assertion, not a simulated browser test.
  const stored=repository.createTestingScenarioFromDraft('Neue Bestätigung prüfen',draft,'luna');assert.equal(repository.getTestingScenario(stored.id).blocks[0].definition.id,newDefinition.id);
});
test('Entwürfe höherer Bindungsrevision verdrängen keine aktive Bindung',()=>{
  const c=ready(catalog()),s=seeds()[0];c.bindings.push({...c.bindings[0],revision:3,status:'draft'});const compiled=compileTestingScenario(s,c,approval(s,c));assert.equal(compiled.executable,true);assert.equal(compiled.bindings.find(b=>b.id===c.bindings[0].id)?.revision,2);
});
test('Mehrere unabhängige Bindungs-IDs brauchen eine eindeutige Entscheidung',()=>{
  const c=ready(catalog()),s={...seeds()[0],blocks:[inst('kunde','kunde.anlegen')]};delete def(c,'kunde.anlegen').bindingId;c.bindings.push({...c.bindings[0],id:'andere.bindung'});assert.equal(compileTestingScenario(s,c).issues.some(i=>i.code==='BINDING_AMBIGUOUS'),true);
});
test('Dublettenprüfung berücksichtigt Vorgang, Schema und fachliche Standardwerte',()=>{
  const c=catalog();const original=def(c,'kunde.anlegen');const same={...clone(original),id:'anderer.name',name:'Eine andere Beschriftung'};assert.equal(findTestingDuplicates(same,c).decision,'reuse');
  const changed=clone(same);changed.inputs[0].default='Maria Müller';assert.equal(findTestingDuplicates(changed,c).decision,'extend');
  const unrelated={...clone(same),semanticKey:'anderer.vorgang',operation:'otherOperation',description:'Eine völlig andere fachliche Nachbedingung.',preconditions:[],postconditions:[]};assert.equal(findTestingDuplicates(unrelated,c).candidates.some(candidate=>candidate.decision==='reuse'),false);
});
test('Andere Versionen derselben Komponente sind keine Dubletten, andere Komponenten bleiben vergleichbar',()=>{
  const c=catalog(),original=clone(def(c,'kunde.anlegen'));
  const next={...clone(original),version:'2.0.0'};
  const versionsOnly={...c,definitions:[original,next]};
  const report=findTestingDuplicates(next,versionsOnly);
  assert.deepEqual(report.candidates,[]);assert.equal(report.decision,'new');assert.equal(report.chosen,undefined);
  const other={...clone(original),id:'kunde.alternative'};
  const comparison=findTestingDuplicates(next,{...versionsOnly,definitions:[original,next,other]});
  assert.deepEqual(comparison.candidates.map(item=>item.definition),[{id:other.id,version:other.version}]);
  assert.equal(comparison.decision,'reuse');assert.deepEqual(comparison.chosen,{id:other.id,version:other.version});
});
test('Leere options bei Text ist keine Auswahlbeschränkung; unbekannte Typen werden gespeichert nicht akzeptiert',()=>{
  const c=catalog();def(c,'kunde.anlegen').inputs[0].options=[];assert.equal(compileTestingScenario({...seeds()[0],blocks:[inst('kunde','kunde.anlegen')]},c).valid,true);
  const bad=clone(def(c,'kunde.anlegen'));bad.inputs[0].type='erfunden' as never;assert.throws(()=>repository.assertTestingDefinition(bad),/bekannten Werttyp/);
});
test('Tierarten haben eigene Pflichtfelder und übernehmen keine versteckten Kuhwerte',()=>{
  const c=catalog();const s=clone(seeds()[0]);s.blocks[0].overrides={tier:{species:'Pferd'}};const compiled=compileTestingScenario(s,c);assert.equal(compiled.valid,false);assert.equal(compiled.issues.some(i=>i.code==='INPUT_NOT_APPLICABLE'&&i.field==='earTag'),true);assert.equal(compiled.issues.some(i=>i.code==='INPUT_REQUIRED'&&i.field==='chipNumber'),true);
  const animal=def(c,'tier.anlegen');assert.equal(animal.inputs.find(i=>i.key==='earTag')?.default,undefined);
});
test('Speichern verwendet Revisionskonflikte; Layout und lose Blöcke bleiben außerhalb der Freigabe',()=>{
  const s=repository.saveTestingScenario({...clone(seeds()[0]),id:'persistenz-test'},0);const approved=repository.approveTestingScenario(s.id,s.revision,'Testerin');const before=testingFingerprint(s,getTestingCatalog());
  repository.saveTestingLayout({id:s.id,scenarioId:s.id,collapsed:['a'],positions:{a:{x:20,y:30}},parkedBlocks:[inst('lose','kunde.anlegen')],zoom:0.8});assert.equal(testingFingerprint(repository.getTestingScenario(s.id),getTestingCatalog()),before);assert.equal(repository.getTestingApproval(s.id)?.id,approved.id);
  const edited=repository.saveTestingScenario({...s,title:'Geänderter Testfall'},s.revision);assert.equal(edited.revision,2);assert.throws(()=>repository.saveTestingScenario(s,1),/zwischenzeitlich/);assert.notEqual(testingFingerprint(edited,getTestingCatalog()),approved.fingerprint);
});
test('Definitionsversionen bleiben unverändert und Wissensrückverweise werden gepflegt',()=>{
  const c=getTestingCatalog();const original=def(c,'kunde.anlegen');const s=seeds()[0];const before=testingFingerprint(s,c);
  const next={...clone(original),id:'kunde.spezialfall',semanticKey:'agriculture.special-customer',origin:'human' as const};repository.saveTestingDefinition(next);const after=getTestingCatalog();assert.equal(testingFingerprint(s,after),before);const doc=after.knowledge.filter(k=>k.id==='fach.kunde-betrieb').sort((a,b)=>b.revision-a.revision)[0];assert.equal(doc.definitionRefs.some(r=>r.id===next.id),true);
  assert.throws(()=>repository.saveTestingDefinition({...next,name:'Stille Änderung'}),/unveränderlich/);
  assert.equal(after.definitions.find(d=>d.id===next.id)?.name,next.name);
});
test('Promotion macht externe Referenzen zu Parametern und erhält ausführbare Reihenfolge',()=>{
  const s=repository.saveTestingScenario({...clone(seeds()[0]),id:'promotion-test'},0);
  const result=repository.promoteTestingBlocks({scenarioId:s.id,expectedRevision:1,instanceIds:['angebot','einreichen'],name:'Antrag vorbereiten',description:'Berechnet und reicht den vorhandenen Vorschlag ein.',parameters:[],replaceSelection:true});
  assert.equal(result.definition.inputs.some(i=>i.type==='proposal-ref'),true);assert.equal(result.scenario.revision,2);const compiled=compileTestingScenario(result.scenario,getTestingCatalog());assert.equal(compiled.valid,true,JSON.stringify(compiled.issues));assert.equal(compiled.steps.length,7);
});
test('Transitive Änderungsfolgen finden verschachtelte Workflows und frieren historische Bindungen ein',()=>{
  const c=ready(catalog()),s=seeds();const compiled=compileTestingScenario(s[0],c,approval(s[0],c));const run:TestingRun={id:'historischer-lauf',scenarioId:s[0].id,scenarioTitle:s[0].title,scenarioRevision:1,status:'passed',startedAt:'2026-09-06',compiled,steps:[]};
  const oldRevision=compiled.bindings.find(b=>b.operation==='createCustomer')!.revision;const next={...c.bindings.find(b=>b.operation==='createCustomer')!,revision:3,changeReason:'Button wurde umbenannt.'};c.bindings.push(next);
  const impact=getTestingImpact('ui.createCustomer',c,s,[run]);assert.equal(impact.scenarios.length,2);assert.equal(impact.definitions.some(d=>d.definition.id==='ablauf.standard-kuhvertrag'&&!d.direct),true);assert.equal(impact.historicalRuns[0].bindingRevision,oldRevision);
  const printImpact=getTestingImpact('ui.printPolicy',c,s,[run]);assert.deepEqual(printImpact.suggestedScenarioIds,['kuh-police-drucken']);
  const graph=buildTestingGraph(c,s,[run],s);assert.equal(graph.edges.some(e=>e.source==='lauf:historischer-lauf'&&e.target===`bindung:ui.createCustomer@${oldRevision}`),true);assert.equal(run.compiled.bindings.find(b=>b.operation==='createCustomer')!.revision,2);
});
test('Zirkuläre Kompositionen werden vor Ausführung erkannt',()=>{
  const c=catalog();const workflow=def(c,'ablauf.kuh-vorschlag');workflow.body=[inst('kreis',workflow.id)];const compiled=compileTestingScenario(seeds()[0],c);assert.equal(compiled.valid,false);assert.equal(compiled.issues.some(i=>i.code==='COMPOSITION_CYCLE'),true);
});
test('Ein ungültiger Agentenentwurf hinterlässt keine verwaisten Definitionen oder Wissensdokumente',()=>{
  const before=readFileSync(process.env.FOLIO_DATA_FILE!,'utf8');const original=def(catalog(),'kunde.anlegen');const fresh={...clone(original),id:'fehlerfall.neuer-block',knowledgeRefs:['fehlerfall.wissen']};
  const draft:TestingBusinessDraft={title:'Ungültige Übernahme',expectedOutcome:'Unverändert',blocks:[],knowledgeRefs:[],newDefinitions:[fresh,{...clone(original),name:'Unzulässiges Überschreiben'}],newKnowledge:[{id:'fehlerfall.wissen',revision:1,title:'Darf nicht gespeichert bleiben',kind:'rule',summary:'Test',content:'Test',definitionRefs:[{id:fresh.id,version:fresh.version}],relatedKnowledge:[],requiredFields:[],preconditions:[],postconditions:[],origin:'agent'}],explanation:'',assumptions:[],openQuestions:[]};
  assert.throws(()=>repository.createTestingScenarioFromDraft('Test',draft,'sol'),/überschreibt/);assert.equal(readFileSync(process.env.FOLIO_DATA_FILE!,'utf8'),before);
});
test('Zusammenhängende Schritte innerhalb eines Rollenblocks lassen sich ohne Dublette wiederverwenden',()=>{
  const s=repository.saveTestingScenario({...clone(seeds()[1]),id:'verschachtelte-promotion'},0);
  const request={scenarioId:s.id,expectedRevision:1,parentPath:'sachbearbeitung',instanceIds:['erneut','drucken'],name:'Erneute Police drucken',description:'Erzeugt eine Ausgabe und druckt sie.',parameters:[],replaceSelection:false};
  const first=repository.promoteTestingBlocks(request);const second=repository.promoteTestingBlocks({...request,replaceSelection:true});
  assert.equal(second.definition.id,first.definition.id);assert.equal(second.duplicateReport.decision,'reuse');assert.equal(second.scenario.blocks[1].children?.[0].definition.id,first.definition.id);
  const compiled=compileTestingScenario(second.scenario,getTestingCatalog());assert.equal(compiled.valid,true,JSON.stringify(compiled.issues));assert.equal(compiled.steps.length,10);assert.equal(compiled.steps.at(-2)?.actor,'Sachbearbeiter');
});
test('Dublettenprüfung erkennt identische Kompositionen trotz anderer lokaler IDs und Aliasnamen',()=>{
  const c=catalog();const original=def(c,'ablauf.kuh-vorschlag'),changed=clone(original);changed.id='gleich.andere-ids';
  const aliases=new Map<string,string>();for(const block of changed.body!){block.id=`neu-${block.id}`;for(const [key,name]of Object.entries(block.outputs??{})){aliases.set(name,`neu-${name}`);block.outputs![key]=`neu-${name}`;}}
  const replace=(value:any):any=>Array.isArray(value)?value.map(replace):value&&typeof value==='object'?typeof value.ref==='string'?{...value,ref:aliases.get(value.ref)??value.ref}:Object.fromEntries(Object.entries(value).map(([k,v])=>[k,replace(v)])):value;
  for(const block of changed.body!)block.inputs=replace(block.inputs);changed.exports=replace(changed.exports);
  assert.equal(findTestingDuplicates(changed,c).decision,'reuse');
});
test('Promotion innerhalb eines Workflows führt dessen Parameter und externe Ergebnisse weiter',()=>{
  const s=repository.saveTestingScenario({...clone(seeds()[0]),id:'workflow-promotion'},0);
  const result=repository.promoteTestingBlocks({scenarioId:s.id,expectedRevision:1,parentPath:'kuhvorschlag',instanceIds:['betrieb','tier'],name:'Betrieb und Kuh erfassen',description:'Erfasst den Betrieb und dessen Kuh.',parameters:[],replaceSelection:true});
  const compiled=compileTestingScenario(result.scenario,getTestingCatalog());assert.equal(compiled.valid,true,JSON.stringify(compiled.issues));assert.equal(compiled.steps.find(step=>step.operation==='createAnimal')?.inputs.sumInsured,15000);assert.equal(compiled.steps.length,7);
});
test('Explizit umbenannte Parameter eines inneren Workflows erhalten eigenständig nutzbare Standardwerte',()=>{
  const original=clone(seeds()[0]);original.blocks[0].inputs={...original.blocks[0].inputs,customerName:'Klara Beispiel',state:'Bayern',farmStreet:'Hauptstraße 4',farmPostalCode:'87437',farmCity:'Kempten'};
  const s=repository.saveTestingScenario({...original,id:'umbenannte-workflow-parameter'},0);
  const promoted=repository.promoteTestingBlocks({scenarioId:s.id,expectedRevision:s.revision,parentPath:'kuhvorschlag',instanceIds:['kunde','betrieb'],name:'Kunden und Betrieb eigenständig anlegen',description:'Zwei zusammengehörige Erfassungsschritte.',parameters:[
    {key:'kundenname',label:'Kundenname',instanceId:'kunde',input:'name'},
    {key:'bundesland',label:'Bundesland',instanceId:'betrieb',input:'state'},
    {key:'betriebsstrasse',label:'Betriebsstraße',instanceId:'betrieb',input:'street'},
    {key:'betriebspostleitzahl',label:'Betriebspostleitzahl',instanceId:'betrieb',input:'postalCode'},
    {key:'betriebsort',label:'Betriebsort',instanceId:'betrieb',input:'city'},
  ],replaceSelection:false});
  const standalone:TestingScenario={...s,id:'eigenstaendige-verwendung',parameters:undefined,blocks:[inst('neu',promoted.definition.id)]};
  const compiled=compileTestingScenario(standalone,getTestingCatalog());
  assert.equal(compiled.valid,true,JSON.stringify(compiled.issues.filter(issue=>issue.severity==='error')));
  assert.deepEqual(Object.fromEntries(promoted.definition.inputs.map(input=>[input.key,input.default])),{kundenname:'Klara Beispiel',bundesland:'Bayern',betriebsstrasse:'Hauptstraße 4',betriebspostleitzahl:'87437',betriebsort:'Kempten'});
  assert.deepEqual(compiled.steps[1].inputs.customerId,{ref:'neu/kunde::customer',type:'customer-ref'});
  assert.equal(compiled.steps[0].inputs.name,'Klara Beispiel');assert.equal(compiled.steps[1].inputs.state,'Bayern');
  assert.deepEqual(repository.getTestingScenario(s.id),s);
});

test('Referenztypfehler nennen Zielblock, Feld, deutsche Ergebnisart und tatsächliche verschachtelte Quelle',()=>{
  const c=catalog(),s=clone(seeds()[0]);
  const customer={...inst('kunde','kunde.anlegen',{}, {customer:'kunde'}),label:'Mein Prüfkunde'};
  const target={...inst('pruefung','pruefung.vorschlagsstatus',{proposalId:ref('kunde'),expectedStatus:'Entwurf'}),label:'Ergebnisquelle prüfen'};
  s.blocks=[{...inst('rolle','kontext.rolle',{role:'Vermittler'}),children:[customer,target]}];
  // Use the actual catalog context key rather than a second synthetic schema.
  s.blocks[0].definition={id:c.definitions.find(d=>d.kind==='context')!.id,version:'1.0.0'};
  const issue=compileTestingScenario(s,c).issues.find(i=>i.code==='INPUT_REFERENCE_TYPE')!;
  assert(issue);assert.equal(issue.path,'rolle/pruefung');assert.equal(issue.field,'proposalId');assert.equal(issue.sourcePath,'rolle/kunde');assert.equal(issue.sourceLabel,'Mein Prüfkunde');
  assert.match(issue.message,/Ergebnisquelle prüfen/);assert.match(issue.message,/Versicherungsvorschlag/);assert.match(issue.message,/Kunde/);assert.match(issue.message,/Mein Prüfkunde/);
  assert(!issue.message.includes('proposal-ref'));assert(!issue.message.includes('customer-ref'));
  target.inputs.proposalId={ref:'kunde',type:'animal-ref'};
  const annotated=compileTestingScenario(s,c).issues.find(i=>i.code==='INPUT_REFERENCE_TYPE')!;
  assert.equal(annotated.path,'rolle/pruefung');assert.equal(annotated.sourcePath,'rolle/kunde');assert.match(annotated.message,/Versicherungsvorschlag/);assert.match(annotated.message,/Kunde/);assert(!annotated.message.includes('Tier'));
});

test('Referenzdiagnosen behalten Unterfeldpfade und markieren fehlende Quellen am Ziel',()=>{
  const c=catalog(),s=clone(seeds()[0]);const original=def(c,'pruefung.vorschlagsstatus');
  const custom:TestingBlockDefinition={...clone(original),id:'fixture.verschachtelte-eingabe',inputs:[{key:'details',label:'Prüfdetails',type:'object',fields:[{key:'proposalId',label:'Versicherungsvorschlag',type:'proposal-ref',required:true}]}]};
  c.definitions.push(custom);
  s.blocks=[inst('kunde','kunde.anlegen',{}, {customer:'kunde'}),inst('ziel',custom.id,{details:{proposalId:ref('kunde')}})];
  const issue=compileTestingScenario(s,c).issues.find(i=>i.code==='INPUT_REFERENCE_TYPE')!;
  assert.equal(issue.field,'details.proposalId');assert.equal(issue.path,'ziel');assert.match(issue.message,/Prüfdetails \/ Versicherungsvorschlag/);
  s.blocks[1].inputs.details={proposalId:ref('erst-spaeter')};
  const missing=compileTestingScenario(s,c).issues.find(i=>i.code==='REFERENCE_MISSING')!;
  assert.equal(missing.path,'ziel');assert.equal(missing.field,'details.proposalId');assert.match(missing.message,/noch nicht verfügbar/);assert.match(missing.message,/Prüfdetails/);
});


test('Das skalare Eingabeschema und die echte Quelle haben Vorrang vor einer alten Typmarkierung',()=>{
  const c=catalog(),s=clone(seeds()[0]);
  s.blocks=[inst('kunde','kunde.anlegen',{}, {customer:'kunde'}),inst('betrieb','betrieb.anlegen',{customerId:{ref:'kunde',type:'farm-ref'}})];
  const original=JSON.stringify(s),compiled=compileTestingScenario(s,c);
  assert(!compiled.issues.some(i=>['REFERENCE_TYPE','INPUT_REFERENCE_TYPE'].includes(i.code)));
  assert.deepEqual(compiled.steps.find(step=>step.path==='betrieb')!.inputs.customerId,{ref:'kunde::customer',type:'customer-ref'});
  assert.equal(JSON.stringify(s),original);
});

 test('Listen und untypisierte Objektwerte behalten ihre ausdrückliche Referenztypprüfung',()=>{
  const c=catalog(),s=clone(seeds()[0]),original=def(c,'pruefung.vorschlagsstatus');
  const custom:TestingBlockDefinition={...clone(original),id:'fixture.offene-werte',inputs:[{key:'liste',label:'Ergebnisliste',type:'list'},{key:'details',label:'Details',type:'object',extensible:true},{key:'typisiert',label:'Typisiert',type:'object',fields:[{key:'kunde',label:'Kunde',type:'customer-ref'}]}]};
  c.definitions.push(custom);const stale={ref:'kunde',type:'farm-ref' as const};
  s.blocks=[inst('kunde','kunde.anlegen',{}, {customer:'kunde'}),inst('ziel',custom.id,{liste:[stale],details:{frei:stale},typisiert:{kunde:{param:'auswahl'}}})];s.parameters={auswahl:{param:'indirekt'},indirekt:stale};
  const issues=compileTestingScenario(s,c).issues.filter(issue=>issue.code==='REFERENCE_TYPE');
  assert.deepEqual(issues.map(issue=>issue.field).sort(),['details.frei','liste']);
  assert(issues.every(issue=>issue.path==='ziel'&&issue.sourcePath==='kunde'));
});

 test('Wiederverwendung übernimmt den Typ einer bekannten Quelle statt alter Referenzmetadaten',()=>{
  const base=clone(seeds().find(s=>s.id==='kuh-direktionsanfrage')!);base.id='promotion-alte-markierung';base.blocks[1].inputs.proposalId={ref:'vorschlag',type:'contract-ref'};
  const saved=repository.saveTestingScenario(base,0);assert.equal(compileTestingScenario(saved,catalog()).valid,true);
  const promoted=repository.promoteTestingBlocks({scenarioId:saved.id,expectedRevision:saved.revision,instanceIds:['angebot','einreichen'],name:'Angebot und Antrag mit alter Markierung',description:'Synthetische Referenztypregression',parameters:[],replaceSelection:true});
  assert.equal(promoted.definition.inputs.find(input=>input.key==='ref_vorschlag')!.type,'proposal-ref');
  assert.equal(compileTestingScenario(promoted.scenario,getTestingCatalog()).valid,true);
});

test('Fehlende technische Bindung ist eine Information und blockiert nur die Ausführung',()=>{
  const source=catalog(),scenario=seeds()[0],withoutBindings={...source,bindings:[]};
  const compiled=compileTestingScenario(scenario,withoutBindings);
  const missing=compiled.issues.filter(issue=>issue.code==='BINDING_MISSING');assert(missing.length);assert(missing.every(issue=>issue.severity==='info'));assert.equal(compiled.valid,true);assert.equal(compiled.executable,false);
});

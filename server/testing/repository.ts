import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { TestingApproval, TestingBlockDefinition, TestingBlockInstance, TestingBusinessDraft, TestingCatalog, TestingInput, TestingKnowledgeDocument, TestingModel, TestingPromotionRequest, TestingPromotionResult, TestingRun, TestingScenario, TestingScenarioLayout, TestingTechnicalBinding, TestingValue, TestingVersionRef } from '../../shared/testing';
import { isTestingParameter, isTestingReference, testingVersionKey } from '../../shared/testing';
import { dataFile, db } from '../store';
import { getTestingCatalog, loadTestingSeedScenarios } from './catalog';
import { compileTestingScenario, findTestingDuplicates, stableTestingStringify, testingFingerprint } from './compiler';
import { validateTestingMatrix } from './matrix';

export class TestingModelError extends Error {
  constructor(message:string,public status=400,public code='TESTING_INVALID') {super(message);this.name='TestingModelError';}
}
type ScenarioRevision={id:string;scenario:TestingScenario};
const now=()=>new Date().toISOString();
const clone=<T>(value:T):T=>structuredClone(value);
const versionPattern=/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/;
const safeKey=(key:string)=>!!key&&!['__proto__','constructor','prototype'].includes(key);
const valueTypes=new Set(['text','number','money','boolean','date','choice','object','list','customer-ref','farm-ref','animal-ref','proposal-ref','referral-ref','contract-ref','policy-ref','document-ref']);
function assertInputs(inputs:TestingInput[],path='Eingaben') {
  if(!Array.isArray(inputs))throw new TestingModelError(`${path} muss eine Liste sein.`);
  const keys=new Set<string>();
  for(const input of inputs) {
    if(!input||typeof input.key!=='string'||!safeKey(input.key)||keys.has(input.key))throw new TestingModelError(`${path} enthält einen fehlenden, reservierten oder mehrfachen Feldnamen.`);
    keys.add(input.key);
    if(!valueTypes.has(input.type)||typeof input.label!=='string')throw new TestingModelError(`„${input.key}“ braucht einen bekannten Werttyp und eine deutsche Beschriftung.`);
    if(input.fields)assertInputs(input.fields,`${path}.${input.key}`);
    if(input.type==='choice'&&(!input.options?.length||input.options.some(o=>typeof o.value!=='string'||typeof o.label!=='string')))throw new TestingModelError(`„${input.label}“ braucht mindestens einen gültigen Auswahlwert.`);
  }
}
export function assertTestingDefinition(definition:TestingBlockDefinition) {
  if(!definition||typeof definition.id!=='string'||!safeKey(definition.id)||!versionPattern.test(definition.version))throw new TestingModelError('Eine Blockdefinition braucht eine stabile ID und eine semantische Version wie 1.0.0.');
  if(!definition.name||!definition.semanticKey||!['action','assertion','workflow','context'].includes(definition.kind))throw new TestingModelError('Eine Blockdefinition braucht Name, fachliche Kennung und gültige Blockart.');
  assertInputs(definition.inputs);
  if(!Array.isArray(definition.outputs)||definition.outputs.some(o=>!safeKey(o.key)||!valueTypes.has(o.type))||new Set(definition.outputs.map(o=>o.key)).size!==definition.outputs.length)throw new TestingModelError('Ergebnisse brauchen eindeutige Namen und gültige Typen.');
  if(!Array.isArray(definition.knowledgeRefs)||!definition.knowledgeRefs.length||!Array.isArray(definition.preconditions)||!Array.isArray(definition.postconditions))throw new TestingModelError('Mindestens ein Wissensverweis sowie Vorbedingungen und Nachbedingungen müssen angegeben werden.');
  if((definition.kind==='workflow')&&!Array.isArray(definition.body))throw new TestingModelError('Ein zusammengesetzter Block braucht einen enthaltenen Ablauf.');
}
function persistVersion<T>(collection:string,value:T,key:(record:T)=>string) {
  const records=db.read<T>(collection);const index=records.findIndex(item=>key(item)===key(value));
  if(index<0)records.push(clone(value));else records[index]=clone(value);db.replace(collection,records);return clone(value);
}
export function listTestingScenarios():TestingScenario[] {
  return [...new Map([...loadTestingSeedScenarios(),...db.read<TestingScenario>('testingScenarios')].map(s=>[s.id,s])).values()].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
}
export function getTestingScenario(id:string):TestingScenario {
  const scenario=listTestingScenarios().find(s=>s.id===id);if(!scenario)throw new TestingModelError('Dieser Testfall wurde nicht gefunden.',404,'SCENARIO_NOT_FOUND');return clone(scenario);
}
export function listTestingScenarioRevisions():TestingScenario[] {
  return [...new Map([...loadTestingSeedScenarios(),...db.read<ScenarioRevision>('testingScenarioRevisions').map(r=>r.scenario),...listTestingScenarios()].map(s=>[`${s.id}@${s.revision}`,s])).values()];
}
export function saveTestingScenario(input:TestingScenario,expectedRevision?:number):TestingScenario {
  if(!input||typeof input.id!=='string'||!input.id||typeof input.title!=='string'||!Array.isArray(input.blocks))throw new TestingModelError('Der Testfall braucht ID, Titel und eine Blockliste.');
  const previous=listTestingScenarios().find(s=>s.id===input.id);
  if(previous&&expectedRevision!==previous.revision)throw new TestingModelError('Der Testfall wurde zwischenzeitlich geändert. Lade die aktuelle Fassung vor dem Speichern.',409,'REVISION_CONFLICT');
  if(!previous&&expectedRevision!==undefined&&expectedRevision!==0)throw new TestingModelError('Der neue Testfall hat noch keine gespeicherte Revision.',409,'REVISION_CONFLICT');
  const saved:TestingScenario={...clone(input),...(input.naming&&input.naming.title!==input.title?{naming:{...input.naming,title:input.title,titleSource:'human' as const}}:{}),revision:previous?previous.revision+1:1,createdAt:previous?.createdAt??input.createdAt??now(),updatedAt:now()};
  if(previous)db.upsert<ScenarioRevision>('testingScenarioRevisions',{id:`${previous.id}@${previous.revision}`,scenario:previous});
  db.upsert('testingScenarios',saved);db.upsert<ScenarioRevision>('testingScenarioRevisions',{id:`${saved.id}@${saved.revision}`,scenario:saved});return clone(saved);
}
export function createTestingRequestDraft(intent:string,model:TestingModel):TestingScenario {
  return saveTestingScenario({id:`testfall-${randomUUID()}`,title:'Neuer Testfall',intent,revision:1,blocks:[],expectedOutcome:'',knowledgeRefs:[],source:'agent',model,createdAt:now(),updatedAt:now()},0);
}
export function getTestingApproval(scenarioId:string):TestingApproval|undefined {
  return db.read<TestingApproval>('testingApprovals').filter(a=>a.scenarioId===scenarioId).sort((a,b)=>b.approvedAt.localeCompare(a.approvedAt))[0];
}
export function approveTestingScenario(id:string,revision:number,actor='Fachliche Prüfung',comment?:string):TestingApproval {
  const scenario=getTestingScenario(id);if(scenario.revision!==revision)throw new TestingModelError('Es kann nur die aktuelle fachliche Revision freigegeben werden.',409,'REVISION_CONFLICT');
  const catalog=getTestingCatalog();const compiled=compileTestingScenario(scenario,catalog);
  if(!compiled.valid)throw new TestingModelError(`Der Entwurf hat noch fachliche Fehler: ${compiled.issues.filter(i=>i.severity==='error').map(i=>i.message).join(' ')}`,400,'BUSINESS_INVALID');
  const approval:TestingApproval={id:`freigabe-${randomUUID()}`,scenarioId:id,scenarioRevision:revision,fingerprint:testingFingerprint(scenario,catalog),actor,approvedAt:now(),...(comment?{comment}:{})};db.upsert('testingApprovals',approval);return approval;
}
export function saveTestingDefinition(definition:TestingBlockDefinition,newKnowledge:TestingKnowledgeDocument[]=[]):TestingBlockDefinition {
  assertTestingDefinition(definition);if(!Array.isArray(newKnowledge))throw new TestingModelError('Neue Wissensbelege müssen als Liste übergeben werden.');
  const catalog=getTestingCatalog(),existing=catalog.definitions.find(d=>testingVersionKey(d)===testingVersionKey(definition));
  if(existing&&stableTestingStringify(existing)!==stableTestingStringify(definition))throw new TestingModelError('Diese Definitionsversion ist unveränderlich. Veröffentliche eine neue semantische Version.',409,'DEFINITION_IMMUTABLE');
  const knowledge=new Map(catalog.knowledge.map(document=>[`${document.id}@${document.revision}`,document]));
  for(const document of newKnowledge){assertKnowledge(document);const key=`${document.id}@${document.revision}`,previous=knowledge.get(key);if(previous&&stableTestingStringify(previous)!==stableTestingStringify(document))throw new TestingModelError('Diese Wissensrevision ist unveränderlich.',409,'KNOWLEDGE_IMMUTABLE');knowledge.set(key,document);}
  for(const document of newKnowledge){if(document.definitionRefs.some(ref=>testingVersionKey(ref)!==testingVersionKey(definition)&&!catalog.definitions.some(item=>testingVersionKey(item)===testingVersionKey(ref))))throw new TestingModelError('Ein neuer Wissensbeleg verweist auf eine fehlende Blockversion.');if(document.relatedKnowledge.some(id=>![...knowledge.values()].some(item=>item.id===id)))throw new TestingModelError('Ein neuer Wissensbeleg verweist auf fehlendes weiteres Wissen.');}
  const additions=[...newKnowledge];
  for(const id of definition.knowledgeRefs){const doc=[...knowledge.values()].filter(item=>item.id===id).sort((a,b)=>b.revision-a.revision)[0];if(!doc)throw new TestingModelError('Eine neue Definition verweist auf ein fehlendes Wissensdokument. Ergänze zuerst den fachlichen Wissensbeleg.');if(!doc.definitionRefs.some(ref=>testingVersionKey(ref)===testingVersionKey(definition))){const linked={...doc,revision:doc.revision+1,definitionRefs:[...doc.definitionRefs,{id:definition.id,version:definition.version}]};knowledge.set(`${linked.id}@${linked.revision}`,linked);additions.push(linked);}}
  const collections:Record<string,unknown[]>=existsSync(dataFile)?JSON.parse(readFileSync(dataFile,'utf8')):{};
  const merge=<T>(name:string,rows:T[],key:(row:T)=>string)=>{collections[name]=[...new Map([...(collections[name]??[]) as T[],...rows].map(row=>[key(row),clone(row)])).values()];};
  merge('testingDefinitions',[definition],testingVersionKey);merge('testingKnowledge',additions,document=>`${document.id}@${document.revision}`);
  writeTestingCollections(collections);return clone(definition);
}
function writeTestingCollections(collections:Record<string,unknown[]>) {mkdirSync(dirname(dataFile),{recursive:true});const temporary=`${dataFile}.${process.pid}.${randomUUID()}.tmp`;writeFileSync(temporary,`${JSON.stringify(collections,null,2)}\n`,{encoding:'utf8',mode:0o600});renameSync(temporary,dataFile);}
export function saveTestingKnowledge(document:TestingKnowledgeDocument):TestingKnowledgeDocument {
  assertKnowledge(document);
  const existing=getTestingCatalog().knowledge.find(d=>d.id===document.id&&d.revision===document.revision);
  if(existing&&stableTestingStringify(existing)!==stableTestingStringify(document))throw new TestingModelError('Diese Wissensrevision ist unveränderlich. Lege eine neue Revision an.',409,'KNOWLEDGE_IMMUTABLE');
  return persistVersion('testingKnowledge',document,d=>`${d.id}@${d.revision}`);
}
function assertKnowledge(document:TestingKnowledgeDocument) {
  if(!document?.id||!Number.isInteger(document.revision)||document.revision<1||!document.title||typeof document.content!=='string'||!Array.isArray(document.definitionRefs)||!['concept','rule','procedure','technical'].includes(document.kind)||!Array.isArray(document.relatedKnowledge)||!Array.isArray(document.requiredFields)||!Array.isArray(document.preconditions)||!Array.isArray(document.postconditions))throw new TestingModelError('Das Wissensdokument braucht ID, Revision, Inhalt, Bedingungen und Definitionsverweise.');
}
export function saveTestingBinding(binding:TestingTechnicalBinding):TestingTechnicalBinding {
  if(!binding?.id||!Number.isInteger(binding.revision)||binding.revision<1||!binding.operation||!Array.isArray(binding.definitionRefs)||!Array.isArray(binding.locators))throw new TestingModelError('Die technische Bindung braucht ID, Revision, Vorgang, Definitionen und Lokatoren.');
  const existing=getTestingCatalog().bindings.find(b=>b.id===binding.id&&b.revision===binding.revision);
  if(existing&&stableTestingStringify(existing)!==stableTestingStringify(binding))throw new TestingModelError('Diese technische Bindungsrevision ist unveränderlich. Erhöhe die technische Revision.',409,'BINDING_IMMUTABLE');
  return persistVersion('testingBindings',binding,b=>`${b.id}@${b.revision}`);
}
export function getTestingLayout(scenarioId:string):TestingScenarioLayout {return db.find<TestingScenarioLayout>('testingLayouts',scenarioId)??{id:scenarioId,scenarioId,collapsed:[]};}
export function saveTestingLayout(layout:TestingScenarioLayout):TestingScenarioLayout {return db.upsert('testingLayouts',{...clone(layout),id:layout.scenarioId});}
export function saveTestingRun(run:TestingRun):TestingRun {return db.upsert('testingRuns',clone(run));}
export function listTestingRuns():TestingRun[] {return db.read<TestingRun>('testingRuns').sort((a,b)=>b.startedAt.localeCompare(a.startedAt));}
export function getTestingRun(id:string):TestingRun {const run=db.find<TestingRun>('testingRuns',id);if(!run)throw new TestingModelError('Dieser Testlauf wurde nicht gefunden.',404,'RUN_NOT_FOUND');return run;}

export function previewTestingBusinessDraft(intent:string,draft:TestingBusinessDraft,model:TestingModel,catalog:TestingCatalog=getTestingCatalog()) {
  if(!draft||!draft.title||!Array.isArray(draft.blocks)||!Array.isArray(draft.newDefinitions)||!Array.isArray(draft.newKnowledge))throw new TestingModelError('Der fachliche Agent hat keinen vollständigen strukturierten Entwurf geliefert.');
  draft.newDefinitions.forEach(assertTestingDefinition);
  const augmented:TestingCatalog={...catalog,definitions:[...catalog.definitions,...draft.newDefinitions],knowledge:[...catalog.knowledge,...draft.newKnowledge]};
  const scenario:TestingScenario={id:`testfall-${randomUUID()}`,title:draft.title,intent,revision:1,blocks:clone(draft.blocks),expectedOutcome:draft.expectedOutcome,knowledgeRefs:draft.knowledgeRefs,createdAt:now(),updatedAt:now(),source:'agent',model,...(draft.matrix?{matrix:clone(draft.matrix)}:{})};
  const compiled=compileTestingScenario(scenario,augmented);
  return {scenario,catalog:augmented,compiled,duplicateReports:draft.newDefinitions.map(definition=>findTestingDuplicates(definition,catalog))};
}
export function previewTestingScenarioEdit(existing:TestingScenario,draft:TestingBusinessDraft,model:TestingModel,catalog:TestingCatalog=getTestingCatalog()) {
  const preview=previewTestingBusinessDraft(existing.intent,draft,model,catalog);
  for(const document of draft.newKnowledge){assertKnowledge(document);if(document.definitionRefs.some(ref=>!preview.catalog.definitions.some(definition=>testingVersionKey(definition)===testingVersionKey(ref))))throw new TestingModelError(`„${document.title}“ verweist auf eine fehlende Definitionsversion.`);if(document.relatedKnowledge.some(id=>!preview.catalog.knowledge.some(item=>item.id===id)))throw new TestingModelError(`„${document.title}“ verweist auf fehlendes weiteres Wissen.`);}
  const base=clone(existing);if(draft.matrixMode==='remove')delete base.matrix;
  const scenario:TestingScenario={...base,title:draft.title,blocks:clone(draft.blocks),expectedOutcome:draft.expectedOutcome,knowledgeRefs:clone(draft.knowledgeRefs),...(draft.matrixMode==='replace'&&draft.matrix?{matrix:clone(draft.matrix)}:{})};
  return {...preview,scenario,compiled:compileTestingScenario(scenario,preview.catalog)};
}
export function applyTestingScenarioEdit(id:string,draft:TestingBusinessDraft,model:TestingModel,expectedRevision:number,fingerprint:string):TestingScenario {
  const existing=getTestingScenario(id),catalog=getTestingCatalog();
  if(existing.revision!==expectedRevision||testingFingerprint(existing,catalog)!==fingerprint)throw new TestingModelError('Der Testfall oder sein Wissensstand hat sich seit dem Änderungsvorschlag geändert. Bitte den aktuellen Ablauf erneut überarbeiten.',409,'AGENT_REVISION_STALE');
  const preview=previewTestingScenarioEdit(existing,draft,model,catalog);
  if(!preview.compiled.valid)throw new TestingModelError(`Der Änderungsvorschlag hat fachliche Fehler: ${preview.compiled.issues.filter(issue=>issue.severity==='error').map(issue=>issue.message).join(' ')}`);
  return persistTestingBusinessDraft(existing.intent,draft,model,existing);
}
/** First drafts may contain business issues for human correction; they are never approved. */
export function completeTestingRequestDraft(id:string,draft:TestingBusinessDraft,model:TestingModel,expectedRevision:number,fingerprint:string):TestingScenario {
  const existing=getTestingScenario(id),catalog=getTestingCatalog();
  if(existing.revision!==expectedRevision||testingFingerprint(existing,catalog)!==fingerprint)throw new TestingModelError('Die Anforderung wurde während der Planung geändert. Der Entwurf wurde nicht übernommen.',409,'AGENT_REVISION_STALE');
  if(existing.blocks.length)throw new TestingModelError('Ein vorhandener Ablauf darf nur über einen geprüften Änderungsvorschlag ersetzt werden.',409);
  return persistTestingBusinessDraft(existing.intent,draft,model,existing);
}
export function createTestingScenarioFromDraft(intent:string,draft:TestingBusinessDraft,model:TestingModel):TestingScenario {
  return persistTestingBusinessDraft(intent,draft,model);
}
function persistTestingBusinessDraft(intent:string,draft:TestingBusinessDraft,model:TestingModel,existing?:TestingScenario):TestingScenario {
  const preview=existing?previewTestingScenarioEdit(existing,draft,model):previewTestingBusinessDraft(intent,draft,model);
  const current=getTestingCatalog();const definitions=new Map(current.definitions.map(d=>[testingVersionKey(d),d]));const knowledge=new Map(current.knowledge.map(d=>[`${d.id}@${d.revision}`,d]));
  for(const definition of draft.newDefinitions){assertTestingDefinition(definition);const key=testingVersionKey(definition),previous=definitions.get(key);if(previous&&stableTestingStringify(previous)!==stableTestingStringify(definition))throw new TestingModelError('Der Agentenentwurf überschreibt eine bestehende Definitionsversion.',409,'DEFINITION_IMMUTABLE');definitions.set(key,clone(definition));}
  for(const doc of draft.newKnowledge){assertKnowledge(doc);const key=`${doc.id}@${doc.revision}`,previous=knowledge.get(key);if(previous&&stableTestingStringify(previous)!==stableTestingStringify(doc))throw new TestingModelError('Der Agentenentwurf überschreibt eine bestehende Wissensrevision.',409,'KNOWLEDGE_IMMUTABLE');knowledge.set(key,clone(doc));}
  for(const doc of draft.newKnowledge){if(doc.definitionRefs.some(ref=>!definitions.has(testingVersionKey(ref))))throw new TestingModelError(`„${doc.title}“ verweist auf eine fehlende Definitionsversion.`);if(doc.relatedKnowledge.some(id=>![...knowledge.values()].some(d=>d.id===id)))throw new TestingModelError(`„${doc.title}“ verweist auf fehlendes weiteres Wissen.`);}
  const addedKnowledge=[...draft.newKnowledge];
  for(const definition of draft.newDefinitions)for(const id of definition.knowledgeRefs){const doc=[...knowledge.values()].filter(d=>d.id===id).sort((a,b)=>b.revision-a.revision)[0];if(!doc)throw new TestingModelError(`Der Wissensbeleg „${id}“ für „${definition.name}“ fehlt.`);if(!doc.definitionRefs.some(ref=>testingVersionKey(ref)===testingVersionKey(definition))){const linked={...doc,revision:doc.revision+1,definitionRefs:[...doc.definitionRefs,{id:definition.id,version:definition.version}]};knowledge.set(`${linked.id}@${linked.revision}`,linked);addedKnowledge.push(linked);}}
  const collections:Record<string,unknown[]>=existsSync(dataFile)?JSON.parse(readFileSync(dataFile,'utf8')):{};
  const merge=<T>(collection:string,added:T[],key:(value:T)=>string)=>{collections[collection]=[...new Map([...(collections[collection]??[]) as T[],...added].map(value=>[key(value),clone(value)])).values()];};
  merge('testingDefinitions',draft.newDefinitions,testingVersionKey);merge('testingKnowledge',addedKnowledge,d=>`${d.id}@${d.revision}`);
  const scenario=existing?{...preview.scenario,revision:existing.revision+1,updatedAt:now()}:preview.scenario;
  if(existing)merge('testingScenarioRevisions',[{id:`${existing.id}@${existing.revision}`,scenario:existing}],r=>r.id);
  merge('testingScenarios',[scenario],s=>s.id);merge('testingScenarioRevisions',[{id:`${scenario.id}@${scenario.revision}`,scenario}],r=>r.id);
  // One synchronous atomic replacement commits the entire adoption, preserving every other collection.
  writeTestingCollections(collections);
  return clone(scenario);
}
function values(value:TestingValue,visit:(value:TestingValue)=>void) {visit(value);if(Array.isArray(value))value.forEach(v=>values(v,visit));else if(value&&typeof value==='object'&&!isTestingReference(value))Object.values(value).forEach(v=>values(v,visit));}
function mapValues(value:TestingValue,transform:(value:TestingValue)=>TestingValue):TestingValue {const transformed=transform(value);if(transformed!==value)return transformed;if(Array.isArray(value))return value.map(v=>mapValues(v,transform));if(value&&typeof value==='object'&&!isTestingReference(value))return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,mapValues(v,transform)]));return value;}
export function promoteTestingBlocks(request:TestingPromotionRequest):TestingPromotionResult {
  const scenario=getTestingScenario(request.scenarioId);if(scenario.revision!==request.expectedRevision)throw new TestingModelError('Der Testfall hat sich seit dem Wiederverwendungsvorschlag geändert.',409,'REVISION_CONFLICT');
  const catalog=getTestingCatalog();const defs=new Map(catalog.definitions.map(d=>[testingVersionKey(d),d]));
  let siblings=scenario.blocks;let parent:TestingBlockInstance|undefined;
  const enclosing:TestingBlockInstance[]=[];
  for(const part of (request.parentPath??'').split('/').filter(Boolean)){parent=siblings.find(b=>b.id===part);if(!parent)throw new TestingModelError('Der übergeordnete Blockpfad ist nicht mehr vorhanden.');const parentDefinition=defs.get(testingVersionKey(parent.definition));if(!parentDefinition||!['context','workflow'].includes(parentDefinition.kind))throw new TestingModelError('Die Auswahl muss innerhalb einer zusammengesetzten Folge oder Rolle liegen.');enclosing.push(parent);parent.children??=clone(parentDefinition.body??[]);siblings=parent.children;}
  const selected=new Set(request.instanceIds);const positions=siblings.map((b,i)=>selected.has(b.id)?i:-1).filter(i=>i>=0);
  if(!positions.length||positions.length!==selected.size||positions.at(-1)!-positions[0]+1!==positions.length)throw new TestingModelError('Wähle eine zusammenhängende Folge auf derselben Ablaufebene.');
  const body=clone(siblings.slice(positions[0],positions.at(-1)!+1));
  const inputs:TestingInput[]=[];const replacementInputs:Record<string,TestingValue>={};
  const outerSchemas=new Map<string,TestingInput>();let outerValues:Record<string,TestingValue>=scenario.parameters??{};
  const resolveOuter=(value:TestingValue,params:Record<string,TestingValue>,active:string[]=[]):TestingValue=>{
    if(isTestingParameter(value)){
      if(!Object.hasOwn(params,value.param))throw new TestingModelError(`Der äußere Parameter „${value.param}“ ist nicht belegt und kann keinen eigenständigen Standardwert liefern.`);
      if(active.includes(value.param))throw new TestingModelError(`Die äußere Parameterverknüpfung für „${value.param}“ enthält einen Kreis.`);
      return resolveOuter(params[value.param],params,[...active,value.param]);
    }
    if(Array.isArray(value))return value.map(v=>resolveOuter(v,params,active));
    if(value&&typeof value==='object'&&!isTestingReference(value))return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,resolveOuter(v,params,active)]));
    return clone(value);
  };
  for(const ancestor of enclosing){const d=defs.get(testingVersionKey(ancestor.definition));if(d?.kind==='workflow'){d.inputs.forEach(input=>outerSchemas.set(input.key,input));const effective={...Object.fromEntries(d.inputs.filter(i=>i.default!==undefined).map(i=>[i.key,i.default!])),...ancestor.inputs};outerValues=Object.fromEntries(Object.entries(effective).map(([k,v])=>[k,resolveOuter(v,outerValues)]));}}
  for(const parameter of request.parameters) {
    const block=body.find(b=>b.id===parameter.instanceId);const schema=block&&defs.get(testingVersionKey(block.definition))?.inputs.find(i=>i.key===parameter.input);
    if(!block||!schema||!safeKey(parameter.key)||inputs.some(i=>i.key===parameter.key))throw new TestingModelError('Ein vorgeschlagener Parameter ist unbekannt oder mehrfach benannt.');
    const value=block.inputs[parameter.input]??schema.default;if(value===undefined)throw new TestingModelError(`„${schema.label}“ hat noch keinen Ausgangswert.`);
    const resolved=resolveOuter(value,outerValues);let hasReference=false;values(resolved,v=>{if(isTestingReference(v))hasReference=true;});
    // The library default belongs to the new definition. Only its replacement instance may still refer to the old parent context.
    const {default:_previousDefault,...inputSchema}=clone(schema);
    const needsExplicitValue=hasReference||schema.default===undefined;
    inputs.push({...inputSchema,key:parameter.key,label:parameter.label,...(!needsExplicitValue?{default:resolved}:{}),...(needsExplicitValue?{required:true}:{})});replacementInputs[parameter.key]=clone(value);block.inputs[parameter.input]={param:parameter.key};
  }
  const localAliases=new Map<string,{key:string;type:TestingBlockDefinition['outputs'][number]['type']}>();
  const knownAliases=new Map<string,TestingBlockDefinition['outputs'][number]['type']>();
  function collectAliases(blocks:TestingBlockInstance[],target:Map<string,TestingBlockDefinition['outputs'][number]['type']>) {for(const block of blocks){const definition=defs.get(testingVersionKey(block.definition));for(const output of definition?.outputs??[])target.set(block.outputs?.[output.key]??`${block.id}.${output.key}`,output.type);if(definition?.kind==='context')collectAliases(block.children??[],target);}}
  collectAliases(scenario.blocks,knownAliases);for(const ancestor of enclosing)collectAliases(ancestor.children??[],knownAliases);collectAliases(siblings.slice(0,positions[0]),knownAliases);
  const bodyAliases=new Map<string,TestingBlockDefinition['outputs'][number]['type']>();collectAliases(body,bodyAliases);
  for(const [alias,type] of bodyAliases)localAliases.set(alias,{key:alias,type});
  const flatten=(blocks:TestingBlockInstance[]):TestingBlockInstance[]=>blocks.flatMap(block=>[block,...flatten(block.children??[])]);
  // Parameters captured from an enclosing workflow become explicit inputs of the new workflow.
  for(const block of flatten(body))for(const value of Object.values(block.inputs))values(value,v=>{
    if(!isTestingParameter(v)||inputs.some(i=>i.key===v.param))return;
    const schema=outerSchemas.get(v.param);if(!schema||!Object.hasOwn(outerValues,v.param))throw new TestingModelError(`Der äußere Parameter „${v.param}“ muss vor der Wiederverwendung ausdrücklich belegt werden.`);
    const resolved=resolveOuter(outerValues[v.param],outerValues);let hasReference=false;values(resolved,item=>{if(isTestingReference(item))hasReference=true;});
    const {default:_previousDefault,...inputSchema}=clone(schema);
    const needsExplicitValue=hasReference||schema.default===undefined;
    inputs.push({...inputSchema,key:v.param,...(!needsExplicitValue?{default:resolved}:{}),...(needsExplicitValue?{required:true}:{})});replacementInputs[v.param]={param:v.param};
  });
  // References supplied by the surrounding flow become required workflow parameters.
  for(const block of flatten(body)) for(const value of Object.values(block.inputs)) values(value,v=>{
    if(!isTestingReference(v)||localAliases.has(v.ref)||inputs.some(i=>i.key===`ref_${v.ref.replace(/[^a-zA-Z0-9_]/g,'_')}`))return;
    const key=`ref_${v.ref.replace(/[^a-zA-Z0-9_]/g,'_')}`;
    const type=knownAliases.get(v.ref)??v.type;if(!type)throw new TestingModelError(`Der Typ des externen Ergebnisses „${v.ref}“ ist nicht eindeutig. Verbinde es vor der Wiederverwendung.`);
    inputs.push({key,label:`Vorhandenes Ergebnis: ${v.ref}`,type,required:true});replacementInputs[key]=clone(v);
    for(const nested of flatten(body)) nested.inputs=Object.fromEntries(Object.entries(nested.inputs).map(([field,current])=>[field,mapValues(current,x=>isTestingReference(x)&&x.ref===v.ref?{param:key}:x)]));
  });
  const outputs=[...localAliases].map(([alias,value],index)=>({key:`ergebnis${index+1}`,label:alias,type:value.type}));
  const exports=Object.fromEntries([...localAliases.keys()].map((alias,index)=>[`ergebnis${index+1}`,{ref:alias}]));
  const knowledgeRefs=[...new Set(body.flatMap(b=>defs.get(testingVersionKey(b.definition))?.knowledgeRefs??[]))];
  const definition:TestingBlockDefinition={id:`ablauf.${randomUUID()}`,version:'1.0.0',name:request.name,description:request.description,kind:'workflow',category:'Wiederverwendung',semanticKey:`workflow.${request.name.toLocaleLowerCase('de-DE').replace(/[^\p{L}\p{N}]+/gu,'.')}`,inputs,outputs,body,exports,knowledgeRefs,preconditions:['Die erforderlichen Parameter sind belegt.'],postconditions:[request.description||request.name],status:'draft',createdAt:now(),origin:'human'};
  const duplicateReport=findTestingDuplicates(definition,catalog);
  const reusesExisting=duplicateReport.decision==='reuse'&&!!duplicateReport.chosen;
  const selectedDefinition=reusesExisting?defs.get(testingVersionKey(duplicateReport.chosen!))!:definition;
  let saved=scenario;
  if(request.replaceSelection) {
    const replacement:TestingBlockInstance={id:`wiederverwendung-${randomUUID()}`,definition:{id:selectedDefinition.id,version:selectedDefinition.version},inputs:replacementInputs,outputs:Object.fromEntries([...localAliases.keys()].map((alias,index)=>[`ergebnis${index+1}`,alias]))};
    const replaced=[...siblings.slice(0,positions[0]),replacement,...siblings.slice(positions.at(-1)!+1)];
    if(parent)parent.children=replaced;else scenario.blocks=replaced;
    const candidateCatalog=reusesExisting?getTestingCatalog():{...getTestingCatalog(),definitions:[...getTestingCatalog().definitions,definition]};
    const matrixIssues=validateTestingMatrix(scenario,candidateCatalog);
    if(matrixIssues.length)throw new TestingModelError(`Die Wiederverwendung würde Matrixziele ungültig machen. Ordne die betroffenen Matrixspalten zuerst neu zu: ${matrixIssues.map(item=>item.message).join(' ')}`,409,'MATRIX_TARGET_STALE');
  }
  const persistedDefinition=reusesExisting?selectedDefinition:saveTestingDefinition(definition);
  if(request.replaceSelection)saved=saveTestingScenario(scenario,scenario.revision);
  return {definition:persistedDefinition,scenario:saved,duplicateReport};
}

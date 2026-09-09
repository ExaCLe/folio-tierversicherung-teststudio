import { createHash } from 'node:crypto';
import type { TestingBlockDefinition, TestingBlockInstance, TestingCatalog, TestingDefaultDecision, TestingDefinitionChangePreview, TestingDefinitionChangeRequest, TestingDefinitionScenarioChange, TestingInput, TestingScenario, TestingTechnicalBinding, TestingValidationIssue, TestingValue } from '../../shared/testing';
import { compareTestingVersions, currentTestingChildren, currentTestingDefinition, isTestingParameter, testingValueTypeLabels } from '../../shared/testing';
import { compileTestingScenario, effectiveTestingOperation, stableTestingStringify, testingBusinessDependencies, testingFingerprint } from './compiler';
import { scenarioForTestingMatrixRow } from './matrix';
import { TestingModelError } from './repository';

const clone=<T>(value:T):T=>structuredClone(value);
const same=(a:unknown,b:unknown)=>stableTestingStringify(a)===stableTestingStringify(b);
const hash=(value:unknown)=>createHash('sha256').update(stableTestingStringify(value)).digest('hex');
const catalogFingerprint=(catalog:TestingCatalog)=>hash({definitions:catalog.definitions,knowledge:catalog.knowledge,bindings:catalog.bindings});
export const fieldDecisionKey=(scenarioId:string,path:string,key:string)=>`${scenarioId}:${path}:${key}`;
const rowDecisionKey=(scenarioId:string,rowId:string,path:string,key:string)=>`${fieldDecisionKey(scenarioId,path,key)}:zeile:${rowId}`;
const schemaByKey=(inputs:TestingInput[])=>new Map(inputs.map(input=>[input.key,input]));
const own=(value:object,key:PropertyKey)=>Object.hasOwn(value,key);

function withCandidate(catalog:TestingCatalog,definition:TestingBlockDefinition,newKnowledge:TestingCatalog['knowledge']):TestingCatalog {
  const knowledge=new Map(catalog.knowledge.map(document=>[`${document.id}@${document.revision}`,document]));
  for(const document of newKnowledge)knowledge.set(`${document.id}@${document.revision}`,document);
  return {...catalog,definitions:[...catalog.definitions.filter(item=>!(item.id===definition.id&&item.version===definition.version)),definition],knowledge:[...knowledge.values()]};
}
function executionSemantics(scenario:TestingScenario,catalog:TestingCatalog) {
  return compileTestingScenario(scenario,catalog).steps.map(step=>({path:step.path,kind:step.kind,operation:step.operation,actor:step.actor,inputs:step.inputs,outputs:step.outputs}));
}
const errorKey=(issue:TestingValidationIssue)=>`${issue.code}:${issue.path??''}:${issue.field??''}:${issue.instanceId??''}`;
function newErrors(before:TestingScenario,beforeCatalog:TestingCatalog,after:TestingScenario,afterCatalog:TestingCatalog) {
  const existing=new Set(compileTestingScenario(before,beforeCatalog).issues.filter(issue=>issue.severity==='error').map(errorKey));
  return compileTestingScenario(after,afterCatalog).issues.filter(issue=>issue.severity==='error'&&!existing.has(errorKey(issue)));
}

type Resolution=NonNullable<TestingDefinitionChangeRequest['valueResolutions']>[string];
interface OverrideOwner {block:TestingBlockInstance;relativePath:string}
interface MigrationContext {
  scenarioId:string;rowId?:string;source:TestingBlockDefinition;target:TestingBlockDefinition;oldCatalog:TestingCatalog;
  decisions:Record<string,TestingDefaultDecision>;resolutions:NonNullable<TestingDefinitionChangeRequest['valueResolutions']>;fullMatrixTargets:Set<string>;
  changes:TestingDefinitionScenarioChange['changes'];diagnostics:TestingValidationIssue[];paths:Set<string>;directPaths:Set<string>;transitivePaths:Set<string>;storageChanged:boolean;
}
function decisionFor<T>(values:Record<string,T>,context:MigrationContext,path:string,key:string):T|undefined {
  return (context.rowId?values[rowDecisionKey(context.scenarioId,context.rowId,path,key)]:undefined)??values[fieldDecisionKey(context.scenarioId,path,key)]??values[key];
}
function setOverride(owner:OverrideOwner,key:string,value:TestingValue) {const overrides=owner.block.overrides??={};const fields=overrides[owner.relativePath]??={};fields[key]=clone(value);}
function deleteOverride(owner:OverrideOwner,key:string) {const fields=owner.block.overrides?.[owner.relativePath];if(!fields||!own(fields,key))return;delete fields[key];if(!Object.keys(fields).length)delete owner.block.overrides![owner.relativePath];if(!Object.keys(owner.block.overrides!).length)delete owner.block.overrides;}
function editInheritedBlock(owner:OverrideOwner,catalog:TestingCatalog,edit:(block:TestingBlockInstance)=>void) {
  const segments=owner.relativePath.split('/');
  const visit=(container:TestingBlockInstance,index:number) => {
    const children=clone(currentTestingChildren(container,catalog)),child=children.find(item=>item.id===segments[index]);
    if(!child)return;
    if(index===segments.length-1)edit(child);else visit(child,index+1);
    container.children=children;
  };
  visit(owner.block,0);
}

function applyResolution(resolution:Resolution,original:TestingBlockInstance,migrated:TestingBlockInstance,owner:OverrideOwner|undefined,oldKey:string,previous:TestingValue|undefined,newInputs:Map<string,TestingInput>,context:MigrationContext,path:string,label:string) {
  const explicitlyStored=own(original.inputs,oldKey)||!!owner&&own(owner.block.overrides?.[owner.relativePath]??{},oldKey);
  if((resolution.action==='feld-verwerfen'||resolution.action==='feld-zuordnen')&&!explicitlyStored){context.diagnostics.push({code:'RESOLUTION_NOT_EXPLICIT',severity:'error',instanceId:original.id,path,field:oldKey,message:`„${label}“ kann nur verworfen oder zugeordnet werden, wenn der Testfall dafür einen ausdrücklichen Wert speichert.`});return;}
  if(resolution.action==='feld-zuordnen'&&(!newInputs.has(resolution.targetField)||resolution.targetField===oldKey)){context.diagnostics.push({code:'RESOLUTION_TARGET_INVALID',severity:'error',instanceId:original.id,path,field:oldKey,message:`Das Zielfeld für „${label}“ ist in der neuen Definition nicht vorhanden.`});return;}
  if(owner)deleteOverride(owner,oldKey);else delete migrated.inputs[oldKey];
  if(resolution.action==='wert-setzen') {
    if(owner)setOverride(owner,oldKey,resolution.value);else migrated.inputs[oldKey]=clone(resolution.value);
    context.changes.push({path,field:oldKey,label,before:clone(previous),after:clone(resolution.value),reason:'Der Wert wird für das geänderte Feld ausdrücklich festgelegt.'});
  } else if(resolution.action==='feld-zuordnen') {
    if(previous===undefined){context.diagnostics.push({code:'RESOLUTION_VALUE_MISSING',severity:'error',instanceId:original.id,path,field:oldKey,message:`Für „${label}“ ist kein Wert zur Zuordnung vorhanden.`});return;}
    if(owner)setOverride(owner,resolution.targetField,previous);else migrated.inputs[resolution.targetField]=clone(previous);
    context.changes.push({path,field:oldKey,label,before:clone(previous),after:clone(previous),reason:`Der ausdrückliche Wert wird dem neuen Feld „${newInputs.get(resolution.targetField)!.label}“ zugeordnet.`});
  } else context.changes.push({path,field:oldKey,label,before:clone(previous),reason:'Der ausdrücklich gespeicherte Wert wird nach deiner Wahl verworfen.'});
  context.storageChanged=true;
}

function processTarget(original:TestingBlockInstance,migrated:TestingBlockInstance,path:string,incomingOverrides:Record<string,Record<string,TestingValue>>,incomingOwners:Record<string,OverrideOwner>,owner:OverrideOwner|undefined,context:MigrationContext) {
  const oldInputs=schemaByKey(context.source.inputs),newInputs=schemaByKey(context.target.inputs),activeOverride=incomingOverrides[original.id]??{};
  context.paths.add(path);(owner?context.transitivePaths:context.directPaths).add(path);
  for(const [key,oldInput] of oldInputs) {
    const next=newInputs.get(key),inputExplicit=own(original.inputs,key),overrideExplicit=own(activeOverride,key),explicit=inputExplicit||overrideExplicit,storageOwner=overrideExplicit?incomingOwners[original.id]:owner;
    const previous=overrideExplicit?activeOverride[key]:inputExplicit?original.inputs[key]:oldInput.default;
    const resolution=decisionFor(context.resolutions,context,path,key);
    if(!next) {
      if(resolution&&owner&&inputExplicit&&(resolution.action==='feld-verwerfen'||resolution.action==='feld-zuordnen')) {
        if(resolution.action==='feld-zuordnen'&&(!newInputs.has(resolution.targetField)||previous===undefined))context.diagnostics.push({code:'RESOLUTION_TARGET_INVALID',severity:'error',instanceId:original.id,path,field:key,message:`Das Zielfeld für „${oldInput.label}“ ist ungültig oder der bisherige Wert fehlt.`});
        else {if(overrideExplicit&&storageOwner)deleteOverride(storageOwner,key);editInheritedBlock(owner,context.oldCatalog,block=>{delete block.inputs[key];if(resolution.action==='feld-zuordnen')block.inputs[resolution.targetField]=clone(previous!);});context.storageChanged=true;context.changes.push({path,field:key,label:oldInput.label,before:clone(previous),...(resolution.action==='feld-zuordnen'?{after:clone(previous)}:{}),reason:resolution.action==='feld-zuordnen'?`Der ausdrückliche Wert wird dem neuen Feld „${newInputs.get(resolution.targetField)!.label}“ zugeordnet.`:'Der ausdrücklich gespeicherte Wert wird nach deiner Wahl verworfen.',source:overrideExplicit?'override':'ausdruecklich'});}
      }
      else if(resolution)applyResolution(resolution,original,migrated,storageOwner,key,previous,newInputs,context,path,oldInput.label);
      else if(explicit)context.diagnostics.push({code:'INPUT_REMOVED',severity:'error',instanceId:original.id,path,field:key,message:`Das Feld „${oldInput.label}“ wurde entfernt, ist in diesem Testfall aber ausdrücklich belegt. Verwirf den Wert oder ordne ihn geprüft einem neuen Feld zu.`});
      continue;
    }
    if(resolution?.action==='wert-setzen'){applyResolution(resolution,original,migrated,storageOwner,key,previous,newInputs,context,path,next.label);continue;}
    if(resolution){context.diagnostics.push({code:'RESOLUTION_ACTION_INVALID',severity:'error',instanceId:original.id,path,field:key,message:`„${next.label}“ ist weiterhin vorhanden; dafür kann nur ein neuer ausdrücklicher Wert festgelegt werden.`});continue;}
    if(context.fullMatrixTargets.has(`${path}::${key}`))continue;
    if(next.type!==oldInput.type&&previous!==undefined){context.diagnostics.push({code:'INPUT_TYPE_CHANGED',severity:'error',instanceId:original.id,path,field:key,message:`„${oldInput.label}“ wechselt von „${testingValueTypeLabels[oldInput.type]}“ zu „${testingValueTypeLabels[next.type]}“. Lege einen geprüften Wert des neuen Typs fest.`});continue;}
    // Equality with a former default never turns an explicit input or override
    // back into inheritance. A user may deliberately opt one concrete use into
    // the new default, but a broad input-key decision must never rewrite it.
    if(explicit) {
      const specificDecision=context.decisions[fieldDecisionKey(context.scenarioId,path,key)];
      const defaultChanged=oldInput.default!==undefined&&next.default!==undefined&&!same(oldInput.default,next.default);
      if(specificDecision==='neuen-standard-uebernehmen'&&defaultChanged&&same(previous,oldInput.default)) {
        // An inherited definition-body literal can sit underneath the current
        // override. Pin the selected new value at the scenario-owned seam;
        // deleting there would reveal that old shared literal again.
        if(storageOwner)setOverride(storageOwner,key,next.default!);else delete migrated.inputs[key];
        context.storageChanged=true;context.changes.push({path,field:key,label:next.label,before:clone(previous),after:clone(next.default!),reason:'Der ausdrücklich gesetzte bisherige Standardwert wird für diese Verwendung nach deiner Wahl durch den neuen Standard ersetzt.'});
      } else if(defaultChanged&&same(previous,oldInput.default)) {
        context.changes.push({path,field:key,label:next.label,before:clone(previous),after:clone(previous),reason:'Der ausdrücklich gesetzte Wert bleibt erhalten; diese konkrete Verwendung kann auf Wunsch den neuen Standard übernehmen.',decisionKey:fieldDecisionKey(context.scenarioId,path,key),decisionRequired:false,source:overrideExplicit?'override':isTestingParameter(previous)?'parameter':'ausdruecklich'});
      }
      continue;
    }
    const removed=oldInput.default!==undefined&&next.default===undefined;
    const changed=oldInput.default!==undefined&&next.default!==undefined&&!same(oldInput.default,next.default);
    if(removed) {
      if(owner)setOverride(owner,key,oldInput.default!);else migrated.inputs[key]=clone(oldInput.default!);
      context.storageChanged=true;context.changes.push({path,field:key,label:next.label,before:clone(oldInput.default!),after:clone(oldInput.default!),reason:'Der bisher geerbte Standardwert wird ausdrücklich im Testfall gespeichert.'});
    } else if(changed) {
      const decision=decisionFor(context.decisions,context,path,key);
      if(!decision){context.diagnostics.push({code:'DEFAULT_DECISION_REQUIRED',severity:'error',instanceId:original.id,path,field:key,message:`Entscheide für „${next.label}“, ob dieser Testfall den neuen Standard übernimmt oder den bisherigen Wert behält.`});context.changes.push({path,field:key,label:next.label,before:clone(oldInput.default!),after:clone(next.default!),reason:'Der geänderte Standard braucht eine Entscheidung für diesen Testfall.',decisionKey:fieldDecisionKey(context.scenarioId,path,key),decisionRequired:true,source:'standard'});}
      else if(decision==='bisherigen-wert-beibehalten') {if(owner)setOverride(owner,key,oldInput.default!);else migrated.inputs[key]=clone(oldInput.default!);context.storageChanged=true;context.changes.push({path,field:key,label:next.label,before:clone(oldInput.default!),after:clone(oldInput.default!),reason:'Der bisher geerbte Standardwert wird nach deiner Wahl ausdrücklich gespeichert.'});}
      else context.changes.push({path,field:key,label:next.label,before:clone(oldInput.default!),after:clone(next.default!),reason:'Der Testfall übernimmt nach deiner Wahl den neuen Standardwert.'});
    }
  }
  for(const next of context.target.inputs) {
    if(oldInputs.has(next.key)||!next.required||next.default!==undefined)continue;
    if(own(original.inputs,next.key)||own(activeOverride,next.key)||context.fullMatrixTargets.has(`${path}::${next.key}`))continue;
    const resolution=decisionFor(context.resolutions,context,path,next.key);
    if(resolution?.action==='wert-setzen'){if(owner)setOverride(owner,next.key,resolution.value);else migrated.inputs[next.key]=clone(resolution.value);context.storageChanged=true;context.changes.push({path,field:next.key,label:next.label,after:clone(resolution.value),reason:'Das neue Pflichtfeld wird ausdrücklich im Testfall belegt.'});}
    else context.diagnostics.push({code:'NEW_REQUIRED_INPUT',severity:'error',instanceId:original.id,path,field:next.key,message:`Für das neue Pflichtfeld „${next.label}“ fehlt ein Wert. Lege ihn für diesen Testfall ausdrücklich fest.`});
  }
}

function childOverrides(block:TestingBlockInstance,incoming:Record<string,Record<string,TestingValue>>,incomingOwners:Record<string,OverrideOwner>) {
  const result:Record<string,Record<string,TestingValue>>=clone(block.overrides??{});
  const owners:Record<string,OverrideOwner>=Object.fromEntries(Object.keys(block.overrides??{}).map(relative=>[relative,{block,relativePath:relative}]));
  for(const [overridePath,values] of Object.entries(incoming))if(overridePath.startsWith(`${block.id}/`)){const relative=overridePath.slice(block.id.length+1);result[relative]={...result[relative],...values};owners[relative]=incomingOwners[overridePath];}
  return {values:result,owners};
}
function migrateStoredBlock(original:TestingBlockInstance,path:string,incomingOverrides:Record<string,Record<string,TestingValue>>,incomingOwners:Record<string,OverrideOwner>,inheritedOwner:OverrideOwner|undefined,context:MigrationContext,active:string[]=[]):TestingBlockInstance {
  const migrated=clone(original),definition=currentTestingDefinition(context.oldCatalog,original.definition);
  if(original.definition.id===context.target.id)processTarget(original,migrated,path,incomingOverrides,incomingOwners,inheritedOwner,context);
  if(!definition||!['workflow','context'].includes(definition.kind))return migrated;
  const definitionKey=`${definition.id}@${definition.version}`;if(active.includes(definitionKey))return migrated;
  const overrides=childOverrides(migrated,incomingOverrides,incomingOwners);
  if(original.children)migrated.children=original.children.map(child=>migrateStoredBlock(child,`${path}/${child.id}`,overrides.values,overrides.owners,undefined,context,[...active,definitionKey]));
  else for(const child of currentTestingChildren(original,context.oldCatalog)) {
    const owner=inheritedOwner?{block:inheritedOwner.block,relativePath:`${inheritedOwner.relativePath}/${child.id}`}:{block:migrated,relativePath:child.id};
    migrateStoredBlock(child,`${path}/${child.id}`,overrides.values,overrides.owners,owner,context,[...active,definitionKey]);
  }
  return migrated;
}
function fullMatrixTargets(scenario:TestingScenario) {
  const enabled=scenario.matrix?.rows.filter(row=>row.enabled)??[];if(!enabled.length)return new Set<string>();
  return new Set((scenario.matrix?.columns??[]).filter(column=>!column.target.inputPath.includes('.')&&enabled.every(row=>own(row.values,column.id))).map(column=>`${column.target.blockPath}::${column.target.inputPath}`));
}
function migrateScenario(scenario:TestingScenario,source:TestingBlockDefinition,target:TestingBlockDefinition,oldCatalog:TestingCatalog,decisions:Record<string,TestingDefaultDecision>,resolutions:NonNullable<TestingDefinitionChangeRequest['valueResolutions']>,rowId?:string) {
  const context:MigrationContext={scenarioId:scenario.id,...(rowId?{rowId}:{}),source,target,oldCatalog,decisions,resolutions,fullMatrixTargets:fullMatrixTargets(scenario),changes:[],diagnostics:[],paths:new Set(),directPaths:new Set(),transitivePaths:new Set(),storageChanged:false};
  const migrated={...clone(scenario),blocks:scenario.blocks.map(block=>migrateStoredBlock(block,block.id,{},{},undefined,context))};return {scenario:migrated,context};
}
function updateStoredDefinitionRefs(blocks:TestingBlockInstance[],id:string,version:string,nextCatalog:TestingCatalog):TestingBlockInstance[] {
  return blocks.map(block=>{
    const copy=clone(block),isTarget=copy.definition.id===id;
    // A materialized body must complete its three-way reconciliation while the
    // stored ref still identifies the old base. Stamping first would make the
    // local body look current and permanently retain stale shared steps.
    const children=copy.children?(isTarget?currentTestingChildren(copy,nextCatalog):copy.children):undefined;
    return {...copy,...(isTarget?{definition:{id,version}}:{}),...(children!==undefined?{children:updateStoredDefinitionRefs(children,id,version,nextCatalog)}:{})};
  });
}
const technicalInputContract=(input:TestingInput):unknown=>({key:input.key,type:input.type,required:input.required,options:input.options,fields:input.fields?.map(technicalInputContract),minimum:input.minimum,maximum:input.maximum,extensible:input.extensible,requiredWhen:input.requiredWhen,applicableWhen:input.applicableWhen});
const technicalDefinitionContract=(definition:TestingBlockDefinition)=>({kind:definition.kind,bindingId:definition.bindingId,operation:effectiveTestingOperation(definition),inputs:definition.inputs.map(technicalInputContract),outputs:definition.outputs.map(output=>({key:output.key,type:output.type}))});
/** The one compatibility gate used by both preview and atomic binding renewal. */
export function compatibleDefinitionChangeBinding(source:TestingBlockDefinition,target:TestingBlockDefinition,catalog:TestingCatalog):TestingTechnicalBinding|undefined {
  if(!['action','assertion'].includes(source.kind)||!['action','assertion'].includes(target.kind)||!same(technicalDefinitionContract(source),technicalDefinitionContract(target)))return;
  const candidates=catalog.bindings.filter(binding=>binding.status==='ready'&&binding.definitionRefs.some(ref=>ref.id===source.id&&ref.version===source.version)&&(source.bindingId?binding.id===source.bindingId:binding.operation===effectiveTestingOperation(source)));
  const ids=[...new Set(candidates.map(binding=>binding.id))];if(ids.length!==1)return;
  return candidates.filter(binding=>binding.id===ids[0]).sort((a,b)=>b.revision-a.revision)[0];
}
function technicalPreparation(source:TestingBlockDefinition,target:TestingBlockDefinition,catalog:TestingCatalog):TestingDefinitionChangePreview['technicalPreparation'] {
  if(!['action','assertion'].includes(target.kind))return undefined;
  const bindingId=source.bindingId??target.bindingId,binding=compatibleDefinitionChangeBinding(source,target,catalog);
  if(binding)return {status:'wiederverwendbar',bindingId:binding.id,reason:'Der vollständige technische Vertrag aus Vorgang, Eingaben und Ergebnissen bleibt unverändert.'};
  const previous=catalog.bindings.some(item=>item.status==='ready'&&item.definitionRefs.some(ref=>ref.id===source.id&&ref.version===source.version));
  return {status:'neu-zu-pruefen',...(bindingId?{bindingId}:{}),reason:previous?'Der technische Vertrag aus Vorgang, Eingaben oder Ergebnissen hat sich geändert oder ist nicht eindeutig zugeordnet.':'Für die neue Definition ist noch keine ausführbare technische Bindung vorhanden.'};
}

export function previewDefinitionChange(input:TestingDefinitionChangeRequest,catalog:TestingCatalog,scenarios:TestingScenario[]):TestingDefinitionChangePreview {
  const target=clone(input.definition),source=currentTestingDefinition(catalog,target.id);
  if(!source)throw new TestingModelError('Für eine neue Blockdefinition ist keine globale Änderungsprüfung erforderlich.',400,'DEFINITION_CHANGE_NOT_REQUIRED');
  if(!target.supersedes||target.supersedes.id!==source.id||target.supersedes.version!==source.version)throw new TestingModelError('Die neue Version muss unmittelbar auf der aktuellsten Definitionsversion aufbauen.',409,'DEFINITION_SOURCE_STALE');
  if(compareTestingVersions(target.version,source.version)<=0)throw new TestingModelError('Die neue semantische Definitionsversion muss höher als die aktuelle Version sein.',409,'DEFINITION_VERSION_STALE');
  if([...Object.keys(input.defaultDecisions??{}),...Object.keys(input.valueResolutions??{})].some(key=>key.includes(':zeile:')))throw new TestingModelError('Abweichende Entscheidungen pro Matrixzeile können noch nicht sicher in der gespeicherten Matrix abgebildet werden. Wähle eine Entscheidung für den gesamten Testfall oder bearbeite die Matrixwerte.',400,'MATRIX_ROW_RESOLUTION_UNSUPPORTED');
  const newKnowledge=clone(input.newKnowledge??[]),nextCatalog=withCandidate(catalog,target,newKnowledge),decisions=clone(input.defaultDecisions??{}),resolutions=clone(input.valueResolutions??{}),results:TestingDefinitionScenarioChange[]=[];
  for(const scenario of scenarios) {
    if(!testingBusinessDependencies(scenario,catalog).definitions.some(definition=>definition.id===target.id))continue;
    const migrated=migrateScenario(scenario,source,target,catalog,decisions,resolutions);if(!migrated.context.paths.size)continue;
    const deltaErrors=newErrors(scenario,catalog,migrated.scenario,nextCatalog),diagnostics=[...migrated.context.diagnostics,...deltaErrors.filter(issue=>!migrated.context.diagnostics.some(existing=>errorKey(existing)===errorKey(issue)))];
    let behavior:TestingDefinitionScenarioChange['behavior']=diagnostics.length?'nicht-anwendbar':same(executionSemantics(scenario,catalog),executionSemantics(migrated.scenario,nextCatalog))?'fachlich-unveraendert':'testdefinition-aendern';
    const matrixRows:TestingDefinitionScenarioChange['matrixRows']=[];
    if(scenario.matrix)for(const row of scenario.matrix.rows.filter(item=>item.enabled))try {
      const before=scenarioForTestingMatrixRow(scenario,catalog,row.id),rowMigration=migrateScenario(scenario,source,target,catalog,decisions,resolutions,row.id);
      const after=scenarioForTestingMatrixRow(rowMigration.scenario,nextCatalog,row.id),afterErrors=newErrors(before,catalog,after,nextCatalog);
      const rowDiagnostics=[...rowMigration.context.diagnostics,...afterErrors.filter(issue=>!rowMigration.context.diagnostics.some(existing=>errorKey(existing)===errorKey(issue)))];
      const rowBehavior:TestingDefinitionScenarioChange['behavior']=rowDiagnostics.length?'nicht-anwendbar':same(executionSemantics(before,catalog),executionSemantics(after,nextCatalog))?'fachlich-unveraendert':'testdefinition-aendern';
      matrixRows.push({rowId:row.id,rowLabel:row.label,behavior:rowBehavior,changes:rowMigration.context.changes,diagnostics:rowDiagnostics});
    } catch(cause) {matrixRows.push({rowId:row.id,rowLabel:row.label,behavior:'nicht-anwendbar',diagnostics:[{code:'MATRIX_ROW_INVALID',severity:'error',message:cause instanceof Error?cause.message:'Die Matrixzeile konnte nicht geprüft werden.'}]});}
    if(matrixRows.length)behavior=matrixRows.some(row=>row.behavior==='nicht-anwendbar')?'nicht-anwendbar':matrixRows.some(row=>row.behavior==='testdefinition-aendern')?'testdefinition-aendern':'fachlich-unveraendert';
    const affectedCaseCount=scenario.matrix?matrixRows.length:1,changedCaseCount=scenario.matrix?matrixRows.filter(row=>row.behavior==='testdefinition-aendern').length:behavior==='testdefinition-aendern'?1:0,blockedCaseCount=scenario.matrix?matrixRows.filter(row=>row.behavior==='nicht-anwendbar').length:behavior==='nicht-anwendbar'?1:0;
    results.push({scenarioId:scenario.id,title:scenario.title,revision:scenario.revision,direct:migrated.context.directPaths.size>0,instancePaths:[...migrated.context.paths],directPaths:[...migrated.context.directPaths],transitivePaths:[...migrated.context.transitivePaths],behavior,changes:migrated.context.changes,matrixRows,diagnostics,affectedCaseCount,changedCaseCount,blockedCaseCount});
  }
  const fingerprint=catalogFingerprint(catalog),sourceRef={id:source.id,version:source.version},targetRef={id:target.id,version:target.version};
  const id=hash({fingerprint,source:sourceRef,target,newKnowledge,decisions,resolutions,scenarios:results.map(item=>({id:item.scenarioId,revision:item.revision,fingerprint:testingFingerprint(scenarios.find(scenario=>scenario.id===item.scenarioId)!,catalog)}))});
  const affectedCaseCount=results.reduce((sum,item)=>sum+item.affectedCaseCount,0),changedCaseCount=results.reduce((sum,item)=>sum+item.changedCaseCount,0),blockedCaseCount=results.reduce((sum,item)=>sum+item.blockedCaseCount,0);
  return {id,catalogFingerprint:fingerprint,source:sourceRef,target:targetRef,definition:target,newKnowledge,defaultDecisions:decisions,valueResolutions:resolutions,scenarios:results,affectedScenarioCount:results.length,changedScenarioCount:results.filter(item=>item.behavior==='testdefinition-aendern').length,unchangedScenarioCount:results.filter(item=>item.behavior==='fachlich-unveraendert').length,blocked:results.some(item=>item.behavior==='nicht-anwendbar'),affectedCaseCount,changedCaseCount,unchangedCaseCount:affectedCaseCount-changedCaseCount-blockedCaseCount,blockedCaseCount,technicalPreparation:technicalPreparation(source,target,catalog)};
}

/** Return only scenarios whose stored test definition must change. */
export function migrateDefinitionScenarios(preview:TestingDefinitionChangePreview,catalog:TestingCatalog,scenarios:TestingScenario[]):TestingScenario[] {
  const source=currentTestingDefinition(catalog,preview.source.id);if(!source)throw new TestingModelError('Die Ausgangsdefinition ist nicht mehr vorhanden.',409,'DEFINITION_SOURCE_STALE');
  const nextCatalog=withCandidate(catalog,preview.definition,preview.newKnowledge);
  const selected=new Map(preview.scenarios.map(item=>[item.scenarioId,item])),result:TestingScenario[]=[];
  for(const scenario of scenarios) {
    const change=selected.get(scenario.id);if(!change)continue;
    const migration=migrateScenario(scenario,source,preview.definition,catalog,preview.defaultDecisions,preview.valueResolutions);
    if(!migration.context.storageChanged&&change.behavior!=='testdefinition-aendern')continue;
    result.push({...migration.scenario,blocks:updateStoredDefinitionRefs(migration.scenario.blocks,preview.definition.id,preview.definition.version,nextCatalog)});
  }
  return result;
}

export {catalogFingerprint};

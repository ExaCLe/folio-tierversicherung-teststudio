import { createHash } from 'node:crypto';
import type { TestingApproval, TestingBlockDefinition, TestingBlockInstance, TestingCatalog, TestingCompiledScenario, TestingCompiledStep, TestingDuplicateReport, TestingInput, TestingScenario, TestingTechnicalBinding, TestingValidationIssue, TestingValue, TestingValueType, TestingVersionRef } from '../../shared/testing';
import { isTestingParameter, isTestingReference, testingVersionKey, testingValueTypeLabels } from '../../shared/testing';
import { scenarioForTestingMatrixRow, validateTestingMatrix } from './matrix';

export function stableTestingStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableTestingStringify).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([,v]) => v !== undefined).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${JSON.stringify(k)}:${stableTestingStringify(v)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
const hash = (value: unknown) => createHash('sha256').update(stableTestingStringify(value)).digest('hex');
export const effectiveTestingOperation = (definition: TestingBlockDefinition): string => definition.operation ?? definition.semanticKey;
const definitionMap = (catalog: TestingCatalog) => new Map(catalog.definitions.map(d => [testingVersionKey(d), d]));
function latestKnowledge(catalog: TestingCatalog) {
  const docs = new Map<string, TestingCatalog['knowledge'][number]>();
  for (const doc of catalog.knowledge) if ((docs.get(doc.id)?.revision ?? -1) < doc.revision) docs.set(doc.id, doc);
  return docs;
}
export function testingBusinessDependencies(scenario: TestingScenario, catalog: TestingCatalog) {
  const map = definitionMap(catalog); const definitions = new Map<string, TestingBlockDefinition>();
  const knowledgeIds = new Set(scenario.knowledgeRefs); const seenPaths = new Set<string>();
  function walk(blocks: TestingBlockInstance[], active: string[]) {
    for (const block of blocks) {
      const key = testingVersionKey(block.definition); const definition = map.get(key);
      if (!definition) continue;
      definitions.set(key, definition); definition.knowledgeRefs.forEach(id => knowledgeIds.add(id));
      if (active.includes(key)) continue;
      // A definition's full body remains review-relevant even when an instance overrides it.
      if (definition.body && !seenPaths.has(key)) { seenPaths.add(key); walk(definition.body, [...active,key]); }
      if (block.children) walk(block.children, [...active,key]);
    }
  }
  walk(scenario.blocks, []);
  const latest = latestKnowledge(catalog); const queue = [...knowledgeIds];
  for (let i = 0; i < queue.length; i++) for (const related of latest.get(queue[i])?.relatedKnowledge ?? []) {
    // Technical knowledge is deliberately excluded from business approval.
    if (latest.get(related)?.kind !== 'technical' && !knowledgeIds.has(related)) { knowledgeIds.add(related); queue.push(related); }
  }
  return { definitions: [...definitions.values()].sort((a,b) => testingVersionKey(a).localeCompare(testingVersionKey(b))),
    knowledge: [...knowledgeIds].map(id => latest.get(id)).filter((d): d is NonNullable<typeof d> => !!d && d.kind !== 'technical').sort((a,b) => a.id.localeCompare(b.id)),
    missingKnowledge: [...knowledgeIds].filter(id => !latest.has(id)) };
}
export function testingFingerprint(scenario: TestingScenario, catalog: TestingCatalog): string {
  const deps = testingBusinessDependencies(scenario,catalog);
  const { createdAt: _created, updatedAt: _updated, ...business } = scenario;
  const knowledge=deps.knowledge.map(({revision:_revision,definitionRefs:_links,path:_path,origin:_origin,...meaning})=>meaning);
  return hash({ scenario:business, definitions:deps.definitions.map(({createdAt:_at, bindingId:_binding, ...d}) => d), knowledge });
}
export function latestTestingBinding(catalog: TestingCatalog, id: string): TestingTechnicalBinding | undefined {
  const versions=catalog.bindings.filter(b => b.id === id).sort((a,b) => b.revision-a.revision);
  return versions.find(b=>b.status==='ready')??versions[0];
}
export function compileTestingScenario(scenario: TestingScenario, catalog: TestingCatalog, approval?: TestingApproval): TestingCompiledScenario {
  const issues: TestingValidationIssue[] = []; const steps: TestingCompiledStep[] = [];
  const defs = definitionMap(catalog); const deps = testingBusinessDependencies(scenario,catalog); const usedBindings = new Map<string,TestingTechnicalBinding>();
  const globals = new Map<string,{key:string;type:TestingValueType}>();
  const declaredByScope = new WeakMap<Map<string,{key:string;type:TestingValueType}>,Set<string>>();
  const fingerprint = testingFingerprint(scenario,catalog); let wired = true;
  const sources = new Map<string, { sourcePath: string; sourceLabel: string }>();
  const issue = (code:string,message:string,block?:TestingBlockInstance,path?:string,field?:string,severity:TestingValidationIssue['severity']='error',source?:{sourcePath:string;sourceLabel:string}) => issues.push({code,message,severity,instanceId:block?.id,path,field,...source});
  issues.push(...validateTestingMatrix(scenario, catalog));
  const blockLabel = (block:TestingBlockInstance) => block.label ?? defs.get(testingVersionKey(block.definition))?.name ?? block.definition.id;
  const fieldLabel = (block:TestingBlockInstance,field:string) => {
    let inputs = defs.get(testingVersionKey(block.definition))?.inputs ?? []; const labels:string[]=[];
    for(const key of field.split('.')) { const input = inputs.find(item=>item.key===key); labels.push(input?.label??key); inputs=input?.fields??[]; }
    return labels.join(' / ');
  };
  const referenceMismatch = (code:string,expected:TestingValueType,actual:TestingValueType,ref:string,block:TestingBlockInstance,path:string,field:string) => {
    const source=sources.get(ref);
    issue(code,`Im Block „${blockLabel(block)}“ erwartet das Feld „${fieldLabel(block,field)}“ ein Ergebnis der Art „${testingValueTypeLabels[expected]}“. Ausgewählt ist aber „${testingValueTypeLabels[actual]}“${source?` aus „${source.sourceLabel}“`:''}. Wähle ein passendes Ergebnis eines vorherigen Blocks.`,block,path,field,'error',source);
  };
  for (const id of deps.missingKnowledge) issue('KNOWLEDGE_MISSING',`Der Wissensbeleg „${id}“ fehlt.`);
  function resolveValue(value:TestingValue, params:Record<string,TestingValue>, scope:Map<string,{key:string;type:TestingValueType}>, block:TestingBlockInstance, path:string, field:string,seen:string[]=[],input?:TestingInput):TestingValue {
    if (isTestingParameter(value)) {
      if (!Object.hasOwn(params,value.param)) { issue('PARAMETER_MISSING',`Der Parameter „${value.param}“ ist nicht belegt.`,block,path,field); return null; }
      if (seen.includes(value.param)) { issue('PARAMETER_CYCLE',`Die Parameterverknüpfung für „${value.param}“ enthält einen Kreis.`,block,path,field); return null; }
      return resolveValue(params[value.param],params,scope,block,path,field,[...seen,value.param],input);
    }
    if (isTestingReference(value)) {
      const found=scope.get(value.ref)??[...scope.values()].find(item=>item.key===value.ref);
      if (!found) { issue('REFERENCE_MISSING',`Im Block „${blockLabel(block)}“ verweist das Feld „${fieldLabel(block,field)}“ auf ein Ergebnis, das hier noch nicht verfügbar ist. Wähle das passende Ergebnis eines vorherigen Blocks im gültigen Ablaufbereich.`,block,path,field); return value; }
      if (value.type && value.type!==found.type && !input?.type.endsWith('-ref')) { const source=sources.get(found.key); issue('REFERENCE_TYPE',`Im Block „${blockLabel(block)}“ ist die gespeicherte Verknüpfung im Feld „${fieldLabel(block,field)}“ als „${testingValueTypeLabels[value.type]}“ markiert. Das ausgewählte Ergebnis${source?` aus „${source.sourceLabel}“`:''} ist jedoch „${testingValueTypeLabels[found.type]}“. Wähle das Ergebnis im Feld erneut aus.`,block,path,field,'error',source); }
      return {ref:found.key,type:found.type};
    }
    if (Array.isArray(value)) return value.map(v=>resolveValue(v,params,scope,block,path,field,seen));
    if (value && typeof value==='object') return Object.fromEntries(Object.entries(value).map(([key,v])=>[key,resolveValue(v,params,scope,block,path,`${field}.${key}`,seen,input?.type==='object'?input.fields?.find(field=>field.key===key):undefined)]));
    return value;
  }
  function validateValue(value:TestingValue|undefined,input:TestingInput,block:TestingBlockInstance,path:string,field=input.key) {
    if (value===undefined || value===null || value==='') { if(input.required) issue('INPUT_REQUIRED',`„${input.label}“ muss angegeben werden.`,block,path,field); return; }
    if (isTestingReference(value)) { if(input.type.endsWith('-ref') && value.type && value.type!==input.type) referenceMismatch('INPUT_REFERENCE_TYPE',input.type,value.type,value.ref,block,path,field); else if(!input.type.endsWith('-ref') && input.type!=='list' && input.type!=='object') issue('INPUT_REFERENCE_TYPE',`Im Block „${blockLabel(block)}“ braucht das Feld „${fieldLabel(block,field)}“ einen Wert der Art „${testingValueTypeLabels[input.type]}“. Entferne die Ergebnisverknüpfung und trage den Wert direkt ein.`,block,path,field,'error',sources.get(value.ref)); return; }
    if(input.type.endsWith('-ref')) { issue('INPUT_REFERENCE_REQUIRED',`Im Block „${blockLabel(block)}“ braucht das Feld „${fieldLabel(block,field)}“ ein Ergebnis der Art „${testingValueTypeLabels[input.type]}“. Wähle das passende Ergebnis eines vorherigen Blocks.`,block,path,field); return; }
    if((input.type==='number'||input.type==='money') && (typeof value!=='number'||!Number.isFinite(value))) issue('INPUT_TYPE',`„${input.label}“ benötigt eine Zahl.`,block,path,field);
    if(typeof value==='number' && ((input.minimum!==undefined && value<input.minimum)||(input.maximum!==undefined && value>input.maximum))) issue('INPUT_RANGE',`„${input.label}“ liegt außerhalb des zulässigen Bereichs${input.minimum!==undefined?` ab ${input.minimum}`:''}${input.maximum!==undefined?` bis ${input.maximum}`:''}.`,block,path,field);
    if(input.type==='boolean' && typeof value!=='boolean') issue('INPUT_TYPE',`„${input.label}“ benötigt Ja oder Nein.`,block,path,field);
    if(['text','choice','date'].includes(input.type) && typeof value!=='string') issue('INPUT_TYPE',`„${input.label}“ benötigt Text.`,block,path,field);
    if(input.type==='date' && typeof value==='string' && (!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number.isNaN(Date.parse(value)))) issue('INPUT_DATE',`„${input.label}“ benötigt ein Datum als JJJJ-MM-TT.`,block,path,field);
    if(input.type==='choice' && input.options?.length && !input.options.some(option=>option.value===value)) issue('INPUT_OPTION',`„${input.label}“ enthält keinen zulässigen Auswahlwert.`,block,path,field);
    if(input.type==='list' && !Array.isArray(value)) issue('INPUT_TYPE',`„${input.label}“ benötigt eine Liste.`,block,path,field);
    if(input.type==='object') {
      if(typeof value!=='object'||Array.isArray(value)) {issue('INPUT_TYPE',`„${input.label}“ benötigt benannte Felder.`,block,path,field);return;}
      for(const nested of input.fields??[]) validateValue((value as Record<string,TestingValue>)[nested.key],nested,block,path,`${field}.${nested.key}`);
      if(!input.extensible) for(const key of Object.keys(value)) if(!(input.fields??[]).some(f=>f.key===key)) issue('INPUT_UNKNOWN',`„${field}.${key}“ ist noch nicht fachlich definiert. Ergänze das Eingabeschema, bevor dieses Feld verwendet wird.`,block,path,`${field}.${key}`);
    }
  }
  function walk(blocks:TestingBlockInstance[],parentPath:string,params:Record<string,TestingValue>,scope:Map<string,{key:string;type:TestingValueType}>,actor:string,ancestors:string[],active:string[],overrides:Record<string,Record<string,TestingValue>>={}) {
    const localIds=new Set<string>();
    for(const block of blocks) {
      const path=parentPath?`${parentPath}/${block.id}`:block.id;
      if(localIds.has(block.id)) { issue('INSTANCE_DUPLICATE',`Die Block-ID „${block.id}“ kommt in derselben Komposition mehrfach vor.`,block,path); continue; } localIds.add(block.id);
      if(!block.id || block.id.includes('/')) {issue('INSTANCE_ID',`Eine Block-ID muss vorhanden sein und darf keinen Schrägstrich enthalten.`,block,path);continue;}
      const key=testingVersionKey(block.definition); const definition=defs.get(key);
      if(!definition) {issue('DEFINITION_MISSING',`Die Definition „${key}“ fehlt. Die KI kann sie fachlich ergänzen.`,block,path);continue;}
      if(active.includes(key)) {issue('COMPOSITION_CYCLE',`„${definition.name}“ enthält sich selbst.`,block,path);continue;}
      for(const outputKey of Object.keys(block.outputs??{})) if(!definition.outputs.some(o=>o.key===outputKey)) issue('OUTPUT_UNKNOWN',`„${outputKey}“ ist kein Ergebnis von „${definition.name}“.`,block,path,outputKey);
      const raw={...Object.fromEntries(definition.inputs.filter(i=>i.default!==undefined).map(i=>[i.key,structuredClone(i.default!)])),...block.inputs,...(overrides[block.id]??{})};
      const inputs=Object.fromEntries(Object.entries(raw).map(([k,v])=>[k,resolveValue(v,params,scope,block,path,k,[],definition.inputs.find(input=>input.key===k))]));
      for(const input of definition.inputs) {
        const required=input.requiredWhen?.values.some(v=>v===inputs[input.requiredWhen!.input]);
        validateValue(inputs[input.key],required?{...input,required:true}:input,block,path);
        if(inputs[input.key]!==undefined && input.applicableWhen && !input.applicableWhen.values.some(v=>v===inputs[input.applicableWhen!.input])) issue('INPUT_NOT_APPLICABLE',`„${input.label}“ passt nicht zur gewählten Ausprägung von „${input.applicableWhen.input}“.`,block,path,input.key);
      }
      for(const inputKey of Object.keys(inputs)) if(!definition.inputs.some(i=>i.key===inputKey)) issue('INPUT_UNKNOWN',`„${inputKey}“ ist in „${definition.name}“ noch nicht definiert. Erweitere zuerst das fachliche Eingabeschema.`,block,path,inputKey);
      if(definition.kind==='context' || definition.kind==='workflow') {
        const childScope=new Map(scope); const childOverrides:Record<string,Record<string,TestingValue>>={...block.overrides};
        for(const [overridePath,values] of Object.entries(overrides)) if(overridePath.startsWith(`${block.id}/`)) childOverrides[overridePath.slice(block.id.length+1)]={...childOverrides[overridePath.slice(block.id.length+1)],...values};
        const body=block.children??definition.body??[];
        if(!body.length) issue('COMPOSITION_EMPTY',`„${definition.name}“ enthält noch keine Schritte.`,block,path);
        walk(body,path,definition.kind==='workflow'?inputs:params,childScope,definition.kind==='context'?String(inputs.role??actor):actor,[...ancestors,path],[...active,key],childOverrides);
        for(const overridePath of Object.keys(childOverrides)) if(!body.some(child=>child.id===overridePath.split('/')[0])) issue('OVERRIDE_TARGET',`Die lokale Änderung verweist auf den fehlenden Block „${overridePath}“.`,block,path);
        if(definition.kind==='context') { for(const [name,ref] of childScope) if(!scope.has(name)) scope.set(name,ref); }
        else for(const output of definition.outputs) {
          const exported=definition.exports?.[output.key]; const resolved=exported?childScope.get(exported.ref):undefined;
          if(!resolved) issue('EXPORT_MISSING',`Das Ergebnis „${output.label}“ ist in „${definition.name}“ nicht verbunden.`,block,path,output.key);
          else { if(resolved.type!==output.type) issue('EXPORT_TYPE',`Das Ergebnis „${output.label}“ hat einen unpassenden Typ.`,block,path,output.key); bindOutput(block,output.key,resolved,scope,path); }
        }
        continue;
      }
      if(block.children?.length) issue('ACTION_CHILDREN',`Der elementare Block „${definition.name}“ kann keine enthaltenen Schritte ausführen. Erstelle dafür einen zusammengesetzten Block.`,block,path);
      let binding=definition.bindingId?latestTestingBinding(catalog,definition.bindingId):undefined;
      if(!definition.bindingId) {
        const candidates=catalog.bindings.filter(b=>b.operation===effectiveTestingOperation(definition)&&b.definitionRefs.some(ref=>testingVersionKey(ref)===key));
        const ids=[...new Set(candidates.map(b=>b.id))];
        if(ids.length>1) issue('BINDING_AMBIGUOUS',`Für „${definition.name}“ gibt es mehrere technische Bindungen. Die technische Prüfung muss eine eindeutige Zuordnung herstellen.`,block,path);
        else if(ids.length===1) binding=latestTestingBinding({...catalog,bindings:candidates},ids[0]);
      }
      if(binding && (!binding.definitionRefs.some(ref=>testingVersionKey(ref)===key)||binding.operation!==effectiveTestingOperation(definition))) {issue('BINDING_MISMATCH',`Die technische Bindung passt nicht zu „${definition.name}“.`,block,path,undefined,'warning');binding=undefined;}
      if(!binding||binding.status!=='ready') {wired=false;issue('BINDING_MISSING',`„${definition.name}“ ist fachlich beschrieben. Die technische Verdrahtung fehlt noch.`,block,path,undefined,'info');}
      if(binding) {
        usedBindings.set(`${binding.id}@${binding.revision}`,binding);
        if(binding.status==='ready') for(const inputKey of Object.keys(inputs)) if(!(binding.inputKeys??[]).includes(inputKey)) {wired=false;issue('BINDING_INPUT_MISSING',`Für „${definition.name}“ muss die technische Umsetzung der Eingabe „${fieldLabel(block,inputKey)}“ noch ergänzt werden.`,block,path,inputKey,'info');}
      }
      const outputs:Record<string,string>={};
      for(const output of definition.outputs) {const qualified=`${path}::${output.key}`;sources.set(qualified,{sourcePath:path,sourceLabel:blockLabel(block)});outputs[output.key]=qualified;bindOutput(block,output.key,{key:qualified,type:output.type},scope,path);}
      steps.push({id:path,instanceId:block.id,path,ancestors,definition:block.definition,label:block.label??definition.name,kind:definition.kind,operation:effectiveTestingOperation(definition),actor,inputs,outputs,...(binding?{binding:{id:binding.id,revision:binding.revision}}:{}),knowledgeRefs:definition.knowledgeRefs});
    }
  }
  function bindOutput(block:TestingBlockInstance,outputKey:string,resolved:{key:string;type:TestingValueType},scope:Map<string,{key:string;type:TestingValueType}>,path:string) {
    const alias=block.outputs?.[outputKey]??`${block.id}.${outputKey}`;
    let declared=declaredByScope.get(scope);if(!declared){declared=new Set();declaredByScope.set(scope,declared);}
    if(declared.has(alias)) { issue('OUTPUT_COLLISION',`Das Ergebnis „${alias}“ ist bereits belegt. Wähle für diese Verwendung einen eigenen Namen.`,block,path,outputKey);return; }
    declared.add(alias);
    scope.set(alias,resolved);
  }
  walk(scenario.blocks,'',scenario.parameters??{},globals,'Vermittler',[],[]);
  if(!steps.length) issue('SCENARIO_EMPTY','Der Testfall enthält noch keine ausführbaren fachlichen Schritte.');
  if(scenario.matrix && !steps.some(step=>step.kind==='assertion')) issue('MATRIX_ASSERTION_REQUIRED','Eine Testmatrix braucht mindestens einen echten Prüfblock. Ohne Assertion kann keine Matrixzeile bestehen.');
  if(scenario.matrix && !issues.some(item=>item.code.startsWith('MATRIX_'))) {
    // A required template field may intentionally be supplied exclusively by every matrix row.
    const covered=new Set(scenario.matrix.columns.map(column=>`${column.target.blockPath}::${column.target.inputPath}`));
    for(let index=issues.length-1;index>=0;index--)if(issues[index].code==='INPUT_REQUIRED'&&covered.has(`${issues[index].path}::${issues[index].field}`))issues.splice(index,1);
  }
  if(scenario.matrix && !issues.some(item=>item.code.startsWith('MATRIX_'))) for(const row of scenario.matrix.rows.filter(item=>item.enabled)) {
    const variant=compileTestingScenario(scenarioForTestingMatrixRow(scenario,catalog,row.id),catalog);
    for(const rowIssue of variant.issues.filter(item=>item.severity==='error')) issues.push({...rowIssue,code:`MATRIX_ROW_${rowIssue.code}`,message:`${row.label}: ${rowIssue.message}`});
    for(const rowIssue of variant.issues.filter(item=>['BINDING_MISSING','BINDING_INPUT_MISSING','BINDING_AMBIGUOUS','BINDING_MISMATCH'].includes(item.code))) {
      wired=false; issues.push({...rowIssue,code:`MATRIX_ROW_${rowIssue.code}`,message:`${row.label}: ${rowIssue.message}`});
    }
  }
  const approved=!!approval && approval.scenarioId===scenario.id && approval.scenarioRevision===scenario.revision && approval.fingerprint===fingerprint;
  if(!approved) issue(approval?'APPROVAL_STALE':'APPROVAL_REQUIRED',approval?'Die fachliche Freigabe ist durch eine Änderung veraltet. Bitte den aktuellen Entwurf erneut prüfen.':'Bitte den fachlichen Entwurf vor der technischen Ausführung freigeben.',undefined,undefined,undefined,'warning');
  const valid=!issues.some(i=>i.severity==='error');
  return {scenarioId:scenario.id,scenarioRevision:scenario.revision,fingerprint,compiledAt:new Date().toISOString(),scenario:structuredClone(scenario),definitions:structuredClone(deps.definitions),bindings:structuredClone([...usedBindings.values()]),knowledge:structuredClone(deps.knowledge),steps,issues,valid,executable:valid&&wired&&approved,...(approval?{approval}: {})};
}

/** Authorizes a deterministic row from the exact frozen, human-approved parent snapshot without fabricating a row approval. */
export function compileTestingMatrixRow(parent:TestingCompiledScenario,rowId:string,frozenCatalog:TestingCatalog):TestingCompiledScenario {
  const row=parent.scenario.matrix?.rows.find(item=>item.id===rowId&&item.enabled);
  if(!row||!parent.approval||parent.approval.fingerprint!==parent.fingerprint||!parent.executable)throw new Error('Die Matrixzeile gehört nicht zu einer ausführbaren, fachlich freigegebenen Matrixfassung.');
  const scenario=scenarioForTestingMatrixRow(parent.scenario,frozenCatalog,rowId);
  const compiled=compileTestingScenario(scenario,frozenCatalog);
  const unwired=compiled.issues.some(item=>['BINDING_MISSING','BINDING_INPUT_MISSING','BINDING_AMBIGUOUS','BINDING_MISMATCH'].includes(item.code));
  return {...compiled,executable:compiled.valid&&!unwired,approval:structuredClone(parent.approval),matrixOrigin:{parentFingerprint:parent.fingerprint,rowId,approval:structuredClone(parent.approval)}};
}

function schemaSignature(definition:TestingBlockDefinition):unknown {
  return {inputs:definition.inputs.map(({key,type,required,default:defaultValue,options,fields,minimum,maximum,extensible,requiredWhen,applicableWhen})=>({key,type,required:!!required,default:defaultValue,options,fields,minimum,maximum,extensible,requiredWhen,applicableWhen})).sort((a,b)=>a.key.localeCompare(b.key)),outputs:definition.outputs.map(({key,type})=>({key,type})).sort((a,b)=>a.key.localeCompare(b.key))};
}
function compositionSignature(definition:TestingBlockDefinition,catalog:TestingCatalog):unknown {
  const definitions=definitionMap(catalog);const aliases=new Map<string,string>();
  const normalizeValue=(value:TestingValue,scope:Map<string,string>):TestingValue=>{
    if(isTestingReference(value))return {ref:scope.get(value.ref)??value.ref,...(value.type?{type:value.type}:{})};
    if(Array.isArray(value))return value.map(v=>normalizeValue(v,scope));
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,normalizeValue(v,scope)]));return value;
  };
  const walk=(blocks:TestingBlockInstance[],scope:Map<string,string>,prefix:string):unknown[]=>blocks.map((block,index)=>{
    const position=`${prefix}${index}`;const referenced=definitions.get(testingVersionKey(block.definition));
    const inputs=Object.fromEntries(Object.entries(block.inputs).map(([key,value])=>[key,normalizeValue(value,scope)]));
    const children=block.children?walk(block.children,referenced?.kind==='context'?scope:new Map(scope),`${position}/`):undefined;
    for(const output of referenced?.outputs??[])scope.set(block.outputs?.[output.key]??`${block.id}.${output.key}`,`${position}::${output.key}`);
    return {definition:block.definition,inputs,children,overrides:block.overrides};
  });
  const body=walk(definition.body??[],aliases,'');
  return {body,exports:Object.fromEntries(Object.entries(definition.exports??{}).map(([key,value])=>[key,normalizeValue(value,aliases)]))};
}
export function findTestingDuplicates(proposed:TestingBlockDefinition,catalog:TestingCatalog):TestingDuplicateReport {
  const normalize=(value:string)=>value.toLocaleLowerCase('de-DE').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
  const words=(value:string)=>new Set(normalize(value).split(' ').filter(w=>w.length>3));
  const proposedMeaning=words(`${proposed.semanticKey} ${proposed.description} ${proposed.preconditions.join(' ')} ${proposed.postconditions.join(' ')}`);
  const candidates=catalog.definitions.filter(d=>d.id!==proposed.id).map(existing=>{
    const matching:string[]=[];const differences:string[]=[];let score=0;
    const sameSemantic=existing.semanticKey===proposed.semanticKey; const sameSchema=stableTestingStringify(schemaSignature(existing))===stableTestingStringify(schemaSignature(proposed));
    const sameBody=stableTestingStringify(compositionSignature(existing,catalog))===stableTestingStringify(compositionSignature(proposed,catalog));
    const sameOperation=!!existing.operation&&existing.operation===proposed.operation;
    const other=words(`${existing.semanticKey} ${existing.description} ${existing.preconditions.join(' ')} ${existing.postconditions.join(' ')}`);const overlap=[...proposedMeaning].filter(w=>other.has(w)).length/Math.max(1,new Set([...proposedMeaning,...other]).size);
    if(sameSemantic){score+=0.45;matching.push('Gleiche fachliche Bedeutung');}else differences.push('Andere fachliche Kennung');
    if(sameSchema){score+=0.25;matching.push('Gleiches Eingabe- und Ergebnisschema');}else differences.push('Abweichendes Eingabe- oder Ergebnisschema');
    if((existing.kind==='workflow'&&proposed.kind==='workflow'&&sameBody)||sameOperation){score+=0.2;matching.push(existing.kind==='workflow'?'Gleiche Komposition':'Gleicher elementarer Vorgang');}else differences.push('Andere Komposition oder technischer Vorgang');
    score+=overlap*0.1;
    const equivalence=sameSchema&&sameSemantic&&((existing.kind==='workflow'&&proposed.kind==='workflow'&&sameBody)||(sameOperation&&existing.kind===proposed.kind));
    const decision=equivalence?'reuse':sameSemantic||sameOperation?'extend':'distinct';
    const reason=equivalence?'Bedeutung, Schema und Komposition beziehungsweise Vorgang stimmen überein. Die vorhandene Version kann verwendet werden.':decision==='extend'?'Der fachliche Kern ist vorhanden, aber Schema oder Komposition weichen ab. Eine explizite neue Version oder lokale Variation benötigt Fachprüfung.':'Es gibt keinen ausreichenden Nachweis fachlicher Gleichheit.';
    return {definition:{id:existing.id,version:existing.version},name:existing.name,score:Math.round(score*100),matching,differences,decision:decision as 'reuse'|'extend'|'distinct',reason};
  }).filter(c=>c.score>=20).sort((a,b)=>b.score-a.score).slice(0,8);
  const exact=candidates.find(c=>c.decision==='reuse');const extension=candidates.find(c=>c.decision==='extend');
  return {proposed:{id:proposed.id,version:proposed.version},checkedAt:new Date().toISOString(),candidates,decision:exact?'reuse':extension?'extend':'new',...(exact?{chosen:exact.definition}:{}),reason:exact?exact.reason:extension?extension.reason:'Kein vorhandener Block deckt Bedeutung, Schema und Ablauf ausreichend ab. Eine neue Definition bleibt als Entwurf prüfbar.'};
}

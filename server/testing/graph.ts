import type { TestingBlockDefinition, TestingBlockInstance, TestingCatalog, TestingGraph, TestingGraphEdge, TestingGraphNode, TestingImpact, TestingRun, TestingScenario } from '../../shared/testing';
import { testingVersionKey } from '../../shared/testing';
import { getTestingCatalog } from './catalog';
import { compileTestingScenario, latestTestingBinding } from './compiler';
import { getTestingApproval, listTestingRuns, listTestingScenarioRevisions, listTestingScenarios } from './repository';

export function buildTestingGraph(catalog:TestingCatalog=getTestingCatalog(),scenarios:TestingScenario[]=listTestingScenarios(),runs:TestingRun[]=listTestingRuns(),revisions:TestingScenario[]=listTestingScenarioRevisions()):TestingGraph {
  const nodes=new Map<string,TestingGraphNode>();const edges=new Map<string,TestingGraphEdge>();
  const node=(id:string,kind:TestingGraphNode['kind'],label:string,data:unknown)=>nodes.set(id,{id,kind,label,data});
  const edge=(source:string,target:string,relation:string)=>{const id=`${source}|${relation}|${target}`;edges.set(id,{id,source,target,relation});};
  const defs=new Map(catalog.definitions.map(d=>[testingVersionKey(d),d]));
  function instances(blocks:TestingBlockInstance[],parent:string,pathPrefix:string) {
    for(const block of blocks) {const path=pathPrefix?`${pathPrefix}/${block.id}`:block.id;const id=`${parent}/verwendung:${path}`;const def=defs.get(testingVersionKey(block.definition));node(id,'instance',block.label??def?.name??block.definition.id,block);edge(parent,id,'enthält Verwendung');edge(id,`definition:${testingVersionKey(block.definition)}`,'verwendet Version');if(block.children)instances(block.children,id,'');}
  }
  for(const definition of catalog.definitions) {
    const id=`definition:${testingVersionKey(definition)}`;node(id,'definition',`${definition.name} · ${definition.version}`,definition);
    if(definition.body)instances(definition.body,id,'');
    for(const knowledgeId of definition.knowledgeRefs) {
      const doc=catalog.knowledge.filter(k=>k.id===knowledgeId).sort((a,b)=>b.revision-a.revision)[0];
      if(doc){edge(id,`wissen:${doc.id}@${doc.revision}`,'ist fachlich begründet durch');edge(`wissen:${doc.id}@${doc.revision}`,id,'beschreibt Block');}
    }
  }
  for(const binding of catalog.bindings) {
    const id=`bindung:${binding.id}@${binding.revision}`;node(id,'binding',`${binding.name} · Technik ${binding.revision}`,binding);
    for(const ref of binding.definitionRefs)edge(id,`definition:${testingVersionKey(ref)}`,'führt elementaren Block aus');
    for(const knowledgeId of binding.knowledgeRefs){const doc=catalog.knowledge.filter(k=>k.id===knowledgeId).sort((a,b)=>b.revision-a.revision)[0];if(doc)edge(id,`wissen:${doc.id}@${doc.revision}`,'folgt technischem Wissen');}
  }
  for(const knowledge of catalog.knowledge) {const id=`wissen:${knowledge.id}@${knowledge.revision}`;node(id,'knowledge',`${knowledge.title} · Wissen ${knowledge.revision}`,knowledge);for(const ref of knowledge.definitionRefs)edge(id,`definition:${testingVersionKey(ref)}`,'beschreibt Block');}
  const allRevisions=[...new Map([...revisions,...scenarios,...runs.map(run=>run.compiled.scenario)].map(s=>[`${s.id}@${s.revision}`,s])).values()];
  for(const scenario of allRevisions) {const id=`revision:${scenario.id}@${scenario.revision}`;node(id,'revision',`${scenario.title} · Revision ${scenario.revision}`,scenario);instances(scenario.blocks,id,'');}
  for(const scenario of scenarios) {
    const id=`testfall:${scenario.id}`;node(id,'scenario',scenario.title,scenario);edge(id,`revision:${scenario.id}@${scenario.revision}`,'hat aktuelle Revision');
    const approval=getTestingApproval(scenario.id);if(approval){node(`freigabe:${approval.id}`,'approval',`Fachliche Freigabe · Revision ${approval.scenarioRevision}`,approval);edge(`freigabe:${approval.id}`,`revision:${approval.scenarioId}@${approval.scenarioRevision}`,'bestätigt Fachfingerprint');}
  }
  for(const run of runs) {
    const id=`lauf:${run.id}`;node(id,'run',`${run.scenarioTitle} · ${run.status}`,run);edge(id,`revision:${run.scenarioId}@${run.scenarioRevision}`,'prüfte exakte Revision');
    for(const binding of run.compiled.bindings) {const bindingId=`bindung:${binding.id}@${binding.revision}`;if(!nodes.has(bindingId))node(bindingId,'binding',`${binding.name} · Technik ${binding.revision}`,binding);edge(id,bindingId,'verwendete eingefrorene Bindung');}
    for(const definition of run.compiled.definitions) {const defId=`definition:${testingVersionKey(definition)}`;if(!nodes.has(defId))node(defId,'definition',`${definition.name} · ${definition.version}`,definition);edge(id,defId,'verwendete Definitionsversion');}
  }
  return {nodes:[...nodes.values()],edges:[...edges.values()]};
}

export function getTestingImpact(bindingId:string,catalog:TestingCatalog=getTestingCatalog(),scenarios:TestingScenario[]=listTestingScenarios(),runs:TestingRun[]=listTestingRuns()):TestingImpact {
  const binding=latestTestingBinding(catalog,bindingId);
  const relevantBindings=catalog.bindings.filter(b=>b.id===bindingId);
  const direct=new Set(relevantBindings.flatMap(b=>b.definitionRefs.map(testingVersionKey)));
  for(const definition of catalog.definitions)if(definition.bindingId===bindingId)direct.add(testingVersionKey(definition));
  const affected=new Map<string,{definition:TestingBlockDefinition;direct:boolean;via:string[]}>();
  for(const definition of catalog.definitions)if(direct.has(testingVersionKey(definition)))affected.set(testingVersionKey(definition),{definition,direct:true,via:[bindingId]});
  const references=(blocks:TestingBlockInstance[]):string[]=>blocks.flatMap(block=>[testingVersionKey(block.definition),...references(block.children??[])]);
  let changed=true;while(changed){changed=false;for(const definition of catalog.definitions){const key=testingVersionKey(definition);if(affected.has(key))continue;const via=references(definition.body??[]).filter(ref=>affected.has(ref));if(via.length){affected.set(key,{definition,direct:false,via});changed=true;}}}
  const impactedScenarios:TestingImpact['scenarios']=[];
  for(const scenario of scenarios) {
    const compiled=compileTestingScenario(scenario,catalog);const steps=compiled.steps.filter(step=>step.binding?.id===bindingId || direct.has(testingVersionKey(step.definition)));
    if(!steps.length)continue;
    impactedScenarios.push({scenarioId:scenario.id,title:scenario.title,revision:scenario.revision,direct:scenario.blocks.some(block=>direct.has(testingVersionKey(block.definition))),instancePaths:steps.map(step=>step.path)});
  }
  return {bindingId,bindingRevision:binding?.revision??0,definitions:[...affected.values()].map(item=>({definition:{id:item.definition.id,version:item.definition.version},name:item.definition.name,direct:item.direct,via:item.via})),scenarios:impactedScenarios,historicalRuns:runs.flatMap(run=>run.compiled.bindings.filter(b=>b.id===bindingId).map(b=>({runId:run.id,scenarioId:run.scenarioId,bindingRevision:b.revision,status:run.status}))),suggestedScenarioIds:impactedScenarios.map(s=>s.scenarioId)};
}

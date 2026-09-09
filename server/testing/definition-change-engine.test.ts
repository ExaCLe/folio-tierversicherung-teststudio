import test from 'node:test';
import assert from 'node:assert/strict';
import type { TestingBlockDefinition, TestingBlockInstance, TestingCatalog, TestingInput, TestingKnowledgeDocument, TestingScenario, TestingTechnicalBinding } from '../../shared/testing';
import { compileTestingScenario } from './compiler';
import { compatibleDefinitionChangeBinding, fieldDecisionKey, migrateDefinitionScenarios, previewDefinitionChange } from './definition-change';
import { scenarioForTestingMatrixRow } from './matrix';

const clone=<T>(value:T):T=>structuredClone(value);
const knowledge:TestingKnowledgeDocument={id:'wissen',revision:1,title:'Fixture',kind:'rule',summary:'Fixture',content:'Fixture',definitionRefs:[],relatedKnowledge:[],requiredFields:[],preconditions:[],postconditions:[],origin:'human'};
const input=(key:string,defaultValue?:unknown):TestingInput=>({key,label:key,type:'text',...(defaultValue===undefined?{}:{default:defaultValue as string})});
const definition=(id:string,version:string,values:Partial<TestingBlockDefinition>={}):TestingBlockDefinition=>({id,version,name:id,description:id,kind:'action',category:'Fixture',semanticKey:id,inputs:[],outputs:[],knowledgeRefs:['wissen'],preconditions:[],postconditions:[],status:'approved',createdAt:'2026-09-09',origin:'human',...values});
const instance=(id:string,definitionId:string,inputs:TestingBlockInstance['inputs']={}):TestingBlockInstance=>({id,definition:{id:definitionId,version:'1.0.0'},inputs});
const scenario=(blocks:TestingBlockInstance[]):TestingScenario=>({id:'fall',title:'Fall',intent:'Fixture',revision:1,blocks,expectedOutcome:'Fixture',knowledgeRefs:[],source:'human',createdAt:'2026-09-09',updatedAt:'2026-09-09'});
const catalog=(...definitions:TestingBlockDefinition[]):TestingCatalog=>({revision:'fixture',definitions,bindings:[],knowledge:[knowledge]});
const next=(source:TestingBlockDefinition,values:Partial<TestingBlockDefinition>):TestingBlockDefinition=>({...clone(source),...values,version:'1.0.1',supersedes:{id:source.id,version:source.version}});

test('removed inherited defaults are pinned while explicit equal values remain explicit',()=>{
  const leaf=definition('leaf','1.0.0',{inputs:[input('value','old')]}),updated=next(leaf,{inputs:[input('value')]});
  const flow=definition('flow','1.0.0',{kind:'workflow',body:[instance('leaf',leaf.id)]}),c=catalog(leaf,flow);
  const inherited=scenario([instance('flow',flow.id)]),explicit={...scenario([instance('leaf',leaf.id,{value:'old'})]),id:'explicit'};
  const preview=previewDefinitionChange({definition:updated},c,[inherited,explicit]);
  assert.equal(preview.blocked,false);
  assert.equal(preview.affectedCaseCount,2);
  assert.deepEqual(preview.scenarios.find(item=>item.scenarioId==='explicit')?.changes,[]);
  const migrated=migrateDefinitionScenarios(preview,c,[inherited,explicit]);
  assert.deepEqual(migrated.find(item=>item.id==='fall')?.blocks[0].overrides,{leaf:{value:'old'}});
  assert.equal(migrated.find(item=>item.id==='fall')?.blocks[0].children,undefined,'an inherited body stays sparse');
  assert.equal(migrated.some(item=>item.id==='explicit'),false,'unchanged explicit behavior needs no scenario rewrite');
});

test('a changed default asks only inherited uses and honors preserve/adopt independently',()=>{
  const leaf=definition('leaf','1.0.0',{inputs:[input('value','old')]}),updated=next(leaf,{inputs:[input('value','new')]}),c=catalog(leaf);
  const inherited=scenario([instance('leaf',leaf.id)]),explicit={...scenario([instance('leaf',leaf.id,{value:'old'})]),id:'explicit'};
  const unresolved=previewDefinitionChange({definition:updated},c,[inherited,explicit]);
  assert.equal(unresolved.blocked,true);
  assert.equal(unresolved.scenarios.find(item=>item.scenarioId==='explicit')?.behavior,'fachlich-unveraendert');
  const key=fieldDecisionKey(inherited.id,'leaf','value');
  const preserve=previewDefinitionChange({definition:updated,defaultDecisions:{[key]:'bisherigen-wert-beibehalten'}},c,[inherited,explicit]);
  assert.equal(preserve.blocked,false);
  assert.equal(migrateDefinitionScenarios(preserve,c,[inherited,explicit])[0].blocks[0].inputs.value,'old');
  const adopt=previewDefinitionChange({definition:updated,defaultDecisions:{[key]:'neuen-standard-uebernehmen'}},c,[inherited]);
  assert.equal(adopt.changedCaseCount,1);
  assert.equal(migrateDefinitionScenarios(adopt,c,[inherited])[0].blocks[0].inputs.value,undefined);
});

test('an explicit old-default literal is preserved unless its exact use opts into the new default',()=>{
  const leaf=definition('leaf','1.0.0',{inputs:[input('value','old')]}),updated=next(leaf,{inputs:[input('value','new')]}),c=catalog(leaf),s=scenario([instance('leaf',leaf.id,{value:'old'})]);
  const global=previewDefinitionChange({definition:updated,defaultDecisions:{value:'neuen-standard-uebernehmen'}},c,[s]);
  assert.equal(global.blocked,false);
  assert.equal(global.scenarios[0].changes[0].decisionRequired,false);
  assert.equal(global.scenarios[0].changes[0].source,'ausdruecklich');
  assert.equal(migrateDefinitionScenarios(global,c,[s]).length,0,'a broad default choice cannot rewrite an explicit literal');
  const exact=previewDefinitionChange({definition:updated,defaultDecisions:{[fieldDecisionKey(s.id,'leaf','value')]:'neuen-standard-uebernehmen'}},c,[s]);
  const migrated=migrateDefinitionScenarios(exact,c,[s])[0];
  assert.equal(migrated.blocks[0].inputs.value,undefined);
  assert.equal(migrated.blocks[0].definition.version,'1.0.1');
});

test('ancestor overrides prevent false default decisions and are preserved',()=>{
  const leaf=definition('leaf','1.0.0',{inputs:[input('value','old')]}),updated=next(leaf,{inputs:[input('value','new')]}),inner=definition('inner','1.0.0',{kind:'workflow',body:[instance('leaf',leaf.id)]}),outer=definition('outer','1.0.0',{kind:'workflow',body:[instance('inner',inner.id)]}),c=catalog(leaf,inner,outer);
  const use=instance('outer',outer.id);use.overrides={'inner/leaf':{value:'local'}};
  const preview=previewDefinitionChange({definition:updated},c,[scenario([use])]);
  assert.equal(preview.blocked,false,JSON.stringify(preview.scenarios[0]));
  assert.equal(preview.scenarios[0].changes.length,0);
  assert.equal(preview.scenarios[0].behavior,'fachlich-unveraendert');
  assert.equal(migrateDefinitionScenarios(preview,c,[scenario([use])]).length,0);
});

test('enabled matrix rows are counted as cases and a full matrix value outranks defaults',()=>{
  const leaf=definition('leaf','1.0.0',{kind:'assertion',inputs:[input('value','old')]}),updated=next(leaf,{inputs:[input('value','new')]}),c=catalog(leaf);
  const use=scenario([instance('leaf',leaf.id)]);use.matrix={columns:[{id:'value',label:'Value',target:{blockPath:'leaf',inputPath:'value'},type:'text'}],rows:[{id:'one',label:'One',enabled:true,values:{value:'row'}},{id:'two',label:'Two',enabled:true,values:{value:'row2'}},{id:'off',label:'Off',enabled:false,values:{value:'ignored'}}]};
  const preview=previewDefinitionChange({definition:updated},c,[use]);
  assert.equal(preview.blocked,false,JSON.stringify(preview.scenarios[0]));
  assert.equal(preview.affectedCaseCount,2);
  assert.equal(preview.changedCaseCount,0);
  assert.deepEqual(preview.scenarios[0].matrixRows.map(row=>row.rowId),['one','two']);
  assert.equal(migrateDefinitionScenarios(preview,c,[use]).length,0);
});

test('nested matrix values preserve old default siblings or adopt new siblings by decision',()=>{
  const profile:TestingInput={key:'profile',label:'Profile',type:'object',default:{address:{country:'DE',zip:'1'}},fields:[{key:'address',label:'Address',type:'object',fields:[{key:'country',label:'Country',type:'text'},{key:'zip',label:'Zip',type:'text'}]}]};
  const leaf=definition('leaf','1.0.0',{kind:'assertion',inputs:[profile]}),updated=next(leaf,{inputs:[{...clone(profile),default:{address:{country:'DE',zip:'2'}}}]}),c=catalog(leaf);
  const use=scenario([instance('leaf',leaf.id)]);use.matrix={columns:[{id:'country',label:'Country',target:{blockPath:'leaf',inputPath:'profile.address.country'},type:'text'}],rows:[{id:'one',label:'One',enabled:true,values:{country:'AT'}}]};
  const key=fieldDecisionKey(use.id,'leaf','profile');
  const preserve=previewDefinitionChange({definition:updated,defaultDecisions:{[key]:'bisherigen-wert-beibehalten'}},c,[use]);
  assert.equal(preserve.changedCaseCount,0);
  assert.deepEqual(migrateDefinitionScenarios(preserve,c,[use])[0].blocks[0].inputs.profile,{address:{country:'DE',zip:'1'}});
  const adopt=previewDefinitionChange({definition:updated,defaultDecisions:{[key]:'neuen-standard-uebernehmen'}},c,[use]);
  assert.equal(adopt.changedCaseCount,1);
  assert.equal(adopt.scenarios[0].matrixRows[0].behavior,'testdefinition-aendern');
});

test('matrix preview and the persisted scenario produce identical enabled-row semantics',()=>{
  const profile:TestingInput={key:'profile',label:'Profile',type:'object',default:{country:'DE',zip:'1'},fields:[{key:'country',label:'Country',type:'text'},{key:'zip',label:'Zip',type:'text'}]};
  const leaf=definition('leaf','1.0.0',{kind:'assertion',inputs:[profile]}),updated=next(leaf,{inputs:[{...clone(profile),default:{country:'DE',zip:'2'}}]}),c=catalog(leaf),s=scenario([instance('leaf',leaf.id)]);
  s.matrix={columns:[{id:'country',label:'Country',target:{blockPath:'leaf',inputPath:'profile.country'},type:'text'}],rows:[{id:'one',label:'One',enabled:true,values:{country:'AT'}},{id:'two',label:'Two',enabled:true,values:{country:'CH'}}]};
  const key=fieldDecisionKey(s.id,'leaf','profile'),preview=previewDefinitionChange({definition:updated,defaultDecisions:{[key]:'bisherigen-wert-beibehalten'}},c,[s]);
  const migrated=migrateDefinitionScenarios(preview,c,[s])[0],nextCatalog={...c,definitions:[...c.definitions,updated]};
  for(const row of s.matrix.rows) {
    const before=compileTestingScenario(scenarioForTestingMatrixRow(s,c,row.id),c).steps[0].inputs;
    const after=compileTestingScenario(scenarioForTestingMatrixRow(migrated,nextCatalog,row.id),nextCatalog).steps[0].inputs;
    assert.deepEqual(after,before);
    assert.equal(preview.scenarios[0].matrixRows.find(item=>item.rowId===row.id)?.behavior,'fachlich-unveraendert');
  }
  assert.throws(()=>previewDefinitionChange({definition:updated,defaultDecisions:{[`${key}:zeile:one`]:'neuen-standard-uebernehmen'}},c,[s]),(error:any)=>error?.code==='MATRIX_ROW_RESOLUTION_UNSUPPORTED');
});

test('unrelated existing errors do not block and unreachable locally deleted body uses are excluded',()=>{
  const leaf=definition('leaf','1.0.0',{inputs:[input('required')]}),updated=next(leaf,{name:'Renamed'}),flow=definition('flow','1.0.0',{kind:'workflow',body:[instance('leaf',leaf.id)]}),c=catalog(leaf,flow);
  const invalid={...scenario([instance('leaf',leaf.id)]),id:'invalid'};
  const deleted={...scenario([{...instance('flow',flow.id),children:[]}]),id:'deleted'};
  const preview=previewDefinitionChange({definition:updated},c,[invalid,deleted]);
  assert.equal(preview.blocked,false);
  assert.deepEqual(preview.scenarios.map(item=>item.scenarioId),['invalid']);
  assert.equal(preview.scenarios[0].behavior,'fachlich-unveraendert');
  assert.equal(migrateDefinitionScenarios(preview,c,[invalid,deleted]).length,0);
});

test('materialized workflow bodies reconcile against their old base before the new ref is stored',()=>{
  const a=definition('a','1.0.0'),b=definition('b','1.0.0'),flow=definition('flow','1.0.0',{kind:'workflow',body:[instance('a',a.id)]}),updated=next(flow,{body:[instance('a',a.id),instance('b',b.id)]}),c=catalog(a,b,flow);
  const use={...instance('flow',flow.id),children:clone(flow.body!)};const s=scenario([use]);
  const preview=previewDefinitionChange({definition:updated},c,[s]);
  assert.equal(preview.changedCaseCount,1);
  const migrated=migrateDefinitionScenarios(preview,c,[s])[0],nextCatalog={...c,definitions:[...c.definitions,updated]};
  assert.deepEqual(migrated.blocks[0].children?.map(block=>block.id),['a','b']);
  assert.equal(migrated.blocks[0].definition.version,'1.0.1');
  assert.deepEqual(compileTestingScenario(migrated,nextCatalog).steps.map(step=>step.path),['flow/a','flow/b']);
});

test('required fields and removed explicit fields need typed resolutions',()=>{
  const old=definition('leaf','1.0.0',{inputs:[input('old')]}),updated=next(old,{inputs:[{key:'required',label:'Required',type:'number',required:true}]}),c=catalog(old),s=scenario([instance('leaf',old.id,{old:'kept'})]);
  const unresolved=previewDefinitionChange({definition:updated},c,[s]);assert.equal(unresolved.blocked,true);
  const resolutions={
    [fieldDecisionKey(s.id,'leaf','old')]:{action:'feld-verwerfen' as const},
    [fieldDecisionKey(s.id,'leaf','required')]:{action:'wert-setzen' as const,value:4},
  };
  const resolved=previewDefinitionChange({definition:updated,valueResolutions:resolutions},c,[s]);
  assert.equal(resolved.blocked,false,JSON.stringify(resolved.scenarios[0]?.diagnostics));
  const migrated=migrateDefinitionScenarios(resolved,c,[s])[0];assert.deepEqual(migrated.blocks[0].inputs,{required:4});
});

test('removing a shared-body literal materializes only the resolved path and removing an override edits its owner',()=>{
  const old=definition('leaf','1.0.0',{inputs:[input('old')]}),updated=next(old,{inputs:[]}),flow=definition('flow','1.0.0',{kind:'workflow',body:[instance('leaf',old.id,{old:'body'})]}),c=catalog(old,flow);
  const inherited=scenario([instance('flow',flow.id)]),key=fieldDecisionKey(inherited.id,'flow/leaf','old');
  const resolved=previewDefinitionChange({definition:updated,valueResolutions:{[key]:{action:'feld-verwerfen'}}},c,[inherited]);
  assert.equal(resolved.blocked,false,JSON.stringify(resolved.scenarios[0]?.diagnostics));
  const migrated=migrateDefinitionScenarios(resolved,c,[inherited])[0],nextCatalog={...c,definitions:[...c.definitions,updated]};
  assert.deepEqual(migrated.blocks[0].children?.[0].inputs,{});
  assert.equal(compileTestingScenario(migrated,nextCatalog).issues.some(issue=>issue.code==='INPUT_UNKNOWN'),false);

  const overridden=scenario([{...instance('flow',flow.id),overrides:{leaf:{old:'override'}}}]);
  const overridePreview=previewDefinitionChange({definition:updated,valueResolutions:{[fieldDecisionKey(overridden.id,'flow/leaf','old')]:{action:'feld-verwerfen'}}},c,[overridden]);
  const overrideMigrated=migrateDefinitionScenarios(overridePreview,c,[overridden])[0];
  assert.equal(overrideMigrated.blocks[0].overrides,undefined);
});

test('stale or lower versions are rejected before impact computation',()=>{
  const old=definition('leaf','2.0.0'),c=catalog(old);
  assert.throws(()=>previewDefinitionChange({definition:{...clone(old),version:'1.9.0',supersedes:{id:old.id,version:old.version}}},c,[]),/höher/);
  assert.throws(()=>previewDefinitionChange({definition:{...clone(old),version:'2.0.1'}},c,[]),/unmittelbar/);
});

test('technical reuse requires one exact source binding and the full recursive contract',()=>{
  const nested:TestingInput={key:'profile',label:'Profile',type:'object',required:true,fields:[{key:'state',label:'State',type:'choice',required:true,options:[{value:'BY',label:'Bayern'}],minimum:1,maximum:2}]};
  const source=definition('leaf','1.0.0',{bindingId:'ui.leaf',operation:'leaf',inputs:[nested]}),binding:TestingTechnicalBinding={id:'ui.leaf',revision:1,operation:'leaf',name:'Leaf',status:'ready',definitionRefs:[{id:source.id,version:source.version}],knowledgeRefs:[],module:'driver',export:'execute',locators:[],inputKeys:['profile'],changeReason:'Fixture',createdAt:'2026-09-09'};
  const c={...catalog(source),bindings:[binding]},compatible=next(source,{inputs:[{...clone(nested),default:{state:'BY'}}]});
  assert.equal(compatibleDefinitionChangeBinding(source,compatible,c)?.id,binding.id,'defaults do not change the technical contract');
  const incompatible=[
    next(source,{bindingId:'ui.other'}),
    next(source,{inputs:[{...clone(nested),required:false}]}),
    next(source,{inputs:[{...clone(nested),fields:[{...clone(nested.fields![0]),options:[{value:'NI',label:'Niedersachsen'}]}]}]}),
    next(source,{inputs:[{...clone(nested),fields:[{...clone(nested.fields![0]),maximum:3}]}]}),
    next(source,{inputs:[{...clone(nested),fields:[{...clone(nested.fields![0]),type:'text'}]}]}),
  ];
  for(const target of incompatible){assert.equal(compatibleDefinitionChangeBinding(source,target,c),undefined);assert.equal(previewDefinitionChange({definition:target},c,[]).technicalPreparation?.status,'neu-zu-pruefen');}
  const ambiguous={...c,bindings:[binding,{...binding,id:'ui.second'}]};
  const sourceWithoutId={...source,bindingId:undefined},targetWithoutId={...compatible,bindingId:undefined};
  assert.equal(compatibleDefinitionChangeBinding(sourceWithoutId,targetWithoutId,ambiguous),undefined,'an unbound definition cannot guess between binding IDs');
});

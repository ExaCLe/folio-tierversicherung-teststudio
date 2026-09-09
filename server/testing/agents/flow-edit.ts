import type { TestingBlockInstance, TestingCatalog, TestingScenario, TestingScenarioEditChange, TestingModel, TestingAgentEvent } from '../../../shared/testing';
import { currentTestingChildren, currentTestingDefinition, testingVersionKey } from '../../../shared/testing';
import { stableTestingStringify } from '../compiler';
import { previewTestingScenarioEdit } from '../repository';
import { agentContext, flowRevisionPrompt } from './prompts';
import { BUSINESS_SCHEMA, decodeBusinessDraft } from './schemas';
import { reviewWithCodex } from './reviews';

// Flow editing must distinguish an inherited body from a deliberately emptied body.
export const FLOW_EDIT_SCHEMA = JSON.parse(JSON.stringify(BUSINESS_SCHEMA));
FLOW_EDIT_SCHEMA.$defs.instance.properties.childrenMode = { type: 'string', enum: ['inherit', 'replace'] };
FLOW_EDIT_SCHEMA.$defs.instance.required.push('childrenMode');
FLOW_EDIT_SCHEMA.properties.matrixMode = { type: 'string', enum: ['keep', 'replace', 'remove'], description: 'keep erhält die vorhandene Matrix, replace verwendet matrix, remove entfernt sie ausdrücklich.' };
FLOW_EDIT_SCHEMA.required.push('matrixMode');
export function decodeScenarioEdit(raw: unknown) {
  const source = structuredClone(raw) as any;
  const matrixMode = source.matrixMode ?? 'keep';
  if(!['keep','replace','remove'].includes(matrixMode))throw new Error('matrixMode muss keep, replace oder remove sein.');
  if(matrixMode==='replace'&&!source.matrix)throw new Error('matrixMode replace braucht eine vollständige Matrix.');
  delete source.matrixMode;
  const modes = new Map<object, { mode: string; children: any[] }>();
  const strip = (blocks: any[]) => {
    if (!Array.isArray(blocks)) return;
    for (const block of blocks) {
      if (!['inherit', 'replace'].includes(block.childrenMode)) throw new Error(`Block ${block.id}: childrenMode muss inherit oder replace sein.`);
      if (block.childrenMode === 'inherit' && block.children?.length) throw new Error(`Block ${block.id}: inherit erlaubt keine lokalen children; verwende replace.`);
      modes.set(block, { mode: block.childrenMode, children: block.children });
      delete block.childrenMode; strip(block.children);
    }
  };
  strip(source.blocks); for (const definition of source.newDefinitions ?? []) strip(definition.body);
  const draft = decodeBusinessDraft(source);
  draft.matrixMode = matrixMode;
  const restore = (blocks: TestingBlockInstance[], wireBlocks: any[]) => blocks.forEach((block, index) => {
    const mode = modes.get(wireBlocks[index])!;
    if (mode.mode === 'replace') block.children ??= [];
    if (block.children) restore(block.children, mode.children);
  });
  restore(draft.blocks, source.blocks);
  draft.newDefinitions.forEach((definition, index) => { if (definition.body) restore(definition.body, source.newDefinitions[index].body); });
  return draft;
}

type FlowEntry = { path: string; parent: string; index: number; label: string; block: TestingBlockInstance };
export function flowEntries(blocks: TestingBlockInstance[], catalog: TestingCatalog, parent = '', active: string[] = []): FlowEntry[] {
  return blocks.flatMap((block, index) => {
    const definition = currentTestingDefinition(catalog, block.definition);
    const path = parent ? `${parent}/${block.id}` : block.id;
    const key = testingVersionKey(block.definition);
    return [{ path, parent, index, label: block.label || definition?.name || block.definition.id, block }, ...(!active.includes(key) ? flowEntries(currentTestingChildren(block,catalog), catalog, path, [...active, key]) : [])];
  });
}
function previousFlowEntries(before:FlowEntry[],after:FlowEntry[]):Map<string,FlowEntry> {
  const exact=new Map(before.map(entry=>[entry.path,entry]));
  const identity=(entry:FlowEntry)=>`${entry.block.id}@${testingVersionKey(entry.block.definition)}`;
  return new Map(after.flatMap(entry=>{
    const same=exact.get(entry.path);if(same)return [[entry.path,same] as const];
    const old=before.filter(item=>identity(item)===identity(entry)),current=after.filter(item=>identity(item)===identity(entry));
    return old.length===1&&current.length===1?[[entry.path,old[0]] as const]:[];
  }));
}
export function scenarioEditChanges(before: TestingScenario, after: TestingScenario, catalog: TestingCatalog): TestingScenarioEditChange[] {
  const oldEntries = flowEntries(before.blocks, catalog), newEntries = flowEntries(after.blocks, catalog);
  const oldMap = new Map(oldEntries.map(entry => [entry.path, entry]));
  const newMap = new Map(newEntries.map(entry => [entry.path, entry]));
  const previous=previousFlowEntries(oldEntries,newEntries),retained=new Set([...previous.values()].map(entry=>entry.path));
  const changes: TestingScenarioEditChange[] = [];
  for (const entry of oldEntries) if (!retained.has(entry.path)) changes.push({ kind: 'remove', path: entry.path, label: entry.label, before: entry.block });
  for (const entry of newEntries) {
    const old = previous.get(entry.path);
    if (!old) { changes.push({ kind: 'add', path: entry.path, label: entry.label, after: entry.block }); continue; }
    const previousOrder = oldEntries.filter(item => item.parent === entry.parent && newMap.has(item.path)).map(item => item.path);
    const nextOrder = newEntries.filter(item => item.parent === entry.parent && oldMap.has(item.path)).map(item => item.path);
    if(old.parent!==entry.parent) changes.push({kind:'move',path:entry.path,label:entry.label,before:{path:old.path,position:old.index+1},after:{path:entry.path,position:entry.index+1}});
    else if (previousOrder.indexOf(entry.path) !== nextOrder.indexOf(entry.path)) changes.push({ kind: 'move', path: entry.path, label: entry.label, before: old.index + 1, after: entry.index + 1 });
    const comparable = ({ children: _children, outputs, overrides, ...value }: TestingBlockInstance) => ({ ...value, ...(outputs && Object.keys(outputs).length ? { outputs } : {}), ...(overrides && Object.keys(overrides).length ? { overrides } : {}) });
    const oldValue = comparable(old.block), newValue = comparable(entry.block);
    if (stableTestingStringify(oldValue) !== stableTestingStringify(newValue)) changes.push({ kind: 'values', path: entry.path, label: entry.label, before: oldValue, after: newValue });
  }
  for (const [field, label] of [['title', 'Titel'], ['expectedOutcome', 'Erwartetes Ergebnis'], ['knowledgeRefs', 'Wissensquellen'], ['matrix', 'Testmatrix']] as const) {
    if (stableTestingStringify(before[field]) !== stableTestingStringify(after[field])) changes.push({ kind: 'metadata', path: field, label, before: before[field], after: after[field] });
  }
  return changes;
}
export async function planScenarioEdit(input: { id: string; model: TestingModel; request: string; scenario: TestingScenario; catalog: TestingCatalog; signal?: AbortSignal; onEvent?: (event: TestingAgentEvent) => void }) {
  return reviewWithCodex({ id: input.id, model: input.model, prompt: flowRevisionPrompt(input.request), schema: FLOW_EDIT_SCHEMA, label: 'Ablaufüberarbeitung', signal: input.signal, onEvent: input.onEvent,
    files: { ...agentContext(input.catalog, undefined, input.scenario), 'ablauf-positionen.json': JSON.stringify(flowEntries(input.scenario.blocks, input.catalog).map(({ path, parent, index, label, block }) => ({ path, parent, position: index + 1, label, definition: block.definition })), null, 2) },
    validate: raw => {
      const draft = decodeScenarioEdit(raw);
      for (const definition of draft.newDefinitions) if (input.catalog.definitions.some(item => testingVersionKey(item) === testingVersionKey(definition))) throw new Error(`Die vorhandene Definition ${testingVersionKey(definition)} darf nicht neu definiert werden. Verwende die bestehende Version im Ablauf.`);
      for (const document of draft.newKnowledge) if (input.catalog.knowledge.some(item => item.id === document.id && item.revision === document.revision)) throw new Error(`Die vorhandene Wissensrevision ${document.id}@${document.revision} darf nicht überschrieben werden.`);
      // Labels are instance metadata absent from the wire schema. Preserve them
      // for unchanged identities instead of losing them during a flow rewrite.
      const oldEntries=flowEntries(input.scenario.blocks,input.catalog);
      const nextEntries=flowEntries(draft.blocks,{...input.catalog,definitions:[...input.catalog.definitions,...draft.newDefinitions]});
      const labels = new Map([...previousFlowEntries(oldEntries,nextEntries)].filter(([,entry])=>entry.block.label).map(([path,entry])=>[path,entry.block.label!]));
      const restoreLabels = (blocks: TestingBlockInstance[], parent = '') => { for (const block of blocks) { const path = parent ? `${parent}/${block.id}` : block.id; if (labels.has(path)) block.label = labels.get(path); if (block.children) restoreLabels(block.children, path); } };
      restoreLabels(draft.blocks);
      const preview = previewTestingScenarioEdit(input.scenario, draft, input.model, input.catalog);
      if (!preview.compiled.valid) throw new Error(preview.compiled.issues.filter(issue => issue.severity === 'error').map(issue => `${issue.path ?? issue.instanceId ?? 'Testfall'}: ${issue.code}: ${issue.message}`).join('\n'));
      return { draft, scenario: preview.scenario, compiled: preview.compiled, changes: scenarioEditChanges(input.scenario, preview.scenario, preview.catalog) };
    } });
}

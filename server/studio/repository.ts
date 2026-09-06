import { randomUUID } from 'node:crypto';
import { db } from '../store';
import type { BlockDefinition, BlockInstance, BlockValue, DependencyGraph, GraphEdge, GraphNode, PromotionRequest, PromotionResult, RunRecord, Scenario, StudioCatalog, TextResolution, ValueType } from '../../shared/blocks';
import { isEntityReference, isParameterReference, versionKey } from '../../shared/blocks';
import { loadSeedScenarios, loadSourceCatalog } from './catalog';
import { assertScenarioShape, confirmInterpretation, interpretChange, StudioError, validateScenario } from './engine';

export const collections = { scenarios: 'studio_scenarios', revisions: 'studio_scenario_revisions', definitions: 'studio_definitions', resolutions: 'studio_resolutions', layouts: 'studio_layouts', runs: 'studio_runs' } as const;
interface DefinitionRecord { id: string; definition: BlockDefinition }
interface RevisionRecord { id: string; scenario: Scenario }
let initialized = false;
export function getCatalog(): StudioCatalog {
  const source = loadSourceCatalog(), extra = db.read<DefinitionRecord>(collections.definitions).map(record => record.definition);
  const definitions = [...source.definitions];
  for (const def of extra) if (!definitions.some(item => versionKey(item) === versionKey(def))) definitions.push(def);
  return { ...source, definitions };
}
export function allResolutions(): TextResolution[] { return db.read<TextResolution>(collections.resolutions); }
export function getScenario(id: string): Scenario {
  const scenario = db.find<Scenario>(collections.scenarios, id);
  if (!scenario) throw new StudioError('Scenario not found.', 404);
  return scenario;
}
export function allScenarios(): Scenario[] { return db.read<Scenario>(collections.scenarios).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
export function getResolution(id: string): TextResolution {
  const resolution = db.find<TextResolution>(collections.resolutions, id);
  if (!resolution) throw new StudioError('Interpretation record not found.', 404);
  return resolution;
}
export function getRun(id: string): RunRecord {
  const run = db.find<RunRecord>(collections.runs, id);
  if (!run) throw new StudioError('Run not found.', 404);
  return run;
}
function rememberRevision(scenario: Scenario): void {
  const key = `${scenario.id}@${scenario.revision}`;
  if (!db.find<RevisionRecord>(collections.revisions, key)) db.upsert(collections.revisions, { id: key, scenario: structuredClone(scenario) });
}
export function scenarioRevisions(id: string): Scenario[] {
  getScenario(id);
  return db.read<RevisionRecord>(collections.revisions).map(record => record.scenario).filter(scenario => scenario.id === id).sort((a, b) => b.revision - a.revision);
}
export function initializeStudio(): void {
  if (initialized) return;
  const catalog = getCatalog();
  for (const seed of loadSeedScenarios()) {
    if (db.find<Scenario>(collections.scenarios, seed.id)) continue;
    if (seed.id === 'italy-referral') {
      const preview = interpretChange(seed, 'warehouse-country-text', catalog);
      const resolution = confirmInterpretation(preview, seed, 'warehouse-country-text', catalog);
      resolution.source = 'seeded-demo'; resolution.decisionId = `seeded-demo-${resolution.decisionId}`;
      db.upsert(collections.resolutions, resolution);
      walkInstances(seed.blocks, block => { if (block.id === resolution.instanceId) block.resolutionId = resolution.id; });
    }
    rememberRevision(seed); db.upsert(collections.scenarios, seed);
  }
  // An early local seed predates the provenance field. Add only that metadata when
  // the untouched initial scenario still matches its exact original reviewed context.
  const initialItaly = db.find<Scenario>(collections.scenarios, 'italy-referral');
  if (initialItaly?.revision === 1 && initialItaly.createdAt === '2026-09-06T10:00:00.000Z') {
    walkInstances(initialItaly.blocks, block => {
      if (block.id !== 'warehouse-country-text' || !block.resolutionId) return;
      const review = db.find<TextResolution>(collections.resolutions, block.resolutionId);
      if (review?.status !== 'confirmed' || review.source) return;
      try {
        const current = interpretChange(initialItaly, block.id, catalog);
        if (current.fingerprint === review.fingerprint) db.upsert(collections.resolutions, { ...review, source: 'seeded-demo' });
      } catch { /* A modified or unsupported context cannot be classified as the original seed. */ }
    });
  }
  for (const run of db.read<RunRecord>(collections.runs)) {
    if (run.status !== 'running' && run.status !== 'queued') continue;
    const stopped = new Date().toISOString();
    db.upsert(collections.runs, { ...run, status: 'failed', finishedAt: stopped, error: 'The local server stopped before this run completed. Start a new run to retry.', events: run.events.map(event => event.status === 'running' ? { ...event, status: 'failed', finishedAt: stopped, error: 'Execution was interrupted by a server restart.' } : event) });
  }
  initialized = true;
}
export function createScenario(input: Partial<Scenario>): Scenario {
  for (const key of ['name', 'description', 'expectedOutcome'] as const) if (input[key] !== undefined && typeof input[key] !== 'string') throw new StudioError(`Scenario ${key} must be text.`, 400);
  if (input.blocks !== undefined && !Array.isArray(input.blocks)) throw new StudioError('Scenario blocks must be an ordered array.', 400);
  if (input.tags !== undefined && (!Array.isArray(input.tags) || input.tags.some(tag => typeof tag !== 'string'))) throw new StudioError('Scenario tags must be text labels.', 400);
  const now = new Date().toISOString();
  const scenario: Scenario = { id: `scenario-${randomUUID()}`, name: typeof input.name === 'string' && input.name.trim() ? input.name.trim().slice(0, 160) : 'Untitled scenario', description: typeof input.description === 'string' ? input.description.slice(0, 4000) : '', revision: 1, createdAt: now, updatedAt: now, tags: Array.isArray(input.tags) ? input.tags.filter(value => typeof value === 'string').slice(0, 12) : [], blocks: Array.isArray(input.blocks) ? structuredClone(input.blocks) : [], ...(input.expectedOutcome ? { expectedOutcome: input.expectedOutcome } : {}), ...(input.parameters ? { parameters: structuredClone(input.parameters) } : {}) };
  assertScenarioShape(scenario); rememberRevision(scenario); return db.upsert(collections.scenarios, scenario);
}
export function saveScenario(id: string, input: Scenario): Scenario {
  const current = getScenario(id);
  if (input.id !== id) throw new StudioError('The scenario id cannot change during save.', 400);
  if (input.revision !== current.revision) throw new StudioError(`This scenario is now revision ${current.revision}. Reload before saving over another edit.`, 409);
  assertScenarioShape(input);
  const next: Scenario = { ...structuredClone(input), name: input.name.trim().slice(0, 160), description: String(input.description ?? '').slice(0, 4000), tags: Array.isArray(input.tags) ? input.tags.filter(value => typeof value === 'string').slice(0, 12) : [], revision: current.revision + 1, createdAt: current.createdAt, updatedAt: new Date().toISOString() };
  rememberRevision(current); rememberRevision(next); return db.upsert(collections.scenarios, next);
}
export function duplicateScenario(id: string, name?: string): Scenario {
  if (name !== undefined && typeof name !== 'string') throw new StudioError('A duplicate scenario name must be text.', 400);
  const source = getScenario(id);
  // Instance IDs belong to their scenario. A copied scenario keeps meaningful IDs and owns independent inputs.
  return createScenario({ ...source, name: name?.trim() || `${source.name} copy`, tags: [...source.tags.filter(tag => tag !== 'Guided example'), 'Variant'] });
}
export function walkInstances(blocks: BlockInstance[], visitor: (block: BlockInstance, siblings: BlockInstance[], index: number) => void): void {
  for (const [index, block] of blocks.entries()) { visitor(block, blocks, index); if (block.children) walkInstances(block.children, visitor); if (block.changes) walkInstances(block.changes, visitor); }
}
function definitionsUsed(blocks: BlockInstance[], catalog: StudioCatalog, seen = new Set<string>()): Set<string> {
  walkInstances(blocks, block => {
    const key = versionKey(block.definition);
    if (seen.has(key)) return;
    seen.add(key);
    const def = catalog.definitions.find(item => versionKey(item) === key);
    if (def?.body) definitionsUsed(def.body, catalog, seen);
  });
  return seen;
}
export function dependents(definitionId: string): { scenarioId: string; scenarioName: string; revision: number }[] {
  const catalog = getCatalog();
  return allScenarios().filter(scenario => [...definitionsUsed(scenario.blocks, catalog)].some(key => key.startsWith(`${definitionId}@`))).map(scenario => ({ scenarioId: scenario.id, scenarioName: scenario.name, revision: scenario.revision }));
}
function validateWorkflowDefinition(definition: BlockDefinition, catalog: StudioCatalog): void {
  if (definition.kind !== 'workflow') throw new StudioError('The studio publishes reusable workflow definitions. Browser action definitions are maintained in the repository.', 400);
  if (!definition.id || !/^[a-z][a-z0-9._-]+$/.test(definition.id) || !definition.label?.trim() || !Array.isArray(definition.inputs) || !Array.isArray(definition.outputs) || !Array.isArray(definition.body) || !definition.body.length) throw new StudioError('A reusable workflow needs a stable id, label, parameter list, output list and nonempty body.', 400);
  assertScenarioShape({ id: definition.id, name: definition.label, revision: 1, blocks: definition.body });
  const parameterNames = new Set<string>();
  const types = new Set<ValueType>(['String', 'Number', 'Boolean', 'Country', 'Money', 'Date', 'Role', 'LocationName', 'PolicyTemplateRef', 'CustomerFixtureRef', 'DocumentFixtureRef', 'PolicyRef', 'LocationRef', 'QuoteRef', 'ApprovalRef', 'AttemptRef', 'Object']);
  for (const parameter of definition.inputs) {
    if (!parameter || typeof parameter.key !== 'string' || typeof parameter.label !== 'string' || !types.has(parameter.type)) throw new StudioError('Every workflow parameter needs a key, label and supported value type.');
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(parameter.key) || parameterNames.has(parameter.key)) throw new StudioError(`Workflow parameter ${parameter.key} must be unique and use letters, digits or underscores.`);
    if (parameter.options !== undefined && (!Array.isArray(parameter.options) || parameter.options.some(option => !option || typeof option.value !== 'string' || typeof option.label !== 'string'))) throw new StudioError('Parameter options must have text values and labels.');
    parameterNames.add(parameter.key);
  }
  const outputKeys = new Set<string>();
  for (const output of definition.outputs) { if (!output || typeof output.key !== 'string' || !/^[A-Za-z][A-Za-z0-9_]*$/.test(output.key) || outputKeys.has(output.key) || typeof output.label !== 'string' || !types.has(output.type)) throw new StudioError('Each workflow output needs a unique key, label and supported value type.'); outputKeys.add(output.key); }
  if (!Array.isArray(definition.knowledgeRefs) || definition.knowledgeRefs.some(ref => typeof ref !== 'string')) throw new StudioError('Knowledge references must be an array of stable document IDs.');
  if (typeof definition.description !== 'string' || typeof definition.category !== 'string' || typeof definition.owner !== 'string') throw new StudioError('Workflow description, category and owner must be text.');
  const nextCatalog: StudioCatalog = { ...catalog, definitions: [...catalog.definitions.filter(item => versionKey(item) !== versionKey(definition)), definition] };
  const allDefs = new Map(nextCatalog.definitions.map(item => [versionKey(item), item]));
  function follow(def: BlockDefinition, stack: string[]): void {
    const key = versionKey(def);
    if (stack.includes(key)) throw new StudioError(`Workflow cycle detected: ${[...stack, key].join(' → ')}.`);
    if (stack.length > 16) throw new StudioError('Reusable workflows may nest at most 16 levels.');
    walkInstances(def.body ?? [], instance => {
      const child = allDefs.get(versionKey(instance.definition));
      if (!child) throw new StudioError(`Missing dependency ${versionKey(instance.definition)}.`);
      if (child.kind === 'workflow') follow(child, [...stack, key]);
    });
  }
  follow(definition, []);
  const outputSymbols = new Map<string, ValueType>();
  walkInstances(definition.body, block => {
    const def = allDefs.get(versionKey(block.definition));
    for (const [key, symbol] of Object.entries(block.outputs ?? {})) {
      if (outputSymbols.has(symbol)) throw new StudioError(`Workflow output symbol ${symbol} is produced more than once.`);
      const output = def?.outputs.find(item => item.key === key);
      if (!output) throw new StudioError(`Unknown output ${key} on ${def?.label ?? block.definition.id}.`);
      outputSymbols.set(symbol, output.type);
    }
    function checkParams(value: unknown): void {
      if (isParameterReference(value)) { if (!parameterNames.has(value.param)) throw new StudioError(`Unknown workflow parameter ${value.param}.`); return; }
      if (value && typeof value === 'object') Object.values(value).forEach(checkParams);
    }
    checkParams(block.inputs);
  });
  for (const output of definition.outputs) {
    const exported = definition.exports?.[output.key];
    if (!exported || !outputSymbols.has(exported.ref)) throw new StudioError(`Output ${output.label} must export a symbol produced by the workflow.`);
    if (outputSymbols.get(exported.ref) !== output.type) throw new StudioError(`Output ${output.label} has the wrong reference type.`);
  }
  for (const knowledgeRef of definition.knowledgeRefs ?? []) if (!catalog.knowledge.some(item => item.id === knowledgeRef)) throw new StudioError(`Knowledge reference ${knowledgeRef} is unavailable.`);
}
export function publishVersion(id: string, candidate: BlockDefinition): { definition: BlockDefinition; dependents: ReturnType<typeof dependents> } {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new StudioError('A workflow definition object is required.', 400);
  const catalog = getCatalog(), prior = catalog.definitions.filter(item => item.id === id);
  if (!prior.length) throw new StudioError('Shared block definition not found.', 404);
  const definition: BlockDefinition = { ...structuredClone(candidate), id, version: Math.max(...prior.map(item => item.version)) + 1, createdAt: new Date().toISOString(), kind: 'workflow', readiness: 'ready', owner: candidate.owner || 'property-testing' };
  validateWorkflowDefinition(definition, catalog);
  const impact = dependents(id);
  db.upsert(collections.definitions, { id: versionKey(definition), definition });
  return { definition, dependents: impact };
}
export function upgradeScenario(id: string, definitionId: string, fromVersion: number, toVersion: number): Scenario {
  const catalog = getCatalog(), target = catalog.definitions.find(def => def.id === definitionId && def.version === toVersion);
  if (!target) throw new StudioError('Target block version not found.', 404);
  const scenario = structuredClone(getScenario(id)); let count = 0;
  walkInstances(scenario.blocks, block => { if (block.definition.id === definitionId && block.definition.version === fromVersion) { block.definition.version = toVersion; count++; } });
  if (!count) throw new StudioError('This scenario has no direct instances of the selected version. Nested dependencies change only when their enclosing workflow is versioned.', 409);
  const validation = validateScenario(scenario, { catalog, resolutions: allResolutions() });
  if (!validation.valid) throw new StudioError('This upgrade needs input or reference changes before it can be applied.', 422, validation.issues);
  return saveScenario(id, scenario);
}
export function promoteSelection(request: PromotionRequest): PromotionResult {
  if (typeof request.scenarioId !== 'string' || !request.scenarioId || !Array.isArray(request.instanceIds) || !request.instanceIds.length || request.instanceIds.some(id => typeof id !== 'string') || typeof request.name !== 'string' || !request.name.trim()) throw new StudioError('Select a sequence and give the reusable workflow a name.', 400);
  if (request.description !== undefined && typeof request.description !== 'string') throw new StudioError('A workflow description must be text.', 400);
  if (request.parameters !== undefined && (!Array.isArray(request.parameters) || request.parameters.some(parameter => !parameter || typeof parameter.key !== 'string' || typeof parameter.label !== 'string' || typeof parameter.instanceId !== 'string' || typeof parameter.input !== 'string'))) throw new StudioError('Workflow parameters need a key, label and a selected instance/input target.', 400);
  if (request.replaceSelection !== undefined && typeof request.replaceSelection !== 'boolean') throw new StudioError('replaceSelection must be true or false.', 400);
  const scenario = structuredClone(getScenario(request.scenarioId)), catalog = getCatalog(), selected = new Set(request.instanceIds);
  if (selected.size !== request.instanceIds.length) throw new StudioError('Select each block only once.', 400);
  let siblings: BlockInstance[] | undefined; const indices: number[] = [];
  walkInstances(scenario.blocks, (block, list, index) => {
    if (!selected.has(block.id)) return;
    if (siblings && siblings !== list) throw new StudioError('Select an ordered sequence from one container. Select the enclosing actor containers to reuse a flow across roles.');
    siblings = list; indices.push(index);
  });
  if (!siblings || indices.length !== selected.size) throw new StudioError('Some selected blocks are unavailable.', 404);
  indices.sort((a, b) => a - b);
  if (indices.some((index, offset) => index !== indices[0] + offset)) throw new StudioError('Select adjacent blocks so reuse preserves the execution order.');
  const sourceBlocks = siblings.slice(indices[0], indices[0] + indices.length);
  if (sourceBlocks.some(block => ['modifier', 'free-text'].includes(catalog.definitions.find(def => versionKey(def) === versionKey(block.definition))?.kind ?? '') || catalog.definitions.find(def => versionKey(def) === versionKey(block.definition))?.contextType === 'location')) throw new StudioError('Promote an action sequence or actor contexts. Location changes stay attached to their draft-creation action.');
  const body = structuredClone(sourceBlocks), inputs: BlockDefinition['inputs'] = [], instanceInputs: Record<string, BlockValue> = {};
  const allBody = new Map<string, BlockInstance>(); walkInstances(body, block => allBody.set(block.id, block));
  for (const parameter of request.parameters ?? []) {
    const block = allBody.get(parameter.instanceId), def = block ? catalog.definitions.find(item => versionKey(item) === versionKey(block.definition)) : undefined, input = def?.inputs.find(item => item.key === parameter.input);
    if (!block || !input) throw new StudioError(`Parameter ${parameter.label || parameter.key} must target an input inside the selected sequence.`);
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(parameter.key) || inputs.some(item => item.key === parameter.key)) throw new StudioError('Parameter names must be unique and use letters, digits or underscores.');
    const current = block.inputs[parameter.input] ?? input.default;
    if (current === undefined) throw new StudioError(`Set ${input.label} before exposing it as a parameter.`);
    inputs.push({ ...structuredClone(input), key: parameter.key, label: parameter.label || input.label, default: structuredClone(current), required: true });
    instanceInputs[parameter.key] = structuredClone(current); block.inputs[parameter.input] = { param: parameter.key };
  }
  const produced = new Map<string, { type: ValueType; label: string }>();
  walkInstances(body, block => {
    const def = catalog.definitions.find(item => versionKey(item) === versionKey(block.definition));
    for (const [key, name] of Object.entries(block.outputs ?? {})) { const output = def?.outputs.find(item => item.key === key); if (output) produced.set(name, { type: output.type, label: output.label }); }
  });
  // References entering the selection become explicit typed parameters with the current use as default.
  const external = new Map<string, string>();
  walkInstances(body, block => {
    const def = catalog.definitions.find(item => versionKey(item) === versionKey(block.definition));
    for (const [key, value] of Object.entries(block.inputs)) {
      if (!isEntityReference(value) || produced.has(value.ref)) continue;
      let parameter = external.get(value.ref);
      if (!parameter) {
        parameter = value.ref.replace(/[^A-Za-z0-9_]/g, '_'); if (!/^[A-Za-z]/.test(parameter)) parameter = `input_${parameter}`;
        while (inputs.some(item => item.key === parameter)) parameter = `${parameter}_ref`;
        const input = def?.inputs.find(item => item.key === key);
        inputs.push({ key: parameter, label: input?.label || value.ref, type: input?.type || 'Object', required: true, default: structuredClone(value) });
        instanceInputs[parameter] = structuredClone(value); external.set(value.ref, parameter);
      }
      block.inputs[key] = { param: parameter };
    }
  });
  const exports: NonNullable<BlockDefinition['exports']> = {}, outputs: BlockDefinition['outputs'] = [], instanceOutputs: Record<string, string> = {};
  for (const [symbol, output] of produced) {
    let key = symbol.replace(/[^A-Za-z0-9_]/g, '_'); if (!/^[A-Za-z]/.test(key)) key = `output_${key}`;
    while (Object.hasOwn(exports, key)) key += '_out';
    outputs.push({ key, label: output.label, type: output.type }); exports[key] = { ref: symbol }; instanceOutputs[key] = symbol;
  }
  const slug = request.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'custom-workflow';
  let id = `workflow.${slug}`; if (catalog.definitions.some(def => def.id === id)) id += `-${randomUUID().slice(0, 6)}`;
  const knowledgeRefs = new Set<string>(); walkInstances(body, block => catalog.definitions.find(def => versionKey(def) === versionKey(block.definition))?.knowledgeRefs.forEach(ref => knowledgeRefs.add(ref)));
  const definition: BlockDefinition = { id, version: 1, kind: 'workflow', label: request.name.trim().slice(0, 160), description: request.description?.trim() || 'A reusable business sequence promoted from a scenario.', category: 'Reusable workflows', inputs, outputs, body, exports, knowledgeRefs: [...knowledgeRefs], readiness: 'ready', owner: 'property-testing', createdAt: new Date().toISOString(), completion: 'Completion of the saved action sequence' };
  validateWorkflowDefinition(definition, catalog);
  const workflowInstance: BlockInstance = { id: `reuse-${randomUUID().slice(0, 8)}`, definition: { id, version: 1 }, inputs: instanceInputs, outputs: instanceOutputs };
  let resultScenario = scenario;
  if (request.replaceSelection !== false) {
    siblings.splice(indices[0], indices.length, workflowInstance);
    const validation = validateScenario(scenario, { catalog: { ...catalog, definitions: [...catalog.definitions, definition] }, resolutions: allResolutions() });
    if (!validation.valid) throw new StudioError('The promoted sequence needs authoring fixes before it can replace the selection.', 422, validation.issues);
  }
  db.upsert(collections.definitions, { id: versionKey(definition), definition });
  if (request.replaceSelection !== false) resultScenario = saveScenario(scenario.id, scenario);
  return { definition, scenario: resultScenario, dependents: dependents(id) };
}
export function dependencyGraph(scenarioId?: string): DependencyGraph {
  const catalog = getCatalog(), nodes = new Map<string, GraphNode>(), edges = new Map<string, GraphEdge>();
  const addNode = (node: GraphNode) => { if (!nodes.has(node.id)) nodes.set(node.id, node); };
  const edge = (source: string, target: string, relation: string) => { const id = `${source}|${relation}|${target}`; edges.set(id, { id, source, target, relation }); };
  function addKnowledge(id: string): void {
    const key = `knowledge:${id}`; if (nodes.has(key)) return;
    const doc = catalog.knowledge.find(item => item.id === id); if (!doc) return;
    addNode({ id: key, kind: 'knowledge', label: doc.title, description: doc.summary, data: doc });
    for (const link of doc.links) {
      if (link.target.startsWith('block:')) continue;
      const target = catalog.knowledge.find(item => item.id === link.target); if (!target) continue;
      addKnowledge(target.id); edge(key, `knowledge:${target.id}`, link.relation);
    }
  }
  function addDefinition(def: BlockDefinition): void {
    const key = `definition:${versionKey(def)}`; if (nodes.has(key)) return;
    addNode({ id: key, kind: 'definition', label: `${def.label} · v${def.version}`, description: def.description, data: def });
    if (def.implementationRef) {
      const manifest = catalog.implementations.find(item => `${item.id}@${item.revision}` === def.implementationRef);
      const target = `implementation:${def.implementationRef}`; addNode({ id: target, kind: 'implementation', label: manifest ? `${manifest.operation} · r${manifest.revision}` : 'Missing implementation', data: manifest ?? { id: def.implementationRef, missing: true } }); edge(key, target, 'implemented by');
    }
    for (const ref of def.knowledgeRefs) { addKnowledge(ref); if (nodes.has(`knowledge:${ref}`)) edge(key, `knowledge:${ref}`, 'explained by'); }
    if (def.body) addInstances(def.body, key, key);
  }
  function addInstances(blocks: BlockInstance[], parent: string, scope: string): void {
    for (const block of blocks) {
      const key = `${scope}/instance:${block.id}`, def = catalog.definitions.find(item => versionKey(item) === versionKey(block.definition));
      addNode({ id: key, kind: 'instance', label: block.label || def?.label || block.definition.id, data: block }); edge(parent, key, 'contains');
      if (def) { addDefinition(def); edge(key, `definition:${versionKey(def)}`, 'uses pinned version'); }
      const templateRef = typeof block.inputs.template === 'string' ? block.inputs.template : '';
      const template = catalog.templates.find(item => versionKey(item) === templateRef);
      if (template) { const target = `template:${versionKey(template)}`; addNode({ id: target, kind: 'template', label: `${template.label} · v${template.version}`, data: template }); edge(key, target, 'configured from'); for (const ref of template.knowledgeRefs) { addKnowledge(ref); edge(target, `knowledge:${ref}`, 'explained by'); } }
      if (block.resolutionId) { const resolution = db.find<TextResolution>(collections.resolutions, block.resolutionId); if (resolution) { const target = `resolution:${resolution.id}`; addNode({ id: target, kind: 'resolution', label: `${resolution.scope.location} · ${resolution.status}`, data: resolution }); edge(key, target, 'interpreted as'); } }
      if (block.children) addInstances(block.children, key, scope);
      if (block.changes) addInstances(block.changes, key, scope);
    }
  }
  function addScenarioRevision(scenario: Scenario): string {
    const key = `scenario:${scenario.id}@${scenario.revision}`;
    if (!nodes.has(key)) { addNode({ id: key, kind: 'scenario', label: `${scenario.name} · r${scenario.revision}`, description: scenario.description, data: scenario }); addInstances(scenario.blocks, key, key); }
    return key;
  }
  const scenarios = scenarioId ? [getScenario(scenarioId)] : allScenarios();
  for (const scenario of scenarios) {
    const key = `scenario:${scenario.id}`; addNode({ id: key, kind: 'scenario', label: scenario.name, description: 'The scenario identity points to its current saved revision.', data: { id: scenario.id, name: scenario.name, currentRevision: scenario.revision } });
    edge(key, addScenarioRevision(scenario), 'has current revision');
  }
  if (!scenarioId) for (const definition of catalog.definitions) addDefinition(definition);
  for (const run of db.read<RunRecord>(collections.runs).filter(item => !scenarioId || item.scenarioId === scenarioId)) { const key = `run:${run.id}`; addNode({ id: key, kind: 'run', label: `${run.status} · ${run.scenarioName} r${run.scenarioRevision}`, data: run }); edge(key, addScenarioRevision(run.compiled.scenario), 'executed revision'); }
  return { nodes: [...nodes.values()], edges: [...edges.values()].filter(item => nodes.has(item.source) && nodes.has(item.target)) };
}

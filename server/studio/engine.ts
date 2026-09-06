import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type {
  ActorRole, BlockDefinition, BlockInstance, BlockValue, CompiledScenario, CompiledStep,
  PolicyConfiguration, PolicyTemplate, ResolvedChange, ResolvedConfiguration, Scenario,
  StudioCatalog, TextResolution, ValidationIssue, ValidationResult, ValueType, VersionRef,
} from '../../shared/blocks';
import { isEntityReference, isParameterReference, versionKey } from '../../shared/blocks';

export class StudioError extends Error {
  status: number; issues?: ValidationIssue[];
  constructor(message: string, status = 422, issues?: ValidationIssue[]) { super(message); this.status = status; this.issues = issues; }
}
export function stableJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.keys(value as object).sort().map(key => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
}
export function fingerprint(value: unknown): string { return createHash('sha256').update(stableJson(value)).digest('hex'); }
function applicationBuild(): string {
  if (process.env.FOLIO_APP_BUILD) return process.env.FOLIO_APP_BUILD;
  const root = resolve(process.cwd()), hash = createHash('sha256');
  function visit(path: string): void {
    if (!existsSync(path)) return;
    for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = join(path, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (/\.(?:tsx?|css|json)$/.test(entry.name)) { hash.update(relative(root, absolute)); hash.update(readFileSync(absolute)); }
    }
  }
  visit(join(root, 'src')); visit(join(root, 'server', 'insurance')); hash.update(readFileSync(join(root, 'shared', 'insurance.ts')));
  return `meridian-${hash.digest('hex').slice(0, 16)}`;
}
export function parseVersionRef(value: unknown): VersionRef | undefined {
  if (typeof value !== 'string') return undefined;
  const match = /^(.*)@(\d+)$/.exec(value);
  return match ? { id: match[1], version: Number(match[2]) } : undefined;
}
function clone<T>(value: T): T { return structuredClone(value); }
function valueOf(value: unknown): BlockValue { return clone(value) as BlockValue; }
function dateValues(asOf: Date): { inception: string; expiry: string; amendment: string } {
  const start = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() + 1, 1));
  return { inception: start.toISOString().slice(0, 10), expiry: new Date(Date.UTC(start.getUTCFullYear() + 1, start.getUTCMonth(), 0)).toISOString().slice(0, 10), amendment: new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)).toISOString().slice(0, 10) };
}
export function resolveTemplate(template: PolicyTemplate, asOf = new Date()): PolicyConfiguration {
  const result = clone(template.configuration), dates = dateValues(asOf);
  if (result.inceptionDate === '$next-month-start') result.inceptionDate = dates.inception;
  if (result.expiryDate === '$next-year-end') result.expiryDate = dates.expiry;
  return result;
}
const addresses: Record<string, Record<string, { line1: string; city: string; postcode: string }>> = {
  Warehouse: { DE: { line1: 'Hafenstrasse 42', city: 'Hamburg', postcode: '20457' }, IT: { line1: 'Via delle Officine 24', city: 'Milan', postcode: '20126' } },
  Factory: { DE: { line1: 'Werkstrasse 18', city: 'Stuttgart', postcode: '70327' }, IT: { line1: 'Via della Produzione 8', city: 'Turin', postcode: '10156' } },
};
function locationValue(configuration: PolicyConfiguration, locationName: string, field: string): BlockValue {
  const location = configuration.locations.find(item => item.name === locationName);
  if (!location) throw new StudioError(`The template has no insured location named ${locationName}.`);
  if (field === 'country') return location.country;
  if (field === 'address') return valueOf(location.address);
  if (field === 'sumInsured') return location.sumInsured;
  const coverage = /^coverages\.(.+)\.limit$/.exec(field);
  if (coverage) return location.coverages.find(item => item.type === coverage[1])?.limit ?? 0;
  throw new StudioError(`Unsupported configuration field ${field}.`);
}
function changesFor(configuration: PolicyConfiguration, location: string, kind: 'country' | 'sumInsured' | 'flood', value: BlockValue): ResolvedChange[] {
  const change = (field: string, next: BlockValue, label: string): ResolvedChange => ({ field: `locations.${location}.${field}`, value: next, previousValue: locationValue(configuration, location, field), label });
  if (kind === 'country') {
    if (value !== 'DE' && value !== 'IT') throw new StudioError('This product supports insured locations in Germany or Italy.');
    const address = addresses[location]?.[value];
    if (!address) throw new StudioError(`There is no reviewed ${value} address fixture for ${location}.`);
    return [change('country', value, `${location} country`), change('address', valueOf(address), `${location} address`)];
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 1000000000) throw new StudioError('Use a positive amount of at most EUR 1,000,000,000.');
  if (kind === 'sumInsured') return [change('sumInsured', value, `${location} sum insured`), change('coverages.Fire.limit', value, `${location} Fire limit`)];
  return [change('coverages.Flood.limit', value, `${location} Flood limit`)];
}
function applyChange(configuration: PolicyConfiguration, change: ResolvedChange): void {
  const match = /^locations\.([^.]+)\.(.+)$/.exec(change.field);
  if (!match) throw new StudioError(`Unsupported resolved field ${change.field}.`);
  const location = configuration.locations.find(item => item.name === match[1]);
  if (!location) throw new StudioError(`Unknown location ${match[1]}.`);
  const field = match[2];
  if (field === 'country') location.country = change.value as 'DE' | 'IT';
  else if (field === 'address') location.address = clone(change.value) as unknown as typeof location.address;
  else if (field === 'sumInsured') location.sumInsured = change.value as number;
  else {
    const coverage = /^coverages\.(Fire|Flood)\.limit$/.exec(field);
    if (!coverage) throw new StudioError(`Unsupported resolved field ${field}.`);
    const item = location.coverages.find(entry => entry.type === coverage[1]);
    if (item) item.limit = change.value as number;
    else location.coverages.push({ type: coverage[1] as 'Fire' | 'Flood', limit: change.value as number, deductible: coverage[1] === 'Flood' ? 5000 : 2500 });
  }
}

interface TextContext { instance: BlockInstance; location: string; scopeInputs: Record<string, BlockValue>; creationInputs: Record<string, BlockValue>; template: PolicyTemplate }
function findTextContext(scenario: Scenario, instanceId: string, catalog: StudioCatalog): TextContext {
  let found: TextContext | undefined;
  function visit(blocks: BlockInstance[], creation?: BlockInstance, location?: BlockInstance, depth = 0): void {
    if (depth > 24) throw new StudioError('Scenario nesting exceeds 24 levels.');
    for (const block of blocks) {
      const def = catalog.definitions.find(item => item.id === block.definition?.id && item.version === block.definition?.version);
      const currentCreation = def?.operation === 'createDraft' ? block : creation;
      const currentLocation = def?.contextType === 'location' ? block : location;
      if (block.id === instanceId) {
        if (def?.kind !== 'free-text') throw new StudioError('Interpretation requires a free-text modifier.');
        if (!currentCreation || !currentLocation) throw new StudioError('Put this change inside a named location under Create standard policy.');
        const createDef = catalog.definitions.find(item => item.id === currentCreation.definition.id && item.version === currentCreation.definition.version)!;
        const creationInputs = defaultsFor(createDef, currentCreation.inputs);
        const templateRef = parseVersionRef(creationInputs.template);
        const template = catalog.templates.find(item => templateRef && item.id === templateRef.id && item.version === templateRef.version);
        if (!template) throw new StudioError('Select a known, versioned policy template before interpreting a change.');
        if (typeof currentLocation.inputs.location !== 'string') throw new StudioError('Select a named location before interpreting a change.');
        found = { instance: block, location: currentLocation.inputs.location, scopeInputs: currentLocation.inputs, creationInputs, template };
      }
      if (block.children) visit(block.children, currentCreation, currentLocation, depth + 1);
      if (block.changes) visit(block.changes, currentCreation, currentLocation, depth + 1);
    }
  }
  visit(scenario.blocks ?? []);
  if (!found) throw new StudioError(`Free-text block ${instanceId} was not found.`, 404);
  return found;
}
function textFingerprint(context: TextContext): string {
  return fingerprint({ text: context.instance.inputs.text, location: context.location, scopeInputs: context.scopeInputs, creationInputs: context.creationInputs, template: context.template, parser: 'local-vocabulary-v1', knowledgeRevision: 'knowledge-1' });
}
function parseAmount(raw: string, scale: string | undefined): number {
  let normalized = raw.trim().replace(/\s/g, '');
  if (/^\d{1,3}(,\d{3})+$/.test(normalized)) normalized = normalized.replace(/,/g, '');
  else if (/^\d{1,3}(\.\d{3})+$/.test(normalized)) normalized = normalized.replace(/\./g, '');
  else if (normalized.includes(',') && !normalized.includes('.')) normalized = normalized.replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(normalized)) throw new StudioError('Use an unambiguous amount, for example EUR 1,000,000 or 1.5m.');
  return Number(normalized) * (scale === 'm' || scale === 'million' ? 1000000 : scale === 'k' || scale === 'thousand' ? 1000 : 1);
}
export function interpretChange(scenario: Scenario, instanceId: string, catalog: StudioCatalog): TextResolution {
  const context = findTextContext(scenario, instanceId, catalog);
  const text = context.instance.inputs.text;
  if (typeof text !== 'string' || !text.trim()) throw new StudioError('Write a concrete location change before interpreting it.');
  if (text.length > 1000) throw new StudioError('Keep a local change request under 1,000 characters.');
  const normalized = text.trim().toLowerCase().replace(/[.!]$/g, '').replace(/\s+/g, ' ');
  const clauses = normalized.split(/\s+and\s+|\s*;\s*|\n/).filter(Boolean);
  const changes: ResolvedChange[] = [], seen = new Map<string, string>();
  for (const clause of clauses) {
    const explicitLocation = /\b(warehouse|factory)\b/.exec(clause)?.[1];
    if (explicitLocation && explicitLocation !== context.location.toLowerCase()) throw new StudioError(`This block targets ${context.location}, but the request names ${explicitLocation}. Move the block to that location or change the text.`);
    const country = /^(?:(?:move|set)\s+)?(?:(?:this|the)\s+location|warehouse|factory|country|location)?\s*(?:(?:country\s+)?(?:should|must)\s+be|(?:country\s+)?(?:to|in|is|be)|country\s+to)?\s*(?:in|to)?\s*(italy|germany|it|de)(?:\s+instead\s+of\s+(?:germany|italy|de|it))?$/.exec(clause);
    const amount = /^(?:(?:set|increase|change|add)\s+)?(?:the\s+)?(?:warehouse\s+|factory\s+|this location(?:'s)?\s+)?(sum insured|flood(?: coverage)?(?: limit)?)(?:\s+(?:to|of|at|is|should be))?\s*(?:€|eur)?\s*(\d[\d.,\s]*?)\s*(m|k|million|thousand)?(?:\s*(?:eur|euros?))?$/.exec(clause);
    let resolved: ResolvedChange[];
    if (country) resolved = changesFor(context.template.configuration, context.location, 'country', ['italy', 'it'].includes(country[1]) ? 'IT' : 'DE');
    else if (amount) resolved = changesFor(context.template.configuration, context.location, amount[1] === 'sum insured' ? 'sumInsured' : 'flood', parseAmount(amount[2], amount[3]));
    else throw new StudioError('This local vocabulary needs a precise supported change. Try "This location should be in Italy instead of Germany", "Set sum insured to EUR 2,000,000", or "Set flood limit to 1m".');
    for (const change of resolved) {
      const prior = seen.get(change.field);
      if (prior && prior !== stableJson(change.value)) throw new StudioError(`The text assigns conflicting values to ${change.label}.`);
      if (!prior) changes.push(change);
      seen.set(change.field, stableJson(change.value));
    }
  }
  return {
    id: `resolution-${randomUUID()}`, instanceId, originalText: text,
    scope: { entityType: 'insured_location', location: context.location }, template: { id: context.template.id, version: context.template.version },
    fingerprint: textFingerprint(context), parser: 'local-vocabulary-v1', knowledgeRevision: 'knowledge-1', changes,
    preserved: [{ field: 'customer.headquartersCountry', value: context.template.configuration.customer.headquartersCountry, label: 'Customer headquarters' }, { field: 'issuingMarket', value: context.template.configuration.issuingMarket, label: 'Policy issuing market' }, ...context.template.configuration.locations.filter(location => location.name !== context.location).flatMap(location => [{ field: `locations.${location.name}.country`, value: location.country, label: `${location.name} country` }, { field: `locations.${location.name}.address`, value: valueOf(location.address), label: `${location.name} address` }])],
    status: 'preview', source: 'author', createdAt: new Date().toISOString(),
  };
}
export function confirmInterpretation(resolution: TextResolution, scenario: Scenario, instanceId: string, catalog: StudioCatalog): TextResolution {
  const context = findTextContext(scenario, instanceId, catalog);
  if (resolution.instanceId !== instanceId || resolution.fingerprint !== textFingerprint(context)) throw new StudioError('The text, scope or template changed after preview. Interpret this change again before confirming.', 409);
  return { ...resolution, status: 'confirmed', confirmedAt: new Date().toISOString(), decisionId: `decision-${randomUUID()}` };
}
function defaultsFor(def: BlockDefinition, inputs: Record<string, BlockValue>): Record<string, BlockValue> {
  return { ...Object.fromEntries(def.inputs.filter(input => input.default !== undefined).map(input => [input.key, clone(input.default!)])), ...clone(inputs ?? {}) };
}
function resolveValues(value: BlockValue, parameters: Record<string, BlockValue>, names: Map<string, string>): BlockValue {
  if (isParameterReference(value)) return Object.hasOwn(parameters, value.param) ? resolveValues(parameters[value.param], {}, names) : value;
  if (isEntityReference(value)) return { ...value, ref: names.get(value.ref) ?? value.ref };
  if (Array.isArray(value)) return value.map(item => resolveValues(item, parameters, names));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveValues(item, parameters, names)]));
  return value;
}
function containsParameter(value: unknown): boolean {
  if (isParameterReference(value)) return true;
  if (value && typeof value === 'object') return Object.values(value).some(containsParameter);
  return false;
}
function referenceType(type: ValueType): boolean { return ['PolicyRef', 'LocationRef', 'QuoteRef', 'ApprovalRef', 'AttemptRef'].includes(type); }
function acceptsReference(wanted: ValueType, actual: ValueType): boolean { return wanted === actual || (wanted === 'ApprovalRef' && actual === 'QuoteRef') || (wanted === 'QuoteRef' && actual === 'ApprovalRef'); }
export function assertScenarioShape(scenario: unknown): asserts scenario is Scenario {
  if (!scenario || typeof scenario !== 'object' || Array.isArray(scenario)) throw new StudioError('A scenario object is required.', 400);
  const value = scenario as Scenario;
  if (typeof value.id !== 'string' || !value.id || typeof value.name !== 'string' || !value.name.trim() || !Array.isArray(value.blocks)) throw new StudioError('A scenario needs an id, name and ordered blocks.', 400);
  if (!Number.isInteger(value.revision) || value.revision < 1) throw new StudioError('A scenario revision must be a positive integer.', 400);
  for (const key of ['description', 'expectedOutcome', 'createdAt', 'updatedAt'] as const) if (value[key] !== undefined && typeof value[key] !== 'string') throw new StudioError(`Scenario ${key} must be text.`, 400);
  if (value.tags !== undefined && (!Array.isArray(value.tags) || value.tags.some(tag => typeof tag !== 'string'))) throw new StudioError('Scenario tags must be an array of text labels.', 400);
  for (const key of ['createdAt', 'updatedAt'] as const) if (value[key] !== undefined && Number.isNaN(Date.parse(value[key]))) throw new StudioError(`Scenario ${key} must be an ISO timestamp.`, 400);
  function jsonValue(input: unknown, depth = 0): void {
    if (depth > 32) throw new StudioError('Input values may nest at most 32 levels.', 400);
    if (input === null || typeof input === 'string' || typeof input === 'boolean') return;
    if (typeof input === 'number' && Number.isFinite(input)) return;
    if (Array.isArray(input)) { for (const item of input) jsonValue(item, depth + 1); return; }
    if (!input || typeof input !== 'object' || Object.getPrototypeOf(input) !== Object.prototype) throw new StudioError('Block inputs must contain JSON values, typed references or workflow parameters.', 400);
    const record = input as Record<string, unknown>;
    if ('ref' in record && (typeof record.ref !== 'string' || !record.ref.trim() || Object.keys(record).some(key => key !== 'ref' && key !== 'type') || record.type !== undefined && typeof record.type !== 'string')) throw new StudioError('An entity reference must contain a logical ref name and optional type.', 400);
    if ('param' in record && (typeof record.param !== 'string' || !record.param.trim() || Object.keys(record).some(key => key !== 'param'))) throw new StudioError('A parameter reference must contain one parameter name.', 400);
    for (const item of Object.values(record)) jsonValue(item, depth + 1);
  }
  if (value.parameters !== undefined) { if (!value.parameters || typeof value.parameters !== 'object' || Array.isArray(value.parameters)) throw new StudioError('Scenario parameters must be an input object.', 400); jsonValue(value.parameters); }
  const ids = new Set<string>(); let count = 0;
  function visit(blocks: BlockInstance[], depth: number): void {
    if (depth > 24) throw new StudioError('Scenario nesting exceeds 24 levels.', 400);
    for (const block of blocks) {
      count++;
      if (count > 1000) throw new StudioError('A scenario may contain at most 1,000 block instances.', 400);
      if (!block || typeof block !== 'object' || typeof block.id !== 'string' || !block.id || block.id.length > 160 || !block.definition || typeof block.definition.id !== 'string' || !block.definition.id || !Number.isInteger(block.definition.version) || block.definition.version < 1 || !block.inputs || typeof block.inputs !== 'object' || Array.isArray(block.inputs)) throw new StudioError('Each block needs a stable id, a pinned definition and an input object.', 400);
      if (ids.has(block.id)) throw new StudioError(`Duplicate block instance id ${block.id}.`, 400);
      ids.add(block.id);
      jsonValue(block.inputs);
      if (block.outputs !== undefined && (!block.outputs || typeof block.outputs !== 'object' || Array.isArray(block.outputs) || Object.values(block.outputs).some(name => typeof name !== 'string' || !name.trim() || name.length > 240))) throw new StudioError('Block outputs must be a map of output keys to logical reference names.', 400);
      if (block.label !== undefined && typeof block.label !== 'string' || block.resolutionId !== undefined && typeof block.resolutionId !== 'string') throw new StudioError('Block labels and interpretation references must be text.', 400);
      if (block.children !== undefined) { if (!Array.isArray(block.children)) throw new StudioError('Action children must be an array.', 400); visit(block.children, depth + 1); }
      if (block.changes !== undefined) { if (!Array.isArray(block.changes)) throw new StudioError('Configuration changes must be an array.', 400); visit(block.changes, depth + 1); }
    }
  }
  visit(value.blocks, 0);
}

interface CompileOptions { catalog: StudioCatalog; resolutions?: TextResolution[]; asOf?: Date }
interface SymbolInfo { type: ValueType; policyKey?: string; location?: string }
interface PolicyState { status: string; referralLocations: string[]; surveys: Set<string>; quote?: string }
interface BuildResult { steps: CompiledStep[]; validation: ValidationResult; blockVersions: VersionRef[]; templateVersions: VersionRef[]; resolutionIds: string[] }
function build(scenario: Scenario, options: CompileOptions): BuildResult {
  assertScenarioShape(scenario);
  const { catalog } = options, asOf = options.asOf ?? new Date();
  const defs = new Map(catalog.definitions.map(def => [versionKey(def), def]));
  const resolutions = new Map((options.resolutions ?? []).map(resolution => [resolution.id, resolution]));
  const issues: ValidationIssue[] = [], steps: CompiledStep[] = [], configs: ResolvedConfiguration[] = [];
  const dependencies = new Map<string, VersionRef>(), templates = new Map<string, VersionRef>(), usedResolutions = new Set<string>();
  const symbols = new Map<string, SymbolInfo>(), policies = new Map<string, PolicyState>();
  const issue = (code: string, message: string, instanceId?: string, field?: string, severity: 'error' | 'warning' = 'error') => issues.push({ code, message, severity, instanceId, field });
  function definition(instance: BlockInstance, path: string): BlockDefinition | undefined {
    const def = defs.get(versionKey(instance.definition));
    if (!def) { issue('MISSING_DEFINITION', `Block definition ${versionKey(instance.definition)} is unavailable.`, path); return undefined; }
    dependencies.set(versionKey(def), { id: def.id, version: def.version });
    return def;
  }
  function validateInputs(def: BlockDefinition, inputs: Record<string, BlockValue>, path: string): void {
    for (const input of def.inputs) {
      const value = inputs[input.key];
      if (value === undefined || value === null || value === '') { if (input.required) issue('MISSING_INPUT', `${input.label} is required.`, path, input.key); continue; }
      if (containsParameter(value)) { issue('UNRESOLVED_PARAMETER', `${input.label} contains an unresolved workflow parameter.`, path, input.key); continue; }
      if (referenceType(input.type)) {
        if (!isEntityReference(value)) { issue('WRONG_REFERENCE_TYPE', `${input.label} requires a ${input.type} output reference.`, path, input.key); continue; }
        const symbol = symbols.get(value.ref);
        if (!symbol) issue('UNKNOWN_REFERENCE', `Output ${value.ref} must be produced before ${def.label}.`, path, input.key);
        else if (!acceptsReference(input.type, symbol.type)) issue('WRONG_REFERENCE_TYPE', `${input.label} expects ${input.type}, but ${value.ref} is ${symbol.type}.`, path, input.key);
        continue;
      }
      let valid = true;
      if (['Money', 'Number'].includes(input.type)) valid = typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1000000000;
      else if (input.type === 'Boolean') valid = typeof value === 'boolean';
      else if (input.type === 'Object') valid = !!value && typeof value === 'object' && !isEntityReference(value);
      else valid = typeof value === 'string';
      if (input.type === 'Date' && typeof value === 'string') valid = value === '$term-month-two' || /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
      if (input.options && typeof value === 'string') valid = input.options.some(option => option.value === value);
      if (!valid) issue('INVALID_INPUT', `${input.label} must be a valid ${input.type}.`, path, input.key);
    }
    for (const key of Object.keys(inputs)) if (!def.inputs.some(input => input.key === key)) issue('UNKNOWN_INPUT', `${def.label} has no input named ${key}.`, path, key);
  }
  function resolveConfiguration(instance: BlockInstance, inputs: Record<string, BlockValue>, path: string, parameters: Record<string, BlockValue>, names: Map<string, string>): PolicyConfiguration | undefined {
    const ref = parseVersionRef(inputs.template), selectedTemplate = catalog.templates.find(item => ref && item.id === ref.id && item.version === ref.version);
    if (!selectedTemplate) { issue('MISSING_TEMPLATE', 'Select an available, versioned policy template.', path, 'template'); return undefined; }
    const template: PolicyTemplate = selectedTemplate;
    if (inputs.customer !== 'synthetic-manufacturer@1') issue('MISSING_FIXTURE', 'The customer fixture must be synthetic-manufacturer@1.', path, 'customer');
    templates.set(versionKey(template), { id: template.id, version: template.version });
    const defaults = resolveTemplate(template, asOf), configuration = clone(defaults), explicit = new Map<string, { value: string; instanceId: string }>(), changes: ResolvedChange[] = [];
    function visit(blocks: BlockInstance[], scope?: { location: string; inputs: Record<string, BlockValue> }, parentPath = path, depth = 0): void {
      if (depth > 24) { issue('NESTING_LIMIT', 'Configuration nesting exceeds 24 levels.', parentPath); return; }
      for (const block of blocks) {
        const blockPath = `${parentPath}/${block.id}`, def = definition(block, blockPath);
        if (!def) continue;
        const values = resolveValues(defaultsFor(def, block.inputs), parameters, names) as Record<string, BlockValue>;
        validateInputs(def, values, blockPath);
        if (block.children?.length) issue('CONFIGURATION_ACTION_MIX', 'Configuration scopes cannot contain ordered actions.', blockPath);
        if (def.contextType === 'location') {
          if (scope) issue('NESTED_LOCATION_SCOPE', 'A location scope cannot contain another location scope.', blockPath);
          if (typeof values.location !== 'string' || !configuration.locations.some(location => location.name === values.location)) { issue('UNKNOWN_LOCATION', 'Select a named location in the policy template.', blockPath); continue; }
          visit(block.changes ?? [], { location: values.location, inputs: values }, blockPath, depth + 1); continue;
        }
        if (!['modifier', 'free-text'].includes(def.kind)) { issue('CONFIGURATION_ACTION_MIX', 'Only scoped modifiers belong under policy changes.', blockPath); continue; }
        if (!scope) { issue('MISSING_LOCATION_SCOPE', 'Place this modifier inside For location.', blockPath); continue; }
        if (block.changes?.length) issue('INVALID_CONFIGURATION_CHILDREN', 'A modifier does not accept nested changes.', blockPath);
        let proposed: ResolvedChange[] = [];
        try {
          if (def.id === 'location.set-country') proposed = changesFor(defaults, scope.location, 'country', values.country);
          else if (def.id === 'location.set-sum-insured') proposed = changesFor(defaults, scope.location, 'sumInsured', values.amount);
          else if (def.id === 'location.add-flood') proposed = changesFor(defaults, scope.location, 'flood', values.limit);
          else if (def.kind === 'free-text') {
            const resolution = block.resolutionId ? resolutions.get(block.resolutionId) : undefined;
            const context: TextContext = { instance: { ...block, inputs: values }, location: scope.location, scopeInputs: scope.inputs, creationInputs: inputs, template };
            if (!resolution || resolution.status !== 'confirmed') { issue('UNCONFIRMED_TEXT', 'Interpret and confirm this text before running.', blockPath); continue; }
            if (resolution.fingerprint !== textFingerprint(context)) { issue('STALE_TEXT_CONFIRMATION', 'Text, scope or template changed. Interpret and confirm this change again.', blockPath); continue; }
            proposed = clone(resolution.changes); usedResolutions.add(resolution.id);
          } else { issue('MISSING_MODIFIER_IMPLEMENTATION', `No configuration resolver exists for ${def.label}.`, blockPath); continue; }
          for (const change of proposed) {
            const prior = explicit.get(change.field), serialized = stableJson(change.value);
            if (prior && prior.value !== serialized) { issue('CONFLICTING_MODIFIERS', `${change.label} has conflicting explicit values. Resolve the conflict instead of relying on block order.`, blockPath, change.field); continue; }
            if (!prior) { explicit.set(change.field, { value: serialized, instanceId: blockPath }); changes.push(change); applyChange(configuration, change); }
          }
        } catch (error) { issue('INVALID_MODIFIER', error instanceof Error ? error.message : String(error), blockPath); }
      }
    }
    visit(instance.changes ?? []);
    const referralLocations = configuration.locations.filter(location => location.coverages.some(coverage => coverage.type === 'Flood' && coverage.limit > 500000)).map(location => location.name);
    configs.push({ instanceId: path, template: { id: template.id, version: template.version }, defaults, configuration, changes, referralLocations });
    return configuration;
  }
  function stepState(step: CompiledStep, def: BlockDefinition, configuration?: PolicyConfiguration): void {
    for (const key of Object.keys(step.outputs)) if (!def.outputs.some(output => output.key === key)) issue('UNKNOWN_OUTPUT', `${def.label} has no output named ${key}.`, step.instanceId, key);
    const symbolInput = (key: string): SymbolInfo | undefined => isEntityReference(step.inputs[key]) ? symbols.get(step.inputs[key].ref) : undefined;
    const policyInfo = symbolInput('policy'), quoteInfo = symbolInput('quote'), locationInfo = symbolInput('location');
    const policyKey = policyInfo?.policyKey, state = policyKey ? policies.get(policyKey) : undefined;
    if (quoteInfo?.policyKey && policyKey && quoteInfo.policyKey !== policyKey) issue('REFERENCE_POLICY_MISMATCH', 'The quote belongs to a different policy reference.', step.instanceId, 'quote');
    if (locationInfo?.policyKey && policyKey && locationInfo.policyKey !== policyKey) issue('REFERENCE_POLICY_MISMATCH', 'The location belongs to a different policy reference.', step.instanceId, 'location');
    if (step.operation === 'requestQuote' && state) { if (state.status === 'Issued') issue('INVALID_SEQUENCE', 'An issued policy cannot request a draft quote.', step.instanceId); state.status = state.referralLocations.length ? 'Referred' : 'Quoted'; state.quote = step.outputs.quote; }
    if (step.operation === 'attachSurvey' && state && locationInfo?.location) { if (step.inputs.document !== 'approved-synthetic-survey@1') issue('MISSING_FIXTURE', 'Select the approved synthetic survey fixture.', step.instanceId, 'document'); state.surveys.add(locationInfo.location); }
    if (step.operation === 'approveQuote' && state) {
      if (state.status !== 'Referred') issue('INVALID_SEQUENCE', 'Approval requires a referred quote request.', step.instanceId);
      for (const location of state.referralLocations) if (!state.surveys.has(location)) issue('MISSING_SURVEY', `${location} needs suitable survey evidence before approval.`, step.instanceId);
      state.status = 'Approved';
    }
    if (step.operation === 'issuePolicy' && state) { if (!['Approved', 'Quoted'].includes(state.status)) issue('INVALID_SEQUENCE', 'Issue policy requires an approved or straight-through quoted request.', step.instanceId); state.status = 'Issued'; }
    if (step.operation === 'amendPolicy' && state && state.status !== 'Issued') issue('INVALID_SEQUENCE', 'An amendment requires an issued policy.', step.instanceId);
    if (step.operation === 'expectSchedule' && state && state.status !== 'Issued') issue('INVALID_SEQUENCE', 'A policy schedule requires an issued policy.', step.instanceId);
    for (const output of def.outputs) {
      const name = step.outputs[output.key];
      if (!name || !/^[A-Za-z0-9_][A-Za-z0-9_.:/-]*$/.test(name)) { issue('INVALID_OUTPUT', `${output.label} needs a logical output name.`, step.instanceId, output.key); continue; }
      if (symbols.has(name)) { issue('DUPLICATE_OUTPUT', `Logical output ${name} is already defined. Give this instance its own output name.`, step.instanceId, output.key); continue; }
      const creationKey = step.operation === 'createDraft' ? step.outputs.policy : policyKey ?? quoteInfo?.policyKey;
      symbols.set(name, { type: output.type, policyKey: creationKey, ...(output.type === 'LocationRef' ? { location: output.key === 'warehouse' ? 'Warehouse' : 'Factory' } : {}) });
    }
    if (step.operation === 'createDraft' && configuration) policies.set(step.outputs.policy, { status: 'Draft', referralLocations: configuration.locations.filter(location => location.coverages.some(coverage => coverage.type === 'Flood' && coverage.limit > 500000)).map(location => location.name), surveys: new Set() });
  }
  function collectOutputs(blocks: BlockInstance[], map: Map<string, string>, prefix: string): void {
    for (const block of blocks) {
      for (const name of Object.values(block.outputs ?? {})) map.set(name, `${prefix}:${name}`);
      if (block.children) collectOutputs(block.children, map, prefix);
    }
  }
  function expand(blocks: BlockInstance[], actor: ActorRole | undefined, parameters: Record<string, BlockValue>, names: Map<string, string>, prefix = '', ancestors: string[] = [], stack: string[] = []): void {
    if (stack.length > 16 || ancestors.length > 32) { issue('NESTING_LIMIT', 'Workflow expansion exceeds the supported nesting depth.', prefix); return; }
    for (const block of blocks) {
      if (steps.length >= 1000) { issue('STEP_LIMIT', 'Expanded scenarios may contain at most 1,000 business steps.', prefix); return; }
      const path = prefix ? `${prefix}/${block.id}` : block.id, def = definition(block, path);
      if (!def) continue;
      const inputs = resolveValues(defaultsFor(def, block.inputs), parameters, names) as Record<string, BlockValue>;
      validateInputs(def, inputs, path);
      if (def.contextType === 'actor') {
        if (block.changes?.length) issue('CONFIGURATION_ACTION_MIX', 'Actor contexts accept ordered actions, not configuration changes.', path);
        const role = inputs.role;
        if (role !== 'Broker' && role !== 'Senior underwriter') { issue('INVALID_ACTOR', 'Select Broker or Senior underwriter.', path); continue; }
        expand(block.children ?? [], role, parameters, names, prefix, [...ancestors, path], stack); continue;
      }
      if (def.kind === 'workflow') {
        const key = versionKey(def);
        if (stack.includes(key)) { issue('WORKFLOW_CYCLE', `Workflow cycle detected: ${[...stack, key].join(' → ')}.`, path); continue; }
        if (!def.body?.length) { issue('EMPTY_WORKFLOW', 'A reusable workflow needs a body.', path); continue; }
        if (block.children?.length || block.changes?.length) issue('WORKFLOW_BODY_OVERRIDE', 'Use workflow parameters for a local change, or publish a new shared version for body edits.', path);
        const localNames = new Map<string, string>(); collectOutputs(def.body, localNames, path);
        for (const output of def.outputs) {
          const exported = def.exports?.[output.key], target = block.outputs?.[output.key];
          if (!exported || !target) { issue('MISSING_WORKFLOW_OUTPUT', `${output.label} needs an export and instance output name.`, path, output.key); continue; }
          if (!localNames.has(exported.ref)) issue('UNKNOWN_WORKFLOW_EXPORT', `Workflow output ${output.key} refers to unknown ${exported.ref}.`, path);
          localNames.set(exported.ref, names.get(target) ?? target);
        }
        expand(def.body, actor, inputs, localNames, path, [...ancestors, path], [...stack, key]);
        for (const output of def.outputs) {
          const name = block.outputs?.[output.key], symbol = name ? symbols.get(names.get(name) ?? name) : undefined;
          if (symbol && !acceptsReference(output.type, symbol.type) && output.type !== symbol.type) issue('WRONG_WORKFLOW_OUTPUT_TYPE', `${output.label} exports ${symbol.type}, expected ${output.type}.`, path);
        }
        continue;
      }
      if (def.kind !== 'action' && def.kind !== 'verification') { issue('MISPLACED_MODIFIER', 'Place configuration inside Create standard policy, under a location scope.', path); continue; }
      if (!actor) issue('MISSING_ACTOR', 'Place this action inside an actor context.', path);
      if (actor && def.allowedRoles && !def.allowedRoles.includes(actor)) issue('ROLE_NOT_ALLOWED', `${def.label} requires ${def.allowedRoles.join(' or ')}. Use the dedicated attempt block for a negative authorization test.`, path);
      if (block.children?.length) issue('INVALID_ACTION_CHILDREN', 'This action does not accept an ordered child sequence.', path);
      if (block.changes?.length && !def.acceptsChanges) issue('INVALID_CONFIGURATION_SLOT', 'This action does not accept configuration changes.', path);
      const manifest = catalog.implementations.find(item => `${item.id}@${item.revision}` === def.implementationRef);
      if (def.readiness !== 'ready' || !manifest || manifest.status !== 'ready' || !manifest.supportedDefinitions.some(ref => ref.id === def.id && ref.version === def.version)) issue('MISSING_IMPLEMENTATION', `${def.label}@${def.version} has no compatible browser implementation.`, path);
      const configuration = def.operation === 'createDraft' ? resolveConfiguration(block, inputs, path, parameters, names) : undefined;
      const runtimeInputs = configuration ? { configuration: valueOf(configuration) } : clone(inputs);
      if (runtimeInputs.effectiveDate === '$term-month-two') runtimeInputs.effectiveDate = dateValues(asOf).amendment;
      const outputs = Object.fromEntries(Object.entries(block.outputs ?? {}).map(([key, name]) => [key, names.get(name) ?? name]));
      const step: CompiledStep = { id: path, instanceId: path, definition: clone(block.definition), label: block.label || def.label, kind: def.kind, operation: def.operation ?? 'missing', actor: actor ?? 'Broker', inputs: runtimeInputs, outputs, ancestors: [...ancestors], implementationRef: def.implementationRef ?? 'missing' };
      steps.push(step); stepState(step, def, configuration);
    }
  }
  expand(scenario.blocks, undefined, scenario.parameters ?? {}, new Map());
  if (!steps.length) issue('EMPTY_SCENARIO', 'Add at least one executable business action before running.');
  const validation: ValidationResult = { valid: !issues.some(item => item.severity === 'error'), issues, resolvedConfigurations: configs, stepCount: steps.length, dependencyCount: dependencies.size };
  return { steps, validation, blockVersions: [...dependencies.values()].sort((a, b) => versionKey(a).localeCompare(versionKey(b))), templateVersions: [...templates.values()], resolutionIds: [...usedResolutions] };
}
export function validateScenario(scenario: Scenario, options: CompileOptions): ValidationResult {
  try { return build(scenario, options).validation; }
  catch (error) { return { valid: false, issues: [{ code: 'INVALID_SCENARIO', severity: 'error', message: error instanceof Error ? error.message : String(error) }], resolvedConfigurations: [], stepCount: 0, dependencyCount: 0 }; }
}
export function compileScenario(scenario: Scenario, options: CompileOptions): CompiledScenario {
  const result = build(scenario, options);
  if (!result.validation.valid) throw new StudioError('Resolve authoring issues before running this scenario.', 422, result.validation.issues);
  const implementationRevision = fingerprint(options.catalog.implementations).slice(0, 16);
  const compiled: CompiledScenario = {
    id: `compile-${randomUUID()}`, scenario: clone(scenario), scenarioRevision: scenario.revision, compiledAt: (options.asOf ?? new Date()).toISOString(),
    fingerprint: fingerprint({ scenario, steps: result.steps, blockVersions: result.blockVersions, templates: result.templateVersions, implementationRevision }),
    catalogRevision: options.catalog.revision, implementationRevision, appBuild: applicationBuild(),
    steps: result.steps, blockVersions: result.blockVersions, templateVersions: result.templateVersions, resolutionIds: result.resolutionIds,
    resolvedConfigurations: result.validation.resolvedConfigurations, generatedSource: '', validation: result.validation,
  };
  compiled.generatedSource = generatePlaywrightSource(compiled);
  return compiled;
}
export function generatePlaywrightSource(compiled: CompiledScenario): string {
  const metadata = { scenarioId: compiled.scenario.id, scenarioRevision: compiled.scenarioRevision, fingerprint: compiled.fingerprint, blockVersions: compiled.blockVersions, templateVersions: compiled.templateVersions, implementationRevision: compiled.implementationRevision, appBuild: compiled.appBuild };
  return `// Generated deterministically from Folio's canonical business records.\n// Save at .local/runs/<run-id>/generated.spec.ts.\n// Run: FOLIO_REPLAY=1 npx playwright test .local/runs/<run-id>/generated.spec.ts\nimport { test } from '@playwright/test';\nimport { createExecutionState, executeCompiledStep } from '../../../e2e/helpers/insurance-driver';\nimport type { CompiledStep } from '../../../shared/blocks';\n\nexport const build = ${JSON.stringify(metadata, null, 2)};\nconst steps: CompiledStep[] = ${JSON.stringify(compiled.steps, null, 2)};\n\ntest(${JSON.stringify(compiled.scenario.name)}, async ({ page }) => {\n  const state = createExecutionState(page, { runId: 'replay-' + Date.now() });\n  for (const step of steps) {\n    await test.step(step.label + ' [' + step.instanceId + ']', async () => {\n      await executeCompiledStep(page, step, state);\n    });\n  }\n});\n`;
}

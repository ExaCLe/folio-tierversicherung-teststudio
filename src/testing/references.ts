import type { TestingValue, TestingValueType } from '../../shared/testing';
import { isTestingParameter, isTestingReference, testingVersionKey } from '../../shared/testing';
import { typeLabels, type BlockEntry } from './model';

export interface ReferenceSource {
  value: string;
  key: string;
  type: TestingValueType;
  outputLabel: string;
  name: string;
  label: string;
  sourcePath: string;
  sourceLabel: string;
  step: string;
}
export interface ReferenceIndex {
  before: Map<string, Map<string, ReferenceSource>>;
  inputs: Map<string, Record<string, TestingValue>>;
  outputs: Map<string, ReferenceSource[]>;
  all: ReferenceSource[];
}

export function entryStep(entry: BlockEntry, entries: BlockEntry[]): string {
  const siblings = entries.filter(item => item.parent?.path === entry.parent?.path);
  const position = siblings.findIndex(item => item.path === entry.path) + 1;
  return entry.parent ? `${entryStep(entry.parent, entries)}.${position}` : String(position);
}
function sourceTrail(entry: BlockEntry): string {
  const name = entry.block.label || entry.definition?.name || 'Unbekannter Block';
  return entry.parent ? `${sourceTrail(entry.parent)} › ${name}` : name;
}

/** Mirrors compiler walk/bindOutput: workflow exports are published after their body,
 * context aliases escape only when absent, and qualified keys never bypass scope. */
export function buildReferenceIndex(entries: BlockEntry[], parameters: Record<string, TestingValue> = {}): ReferenceIndex {
  const index: ReferenceIndex = { before: new Map(), inputs: new Map(), outputs: new Map(), all: [] };
  type Scope = Map<string, ReferenceSource>;
  const resolve = (value: TestingValue, params: Record<string, TestingValue>, scope: Scope, seen: string[] = []): TestingValue => {
    if (isTestingParameter(value)) return !seen.includes(value.param) && Object.hasOwn(params, value.param) ? resolve(params[value.param], params, scope, [...seen, value.param]) : value;
    if (isTestingReference(value)) { const found = scope.get(value.ref) ?? [...scope.values()].find(item => item.key === value.ref); return found ? { ...value, ref: found.key, type: value.type ?? found.type } : value; }
    if (Array.isArray(value)) return value.map(item => resolve(item, params, scope, seen));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolve(item, params, scope, seen)]));
    return value;
  };
  const walk = (children: BlockEntry[], params: Record<string, TestingValue>, scope: Scope, active: string[], overrides: Record<string, Record<string, TestingValue>> = {}) => {
    const declared = new Set<string>();
    const ids = new Set<string>();
    for (const entry of children) {
      const { block, definition } = entry;
      if (!definition || !block.id || block.id.includes('/') || ids.has(block.id) || active.includes(testingVersionKey(definition))) continue;
      ids.add(block.id);
      index.before.set(entry.path, new Map(scope));
      const raw = { ...Object.fromEntries(definition.inputs.filter(input => input.default !== undefined).map(input => [input.key, input.default!])), ...block.inputs, ...overrides[block.id] };
      const values = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, resolve(value, params, scope)]));
      index.inputs.set(entry.path, values);
      const bind = (outputKey: string, source: ReferenceSource) => {
        const alias = block.outputs?.[outputKey] ?? `${block.id}.${outputKey}`;
        if (declared.has(alias)) return;
        declared.add(alias);
        const exposed = { ...source, value: alias };
        scope.set(alias, exposed);
        index.outputs.set(entry.path, [...index.outputs.get(entry.path) ?? [], exposed]);
        index.all.push(exposed);
      };
      if (definition.kind === 'context' || definition.kind === 'workflow') {
        const childScope = new Map(scope);
        const childOverrides = { ...block.overrides };
        for (const [path, fields] of Object.entries(overrides)) if (path.startsWith(`${block.id}/`)) childOverrides[path.slice(block.id.length + 1)] = { ...childOverrides[path.slice(block.id.length + 1)], ...fields };
        walk(entries.filter(item => item.parent?.path === entry.path), definition.kind === 'workflow' ? values : params, childScope, [...active, testingVersionKey(definition)], childOverrides);
        if (definition.kind === 'context') { for (const [alias, source] of childScope) if (!scope.has(alias)) scope.set(alias, source); }
        else for (const output of definition.outputs) {
          const exported = definition.exports?.[output.key];
          const source = exported && childScope.get(exported.ref);
          if (source && source.type === output.type) bind(output.key, source);
        }
        continue;
      }
      const text = (value: TestingValue | undefined) => typeof value === 'string' && value.trim() ? value : '';
      const related = Object.values(values).flatMap(value => Array.isArray(value) ? value : [value]).filter(isTestingReference).map(value => [...scope.values()].find(source => source.key === value.ref)).filter((source): source is ReferenceSource => !!source);
      for (const output of definition.outputs) {
        const name = text(values.name) || text(values.title) || [...new Set(related.map(source => source.name))].join(' · ') || text(values.product) || block.label || definition.name;
        const step = entryStep(entry, entries);
        const sourceLabel = sourceTrail(entry);
        const resultLabel = output.label === typeLabels[output.type] ? output.label : `${typeLabels[output.type]} · ${output.label}`;
        bind(output.key, { value: '', key: `${entry.path}::${output.key}`, type: output.type, outputLabel: output.label, name, label: `${resultLabel} „${name}“ · Schritt ${step} · ${sourceLabel}`, sourcePath: entry.path, sourceLabel, step });
      }
    }
  };
  walk(entries.filter(entry => !entry.parent), parameters, new Map(), []);
  return index;
}

export function referenceChoices(index: ReferenceIndex, path: string, type?: TestingValueType): ReferenceSource[] {
  return [...index.before.get(path)?.values() ?? []].filter(source => !type || source.type === type);
}
export function describeReference(index: ReferenceIndex, path: string, value: TestingValue | undefined, type?: TestingValueType): { label: string; source?: ReferenceSource; status: 'available' | 'missing' | 'future' | 'type' | 'literal' | 'parameter' } {
  if (isTestingParameter(value)) return { label: `Parameter „${value.param}“ ist hier nicht aufgelöst`, status: 'parameter' };
  if (!isTestingReference(value)) return { label: value ? `Fester Wert „${String(value)}“ · kein Verweis auf ein früheres Ergebnis` : 'Noch kein früheres Ergebnis ausgewählt', status: 'literal' };
  const scope = index.before.get(path);
  const source = scope?.get(value.ref) ?? [...scope?.values() ?? []].find(item => item.key === value.ref);
  if (source) {
    if ((type?.endsWith('-ref') && source.type !== type) || (value.type && value.type !== source.type)) return { label: `${source.label} · Ergebnisart passt nicht zu diesem Feld`, source, status: 'type' };
    return { label: source.label, source, status: 'available' };
  }
  const localFuture = index.all.filter(item => (item.value === value.ref || item.key === value.ref) && item.sourcePath.split('/').slice(0, -1).join('/') === path.split('/').slice(0, -1).join('/'));
  const label = !value.ref ? 'Noch kein früheres Ergebnis ausgewählt' : localFuture.length ? 'Dieses Ergebnis steht erst in einem späteren Schritt zur Verfügung' : 'Verweis nicht aufgelöst · kein verfügbares Ergebnis in diesem Ablaufbereich';
  return { label, status: localFuture.length ? 'future' : 'missing' };
}

import type { TestingBlockInstance, TestingCatalog, TestingValue } from '../../shared/testing';
import { isTestingReference } from '../../shared/testing';
import { findDefinition, flattenBlocks, formatGermanNumber, type BlockEntry } from './model';
import { buildReferenceIndex, describeReference, entryStep, type ReferenceIndex } from './references';

export interface ValueChange {
  path: string; field: string; label: string; step: string; blockLabel: string;
  before: TestingValue | undefined; after: TestingValue | undefined; beforeLabel: string; afterLabel: string;
}
export interface ValueChanges { changes: ValueChange[]; current: ReferenceIndex; baseline: ReferenceIndex }
function stable(value: TestingValue | undefined): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable((value as Record<string, TestingValue>)[key])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'undefined';
}
function valueLabel(value: TestingValue | undefined, type: string | undefined, index: ReferenceIndex, path: string): string {
  if (value === undefined) return 'Kein Standardwert';
  if (value === null || value === '') return 'Nicht gesetzt';
  if (isTestingReference(value)) return describeReference(index, path, value).label;
  if (typeof value === 'number') return `${formatGermanNumber(value)}${type === 'money' ? ' EUR' : ''}`;
  if (typeof value === 'boolean') return value ? 'Ja' : 'Nein';
  if (Array.isArray(value)) return value.map(item => valueLabel(item, undefined, index, path)).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** The baseline is the pinned library definition, including its intentional body
 * literals and parameter bindings. Instance inputs/overrides never modify it. */
export function buildValueChanges(entries: BlockEntry[], catalog: TestingCatalog, parameters: Record<string, TestingValue> = {}): ValueChanges {
  const baselineBlock = (block: TestingBlockInstance): TestingBlockInstance => {
    const definition = findDefinition(catalog, block);
    const copy = structuredClone(block);
    copy.inputs = Object.fromEntries((definition?.inputs ?? []).filter(input => input.default !== undefined).map(input => [input.key, structuredClone(input.default!)]));
    delete copy.overrides;
    if (definition?.body) copy.children = structuredClone(definition.body);
    else if (copy.children) copy.children = copy.children.map(baselineBlock);
    return copy;
  };
  const current = buildReferenceIndex(entries, parameters);
  const baselineEntries = flattenBlocks(entries.filter(entry => !entry.parent).map(entry => baselineBlock(entry.block)), catalog);
  const baseline = buildReferenceIndex(baselineEntries, parameters);
  const changes: ValueChange[] = [];
  for (const entry of entries) {
    const actual = current.inputs.get(entry.path) ?? {};
    const standard = baseline.inputs.get(entry.path) ?? {};
    for (const key of new Set([...Object.keys(actual), ...Object.keys(standard)])) {
      if (stable(actual[key]) === stable(standard[key])) continue;
      const input = entry.definition?.inputs.find(input => input.key === key);
      changes.push({ path: entry.path, field: key, label: input?.label ?? key, step: entryStep(entry, entries), blockLabel: entry.block.label || entry.definition?.name || 'Unbekannter Block', before: standard[key], after: actual[key], beforeLabel: valueLabel(standard[key], input?.type, baseline, entry.path), afterLabel: valueLabel(actual[key], input?.type, current, entry.path) });
    }
  }
  return { changes, current, baseline };
}
export function changesWithin(changes: ValueChange[], path: string) { return changes.filter(change => change.path === path || change.path.startsWith(`${path}/`)); }

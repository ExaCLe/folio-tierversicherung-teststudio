import type { TestingBlockDefinition, TestingBlockInstance, TestingCatalog, TestingInput, TestingScenario, TestingValue, TestingValueType } from '../../shared/testing';
import { createTestingInstance, currentTestingChildren, currentTestingDefinition, isTestingParameter, isTestingReference } from '../../shared/testing';

export const kindLabels = { action: 'Aktion', assertion: 'Prüfung', workflow: 'Baustein', context: 'Rolle & Gruppe' };
export const phaseLabels = { naming: 'Testfall benennen', business: 'Fachlicher Entwurf', exploration: 'Erkundung', technical: 'Technische Umsetzung', duplicates: 'Dublettenprüfung', reuse: 'Wiederverwendung' };
export const statusLabels: Record<string, string> = { queued: 'Eingereiht', running: 'Läuft', completed: 'Abgeschlossen', failed: 'Fehlgeschlagen', cancelled: 'Abgebrochen', passed: 'Bestanden', skipped: 'Übersprungen', suggested: 'Vorgeschlagen', accepted: 'Übernommen', dismissed: 'Verworfen', ready: 'Ausführbar', draft: 'Entwurf', approved: 'Freigegeben', missing: 'Nicht verdrahtet' };
export const typeLabels: Record<TestingValueType, string> = { text: 'Text', number: 'Zahl', money: 'Geldbetrag', boolean: 'Ja / Nein', date: 'Datum', choice: 'Auswahl', object: 'Wertepaare', list: 'Liste', 'customer-ref': 'Kunde', 'farm-ref': 'Betrieb', 'animal-ref': 'Tier', 'proposal-ref': 'Vorschlag', 'referral-ref': 'Direktionsanfrage', 'policy-ref': 'Police', 'contract-ref': 'Vertrag', 'document-ref': 'Dokument' };

export function findDefinition(catalog: TestingCatalog, block: TestingBlockInstance) {
  return currentTestingDefinition(catalog, block.definition);
}

export interface BlockEntry { block: TestingBlockInstance; definition?: TestingBlockDefinition; path: string; depth: number; inherited: boolean; parent?: BlockEntry }
export function flattenBlocks(blocks: TestingBlockInstance[], catalog: TestingCatalog, parent?: BlockEntry, seen = new Set<string>()): BlockEntry[] {
  return blocks.flatMap(block => {
    const definition = findDefinition(catalog, block);
    const path = parent ? `${parent.path}/${block.id}` : block.id;
    const entry: BlockEntry = { block, definition, path, depth: parent ? parent.depth + 1 : 0, inherited: !!parent && !parent.block.children, parent };
    const key = definition ? `${definition.id}@${definition.version}` : block.definition.id;
    const children = currentTestingChildren(block, catalog);
    return [entry, ...(children.length && !seen.has(key) ? flattenBlocks(children, catalog, entry, new Set([...seen, key])) : [])];
  });
}

export function updateBlockAtPath(blocks: TestingBlockInstance[], path: string, catalog: TestingCatalog, update: (block: TestingBlockInstance) => TestingBlockInstance | null): TestingBlockInstance[] {
  const [head, ...tail] = path.split('/');
  return blocks.flatMap(block => {
    if (block.id !== head) return [block];
    if (!tail.length) { const next = update(structuredClone(block)); return next ? [next] : []; }
    const children = currentTestingChildren(block, catalog);
    return [{ ...block, children: updateBlockAtPath(children, tail.join('/'), catalog, update) }];
  });
}

export function fieldValueLabel(value: TestingValue | undefined): string {
  if (value === undefined || value === null) return 'Nicht gesetzt';
  if (isTestingReference(value)) return `↗ ${value.ref}`;
  if (isTestingParameter(value)) return `$${value.param}`;
  if (typeof value === 'boolean') return value ? 'Ja' : 'Nein';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** German input is unambiguous: periods group thousands, commas decimals. */
export function parseGermanNumber(raw: string): number | undefined {
  const value = raw.trim().replace(/\s/g, '').replace(/€|EUR/gi, '');
  if (!/^[+-]?(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d+)?$/.test(value)) return undefined;
  const parsed = Number(value.replaceAll('.', '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function formatGermanNumber(value: number) {
  return value.toLocaleString('de-DE', { maximumFractionDigits: 8 });
}

export function resolvedBlockInputs(entry: BlockEntry): Record<string, TestingValue> {
  const resolveValue = (value: TestingValue, context: BlockEntry = entry): TestingValue => {
    if (isTestingParameter(value)) {
      let parent = context.parent;
      while (parent) {
        const parameterValue = parent.block.inputs[value.param] ?? parent.definition?.inputs.find(input => input.key === value.param)?.default;
        if (parameterValue !== undefined) return resolveValue(parameterValue, parent);
        parent = parent.parent;
      }
      return value;
    }
    if (Array.isArray(value)) return value.map(item => resolveValue(item, context));
    if (value && typeof value === 'object' && !isTestingReference(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveValue(item, context)]));
    return value;
  };
  const initialValues = { ...Object.fromEntries((entry.definition?.inputs ?? []).filter(input => input.default !== undefined).map(input => [input.key, input.default!])), ...entry.block.inputs };
  let values = Object.fromEntries(Object.entries(initialValues).map(([key, value]) => [key, resolveValue(value)]));
  let parent = entry.parent;
  while (parent) { const relative = entry.path.slice(parent.path.length + 1); values = { ...values, ...parent.block.overrides?.[relative] }; parent = parent.parent; }
  return values;
}

export function defaultsForInput(input: TestingInput): TestingValue {
  if (input.default !== undefined) return structuredClone(input.default);
  if (input.type === 'boolean') return false;
  if (input.type === 'number' || input.type === 'money') return 0;
  if (input.type === 'object') return Object.fromEntries((input.fields ?? []).filter(field => field.default !== undefined || field.required).map(field => [field.key, defaultsForInput(field)]));
  if (input.type === 'list') return [];
  if (input.type.endsWith('-ref')) return { ref: '', type: input.type };
  return input.options?.[0]?.value ?? '';
}

export function newInstance(definition: TestingBlockDefinition, existing: TestingScenario['blocks'], catalog: TestingCatalog) {
  const block = createTestingInstance(definition);
  const entries = flattenBlocks(existing, catalog);
  for (const input of definition.inputs) {
    if (!input.type.endsWith('-ref')) continue;
    const matches = entries.flatMap(entry => entry.definition?.outputs.filter(output => output.type === input.type).map(output => entry.block.outputs?.[output.key]).filter((value): value is string => !!value) ?? []);
    if (matches.length === 1) block.inputs[input.key] = { ref: matches[0], type: input.type };
  }
  return block;
}

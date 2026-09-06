import { isEntityReference, isParameterReference, makeBlockInstance, versionKey, type BlockDefinition, type BlockInstance, type BlockKind, type BlockValue, type Scenario, type StudioCatalog } from '../../shared/blocks';

export const KIND_LABELS: Record<BlockKind, string> = { action: 'Standard action', modifier: 'Structured modifier', 'free-text': 'Free-text modifier', context: 'Context', workflow: 'Reusable workflow', verification: 'Verification' };
export const KIND_SHORT: Record<BlockKind, string> = { action: 'Actions', modifier: 'Modifiers', 'free-text': 'Free text', context: 'Contexts', workflow: 'Workflows', verification: 'Verifications' };
export const KINDS: BlockKind[] = ['action', 'modifier', 'free-text', 'context', 'workflow', 'verification'];
export const countryName = (value: unknown) => value === 'IT' ? 'Italy' : value === 'DE' ? 'Germany' : String(value ?? '');

export interface LocatedBlock { block: BlockInstance; parent?: BlockInstance; siblings: BlockInstance[]; index: number; slot?: 'children' | 'changes'; ancestors: BlockInstance[] }

export function locateBlock(blocks: BlockInstance[], id: string, parent?: BlockInstance, slot?: 'children' | 'changes', ancestors: BlockInstance[] = []): LocatedBlock | undefined {
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    if (block.id === id) return { block, parent, siblings: blocks, index, slot, ancestors };
    for (const key of ['children', 'changes'] as const) {
      const found = locateBlock(block[key] || [], id, block, key, [...ancestors, block]);
      if (found) return found;
    }
  }
  return undefined;
}

export function flattenBlocks(blocks: BlockInstance[]): BlockInstance[] {
  return blocks.flatMap(block => [block, ...flattenBlocks(block.children || []), ...flattenBlocks(block.changes || [])]);
}

export function updateBlock(scenario: Scenario, id: string, updater: (block: BlockInstance) => void): Scenario {
  const copy = structuredClone(scenario);
  const found = locateBlock(copy.blocks, id);
  if (found) updater(found.block);
  return copy;
}

export function invalidateResolutions(block: BlockInstance) {
  for (const child of flattenBlocks([block])) delete child.resolutionId;
}

export function definitionMap(catalog: StudioCatalog) { return new Map(catalog.definitions.map(def => [versionKey(def), def])); }
export function findDefinition(catalog: StudioCatalog, block: BlockInstance) { return catalog.definitions.find(def => def.id === block.definition.id && def.version === block.definition.version); }
export function newestDefinitions(catalog: StudioCatalog) {
  const latest = new Map<string, BlockDefinition>();
  for (const def of catalog.definitions) if (!latest.has(def.id) || latest.get(def.id)!.version < def.version) latest.set(def.id, def);
  return [...latest.values()];
}

export function displayValue(value: BlockValue | undefined, type?: string): string {
  if (value === undefined || value === null || value === '') return 'Not set';
  if (isEntityReference(value)) return value.ref;
  if (isParameterReference(value)) return `$${value.param}`;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (value === 'DE' || value === 'IT') return countryName(value);
  if (type === 'Country') return countryName(value);
  if (type === 'Money') return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(Number(value));
  if (typeof value === 'object') {
    if (!Array.isArray(value) && 'line1' in value && 'city' in value) return `${value.line1} · ${value.postcode || ''} ${value.city}`.trim();
    return Array.isArray(value) ? value.map(item => displayValue(item)).join(', ') : JSON.stringify(value);
  }
  return String(value);
}

export function addBlock(scenario: Scenario, definition: BlockDefinition, catalog: StudioCatalog, selectedId?: string): { scenario: Scenario; block: BlockInstance } {
  const copy = structuredClone(scenario);
  const block = makeBlockInstance(definition);
  const found = selectedId ? locateBlock(copy.blocks, selectedId) : undefined;
  const configuring = ['modifier', 'free-text'].includes(definition.kind) || definition.contextType === 'location';
  if (configuring) {
    const candidates = found ? [...found.ancestors, found.block].reverse() : [];
    let target = candidates.find(candidate => definition.contextType === 'location' ? findDefinition(catalog, candidate)?.acceptsChanges : (findDefinition(catalog, candidate)?.contextType === 'location' || findDefinition(catalog, candidate)?.acceptsChanges));
    target ||= flattenBlocks(copy.blocks).find(candidate => findDefinition(catalog, candidate)?.acceptsChanges);
    if (!target) throw new Error('Add a Create standard policy action first, then add its changes.');
    target.changes ||= [];
    if (found && found.parent?.id === target.id && found.slot === 'changes') target.changes.splice(found.index + 1, 0, block);
    else target.changes.push(block);
  } else if (definition.contextType === 'actor') {
    const top = found?.ancestors[0] || found?.block;
    const index = top ? copy.blocks.findIndex(item => item.id === top.id) : -1;
    copy.blocks.splice(index >= 0 ? index + 1 : copy.blocks.length, 0, block);
  } else {
    const actor = found ? [...found.ancestors, found.block].reverse().find(candidate => findDefinition(catalog, candidate)?.contextType === 'actor') : undefined;
    if (actor) {
      actor.children ||= [];
      if (found?.parent?.id === actor.id && found.slot === 'children') actor.children.splice(found.index + 1, 0, block);
      else actor.children.push(block);
    } else copy.blocks.push(block);
  }
  const ordered = flattenBlocks(copy.blocks);
  const outputChoices = ordered.slice(0, ordered.findIndex(item => item.id === block.id)).flatMap(instance => {
    const def = findDefinition(catalog, instance);
    return (def?.outputs || []).map(output => ({ type: output.type, ref: instance.outputs?.[output.key] }));
  });
  for (const input of definition.inputs) {
    if (!input.type.endsWith('Ref') || input.type.includes('Fixture') || input.type === 'PolicyTemplateRef') continue;
    const compatible = outputChoices.filter(output => (output.type === input.type || input.type === 'ApprovalRef' && output.type === 'QuoteRef') && output.ref);
    block.inputs[input.key] = { ref: compatible.length === 1 ? compatible[0].ref! : '' };
  }
  return { scenario: copy, block };
}

export function relocateBlock(scenario: Scenario, id: string, direction: -1 | 1): Scenario {
  const copy = structuredClone(scenario);
  const found = locateBlock(copy.blocks, id);
  if (!found) return scenario;
  const next = found.index + direction;
  if (next < 0 || next >= found.siblings.length) return scenario;
  [found.siblings[next], found.siblings[found.index]] = [found.siblings[found.index], found.siblings[next]];
  return copy;
}

export function removeBlock(scenario: Scenario, id: string): Scenario {
  const copy = structuredClone(scenario);
  const found = locateBlock(copy.blocks, id);
  if (found) found.siblings.splice(found.index, 1);
  return copy;
}

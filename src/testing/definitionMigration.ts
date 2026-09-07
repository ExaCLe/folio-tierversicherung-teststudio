import type { TestingBlockDefinition, TestingBlockInstance, TestingCatalog, TestingValue } from '../../shared/testing';
import { testingVersionKey } from '../../shared/testing';
import { flattenBlocks, updateBlockAtPath } from './model';

/** Adopt a stored version for one scoped use. The current schema and actual
 * source resolve reference types; values, shared defaults and parameters stay intact. */
export function migrateDefinition(blocks: TestingBlockInstance[], path: string, catalog: TestingCatalog, definition: TestingBlockDefinition, _parameters: Record<string, TestingValue> = {}): TestingBlockInstance[] {
  const original = flattenBlocks(blocks, catalog).find(entry => entry.path === path);
  if (!original || original.block.definition.id !== definition.id) throw new Error('Die ausgewählte Verwendung passt nicht zu dieser Blockdefinition.');
  const available = catalog.definitions.find(item => testingVersionKey(item) === testingVersionKey(definition));
  if (!available) throw new Error('Diese Blockversion ist noch nicht im Katalog gespeichert.');
  return updateBlockAtPath(blocks, path, catalog, block => ({ ...block, definition: { id: available.id, version: available.version } }));
}

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BlockDefinition, ImplementationManifest, KnowledgeDocument, PolicyTemplate, Scenario, StudioCatalog } from '../../shared/blocks';

const root = resolve(process.cwd());
function source<T>(path: string): T { return JSON.parse(readFileSync(resolve(root, path), 'utf8')) as T; }
export function loadSourceCatalog(): StudioCatalog {
  const knowledge = source<Omit<KnowledgeDocument, 'content'>[]>('knowledge/index.json').map(doc => ({ ...doc, content: readFileSync(resolve(root, doc.path), 'utf8') }));
  return {
    revision: 'folio-catalog-1',
    definitions: source<BlockDefinition[]>('catalog/definitions.json'),
    templates: source<PolicyTemplate[]>('catalog/templates.json'),
    implementations: source<ImplementationManifest[]>('catalog/implementations.json'),
    knowledge,
    roles: [{ value: 'Broker', label: 'Broker', name: 'Alex Morgan' }, { value: 'Senior underwriter', label: 'Senior underwriter', name: 'Sarah Chen' }],
  };
}
export function loadSeedScenarios(): Scenario[] { return source<Scenario[]>('catalog/scenarios.json'); }

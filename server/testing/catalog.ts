import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { TestingBlockDefinition, TestingCatalog, TestingKnowledgeDocument, TestingScenario, TestingTechnicalBinding } from '../../shared/testing';
import { db } from '../store';

const source = <T>(path: string): T => JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')) as T;
export function loadTestingSourceCatalog(): TestingCatalog {
  const knowledge = source<TestingKnowledgeDocument[]>('knowledge/agriculture/index.json').map(doc => ({
    ...doc, content: doc.path ? readFileSync(resolve(process.cwd(), doc.path), 'utf8') : doc.content,
  }));
  return { revision: 'tierversicherung-1', definitions: source<TestingBlockDefinition[]>('catalog/agriculture/definitions.json'),
    bindings: source<TestingTechnicalBinding[]>('catalog/agriculture/bindings.json'), knowledge };
}
function overlay<T>(base: T[], persisted: T[], key: (value: T) => string): T[] {
  return [...new Map([...base, ...persisted].map(value => [key(value), value])).values()];
}
export function getTestingCatalog(): TestingCatalog {
  const base = loadTestingSourceCatalog();
  return { ...base,
    definitions: overlay(base.definitions, db.read<TestingBlockDefinition>('testingDefinitions'), item => `${item.id}@${item.version}`),
    bindings: overlay(base.bindings, db.read<TestingTechnicalBinding>('testingBindings'), item => `${item.id}@${item.revision}`),
    knowledge: overlay(base.knowledge, db.read<TestingKnowledgeDocument>('testingKnowledge'), item => `${item.id}@${item.revision}`),
  };
}
export function loadTestingSeedScenarios(): TestingScenario[] { return source<TestingScenario[]>('catalog/agriculture/scenarios.json'); }

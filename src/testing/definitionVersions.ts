import type { TestingBlockDefinition } from '../../shared/testing';
import { compareTestingVersions } from '../../shared/testing';

export function compareDefinitionVersions(left: string, right: string): number {
  return compareTestingVersions(left, right);
}
export function definitionVersions(definition: TestingBlockDefinition, definitions: TestingBlockDefinition[]) {
  return definitions.filter(item => item.id === definition.id).sort((a, b) => compareDefinitionVersions(a.version, b.version));
}
export function nextDefinitionVersion(definition: TestingBlockDefinition, definitions: TestingBlockDefinition[]) {
  const latest = definitionVersions(definition, [...definitions, definition]).at(-1)!;
  const [major, minor, patch] = latest.version.split('-')[0].split('.').map(Number);
  return `${major}.${minor}.${patch + 1}`;
}

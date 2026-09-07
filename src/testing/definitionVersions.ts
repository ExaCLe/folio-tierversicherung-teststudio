import type { TestingBlockDefinition } from '../../shared/testing';

export function compareDefinitionVersions(left: string, right: string): number {
  const split = (value: string) => { const [core, ...pre] = value.split('-'); return { core: core.split('.').map(Number), pre: pre.join('-') }; };
  const a = split(left), b = split(right);
  for (let index = 0; index < 3; index++) if (a.core[index] !== b.core[index]) return a.core[index] - b.core[index];
  if (!a.pre || !b.pre) return a.pre === b.pre ? 0 : a.pre ? -1 : 1;
  const aa = a.pre.split('.'), bb = b.pre.split('.');
  for (let index = 0; index < Math.max(aa.length, bb.length); index++) {
    if (aa[index] === bb[index]) continue;
    if (aa[index] === undefined || bb[index] === undefined) return aa[index] === undefined ? -1 : 1;
    const an = /^\d+$/.test(aa[index]), bn = /^\d+$/.test(bb[index]);
    return an && bn ? Number(aa[index]) - Number(bb[index]) : an !== bn ? an ? -1 : 1 : aa[index].localeCompare(bb[index]);
  }
  return 0;
}
export function definitionVersions(definition: TestingBlockDefinition, definitions: TestingBlockDefinition[]) {
  return definitions.filter(item => item.id === definition.id).sort((a, b) => compareDefinitionVersions(a.version, b.version));
}
export function nextDefinitionVersion(definition: TestingBlockDefinition, definitions: TestingBlockDefinition[]) {
  const latest = definitionVersions(definition, [...definitions, definition]).at(-1)!;
  const [major, minor, patch] = latest.version.split('-')[0].split('.').map(Number);
  return `${major}.${minor}.${patch + 1}`;
}

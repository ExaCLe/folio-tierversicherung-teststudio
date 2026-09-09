import test from 'node:test';
import assert from 'node:assert/strict';
import type { TestingBlockDefinition, TestingBlockInstance, TestingCatalog, TestingInput } from '../../shared/testing';
import { createTestingInstance, currentTestingChildren, currentTestingDefinition } from '../../shared/testing';

const input = (key: string, defaultValue?: string): TestingInput => ({
  key,
  label: key,
  type: 'text',
  ...(defaultValue === undefined ? {} : { default: defaultValue }),
});

const definition = (id: string, version: string, values: Partial<TestingBlockDefinition> = {}): TestingBlockDefinition => ({
  id,
  version,
  name: `${id} ${version}`,
  description: id,
  kind: 'action',
  category: 'Current-definition fixture',
  semanticKey: id,
  inputs: [],
  outputs: [],
  knowledgeRefs: [],
  preconditions: [],
  postconditions: [],
  status: 'approved',
  createdAt: '2026-09-09T00:00:00.000Z',
  origin: 'human',
  ...values,
});

const instance = (
  id: string,
  definitionId: string,
  version = '1.0.0',
  inputs: TestingBlockInstance['inputs'] = {},
): TestingBlockInstance => ({ id, definition: { id: definitionId, version }, inputs });

const catalog = (...definitions: TestingBlockDefinition[]): TestingCatalog => ({
  revision: 'current-definition-fixture',
  definitions,
  bindings: [],
  knowledge: [],
});

test('current definition is selected by semantic version independent of catalog order', () => {
  const versions = catalog(
    definition('fixture.step', '1.10.0'),
    definition('fixture.step', '2.0.0-beta.1'),
    definition('fixture.step', '1.9.9'),
    definition('fixture.step', '2.0.0'),
  );

  assert.equal(currentTestingDefinition(versions, { id: 'fixture.step' })?.version, '2.0.0');
});

test('unchanged materialized body adopts the current global order and fields', () => {
  const a = definition('fixture.a', '1.0.0');
  const b = definition('fixture.b', '1.0.0');
  const oldBody = [instance('a', a.id), instance('b', b.id, '1.0.0', { status: 'old' })];
  const currentBody = [
    instance('b', b.id, '1.0.0', { status: 'current', newField: 'globally-added' }),
    instance('a', a.id),
  ];
  const oldWorkflow = definition('fixture.workflow', '1.0.0', { kind: 'workflow', body: oldBody });
  const currentWorkflow = definition('fixture.workflow', '1.0.1', {
    kind: 'workflow',
    body: currentBody,
    supersedes: { id: oldWorkflow.id, version: oldWorkflow.version },
  });
  const use: TestingBlockInstance = {
    ...instance('workflow', oldWorkflow.id, oldWorkflow.version),
    children: structuredClone(oldBody),
  };

  assert.deepEqual(currentTestingChildren(use, catalog(a, b, oldWorkflow, currentWorkflow)), currentBody);
});

test('local per-key deltas survive while unrelated inputs come from the current body', () => {
  const leaf = definition('fixture.leaf', '1.0.0');
  const oldChild = instance('leaf', leaf.id, leaf.version, { local: 'base', shared: 'old' });
  const localChild = instance('leaf', leaf.id, leaf.version, { local: 'override', shared: 'old' });
  const currentChild = instance('leaf', leaf.id, leaf.version, { local: 'new-default', shared: 'fresh', added: 'new' });
  const oldWorkflow = definition('fixture.delta-workflow', '1.0.0', { kind: 'workflow', body: [oldChild] });
  const currentWorkflow = definition('fixture.delta-workflow', '1.0.1', {
    kind: 'workflow',
    body: [currentChild],
    supersedes: { id: oldWorkflow.id, version: oldWorkflow.version },
  });
  const use: TestingBlockInstance = {
    ...instance('workflow', oldWorkflow.id, oldWorkflow.version),
    children: [localChild],
  };

  assert.deepEqual(
    currentTestingChildren(use, catalog(leaf, oldWorkflow, currentWorkflow))[0].inputs,
    { local: 'override', shared: 'fresh', added: 'new' },
  );
});

test('a value-only local delta still follows a new shared order',()=>{
  const leaf=definition('leaf','1.0.0');
  const base=definition('workflow','1.0.0',{kind:'workflow',body:[instance('a','leaf','1.0.0',{value:'old'}),instance('b','leaf')]});
  const current=definition('workflow','1.0.1',{kind:'workflow',body:[instance('b','leaf'),instance('a','leaf','1.0.0',{value:'new'})]});
  const local=structuredClone(base.body!);local[0].inputs.value='local';
  const use={...instance('flow','workflow'),children:local};
  const resolved=currentTestingChildren(use,catalog(leaf,base,current));
  assert.deepEqual(resolved.map(block=>block.id),['b','a']);
  assert.equal(resolved[1].inputs.value,'local');
});

test('local insertion, deletion, and relative order are not silently undone', () => {
  const leaves = ['a', 'b', 'c', 'd', 'local'].map(id => definition(`fixture.${id}`, '1.0.0'));
  const [a, b, c, d, local] = leaves;
  const oldBody = [instance('a', a.id), instance('b', b.id), instance('c', c.id)];
  const localBody = [instance('local', local.id), instance('c', c.id), instance('a', a.id)];
  const currentBody = [instance('a', a.id), instance('b', b.id), instance('c', c.id), instance('d', d.id)];
  const oldWorkflow = definition('fixture.structure-workflow', '1.0.0', { kind: 'workflow', body: oldBody });
  const currentWorkflow = definition('fixture.structure-workflow', '1.0.1', {
    kind: 'workflow',
    body: currentBody,
    supersedes: { id: oldWorkflow.id, version: oldWorkflow.version },
  });
  const use: TestingBlockInstance = {
    ...instance('workflow', oldWorkflow.id, oldWorkflow.version),
    children: localBody,
  };

  const result = currentTestingChildren(use, catalog(...leaves, oldWorkflow, currentWorkflow));
  assert.deepEqual(result.map(child => child.id), ['local', 'c', 'd', 'a']);
  assert.equal(result.some(child => child.id === 'b'), false, 'a locally deleted base child must stay deleted');
  assert.deepEqual(result.filter(child => ['local', 'c', 'a'].includes(child.id)).map(child => child.id), ['local', 'c', 'a']);
});

test('a context without a shared body keeps its scenario-owned children', () => {
  const leaf = definition('fixture.context-child', '1.0.0');
  const context = definition('fixture.context', '1.0.0', { kind: 'context' });
  const children = [instance('first', leaf.id), instance('second', leaf.id)];
  const use: TestingBlockInstance = { ...instance('role', context.id), children: structuredClone(children) };

  assert.deepEqual(currentTestingChildren(use, catalog(leaf, context)), children);
});

test('new instances are sparse while an explicitly stored value equal to an old default stays explicit', () => {
  const oldDefinition = definition('fixture.defaults', '1.0.0', { inputs: [input('limit', '10')] });
  const currentDefinition = definition('fixture.defaults', '1.0.1', {
    inputs: [input('limit', '20')],
    supersedes: { id: oldDefinition.id, version: oldDefinition.version },
  });
  const definitions = catalog(oldDefinition, currentDefinition);

  assert.deepEqual(createTestingInstance(currentDefinition, 'new-use').inputs, {});

  const explicit = instance('existing-use', oldDefinition.id, oldDefinition.version, { limit: '10' });
  assert.equal(currentTestingDefinition(definitions, explicit.definition)?.version, currentDefinition.version);
  assert.deepEqual(explicit.inputs, { limit: '10' });
});

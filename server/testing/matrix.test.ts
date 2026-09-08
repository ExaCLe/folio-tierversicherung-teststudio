import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import type { TestingApproval, TestingBlockDefinition, TestingBlockInstance, TestingCatalog, TestingMatrix, TestingScenario, TestingTechnicalBinding } from '../../shared/testing';
import { compileTestingMatrixRow, compileTestingScenario, testingFingerprint } from './compiler';
import { generateTestingMatrix, scenarioForTestingMatrixRow, validateTestingMatrix } from './matrix';

const clone = <T>(value: T): T => structuredClone(value);
const ref = (id: string) => ({ id, version: '1.0.0' });
const instance = (id: string, definition: string, inputs: TestingBlockInstance['inputs'] = {}): TestingBlockInstance => ({ id, definition: ref(definition), inputs });
const definition = (input: Partial<TestingBlockDefinition> & Pick<TestingBlockDefinition, 'id' | 'kind' | 'inputs'>): TestingBlockDefinition => ({
  version: '1.0.0', name: input.id, description: input.id, category: 'Matrix', semanticKey: input.id, operation: input.id,
  outputs: [], knowledgeRefs: [], preconditions: [], postconditions: [], status: 'approved', createdAt: '2026-09-08', origin: 'human', ...input,
});
const binding = (id: string, revision = 1): TestingTechnicalBinding => ({
  id: `bindung.${id}`, revision, operation: id, name: id, status: 'ready', definitionRefs: [ref(id)], knowledgeRefs: [],
  module: 'generischer-rezepttreiber', export: 'execute', locators: [{ key: 'wert', method: 'testId', value: id }],
  recipe: [{ op: 'expectText', locatorKey: 'wert', value: { param: 'expected' } }], inputKeys: ['expected', 'profil', 'betrieb'], changeReason: 'Matrix-Vertragsfixture', createdAt: '2026-09-08',
});

const leaf = definition({ id: 'matrix.pruefung', kind: 'assertion', inputs: [
  { key: 'expected', label: 'Erwarteter Wert', type: 'text', required: true },
  { key: 'profil', label: 'Profil', type: 'object', default: { adresse: { land: 'DE', plz: '87437' }, alter: 4 }, fields: [
    { key: 'adresse', label: 'Adresse', type: 'object', fields: [
      { key: 'land', label: 'Land', type: 'text', required: true },
      { key: 'plz', label: 'Postleitzahl', type: 'text', required: true },
    ] },
    { key: 'alter', label: 'Alter', type: 'number', required: true },
  ] },
  { key: 'betrieb', label: 'Betrieb', type: 'farm-ref' },
] });
const middle = definition({ id: 'matrix.mitte', kind: 'workflow', inputs: [], body: [instance('pruefen', leaf.id)] });
const outer = definition({ id: 'matrix.aussen', kind: 'workflow', inputs: [], body: [instance('mitte', middle.id)] });
const baseCatalog: TestingCatalog = { revision: 'matrix-fixture', definitions: [leaf, middle, outer], bindings: [binding(leaf.id)], knowledge: [] };
const baseScenario = (blocks: TestingBlockInstance[] = [instance('aussen', outer.id)]): TestingScenario => ({
  id: 'matrix-testfall', title: 'Matrix-Vertragsfixture', intent: 'Matrix prüfen', revision: 1, blocks,
  expectedOutcome: 'Jede Zeile prüft einen erwarteten Wert.', knowledgeRefs: [], source: 'human', createdAt: '2026-09-08', updatedAt: '2026-09-08',
});
const matrix = (columns: TestingMatrix['columns'], values: TestingMatrix['rows'][number]['values']): TestingMatrix => ({
  columns, rows: [{ id: 'fall-1', label: 'Fall 1', enabled: true, values }],
});
const column = (id: string, blockPath: string, inputPath: string, type: TestingMatrix['columns'][number]['type']) => ({ id, label: id, target: { blockPath, inputPath }, type });
const approval = (scenario: TestingScenario, catalog: TestingCatalog): TestingApproval => ({
  id: 'freigabe-matrix', scenarioId: scenario.id, scenarioRevision: scenario.revision, fingerprint: testingFingerprint(scenario, catalog), actor: 'Vertragsfixture', approvedAt: '2026-09-08',
});

test('Kartesische Erzeugung liefert deterministisch 100 Zeilen und stoppt vor 101', () => {
  const started = performance.now();
  const generated = generateTestingMatrix([
    { ...column('land', 'aussen/mitte/pruefen', 'profil.adresse.land', 'text'), values: Array.from({ length: 10 }, (_, index) => `L${index}`) },
    { ...column('alter', 'aussen/mitte/pruefen', 'profil.alter', 'number'), values: Array.from({ length: 10 }, (_, index) => index) },
  ]);
  assert.equal(generated.rows.length, 100);
  assert.deepEqual(generated.rows[0].values, { land: 'L0', alter: 0 });
  assert.deepEqual(generated.rows[99].values, { land: 'L9', alter: 9 });
  assert.ok(performance.now() - started < 1_000, '100 Kombinationen sollten ohne merkliche Verzögerung entstehen');
  assert.throws(() => generateTestingMatrix([
    { ...column('a', 'aussen/mitte/pruefen', 'expected', 'text'), values: Array.from({ length: 101 }, (_, index) => String(index)) },
  ]), (error: any) => error?.code === 'MATRIX_LIMIT');
  assert.throws(() => generateTestingMatrix(Array.from({ length: 21 }, (_, index) => ({
    ...column(`spalte-${index}`, 'aussen/mitte/pruefen', 'expected', 'text'), values: ['gleich'],
  }))), (error: any) => error?.code === 'MATRIX_COLUMN_LIMIT');
});

test('Zweifach verschachtelte Definitionskörper erhalten Objekt-Defaults und Geschwisterfelder', () => {
  const scenario = baseScenario();
  scenario.matrix = matrix([column('land', 'aussen/mitte/pruefen', 'profil.adresse.land', 'text')], { land: 'AT' });
  const beforeScenario = clone(scenario), beforeCatalog = clone(baseCatalog);
  const row = scenarioForTestingMatrixRow(scenario, baseCatalog, 'fall-1');
  assert.deepEqual(row.blocks[0].overrides?.['mitte/pruefen']?.profil, { adresse: { land: 'AT', plz: '87437' }, alter: 4 });
  assert.deepEqual(scenario, beforeScenario, 'Materialisierung darf die gespeicherte Matrix nicht verändern');
  assert.deepEqual(baseCatalog, beforeCatalog, 'Materialisierung darf den Katalog nicht verändern');
});

test('Auch ein direkter Block übernimmt beim verschachtelten Matrixwert alle Default-Geschwister', () => {
  const scenario = baseScenario([instance('pruefen', leaf.id)]);
  scenario.matrix = matrix([column('land', 'pruefen', 'profil.adresse.land', 'text')], { land: 'CH' });
  const row = scenarioForTestingMatrixRow(scenario, baseCatalog, 'fall-1');
  assert.deepEqual(row.blocks[0].inputs.profil, { adresse: { land: 'CH', plz: '87437' }, alter: 4 });
});

test('Eine Matrix darf ein Pflichtfeld vollständig liefern, braucht aber einen echten Prüfblock', () => {
  const scenario = baseScenario();
  scenario.matrix = matrix([column('erwartet', 'aussen/mitte/pruefen', 'expected', 'text')], { erwartet: 'angenommen' });
  const compiled = compileTestingScenario(scenario, baseCatalog);
  assert.equal(compiled.valid, true, JSON.stringify(compiled.issues));
  assert.equal(scenarioForTestingMatrixRow(scenario, baseCatalog, 'fall-1').blocks[0].overrides?.['mitte/pruefen']?.expected, 'angenommen');

  const action = definition({ ...leaf, id: 'matrix.aktion', kind: 'action' });
  const noAssertionCatalog = { ...baseCatalog, definitions: [action], bindings: [binding(action.id)] };
  const noAssertion = baseScenario([instance('aktion', action.id)]);
  noAssertion.matrix = matrix([column('erwartet', 'aktion', 'expected', 'text')], { erwartet: 'angenommen' });
  assert.ok(compileTestingScenario(noAssertion, noAssertionCatalog).issues.some(issue => issue.code === 'MATRIX_ASSERTION_REQUIRED'));
});

test('Ungültige Ziele, Typen, zusammengesetzte Felder und Referenzfelder werden abgewiesen', () => {
  const cases = [
    { expected: 'MATRIX_TARGET', column: column('x', 'fehlt', 'expected', 'text'), value: 'x' },
    { expected: 'MATRIX_INPUT', column: column('x', 'aussen/mitte/pruefen', 'fehlt', 'text'), value: 'x' },
    { expected: 'MATRIX_TYPE', column: column('x', 'aussen/mitte/pruefen', 'expected', 'number'), value: 1 },
    { expected: 'MATRIX_TARGET_UNSUPPORTED', column: column('x', 'aussen/mitte/pruefen', 'profil', 'object'), value: {} },
    { expected: 'MATRIX_TARGET_UNSUPPORTED', column: column('x', 'aussen/mitte/pruefen', 'betrieb', 'farm-ref'), value: { ref: 'betrieb' } },
  ];
  for (const item of cases) {
    const scenario = baseScenario(); scenario.matrix = matrix([item.column], { x: item.value as any });
    assert.ok(validateTestingMatrix(scenario, baseCatalog).some(issue => issue.code === item.expected), `${item.expected} fehlt`);
  }
});

test('Matrixänderungen machen eine vorhandene Fachfreigabe veraltet', () => {
  const scenario = baseScenario();
  scenario.matrix = matrix([column('erwartet', 'aussen/mitte/pruefen', 'expected', 'text')], { erwartet: 'angenommen' });
  const accepted = approval(scenario, baseCatalog);
  assert.equal(compileTestingScenario(scenario, baseCatalog, accepted).executable, true);
  const changed = clone(scenario); changed.matrix!.rows[0].values.erwartet = 'abgelehnt';
  const compiled = compileTestingScenario(changed, baseCatalog, accepted);
  assert.notEqual(compiled.fingerprint, accepted.fingerprint);
  assert.equal(compiled.executable, false);
  assert.ok(compiled.issues.some(issue => issue.code === 'APPROVAL_STALE'));
});

test('Matrixzeilen verwenden ausschließlich die eingefrorene Bindungsrevision des freigegebenen Elternlaufs', () => {
  const scenario = baseScenario();
  scenario.matrix = matrix([column('erwartet', 'aussen/mitte/pruefen', 'expected', 'text')], { erwartet: 'angenommen' });
  const parent = compileTestingScenario(scenario, baseCatalog, approval(scenario, baseCatalog));
  assert.equal(parent.executable, true, JSON.stringify(parent.issues));
  const globalWithRevision2 = { ...baseCatalog, bindings: [...baseCatalog.bindings, binding(leaf.id, 2)] };
  assert.equal(compileTestingScenario(scenarioForTestingMatrixRow(scenario, globalWithRevision2, 'fall-1'), globalWithRevision2).bindings[0].revision, 2);
  const frozen = { revision: `run-${parent.fingerprint}`, definitions: parent.definitions, bindings: parent.bindings, knowledge: parent.knowledge };
  const row = compileTestingMatrixRow(parent, 'fall-1', frozen);
  assert.equal(row.bindings[0].revision, 1);
  assert.equal(row.approval?.fingerprint, parent.fingerprint);
  assert.deepEqual(row.matrixOrigin, { parentFingerprint: parent.fingerprint, rowId: 'fall-1', approval: parent.approval });
  assert.equal(row.executable, true);
});

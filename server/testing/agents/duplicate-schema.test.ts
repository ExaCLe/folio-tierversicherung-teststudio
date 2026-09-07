import test from 'node:test';
import assert from 'node:assert/strict';
import type { TestingBlockDefinition, TestingCatalog, TestingCompiledScenario } from '../../../shared/testing';
import { DUPLICATES_SCHEMA, duplicateSchemaFor, REUSE_SCHEMA, reuseSchemaFor } from './schemas';
import { validateDuplicateReview } from './reviews';

const definition = (id: string, version: string, origin: TestingBlockDefinition['origin'] = 'human'): TestingBlockDefinition => ({
  id, version, origin, name: 'Freigabeberechtigung prüfen', description: 'Prüft eine fachliche Berechtigung.', kind: 'assertion', category: 'Prüfungen',
  semanticKey: id, inputs: [{ key: 'expectedRole', label: 'Erwartete Rolle', type: 'text' }], outputs: [], knowledgeRefs: [], preconditions: [], postconditions: [], status: 'draft', createdAt: '2026-01-01',
});
const compiled = (...definitions: TestingBlockDefinition[]) => ({ definitions }) as TestingCompiledScenario;
const subject = definition('pruefung.sonderfreigabe', '1.0.0');
const comparison = definition('pruefung.bestehende-freigabe', '2.0.0', 'seed');
const catalog: TestingCatalog = { definitions: [subject, comparison], bindings: [], knowledge: [], revision: 'test' };
const decision = (proposed = { id: subject.id, version: subject.version }) => ({ proposed, decision: 'new', chosen: null, reason: 'Die Berechtigung ist eine eigene fachliche Prüfung.', compatible: false });

test('Dynamisches Dublettenschema trennt ID und Version und lässt Begründungen sowie Vergleichsreferenzen frei', () => {
  const schema = JSON.parse(JSON.stringify(duplicateSchemaFor(compiled(subject))));
  const fields = schema.properties.decisions.items.properties;
  assert.deepEqual(fields.proposed.properties.id.enum, ['pruefung.sonderfreigabe']);
  assert.deepEqual(fields.proposed.properties.version.enum, ['1.0.0']);
  assert.equal(fields.proposed.properties.id.enum.includes('1.0.0'), false);
  for (const unrelated of [schema.properties.explanation, fields.reason, schema.properties.unresolved.items, fields.chosen.anyOf[0].properties.id, fields.chosen.anyOf[0].properties.version]) {
    assert.equal(unrelated.type, 'string');
    assert.equal(unrelated.enum, undefined);
  }
  assert.equal(validateDuplicateReview({ explanation: 'Unabhängige Prüfung abgeschlossen.', decisions: [decision()], unresolved: [] }, compiled(subject), catalog).decisions[0].proposed.id, subject.id);
});

test('Mehrere Prüfgegenstände erlauben nur tatsächlich vorhandene ID-Versionspaare', () => {
  const second = definition('pruefung.zweite-berechtigung', '3.1.0');
  const schema = duplicateSchemaFor(compiled(subject, second));
  const branches = schema.properties.decisions.items.properties.proposed.anyOf;
  assert.deepEqual(branches.map((branch: any) => [branch.properties.id.enum[0], branch.properties.version.enum[0]]), [[subject.id, subject.version], [second.id, second.version]]);
  assert.throws(() => validateDuplicateReview({ explanation: '', decisions: [decision({ id: subject.id, version: second.version }), decision({ id: second.id, version: second.version })], unresolved: [] }, compiled(subject, second), { ...catalog, definitions: [...catalog.definitions, second] }), /Erlaubte Prüfgegenstände/);
});

test('Schema-Refinements verändern weder andere Aufrufe noch Basisschemas oder Wiederverwendungsfelder', () => {
  const original = JSON.stringify({ duplicates: DUPLICATES_SCHEMA, reuse: REUSE_SCHEMA });
  const first = duplicateSchemaFor(compiled(subject));
  const second = duplicateSchemaFor(compiled(definition('anderer.block', '9.0.0')));
  assert.deepEqual(first.properties.decisions.items.properties.proposed.properties.id.enum, [subject.id]);
  assert.deepEqual(second.properties.decisions.items.properties.proposed.properties.id.enum, ['anderer.block']);
  const reuse = reuseSchemaFor(compiled(subject));
  const parameter = reuse.properties.suggestions.items.properties.parameters.items.properties;
  assert.deepEqual(parameter.input.enum, ['expectedRole']);
  assert.equal(parameter.key.enum, undefined);
  assert.equal(parameter.instanceId.enum, undefined);
  assert.equal(parameter.label.enum, undefined);
  assert.equal(JSON.stringify({ duplicates: DUPLICATES_SCHEMA, reuse: REUSE_SCHEMA }), original);
});

test('Decoder lehnt die frühere schemaerzwungene Versions-ID weiterhin ab; echte Vergleichs-ID bleibt gültig', () => {
  const broken = { explanation: '1.0.0', decisions: [decision({ id: '1.0.0', version: '1.0.0' })], unresolved: [] };
  assert.throws(() => validateDuplicateReview(broken, compiled(subject), catalog), /1\.0\.0@1\.0\.0.*Erlaubte Prüfgegenstände/);
  const reuse = { explanation: 'Fachlich gleiche Prüfung gefunden.', decisions: [{ ...decision(), decision: 'reuse', chosen: { id: comparison.id, version: comparison.version }, compatible: true }], unresolved: [] };
  assert.equal(validateDuplicateReview(reuse, compiled(subject), catalog).decisions[0].chosen?.id, comparison.id);
  const emptySchema = duplicateSchemaFor(compiled(comparison));
  assert.equal(emptySchema.properties.decisions.maxItems, 0);
  assert.deepEqual(validateDuplicateReview({ explanation: 'Keine neuen Prüfgegenstände.', decisions: [], unresolved: [] }, compiled(comparison), catalog).decisions, []);
});

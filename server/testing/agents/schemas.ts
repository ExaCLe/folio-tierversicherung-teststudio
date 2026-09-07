import { z } from 'zod';
import type { TestingBlockDefinition, TestingBlockInstance, TestingBusinessDraft, TestingCompiledScenario, TestingInput, TestingKnowledgeDocument, TestingTechnicalBinding } from '../../../shared/testing';

type Schema = Record<string, any>;
const identifier = { type: 'string', pattern: '^[a-zA-Z0-9_.-]+$', minLength: 1, maxLength: 140 };
const string = { type: 'string' }, boolean = { type: 'boolean' };
const nullable = (schema: Schema) => ({ anyOf: [schema, { type: 'null' }] });
const array = (items: Schema) => ({ type: 'array', items });
const object = (properties: Record<string, Schema>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const strings = array(string);
const typeSchema = { enum: ['text', 'number', 'money', 'boolean', 'date', 'choice', 'object', 'list', 'customer-ref', 'farm-ref', 'animal-ref', 'proposal-ref', 'contract-ref', 'document-ref', 'policy-ref', 'referral-ref'] };
const ref = object({ id: string, version: string });
const pair = object({ key: string, valueJson: { type: 'string', description: 'Ein gültiger JSON-Wert. Referenzen {"ref":"alias"}, Parameter {"param":"name"}. Zeichenketten mit JSON-Anführungszeichen.' } });
const pairs = array(pair);
const output = object({ key: string, label: string, type: typeSchema });
const instance = object({ id: string, definition: ref, inputs: pairs, outputs: array(object({ key: string, name: string })),
  children: array({ $ref: '#/$defs/instance' }), overrides: array(object({ path: string, inputs: pairs })), note: string });
const input = object({ key: string, label: string, type: typeSchema, required: boolean,
  defaultJson: nullable(string), description: string, options: array(object({ value: string, label: string })),
  fieldsJson: { type: 'string', description: 'JSON-Liste von TestingInput, bei flachen Eingaben [].' }, minimum: nullable({ type: 'number' }), maximum: nullable({ type: 'number' }), extensible: boolean });
const definition = object({ id: string, version: string, name: string, description: string, kind: { enum: ['action', 'assertion', 'workflow', 'context'] },
  category: string, semanticKey: string, inputs: array(input), outputs: array(output), knowledgeRefs: strings, preconditions: strings, postconditions: strings,
  operation: nullable(string), bindingId: nullable(string), body: array({ $ref: '#/$defs/instance' }), exports: array(object({ key: string, ref: string, type: typeSchema })) });
const knowledge = object({ id: string, title: string, kind: { enum: ['concept', 'rule', 'procedure', 'technical'] }, summary: string, content: string,
  definitionRefs: array(ref), relatedKnowledge: strings, requiredFields: strings, preconditions: strings, postconditions: strings });

/** Strict schema uses key/value rows for extensible maps, then validates decoded domain data. */
export const BUSINESS_SCHEMA = { ...object({ title: string, expectedOutcome: string, blocks: array({ $ref: '#/$defs/instance' }), knowledgeRefs: strings,
  newDefinitions: array(definition), newKnowledge: array(knowledge), explanation: string, assumptions: strings, openQuestions: strings }), $defs: { instance } };
export const TECHNICAL_SCHEMA = object({ explanation: string, reuseBindings: array(object({ id: string, revision: { type: 'integer' } })),
  newBindings: array(object({ bindingJson: { type: 'string', description: 'Vollständiges TestingTechnicalBinding mit inputKeys, locators und deklarativem recipe; gültiges JSON, keine ausführbaren JS-/Shell-Zeichenketten. unlessVisible ist nur an click ohne capture erlaubt und benennt einen key aus denselben locators. Speicherklicks mit capture dürfen nicht übersprungen werden.' }, reason: string })), unsupported: strings });
export const DUPLICATES_SCHEMA = object({ explanation: string, decisions: array(object({ proposed: ref, decision: { enum: ['reuse', 'extend', 'new'] },
  chosen: nullable(ref), reason: string, compatible: boolean })), unresolved: strings });
export const REUSE_SCHEMA = object({ explanation: string, suggestions: array(object({ name: string, reason: string, instanceIds: array(identifier), parentPath: nullable(string),
  parameters: array(object({ key: identifier, label: string, instanceId: identifier, input: { ...identifier, description: "Exakter inputs[].key der ausgewählten Blockdefinition, z.B. state. Niemals ein Wert wie Bayern oder ein Blockpfad." } })) })) });
// JSON Schema is a value tree. structuredClone preserves shared object identity
// between reused fragments, so refining one field could constrain other fields.
function cloneSchemaTree(schema: Schema): Schema { return JSON.parse(JSON.stringify(schema)); }
export function reuseSchemaFor(compiled: TestingCompiledScenario) {
  const schema = cloneSchemaTree(REUSE_SCHEMA);
  const parameters = schema.properties.suggestions.items.properties.parameters;
  const keys = [...new Set(compiled.definitions.flatMap(definition => definition.inputs.map(input => input.key)))];
  if (keys.length) parameters.items.properties.input.enum = keys;
  else parameters.maxItems = 0;
  return schema;
}
export function duplicateSchemaFor(compiled: TestingCompiledScenario) {
  const schema = cloneSchemaTree(DUPLICATES_SCHEMA), candidates = compiled.definitions.filter(item => item.origin !== 'seed');
  if (candidates.length) {
    const references = candidates.map(item => object({
      id: { type: 'string', enum: [item.id], description: 'Exakte Definitions-ID des Prüfgegenstands, nicht seine Versionsnummer.' },
      version: { type: 'string', enum: [item.version], description: 'Zur Definitions-ID gehörende freigegebene Version.' },
    }));
    // Keep each ID paired with its actual version, rather than permitting a
    // cross-product of IDs and versions from unrelated review subjects.
    schema.properties.decisions.items.properties.proposed = references.length === 1 ? references[0] : { anyOf: references };
  } else schema.properties.decisions.maxItems = 0;
  return schema;
}

const text = z.string().max(40_000);
const id = z.string().min(1).max(140).regex(/^[a-zA-Z0-9_.-]+$/);
const valueType = z.enum(['text', 'number', 'money', 'boolean', 'date', 'choice', 'object', 'list', 'customer-ref', 'farm-ref', 'animal-ref', 'proposal-ref', 'contract-ref', 'document-ref', 'policy-ref', 'referral-ref']);
const conditionZ = z.object({ input: id, values: z.array(z.union([z.string(), z.number(), z.boolean()])) }).strict();
const domainInputZ: z.ZodType<TestingInput> = z.lazy(() => z.object({ key: id, label: text, type: valueType, required: z.boolean().optional(), default: z.unknown().optional(),
  description: text.optional(), options: z.array(z.object({ value: text, label: text }).strict()).optional(), fields: z.array(domainInputZ).optional(),
  minimum: z.number().optional(), maximum: z.number().optional(), extensible: z.boolean().optional(), requiredWhen: conditionZ.optional(), applicableWhen: conditionZ.optional() }).strict()) as z.ZodType<TestingInput>;
const pairZ = z.object({ key: id, valueJson: text }).strict();
function parseJson(value: string, label: string): any { try { return JSON.parse(value); } catch { throw new Error(`${label} enthält keinen gültigen JSON-Wert.`); } }
function decodedPairs(value: unknown): Record<string, any> {
  const rows = z.array(pairZ).max(100).parse(value);
  if (new Set(rows.map(row => row.key)).size !== rows.length) throw new Error('Ein Eingabefeld wurde mehrfach definiert.');
  return Object.fromEntries(rows.map(row => [row.key, parseJson(row.valueJson, row.key)]));
}
function decodeInstance(raw: any, depth = 0): TestingBlockInstance {
  if (depth > 12) throw new Error('Eine Blockverschachtelung ist tiefer als zwölf Ebenen.');
  const row = z.object({ id, definition: z.object({ id, version: id }).strict(), inputs: z.array(pairZ),
    outputs: z.array(z.object({ key: id, name: text }).strict()), children: z.array(z.unknown()), overrides: z.array(z.object({ path: text, inputs: z.array(pairZ) }).strict()), note: text }).strict().parse(raw);
  return { id: row.id, definition: row.definition, inputs: decodedPairs(row.inputs), outputs: Object.fromEntries(row.outputs.map(output => [output.key, output.name])),
    ...(row.children.length ? { children: row.children.map(child => decodeInstance(child, depth + 1)) } : {}),
    ...(row.overrides.length ? { overrides: Object.fromEntries(row.overrides.map(override => [override.path, decodedPairs(override.inputs)])) } : {}),
    ...(row.note ? { note: row.note } : {}) };
}
export function decodeBusinessDraft(raw: unknown): TestingBusinessDraft {
  const value = z.object({ title: text.min(1), expectedOutcome: text.min(1), blocks: z.array(z.unknown()).max(100), knowledgeRefs: z.array(id),
    newDefinitions: z.array(z.any()).max(30), newKnowledge: z.array(z.any()).max(30), explanation: text, assumptions: z.array(text), openQuestions: z.array(text) }).strict().parse(raw);
  const newDefinitions: TestingBlockDefinition[] = value.newDefinitions.map(row => ({
    id: id.parse(row.id), version: id.parse(row.version), name: text.min(1).parse(row.name), description: text.parse(row.description),
    kind: z.enum(['action', 'assertion', 'workflow', 'context']).parse(row.kind), category: text.parse(row.category), semanticKey: text.min(1).parse(row.semanticKey),
    inputs: z.array(z.any()).max(100).parse(row.inputs).map((item): TestingInput => domainInputZ.parse({ key: id.parse(item.key), label: text.parse(item.label), type: valueType.parse(item.type), required: z.boolean().parse(item.required),
      ...(item.defaultJson !== null ? { default: parseJson(text.parse(item.defaultJson), `${item.key}.default`) } : {}), description: text.parse(item.description),
      ...(item.options?.length ? { options: z.array(z.object({ value: text, label: text }).strict()).parse(item.options) } : {}), fields: parseJson(text.parse(item.fieldsJson), `${item.key}.fields`),
      ...(item.minimum !== null ? { minimum: z.number().parse(item.minimum) } : {}), ...(item.maximum !== null ? { maximum: z.number().parse(item.maximum) } : {}), extensible: z.boolean().parse(item.extensible) })),
    outputs: z.array(z.object({ key: id, label: text, type: valueType }).strict()).parse(row.outputs),
    knowledgeRefs: z.array(id).parse(row.knowledgeRefs), preconditions: z.array(text).parse(row.preconditions), postconditions: z.array(text).parse(row.postconditions),
    ...(row.operation ? { operation: text.parse(row.operation) } : {}), ...(row.bindingId ? { bindingId: id.parse(row.bindingId) } : {}),
    ...(row.body?.length ? { body: row.body.map((child: any) => decodeInstance(child)) } : {}),
    ...(row.exports?.length ? { exports: Object.fromEntries(row.exports.map((item: any) => [id.parse(item.key), { ref: text.parse(item.ref), type: text.parse(item.type) }])) } : {}),
    status: 'draft', origin: 'agent', createdAt: new Date().toISOString(),
  }));
  const newKnowledge: TestingKnowledgeDocument[] = value.newKnowledge.map(row => ({
    id: id.parse(row.id), revision: 1, title: text.min(1).parse(row.title), kind: z.enum(['concept', 'rule', 'procedure', 'technical']).parse(row.kind),
    summary: text.parse(row.summary), content: text.parse(row.content), definitionRefs: z.array(z.object({ id, version: id })).parse(row.definitionRefs),
    relatedKnowledge: z.array(id).parse(row.relatedKnowledge), requiredFields: z.array(text).parse(row.requiredFields), preconditions: z.array(text).parse(row.preconditions), postconditions: z.array(text).parse(row.postconditions), origin: 'agent',
  }));
  return { ...value, blocks: value.blocks.map(block => decodeInstance(block)), newDefinitions, newKnowledge };
}
export function decodeTechnicalPlan(raw: unknown) {
  const value = z.object({ explanation: text, reuseBindings: z.array(z.object({ id, revision: z.number().int().positive() }).strict()),
    newBindings: z.array(z.object({ bindingJson: text, reason: text }).strict()).max(40), unsupported: z.array(text) }).strict().parse(raw);
  return { ...value, newBindings: value.newBindings.map(row => ({ binding: parseJson(row.bindingJson, 'Technische Bindung') as TestingTechnicalBinding, reason: row.reason })) };
}
export const decodeDuplicates = (raw: unknown) => z.object({ explanation: text, decisions: z.array(z.object({ proposed: z.object({ id, version: id }), decision: z.enum(['reuse', 'extend', 'new']), chosen: z.object({ id, version: id }).nullable(), reason: text, compatible: z.boolean() })), unresolved: z.array(text) }).strict().parse(raw);
export const decodeReuse = (raw: unknown) => z.object({ explanation: text, suggestions: z.array(z.object({ name: text.min(1), reason: text, instanceIds: z.array(id).min(1), parentPath: text.nullable().optional().transform(value => value || undefined), parameters: z.array(z.object({ key: id, label: text, instanceId: id, input: id })) })).max(12) }).strict().parse(raw);

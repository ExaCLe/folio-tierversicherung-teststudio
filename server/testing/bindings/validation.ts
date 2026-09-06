import { createHash } from 'node:crypto';
import { z } from 'zod';
import { effectiveTestingOperation } from '../compiler';
import type { TestingCatalog, TestingTechnicalBinding, TestingValue } from '../../../shared/testing';

const safeId = z.string().min(1).max(140).regex(/^[a-zA-Z0-9_.-]+$/);
const locator = z.object({ key: safeId, method: z.enum(['role', 'label', 'text', 'testId']), value: z.string().min(1).max(500), role: z.string().optional(), exact: z.boolean().optional() }).strict();
const capture = z.object({ method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']), path: z.string().startsWith('/api/agriculture/').max(300), status: z.number().int().min(200).max(599).optional(),
  outputs: z.record(z.string().max(200)), expect: z.record(z.unknown()).optional() }).strict();
const action = z.object({ op: z.enum(['goto', 'fill', 'select', 'click', 'check', 'expectText', 'expectVisible', 'captureResponse']), locatorKey: safeId.optional(), value: z.unknown().optional(), capture: capture.optional(), proof: z.object({ matched: safeId.optional(), actual: safeId.optional() }).strict().optional(), unlessVisible: safeId.optional(), when: z.object({ input: safeId, equals: z.unknown().optional(), present: z.boolean().optional() }).strict().optional() }).strict();
const bindingSchema = z.object({ id: safeId, revision: z.number().int().positive(), operation: z.string().min(1).max(300), name: z.string().min(1).max(300), status: z.enum(['missing', 'draft', 'ready']),
  definitionRefs: z.array(z.object({ id: safeId, version: safeId }).strict()), knowledgeRefs: z.array(safeId), module: z.literal('e2e/helpers/agriculture-driver.ts'), export: z.literal('executeTestingStep'),
  locators: z.array(locator).max(100), recipe: z.array(action).max(150), inputKeys: z.array(safeId).max(100), changeReason: z.string().min(1).max(5000), createdAt: z.string(), sourceHash: z.string().optional() }).strict();

export function collectRecipeParameters(value: unknown, result = new Set<string>()): Set<string> {
  if (typeof value === 'string') for (const match of value.matchAll(/\{\{([a-zA-Z0-9_.-]+)\}\}/g)) result.add(match[1]);
  if (Array.isArray(value)) value.forEach(item => collectRecipeParameters(item, result));
  else if (value && typeof value === 'object') {
    if ('when' in value && value.when && typeof value.when === 'object' && 'input' in value.when && typeof value.when.input === 'string') result.add(value.when.input);
    if ('param' in value && typeof value.param === 'string') result.add(value.param);
    Object.values(value).forEach(item => collectRecipeParameters(item, result));
  }
  return result;
}
function assertSafeValue(value: unknown, depth = 0): asserts value is TestingValue {
  if (depth > 15) throw new Error('Technischer Wert ist zu tief verschachtelt.');
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return;
  if (Array.isArray(value)) { value.forEach(item => assertSafeValue(item, depth + 1)); return; }
  if (value && typeof value === 'object') { for (const [key, item] of Object.entries(value)) { if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Ungültiger technischer Feldname.'); assertSafeValue(item, depth + 1); } return; }
  throw new Error('Ein technischer Wert ist kein JSON-Wert.');
}
export function validateTestingBinding(input: unknown, catalog: TestingCatalog): TestingTechnicalBinding {
  const binding = bindingSchema.parse(input) as TestingTechnicalBinding;
  if (!binding.recipe?.length && binding.status === 'ready') throw new Error('Eine ausführbare Bindung benötigt ein UI-Rezept.');
  const keys = new Set(binding.locators.map(item => item.key));
  if (keys.size !== binding.locators.length) throw new Error('Locator-Schlüssel müssen eindeutig sein.');
  for (const item of binding.locators) if (item.method === 'role' && !item.role) throw new Error(`Locator ${item.key} benötigt eine ARIA-Rolle.`);
  for (const item of binding.recipe ?? []) {
    if (item.value !== undefined) assertSafeValue(item.value);
    if (item.capture?.expect) assertSafeValue(item.capture.expect);
    if (item.op === 'goto') {
      if (typeof item.value !== 'string' || !/^\/portal(?:[/?#]|$)/.test(item.value) || item.value.includes('://') || item.value.includes('\\')) throw new Error('Browserrezepte dürfen ausschließlich lokale /portal-Seiten öffnen.');
    } else if (item.op !== 'captureResponse' && (!item.locatorKey || !keys.has(item.locatorKey))) throw new Error(`Rezeptaktion ${item.op} verweist auf einen unbekannten Locator.`);
    if (item.unlessVisible && (item.op !== 'click' || !keys.has(item.unlessVisible) || item.capture)) throw new Error('unlessVisible darf nur einen bekannten alternativen Formularzustand eines reinen Öffnungsklicks prüfen.');
    if (item.op === 'captureResponse') throw new Error('Antworten müssen als capture an der auslösenden Klickaktion hängen, damit kein Ereignis verloren geht.');
    if (item.capture && item.op !== 'click') throw new Error('Antwortnachweise sind ausschließlich an Klickaktionen erlaubt.');
    if (item.proof && !['expectText', 'expectVisible'].includes(item.op)) throw new Error('Prüfergebnisse dürfen nur nach einer echten UI-Assertion erfasst werden.');
  }
  const used = collectRecipeParameters([binding.recipe, binding.locators]);
  for (const key of binding.inputKeys ?? []) if (!used.has(key)) throw new Error(`Eingabe ${key} ist als verwendet deklariert, wird im UI-Rezept aber weder gesetzt noch geprüft.`);
  for (const key of used) if (key !== 'runId' && !binding.inputKeys?.includes(key)) throw new Error(`Verwendete Eingabe ${key} fehlt in inputKeys.`);
  for (const ref of binding.definitionRefs) {
    const definition = catalog.definitions.find(item => item.id === ref.id && item.version === ref.version);
    if (!definition) throw new Error(`Die fachliche Definition ${ref.id}@${ref.version} ist unbekannt.`);
    if (effectiveTestingOperation(definition) !== binding.operation) throw new Error(`Die Bindung ${binding.id} verwendet operation=${binding.operation}; ${definition.id}@${definition.version} erwartet exakt operation=${effectiveTestingOperation(definition)}. Bei einer fachlichen Definition ohne operation gilt semanticKey unverändert als technischer Vorgang.`);
    const captured = new Set((binding.recipe ?? []).flatMap(item => [...Object.keys(item.capture?.outputs ?? {}), ...Object.values(item.proof ?? {})]));
    for (const output of definition.outputs) if (!captured.has(output.key)) throw new Error(`Das deklarierte Ergebnis ${definition.id}.${output.key} fehlt im Rezept. IDs müssen aus einer echten Klickantwort kommen; Assertion-Ergebnisse können mit proof:{matched:"ergebnisname",actual:"istwertname"} nach erfolgreichem expectText/expectVisible erfasst werden.`);
    for (const item of binding.recipe ?? []) {
      if (item.proof?.matched && definition.outputs.find(output => output.key === item.proof!.matched)?.type !== 'boolean') throw new Error('proof.matched benötigt ein deklariertes boolesches Ergebnis.');
      if (item.proof?.actual && !['text', 'choice'].includes(definition.outputs.find(output => output.key === item.proof!.actual)?.type ?? '')) throw new Error('proof.actual benötigt ein deklariertes Text- oder Auswahl-Ergebnis.');
    }
  }
  for (const ref of binding.knowledgeRefs) if (!catalog.knowledge.some(item => item.id === ref)) throw new Error(`Wissensquelle ${ref} ist unbekannt.`);
  return { ...binding, sourceHash: createHash('sha256').update(JSON.stringify({ locators: binding.locators, recipe: binding.recipe, inputKeys: binding.inputKeys })).digest('hex') };
}

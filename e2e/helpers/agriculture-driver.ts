import { expect, type Page, type Locator } from '@playwright/test';
import type { TestingCompiledStep, TestingTechnicalBinding, TestingValue, TestingUIRecipeAction } from '../../shared/testing';

export interface TestingExecutionState { runId: string; outputs: Record<string, TestingValue>; }
export function createTestingExecutionState(runId: string): TestingExecutionState { return { runId, outputs: {} }; }

function getPath(value: unknown, path: string): unknown {
  return path.split('.').filter(Boolean).reduce<unknown>((result, key) => result && typeof result === 'object' ? (result as Record<string, unknown>)[key] : undefined, value);
}
function resolveValue(value: unknown, inputs: Record<string, TestingValue>, state: TestingExecutionState, encodeTemplates = false): any {
  if (Array.isArray(value)) return value.map(item => resolveValue(item, inputs, state));
  if (value && typeof value === 'object') {
    if ('ref' in value && typeof value.ref === 'string') {
      if (!(value.ref in state.outputs) || state.outputs[value.ref] === null) throw new Error(`Das konkrete Laufobjekt ${value.ref} fehlt.`);
      return state.outputs[value.ref];
    }
    if ('param' in value && typeof value.param === 'string') {
      if (!(value.param in inputs)) throw new Error(`Das technische Rezept erwartet das nicht gesetzte Feld ${value.param}.`);
      return resolveValue(inputs[value.param], inputs, state);
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveValue(item, inputs, state)]));
  }
  if (typeof value === 'string') return value.replace(/\{\{([a-zA-Z0-9_.-]+)\}\}/g, (_all, key: string) => {
    const resolved = key === 'runId' ? state.runId : resolveValue({ param: key }, inputs, state);
    if (resolved !== null && typeof resolved === 'object') throw new Error(`Die URL-Eingabe ${key} muss ein einzelner Wert sein.`);
    return encodeTemplates ? encodeURIComponent(String(resolved)) : String(resolved);
  });
  return value;
}
function locatorFor(page: Page, binding: TestingTechnicalBinding, key: string, inputs: Record<string, TestingValue>, state: TestingExecutionState): Locator {
  const locator = binding.locators.find(item => item.key === key);
  if (!locator) throw new Error(`Locator ${key} fehlt in ${binding.id}@${binding.revision}.`);
  const exact = locator.exact ?? true;
  const value = String(resolveValue(locator.value, inputs, state));
  if (locator.method === 'label') return page.getByLabel(value, { exact });
  if (locator.method === 'text') return page.getByText(value, { exact });
  if (locator.method === 'testId') return page.getByTestId(value);
  return page.getByRole(locator.role as Parameters<Page['getByRole']>[0], { name: value, exact });
}
function paramUsage(value: unknown, result = new Set<string>()): Set<string> {
  if (typeof value === 'string') for (const match of value.matchAll(/\{\{([a-zA-Z0-9_.-]+)\}\}/g)) result.add(match[1]);
  if (Array.isArray(value)) value.forEach(item => paramUsage(item, result));
  else if (value && typeof value === 'object') {
    if ('param' in value && typeof value.param === 'string') result.add(value.param);
    Object.values(value).forEach(item => paramUsage(item, result));
  }
  return result;
}
function responseMatches(template: string, pathname: string): boolean {
  const expression = template.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]+');
  return new RegExp(`^${expression}$`).test(pathname);
}
async function setActor(page: Page, actor: string) {
  const role = page.getByLabel('Benutzerrolle', { exact: true });
  await expect(role).toBeVisible();
  await role.selectOption(actor);
}

/** Executes declarative recipes. It has no switch over business block IDs or operation names. */
export async function executeTestingStep(page: Page, step: TestingCompiledStep, binding: TestingTechnicalBinding, state: TestingExecutionState) {
  if (!binding.recipe?.length || binding.status !== 'ready') throw new Error(`Der Block ${step.path} besitzt noch keine ausführbare technische Bindung.`);
  const outputValues: Record<string, TestingValue> = {};
  const usedInputs = new Set<string>();
  if (!binding.recipe.some(action => action.op === 'goto')) await setActor(page, step.actor);
  for (const action of binding.recipe) {
    const when = (action as TestingUIRecipeAction & { when?: { input: string; equals?: TestingValue; present?: boolean } }).when;
    if (when) {
      usedInputs.add(when.input);
      const inputValue = step.inputs[when.input];
      if (when.present !== undefined && (inputValue !== undefined && inputValue !== null) !== when.present) continue;
      if (when.equals !== undefined && resolveValue(inputValue, step.inputs, state) !== resolveValue(when.equals, step.inputs, state)) continue;
    }
    paramUsage(action, usedInputs);
    const value = resolveValue(action.value, step.inputs, state, action.op === 'goto');
    if (action.op === 'goto') {
      if (typeof value !== 'string' || !/^\/portal(?:[/?#]|$)/.test(value) || value.includes('://') || value.includes('\\')) throw new Error('Das Rezept wollte eine Seite außerhalb des lokalen Portals öffnen.');
      await page.goto(value);
      await setActor(page, step.actor);
      continue;
    }
    if (!action.locatorKey) throw new Error(`Die Aktion ${action.op} hat keinen Locator.`);
    paramUsage(binding.locators.find(item => item.key === action.locatorKey)?.value, usedInputs);
    const locator = locatorFor(page, binding, action.locatorKey, step.inputs, state);
    if (action.unlessVisible) {
      const achieved = locatorFor(page, binding, action.unlessVisible, step.inputs, state);
      await expect.poll(async () => {
        if (await achieved.isVisible()) return 'geöffnet';
        return await locator.isVisible() && await locator.isEnabled() ? 'öffnen möglich' : 'lädt';
      }, { message: `Formularzustand für ${action.locatorKey}`, timeout: 12_000 }).not.toBe('lädt');
      if (await achieved.isVisible()) continue;
    }
    if (action.op === 'fill') await locator.fill(String(value));
    else if (action.op === 'select') await locator.selectOption(Array.isArray(value) ? value.map(String) : String(value));
    else if (action.op === 'check') await locator.setChecked(Boolean(value));
    else if (action.op === 'expectVisible') await expect(locator).toBeVisible();
    else if (action.op === 'expectEnabled') { await expect(locator).toBeVisible(); await expect(locator).toBeEnabled(); }
    else if (action.op === 'expectDisabled') { await expect(locator).toBeVisible(); await expect(locator).toBeDisabled(); }
    else if (action.op === 'expectText') await expect(locator).toHaveText(String(value));
    else if (action.op === 'click') {
      if (!action.capture) await locator.click();
      else {
        const spec = action.capture;
        const path = String(resolveValue(spec.path, step.inputs, state));
        const responsePromise = page.waitForResponse(response => response.request().method() === spec.method && responseMatches(path, new URL(response.url()).pathname));
        const [response] = await Promise.all([responsePromise, locator.click()]);
        const body: unknown = await response.json();
        if (spec.status !== undefined) expect(response.status(), `HTTP-Antwort für ${path}`).toBe(spec.status);
        else expect(response.ok(), `HTTP-Antwort für ${path}: ${JSON.stringify(body)}`).toBeTruthy();
        for (const [jsonPath, expected] of Object.entries(spec.expect ?? {})) expect(getPath(body, jsonPath), `Antwortfeld ${jsonPath} im Block ${step.path}`).toEqual(resolveValue(expected, step.inputs, state));
        for (const [outputKey, jsonPath] of Object.entries(spec.outputs)) {
          const captured = getPath(body, jsonPath);
          if (captured === undefined) throw new Error(`Das erwartete Ergebnis ${jsonPath} fehlt in der echten Portalantwort.`);
          outputValues[outputKey] = captured as TestingValue;
          const qualified = step.outputs[outputKey];
          if (qualified) state.outputs[qualified] = captured as TestingValue;
        }
      }
    } else throw new Error(`Nicht unterstützte Rezeptaktion ${action.op}.`);
    if (action.proof) {
      if (!['expectText', 'expectVisible', 'expectEnabled', 'expectDisabled'].includes(action.op)) throw new Error('Ein Prüfergebnis darf nur nach einer echten Assertion gespeichert werden.');
      for (const [kind, key] of Object.entries(action.proof)) {
        const observed = kind === 'matched' ? true : (await locator.textContent())?.trim() ?? '';
        outputValues[key] = observed;
        if (step.outputs[key]) state.outputs[step.outputs[key]] = observed;
      }
    }
  }
  for (const key of Object.keys(step.inputs)) if (!usedInputs.has(key)) throw new Error(`Das Eingabefeld ${key} wurde in diesem Lauf weder gesetzt noch geprüft. Der Block benötigt eine ergänzte technische Bindung.`);
  for (const key of Object.keys(step.outputs)) if (!(key in outputValues)) throw new Error(`Das deklarierte Ergebnis ${key} wurde vom Portal nicht erfasst.`);
  return { outputValues, outputs: { ...state.outputs } };
}

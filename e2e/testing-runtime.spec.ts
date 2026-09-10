import { test, expect, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import type { TestingBlockDefinition, TestingCatalog, TestingCompiledScenario, TestingRun, TestingScenario, TestingTechnicalBinding } from '../shared/testing';
import type { ProposalDetail, AgricultureOverview } from '../shared/agriculture';
import { createTestingExecutionState, executeTestingStep } from './helpers/agriculture-driver';

async function json<T>(request: APIRequestContext, method: 'get' | 'post' | 'put', path: string, data?: unknown): Promise<T> {
  const response = await request[method](path, { ...(data === undefined ? {} : { data }) });
  expect(response.ok(), await response.text()).toBeTruthy(); return response.json() as Promise<T>;
}
async function variation(request: APIRequestContext, source: string, mutate?: (scenario: TestingScenario) => void) {
  const seed = await json<TestingScenario>(request, 'get', `/api/testing/scenarios/${source}`);
  const scenario = { ...seed, id: `laufpruefung-${randomUUID()}`, title: `${seed.title} · Laufprüfung`, source: 'human' as const };
  mutate?.(scenario);
  return json<TestingScenario>(request, 'put', `/api/testing/scenarios/${scenario.id}`, { ...scenario, expectedRevision: 0 });
}
async function approve(request: APIRequestContext, scenario: TestingScenario) {
  await json(request, 'post', `/api/testing/scenarios/${scenario.id}/approve`, { revision: scenario.revision });
  const compiled = await json<TestingCompiledScenario>(request, 'get', `/api/testing/scenarios/${scenario.id}/compile`);
  expect(compiled.executable, JSON.stringify(compiled.issues)).toBe(true); return compiled;
}
async function run(request: APIRequestContext, scenario: TestingScenario) {
  const queued = await json<TestingRun>(request, 'post', `/api/testing/scenarios/${scenario.id}/run`, { revision: scenario.revision });
  let result = queued;
  await expect.poll(async () => { result = await json<TestingRun>(request, 'get', `/api/testing/runs/${queued.id}`); return result.status; }, { timeout: 70_000, intervals: [200, 500, 1000] }).toMatch(/passed|failed/);
  return result;
}
function output(run: TestingRun, suffix: string) { const entry = Object.entries(run.outputs ?? {}).find(([key]) => key.endsWith(`::${suffix}`)); expect(entry).toBeTruthy(); return String(entry![1]); }

test('Automatisch öffnendes Formular wartet auf Ladeende statt einen noch gesperrten Öffnungsknopf zu klicken', async ({ page }) => {
  await page.setContent('<label>Benutzerrolle<select aria-label="Benutzerrolle"><option>Vermittler</option></select></label><button disabled>Neuen Betrieb erfassen</button><main></main>');
  await page.evaluate(() => { setTimeout(() => { document.querySelector('button')!.remove(); document.querySelector('main')!.innerHTML = '<label>Betriebsname<input></label>'; }, 200); });
  const binding: TestingTechnicalBinding = { id: 'ui.ladezustand', revision: 1, operation: 'ladezustand', name: 'Ladezustand', status: 'ready', definitionRefs: [], knowledgeRefs: [], module: 'e2e/helpers/agriculture-driver.ts', export: 'executeTestingStep', inputKeys: ['name'], changeReason: 'Regression für automatisch geöffnete Formulare.', createdAt: new Date().toISOString(),
    locators: [{ key: 'open', method: 'role', role: 'button', value: 'Neuen Betrieb erfassen' }, { key: 'name', method: 'label', value: 'Betriebsname' }], recipe: [{ op: 'click', locatorKey: 'open', unlessVisible: 'name' }, { op: 'fill', locatorKey: 'name', value: { param: 'name' } }] };
  await executeTestingStep(page, { id: 'betrieb', instanceId: 'betrieb', path: 'betrieb', ancestors: [], definition: { id: 'betrieb', version: '1.0.0' }, label: 'Betrieb', kind: 'action', operation: 'ladezustand', actor: 'Vermittler', inputs: { name: 'Ladezustand geprüft' }, outputs: {}, knowledgeRefs: [] }, binding, createTestingExecutionState('ladezustand'));
  await expect(page.getByLabel('Betriebsname')).toHaveValue('Ladezustand geprüft');
});

test('Berechtigungsrezepte prüfen Bedienbarkeit und lehnen beide falschen Erwartungen ab', async ({ page }) => {
  test.setTimeout(45_000);
  await page.setContent('<label>Benutzerrolle<select aria-label="Benutzerrolle"><option>Direktion</option></select></label><label>Entscheidung<select aria-label="Entscheidung" disabled><option>Freigeben</option></select></label>');
  const binding: TestingTechnicalBinding = { id: 'ui.bedienbarkeit', revision: 1, operation: 'bedienbarkeit', name: 'Bedienbarkeit', status: 'ready', definitionRefs: [], knowledgeRefs: [], module: 'e2e/helpers/agriculture-driver.ts', export: 'executeTestingStep', inputKeys: ['allowed'], changeReason: 'Regression für echte Bedienbarkeit.', createdAt: new Date().toISOString(),
    locators: [{ key: 'decision', method: 'label', value: 'Entscheidung' }], recipe: [
      { op: 'expectEnabled', locatorKey: 'decision', when: { input: 'allowed', equals: true }, proof: { matched: 'matched' } },
      { op: 'expectDisabled', locatorKey: 'decision', when: { input: 'allowed', equals: false }, proof: { matched: 'matched' } },
    ] };
  const step = { id: 'authorization', instanceId: 'authorization', path: 'authorization', ancestors: [], definition: { id: 'authorization', version: '1.0.0' }, label: 'Berechtigung', kind: 'assertion' as const, operation: 'bedienbarkeit', actor: 'Direktion', inputs: { allowed: false }, outputs: { matched: 'authorization::matched' }, knowledgeRefs: [] };
  const success = createTestingExecutionState('bedienbarkeit');
  await executeTestingStep(page, step, binding, success);
  expect(Object.values(success.outputs)).toContain(true);
  const wrongEnabled = createTestingExecutionState('falsch-enabled');
  await expect(executeTestingStep(page, { ...step, inputs: { allowed: true } }, binding, wrongEnabled)).rejects.toThrow(/toBeEnabled/);
  expect(wrongEnabled.outputs).toEqual({});
  await page.getByLabel('Entscheidung').evaluate(element => { (element as HTMLSelectElement).disabled = false; });
  await executeTestingStep(page, { ...step, inputs: { allowed: true } }, binding, createTestingExecutionState('enabled'));
  const wrongDisabled = createTestingExecutionState('falsch-disabled');
  await expect(executeTestingStep(page, step, binding, wrongDisabled)).rejects.toThrow(/toBeDisabled/);
  expect(wrongDisabled.outputs).toEqual({});
});

test('Direktionsberechtigung prüft die tatsächliche Bedienbarkeit in allen drei Portalrollen', async ({ request }) => {
  const suffix = randomUUID();
  const definition: TestingBlockDefinition = { id: `pruefung.berechtigung.${suffix}`, version: '1.0.0', name: 'Bedienbare Direktionsentscheidung prüfen', description: 'Prüft das Entscheidungseingabefeld für jede Rolle.', kind: 'assertion', category: 'Prüfungen', semanticKey: `authorization.${suffix}`,
    inputs: [{ key: 'proposalId', label: 'Vorschlag', type: 'proposal-ref', required: true }, { key: 'expectedAllowed', label: 'Berechtigt', type: 'boolean', required: true }], outputs: [], knowledgeRefs: ['regel.direktionsanfrage', 'fach.rollen'], preconditions: ['Eine offene Direktionsanfrage besteht.'], postconditions: ['Die Bedienbarkeit entspricht der Rolle.'], status: 'draft', origin: 'human', createdAt: new Date().toISOString() };
  await json(request, 'post', '/api/testing/definitions', { definition });
  const binding: TestingTechnicalBinding = { id: `ui.berechtigung.${suffix}`, revision: 1, operation: definition.semanticKey, name: 'Direktionsentscheidung bedienen', status: 'ready', definitionRefs: [{ id: definition.id, version: definition.version }], knowledgeRefs: ['fach.rollen'], module: 'e2e/helpers/agriculture-driver.ts', export: 'executeTestingStep', inputKeys: ['proposalId', 'expectedAllowed'], changeReason: 'Prüft aktivierte beziehungsweise deaktivierte Entscheidungseingabe.', createdAt: new Date().toISOString(),
    locators: [{ key: 'decision', method: 'label', value: 'Entscheidung', exact: true }], recipe: [{ op: 'goto', value: '/portal/vorschlaege/{{proposalId}}' }, { op: 'expectEnabled', locatorKey: 'decision', when: { input: 'expectedAllowed', equals: true } }, { op: 'expectDisabled', locatorKey: 'decision', when: { input: 'expectedAllowed', equals: false } }] };
  await json(request, 'post', '/api/testing/bindings', { binding });
  const scenario = await variation(request, 'kuh-direktionsanfrage', item => {
    for (const [index, role] of ['Vermittler', 'Sachbearbeiter', 'Direktion'].entries()) item.blocks.push({ id: `rolle-${index}`, definition: { id: 'rolle.als', version: '1.0.0' }, inputs: { role }, children: [{ id: 'berechtigung', definition: { id: definition.id, version: definition.version }, inputs: { proposalId: { ref: 'vorschlag' }, expectedAllowed: role === 'Direktion' } }] });
  });
  const compiled = await approve(request, scenario);
  const result = await run(request, scenario);
  expect(result.status, result.error).toBe('passed');
  expect(result.compiled.fingerprint).toBe(compiled.fingerprint);
  expect(result.steps.slice(-3).map(step => step.status)).toEqual(['passed', 'passed', 'passed']);
  expect(result.compiled.steps.slice(-3).map(step => step.actor)).toEqual(['Vermittler', 'Sachbearbeiter', 'Direktion']);
  const detail = await json<ProposalDetail>(request, 'get', `/api/agriculture/proposals/${output(result, 'proposal')}`);
  expect(detail.proposal.status).toBe('Direktionsprüfung');
  expect(detail.referral?.status).toBe('Offen');
  expect(detail.contract).toBeNull();
});

test('Kuh mit hoher Summe erreicht echte Direktionsanfrage und endet ohne Vertrag', async ({ request }) => {
  const scenario = await variation(request, 'kuh-direktionsanfrage'); await approve(request, scenario);
  const result = await run(request, scenario);
  expect(result.status, result.error).toBe('passed'); expect(result.steps).toHaveLength(7);
  const detail = await json<ProposalDetail>(request, 'get', `/api/agriculture/proposals/${output(result, 'proposal')}`);
  expect(detail.proposal.status).toBe('Direktionsprüfung'); expect(detail.contract).toBeNull(); expect(detail.policy).toBeNull();
  expect(detail.customer.id).toBe(output(result, 'customer')); expect(detail.farm.customerId).toBe(detail.customer.id);
  expect(detail.animals[0].farmId).toBe(detail.farm.id); expect(detail.animals[0].sumInsured).toBe(15000);
  expect(detail.referral?.id).toBe(output(result, 'referral')); expect(detail.referral?.status).toBe('Offen');
  expect(detail.proposal.runId).toBe(result.id);
  expect((await request.get(result.steps.at(-1)!.screenshot!)).status()).toBe(200);
  expect((await request.get(result.artifacts!.trace!)).status()).toBe(200);
  const source = await (await request.get(result.artifacts!.source!)).text();
  expect(source).toContain('executeTestingStep'); expect(source).not.toContain('Kunde speichern');
});
test('Testmatrix führt Grenzwerte als isolierte Fälle aus und setzt nach einer Abweichung fort', async ({ page, request }) => {
  const scenario = await variation(request, 'kuh-direktionsanfrage', item => { item.matrix = {
    columns: [
      { id: 'bundesland', label: 'Bundesland', target: { blockPath: 'kuhvorschlag', inputPath: 'state' }, type: 'choice' },
      { id: 'summe', label: 'Versicherungssumme', target: { blockPath: 'kuhvorschlag', inputPath: 'sumInsured' }, type: 'money' },
      { id: 'erwartung', label: 'Erwarteter Zustand', target: { blockPath: 'pruefung', inputPath: 'expectedStatus' }, type: 'choice' },
    ],
    rows: [
      { id: 'bayern-10000', label: 'Bayern 10.000', enabled: true, values: { bundesland: 'Bayern', summe: 10000, erwartung: 'Freigegeben' } },
      { id: 'bayern-11000', label: 'Bayern 11.000', enabled: true, values: { bundesland: 'Bayern', summe: 11000, erwartung: 'Freigegeben' } },
      { id: 'falsche-erwartung', label: 'Absichtliche Abweichung', enabled: true, values: { bundesland: 'Bayern', summe: 12000, erwartung: 'Freigegeben' } },
      { id: 'bayern-12000', label: 'Bayern 12.000', enabled: true, values: { bundesland: 'Bayern', summe: 12000, erwartung: 'Direktionsprüfung' } },
      { id: 'hessen-10000', label: 'Hessen 10.000', enabled: true, values: { bundesland: 'Hessen', summe: 10000, erwartung: 'Freigegeben' } },
      { id: 'hessen-11000', label: 'Hessen 11.000', enabled: true, values: { bundesland: 'Hessen', summe: 11000, erwartung: 'Direktionsprüfung' } },
      { id: 'hessen-12000', label: 'Hessen 12.000', enabled: true, values: { bundesland: 'Hessen', summe: 12000, erwartung: 'Direktionsprüfung' } },
    ],
  }; });
  await approve(request, scenario); const result = await run(request, scenario);
  expect(result.mode).toBe('matrix'); expect(result.status).toBe('failed');
  expect(result.summary).toEqual({ total: 7, passed: 6, failed: 1, skipped: 0 });
  expect(result.matrixRows?.map(row => row.status)).toEqual(['passed', 'passed', 'failed', 'passed', 'passed', 'passed', 'passed']);
  expect(result.matrixRows?.map(row => row.compiled?.steps.find(step => step.path === 'kuhvorschlag/betrieb')?.inputs.state)).toEqual(['Bayern', 'Bayern', 'Bayern', 'Bayern', 'Hessen', 'Hessen', 'Hessen']);
  expect(result.matrixRows?.map(row => row.compiled?.steps.find(step => step.path === 'kuhvorschlag/tier')?.inputs.sumInsured)).toEqual([10000, 11000, 12000, 12000, 10000, 11000, 12000]);
  expect(result.matrixRows?.map(row => row.compiled?.steps.find(step => step.path === 'pruefung')?.inputs.expectedStatus)).toEqual(['Freigegeben', 'Freigegeben', 'Freigegeben', 'Direktionsprüfung', 'Freigegeben', 'Direktionsprüfung', 'Direktionsprüfung']);
  const customerReferences = result.matrixRows?.map(row => Object.entries(row.outputs ?? {}).find(([key]) => key.endsWith('::customer'))?.[1]);
  expect(new Set(customerReferences).size).toBe(7);
  expect(result.matrixRows?.[2].steps?.find(step => step.status === 'failed')?.path).toBe('pruefung');
  for (const row of result.matrixRows ?? []) {
    expect(row.artifacts?.trace).toBeTruthy(); expect((await request.get(row.artifacts!.trace!)).status()).toBe(200);
    expect(row.artifacts?.source).toBeTruthy(); expect((await request.get(row.artifacts!.source!)).status()).toBe(200);
    const screenshot = row.steps?.find(step => step.screenshot)?.screenshot;
    expect(screenshot).toBeTruthy(); expect((await request.get(screenshot!)).status()).toBe(200);
  }
  const replay = await (await request.get(result.artifacts!.source!)).text();
  expect(replay).toContain("variant.row.label + ' [' + variant.row.id + ']'");
  expect(replay).toContain("'wiederholung-' + variant.row.id");
  await page.goto(`/testing/editor/${scenario.id}?step=5`);
  await expect(page.getByRole('region', { name: 'Prüfergebnis', exact: true })).toContainText('6 von 7 Testfällen bestanden');
  await expect(page.getByRole('region', { name: 'Prüfergebnis', exact: true })).toContainText('Absichtliche Abweichung');
  await page.screenshot({ path: '.local/verification/matrix/testmatrix-ergebnis-mit-abweichung.png', fullPage: true });
});
test('Standardvertrag in Bayern hat neue Policenversion und exakten Sachbearbeiter-Drucknachweis', async ({ request }) => {
  const scenario = await variation(request, 'kuh-police-drucken'); await approve(request, scenario);
  const result = await run(request, scenario); expect(result.status, result.error).toBe('passed'); expect(result.steps).toHaveLength(10);
  const detail = await json<ProposalDetail>(request, 'get', `/api/agriculture/proposals/${output(result, 'proposal')}`);
  expect(detail.farm.state).toBe('Bayern'); expect(detail.proposal.status).toBe('Abgeschlossen'); expect(detail.documents).toHaveLength(2);
  expect(detail.policy?.version).toBe(2); expect(detail.printEvents).toHaveLength(1);
  const document = result.steps.find(step => step.path.endsWith('/erneut'))?.outputValues?.document;
  expect(detail.printEvents[0].documentId).toBe(document); expect(detail.printEvents[0].role).toBe('Sachbearbeiter');
  expect(detail.printEvents[0].documentSha256).toBe(detail.documents.find(item => item.id === document)?.sha256);
});
test('Eine völlig neue Assertion läuft als generisches Rezept mit typisiertem erwarteten Text', async ({ request }) => {
  const suffix = randomUUID(), id = `pruefung.grund.${suffix}`, bindingId = `ui.grund.${suffix}`;
  const definition: TestingBlockDefinition = { id, version: '1.0.0', name: 'Direktionsgrund lesen', description: 'Prüft die sichtbare Begründung der hohen Summe.', kind: 'assertion', category: 'Prüfungen', semanticKey: `referral.reason.${suffix}`,
    inputs: [{ key: 'proposalId', label: 'Vorschlag', type: 'proposal-ref', required: true }, { key: 'expectedReason', label: 'Erwarteter Begründungsteil', type: 'text', required: true }], outputs: [],
    knowledgeRefs: ['regel.direktionsanfrage'], preconditions: ['Eine Direktionsanfrage ist vorhanden.'], postconditions: ['Die erwartete Begründung ist sichtbar.'], status: 'draft', origin: 'human', createdAt: new Date().toISOString() };
  await json(request, 'post', '/api/testing/definitions', { definition });
  const binding: TestingTechnicalBinding = { id: bindingId, revision: 1, operation: definition.semanticKey, name: 'Begründung im Portal lesen', status: 'ready', definitionRefs: [{ id, version: '1.0.0' }], knowledgeRefs: ['technik.portal'],
    module: 'e2e/helpers/agriculture-driver.ts', export: 'executeTestingStep', inputKeys: ['proposalId', 'expectedReason'], locators: [{ key: 'reason', method: 'text', value: '{{expectedReason}}', exact: false }],
    recipe: [{ op: 'goto', value: '/portal/vorschlaege/{{proposalId}}' }, { op: 'expectVisible', locatorKey: 'reason' }], changeReason: 'Neuer fachlicher Prüfschritt mit generischem Rezept.', createdAt: new Date().toISOString() };
  await json(request, 'post', '/api/testing/bindings', { binding });
  const scenario = await variation(request, 'kuh-direktionsanfrage', item => item.blocks.push({ id: 'begruendung', definition: { id, version: '1.0.0' }, inputs: { proposalId: { ref: 'vorschlag' }, expectedReason: 'übersteigt die Direktionsgrenze' } }));
  await approve(request, scenario); const result = await run(request, scenario);
  expect(result.status, result.error).toBe('passed'); expect(result.steps.at(-1)?.path).toBe('begruendung'); expect(result.compiled.bindings.some(item => item.operation === definition.semanticKey)).toBe(true);
});
test('Veralteter Button scheitert am kleinsten Blatt, Impact verfolgt indirekte Nutzung und zentrale Reparatur erhält Historie', async ({ request }) => {
  const catalog = await json<TestingCatalog>(request, 'get', '/api/testing/catalog'); const suffix = randomUUID();
  const original = catalog.definitions.find(item => item.id === 'kunde.anlegen')!;
  const originalBinding = catalog.bindings.filter(item => item.id === original.bindingId && item.status === 'ready').sort((a, b) => b.revision - a.revision)[0];
  const leaf = { ...original, id: `testkunde.${suffix}`, semanticKey: `testkunde.${suffix}`, operation: `createIsolatedCustomer.${suffix}`, bindingId: `ui.testkunde.${suffix}`, origin: 'human' as const, createdAt: new Date().toISOString() };
  await json(request, 'post', '/api/testing/definitions', { definition: leaf });
  const invalid: TestingTechnicalBinding = { ...originalBinding, id: leaf.bindingId, revision: 1, operation: leaf.operation, definitionRefs: [{ id: leaf.id, version: leaf.version }],
    locators: originalBinding.locators.map(item => item.key === 'save' ? { ...item, value: 'Kundenkarte speichern (alte Bezeichnung)' } : item), changeReason: 'Absichtlich veraltete Beschriftung für die Reparaturprüfung.', createdAt: new Date().toISOString() };
  await json(request, 'post', '/api/testing/bindings', { binding: invalid });
  const baseWorkflow = catalog.definitions.find(item => item.id === 'ablauf.kuh-vorschlag')!;
  const workflow = { ...baseWorkflow, id: `workflow.reparatur.${suffix}`, semanticKey: `workflow.reparatur.${suffix}`, body: baseWorkflow.body!.map(item => item.definition.id === original.id ? { ...item, definition: { id: leaf.id, version: leaf.version } } : item), origin: 'human' as const, createdAt: new Date().toISOString() };
  await json(request, 'post', '/api/testing/definitions', { definition: workflow });
  const scenario = await variation(request, 'kuh-direktionsanfrage', item => { item.blocks[0].definition = { id: workflow.id, version: workflow.version }; });
  const approved = await approve(request, scenario); const failed = await run(request, scenario);
  expect(failed.status).toBe('failed'); expect(failed.steps.find(step => step.status === 'failed')?.path).toBe('kuhvorschlag/kunde'); expect(failed.steps.slice(1).every(step => step.status === 'skipped')).toBe(true);
  const impact = await json<any>(request, 'get', `/api/testing/bindings/${leaf.bindingId}/impact`);
  expect(impact.scenarios.some((item: any) => item.scenarioId === scenario.id && item.instancePaths.includes('kuhvorschlag/kunde'))).toBe(true);
  expect(impact.definitions.some((item: any) => item.definition.id === workflow.id && !item.direct)).toBe(true);
  await json(request, 'post', '/api/testing/bindings', { binding: { ...invalid, revision: 2, locators: originalBinding.locators, changeReason: 'Nur die zentrale Speicherbutton-Beschriftung wurde berichtigt.' } });
  const compiled = await json<TestingCompiledScenario>(request, 'get', `/api/testing/scenarios/${scenario.id}/compile`);
  expect(compiled.fingerprint).toBe(approved.fingerprint); expect(compiled.executable).toBe(true);
  const passed = await run(request, scenario); expect(passed.status, passed.error).toBe('passed');
  const previous = await json<TestingRun>(request, 'get', `/api/testing/runs/${failed.id}`);
  expect(previous.compiled.bindings.find(item => item.id === invalid.id)?.revision).toBe(1);
  expect(passed.compiled.bindings.find(item => item.id === invalid.id)?.revision).toBe(2);
});

test('Ein ungültiger unlessVisible-Speicherwächter wird konkret abgelehnt und das korrigierte Rezept speichert echte Portaldaten', async ({ request }, testInfo) => {
  const catalog = await json<TestingCatalog>(request, 'get', '/api/testing/catalog');
  const suffix = randomUUID();
  const original = catalog.definitions.find(item => item.id === 'kunde.anlegen')!;
  const originalBinding = catalog.bindings.filter(item => item.id === original.bindingId && item.status === 'ready').sort((a, b) => b.revision - a.revision)[0];
  const leaf: TestingBlockDefinition = { ...original, id: `guardkunde.${suffix}`, semanticKey: `guardkunde.${suffix}`, operation: `createGuardCustomer.${suffix}`, bindingId: `ui.guardkunde.${suffix}`, name: 'Kunde mit geprüfter Öffnungsbedingung', origin: 'human', createdAt: new Date().toISOString() };
  await json(request, 'post', '/api/testing/definitions', { definition: leaf });
  const saveIndex = originalBinding.recipe!.findIndex(action => !!action.capture);
  expect(saveIndex).toBeGreaterThanOrEqual(0);
  // Explicit malformed fixture, independent of any unavailable user job or AI call.
  const invalid: TestingTechnicalBinding = { ...originalBinding, id: leaf.bindingId!, revision: 1, operation: leaf.operation!, definitionRefs: [{ id: leaf.id, version: leaf.version }],
    recipe: originalBinding.recipe!.map((action, index) => index === saveIndex ? { ...action, unlessVisible: 'name' } : action), changeReason: 'Synthetisches QA-Fixture mit unzulässigem Überspringen einer Speicheraktion.' };
  const rejected = await request.post('/api/testing/bindings', { data: { binding: invalid } });
  expect(rejected.ok()).toBeFalsy();
  const error = (await rejected.json()).error as string;
  expect(error).toContain(invalid.id);
  expect(error).toContain(`recipe[${saveIndex}]`);
  expect(error).toContain('capture');
  expect(error).toContain('unlessVisible');
  const afterRejected = await json<TestingCatalog>(request, 'get', '/api/testing/catalog');
  expect(afterRejected.bindings.some(binding => binding.id === invalid.id)).toBeFalsy();
  const corrected: TestingTechnicalBinding = { ...invalid, recipe: originalBinding.recipe, changeReason: 'Nur der unzulässige Wächter der Speicheraktion wurde entfernt. Der Öffnungsklick behält seine Formularprüfung.' };
  const saved = await json<TestingTechnicalBinding>(request, 'post', '/api/testing/bindings', { binding: corrected });
  expect(saved.recipe?.some(action => action.unlessVisible && action.op === 'click' && !action.capture)).toBeTruthy();
  expect(saved.recipe?.[saveIndex].unlessVisible).toBeUndefined();
  const baseWorkflow = catalog.definitions.find(item => item.id === 'ablauf.kuh-vorschlag')!;
  const workflow: TestingBlockDefinition = { ...baseWorkflow, id: `workflow.guard.${suffix}`, semanticKey: `workflow.guard.${suffix}`, body: baseWorkflow.body!.map(item => item.definition.id === original.id ? { ...item, definition: { id: leaf.id, version: leaf.version } } : item), origin: 'human', createdAt: new Date().toISOString() };
  await json(request, 'post', '/api/testing/definitions', { definition: workflow });
  const name = `Guardprüfung ${suffix.slice(0, 8)}`;
  const scenario = await variation(request, 'kuh-direktionsanfrage', item => { item.title = name; item.blocks[0].definition = { id: workflow.id, version: workflow.version }; item.blocks[0].inputs.customerName = name; });
  const approval = await approve(request, scenario);
  const result = await run(request, scenario);
  expect(result.status, result.error).toBe('passed');
  expect(result.compiled.fingerprint).toBe(approval.fingerprint);
  expect(result.compiled.bindings.find(binding => binding.id === corrected.id)?.revision).toBe(1);
  const detail = await json<ProposalDetail>(request, 'get', `/api/agriculture/proposals/${output(result, 'proposal')}`);
  expect(detail.customer.name).toBe(name);
  expect(detail.customer.id).toBe(output(result, 'customer'));
  expect(detail.farm.customerId).toBe(detail.customer.id);
  expect(detail.proposal.status).toBe('Direktionsprüfung');
  await testInfo.attach('ungueltiger-waechter-und-echter-portallauf', { body: JSON.stringify({ fixture: 'synthetic', validationError: error, correctedBinding: saved, runId: result.id, customerId: detail.customer.id, customerName: detail.customer.name, artifacts: result.artifacts }, null, 2), contentType: 'application/json' });
});

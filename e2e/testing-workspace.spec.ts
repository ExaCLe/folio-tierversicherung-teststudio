import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import type { TestingAgentJob, TestingApproval, TestingCatalog, TestingCompiledScenario, TestingRun, TestingScenario } from '../shared/testing';
import { deriveTestingLifecycle } from '../server/testing/lifecycle';

// These are explicit transport fixtures, never model results or real KI calls.
// Scenario/definition/knowledge writes still use the isolated E2E server API.
interface TransportFixture { jobs: TestingAgentJob[]; runs: TestingRun[] }
async function readScenario(request: APIRequestContext, id: string): Promise<TestingScenario> {
  const response = await request.get(`/api/testing/scenarios/${id}`);
  expect(response.ok(), await response.text()).toBeTruthy(); return response.json();
}
async function persist(request: APIRequestContext, value: TestingScenario): Promise<TestingScenario> {
  const response = await request.put(`/api/testing/scenarios/${value.id}`, { data: { ...value, expectedRevision: value.revision } });
  expect(response.ok(), await response.text()).toBeTruthy(); return response.json();
}
async function scenarioFixture(request: APIRequestContext, empty = false) {
  const source = await readScenario(request, 'kuh-direktionsanfrage');
  return persist(request, { ...source, id: `arbeitsablauf-${randomUUID()}`, title: `Arbeitsablauf ${randomUUID().slice(0, 8)}`, revision: 0,
    source: 'human', ...(empty ? { blocks: [], intent: 'Synthetische noch offene Anforderung.' } : {}) });
}
function job(scenario: TestingScenario, patch: Partial<TestingAgentJob> = {}): TestingAgentJob {
  return { id: `synthetic-workspace-${randomUUID()}`, model: 'luna', phase: 'business', stage: 'knowledge', status: 'running',
    scenarioId: scenario.id, scenarioRevision: scenario.revision, prompt: 'Synthetischer Transportzustand für die Oberflächenprüfung.',
    startedAt: new Date().toISOString(), events: [{ id: randomUUID(), at: new Date().toISOString(), kind: 'status', message: 'Synthetische Wissensprüfung läuft.' }], ...patch };
}
async function transport(page: Page, state: TransportFixture) {
  await page.route('**/api/testing/jobs/**', async route => {
    if (route.request().method() === 'GET') {
      const id = new URL(route.request().url()).pathname.split('/').at(-1);
      const current = state.jobs.find(item => item.id === id);
      if (current) { await route.fulfill({ json: current }); return; }
    }
    // A missing fixture must fail locally, never accidentally invoke a CLI.
    await route.fulfill({ status: 409, json: { error: 'Dieser E2E-Test hat keinen KI-Aufruf für diese Aktion definiert.' } });
  });
  await page.route('**/api/testing/scenarios/*/plan', route => route.fulfill({ status: 409, json: { error: 'Kein synthetischer Planungsauftrag definiert.' } }));
  await page.route('**/api/testing/bootstrap', async route => {
    const response = await route.fetch(); const data = await response.json();
    const jobs = [...state.jobs, ...data.jobs], runs = [...state.runs, ...data.runs];
    await route.fulfill({ json: { ...data, jobs, runs, lifecycles: data.scenarios.map((scenario: TestingScenario) =>
      deriveTestingLifecycle(scenario, data.catalog, jobs, runs, data.approvals.find((item: TestingApproval) => item.scenarioId === scenario.id))) } });
  });
}
const activity = (page: Page) => page.getByRole('region', { name: 'Aktueller Arbeitsstand', exact: true });
const nextHeading = (page: Page) => page.locator('.t-phase-heading h2');

test('Anforderung bleibt sofort gespeichert; Navigation, Reload und laufende Kindprüfung erhalten den linearen Arbeitsstand', async ({ page, request }, testInfo) => {
  const state: TransportFixture = { jobs: [], runs: [] };
  await transport(page, state);
  let created: TestingScenario | undefined;
  await page.route('**/api/testing/jobs/business', async route => {
    const payload = route.request().postDataJSON();
    const source = await readScenario(request, 'kuh-direktionsanfrage');
    created = await persist(request, { ...source, id: `arbeitsablauf-${randomUUID()}`, title: 'Synthetischer sofort gespeicherter Test', revision: 0, blocks: [],
      intent: payload.request, source: 'human' });
    const parent = job(created);
    const child = job(created, { phase: 'exploration', parentJobId: parent.id,
      events: [{ id: randomUUID(), at: new Date().toISOString(), kind: 'status', message: 'Vorhandenes Wissen zur synthetischen Freigabe wird geprüft.' }] });
    parent.childJobIds = [child.id]; state.jobs = [parent, child];
    await route.fulfill({ status: 202, json: parent });
  });
  await page.goto('/testing/new');
  await page.getByLabel('Deine Anforderung', { exact: true }).fill('Prüfe eine synthetische Freigabe im Portal.');
  await page.getByRole('button', { name: 'Testfall starten', exact: true }).click();
  await expect.poll(() => created?.id).toBeTruthy();
  await expect(page).toHaveURL(new RegExp(`/testing/editor/${created!.id}$`));
  expect((await readScenario(request, created!.id)).blocks).toEqual([]);
  await expect(activity(page)).toBeVisible(); await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(nextHeading(page)).toHaveText('Wir bereiten deinen Test vor');
  await expect(activity(page).getByRole('heading', { name: 'Fachwissen prüfen', exact: true })).toBeVisible();
  await expect(activity(page).locator('.t-activity-current')).toContainText('Vorhandenes Wissen zur synthetischen Freigabe wird geprüft.');
  // Mutate only the child after its initial render. The parent remains running
  // and unchanged; the live update must come through polling, without reload.
  const updatedAction = 'Im Portal wird geprüft, ob die Rolle Direktion die Sonderfreigabe bedienen kann.';
  state.jobs = state.jobs.map(item => item.phase === 'exploration' ? { ...item, stage: 'exploring',
    events: [...item.events, { id: randomUUID(), at: new Date().toISOString(), kind: 'status', message: updatedAction }] } : item);
  await expect(activity(page).locator('.t-activity-current')).toContainText(updatedAction, { timeout: 15_000 });
  await expect(activity(page).getByRole('heading', { name: 'Die Anwendung erkunden', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Einstellungen', exact: true }).click();
  await page.getByRole('link', { name: 'Alle Testfälle', exact: true }).click();
  const row = page.locator('.t-test-row').filter({ hasText: created!.title });
  await expect(row).toContainText('In Bearbeitung');
  await page.reload(); await row.click();
  await expect(page.getByLabel('Name des Testfalls', { exact: true })).toHaveValue(created!.title);

  const parent = state.jobs[0];
  const child = job(created!, { phase: 'exploration', stage: 'exploring', parentJobId: parent.id,
    events: [{ id: randomUUID(), at: new Date().toISOString(), kind: 'status', message: 'Die Berechtigung wird noch untersucht.' }] });
  state.jobs = [{ ...parent, status: 'completed', childJobIds: [child.id], result: { explanation: 'Eine erste Antwort ist vorhanden.' } }, child];
  await page.reload();
  await expect(nextHeading(page)).toHaveText('Wir bereiten deinen Test vor');
  await expect(page.getByRole('button', { name: 'Erkundung und Entwurf fortsetzen', exact: true })).toHaveCount(0);
  await expect(activity(page).getByLabel('Arbeitsschritte der KI')).toContainText('In Bearbeitung');
  await expect(page.locator('.t-workflow-progress li[aria-current="step"]')).toContainText('Erkundung & Entwurf');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  const template = await readScenario(request, 'kuh-direktionsanfrage');
  const completed = await persist(request, { ...created!, blocks: template.blocks });
  state.jobs = [{ ...parent, status: 'completed', childJobIds: [child.id], result: { scenario: completed, applied: true } },
    { ...child, status: 'completed', result: { explored: false, evidence: [], newKnowledge: [], openQuestions: [], explanation: 'Vorhandene fiktive Regeln reichen aus.' } }];
  await page.reload();
  await expect(nextHeading(page)).toHaveText('Passt dieser Ablauf zu deiner Anforderung?');
  await expect(page.getByRole('button', { name: 'Freigeben und technisch prüfen', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Schritt 2: Erkundung & Entwurf', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Erkundungsergebnis', exact: true })).toContainText('Das vorhandene Wissen reicht');
  await page.getByRole('button', { name: 'Schritt 3: Fachlich prüfen', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Prüfergebnis', exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('linearer-entwurf-nach-wiederaufnahme.png'), fullPage: true });
});

test('Testdatenmatrix erzeugt und speichert typisierte Kombinationen aus lesbaren Ablauffeldern', async ({ page, request }) => {
  const current = await scenarioFixture(request); await transport(page, { jobs: [], runs: [] });
  await page.goto(`/testing/editor/${current.id}?step=3`);
  const matrix = page.getByRole('region', { name: 'Mit Testdaten variieren', exact: true });
  await expect(matrix).toBeVisible();
  await matrix.getByRole('checkbox').first().check();
  await matrix.getByRole('button', { name: 'Erste Eingabe hinzufügen', exact: true }).click();
  const firstField = matrix.getByLabel(/Feld für/).first();
  const stateOption = await firstField.locator('option').filter({ hasText: 'Bundesland' }).first().getAttribute('value');
  expect(stateOption).toBeTruthy(); await firstField.selectOption(stateOption!);
  await matrix.getByLabel('Bundesland, Kombinationswert 1').selectOption({ label: 'Bayern' });
  await matrix.getByRole('button', { name: 'Weiteren Wert', exact: true }).click();
  await matrix.getByLabel('Bundesland, Kombinationswert 2').selectOption({ label: 'Hessen' });
  await matrix.getByRole('button', { name: 'Eingabe hinzufügen', exact: true }).click();
  const secondField = matrix.getByLabel(/Feld für/).nth(1);
  const sumOption = await secondField.locator('option').filter({ hasText: 'Versicherungssumme in EUR' }).first().getAttribute('value');
  expect(sumOption).toBeTruthy(); await secondField.selectOption(sumOption!);
  const firstSum = matrix.getByLabel('Versicherungssumme in EUR, Kombinationswert 1');
  await firstSum.clear();
  await firstSum.pressSequentially('10.000,50');
  await expect(firstSum).toHaveValue('10.000,50');
  await firstSum.fill('10.000');
  await matrix.getByRole('button', { name: 'Weiteren Wert', exact: true }).nth(1).click();
  await matrix.getByLabel('Versicherungssumme in EUR, Kombinationswert 2').fill('11.000');
  await matrix.getByRole('button', { name: 'Weiteren Wert', exact: true }).nth(1).click();
  await matrix.getByLabel('Versicherungssumme in EUR, Kombinationswert 3').fill('12.000');
  await matrix.getByRole('button', { name: 'Erwartetes Ergebnis hinzufügen', exact: true }).click();
  const statusField = matrix.getByLabel(/Feld für/).nth(2);
  const statusOption = await statusField.locator('option').filter({ hasText: 'Erwarteter Zustand' }).first().getAttribute('value');
  expect(statusOption).toBeTruthy(); await statusField.selectOption(statusOption!);
  await expect(matrix).toContainText('6 Kombinationen in der Vorschau');
  await matrix.getByRole('button', { name: 'Kombinationen erzeugen', exact: true }).click();
  await expect(matrix.getByRole('row')).toHaveCount(8);
  const expected = ['Freigegeben', 'Freigegeben', 'Direktionsprüfung', 'Freigegeben', 'Direktionsprüfung', 'Direktionsprüfung'];
  for (const [index, value] of expected.entries()) await matrix.getByLabel(`Fall ${index + 1}: Erwarteter Zustand`).selectOption({ label: value });
  await expect(matrix).toContainText('6 von 6 Testfällen werden ausgeführt');
  await page.screenshot({ path: '.local/verification/matrix/testmatrix-tabelle.png', fullPage: true });
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  const saved = await readScenario(request, current.id);
  expect(saved.matrix?.columns.map(column => [column.type, column.role])).toEqual([['choice', 'input'], ['money', 'input'], ['choice', 'expectation']]);
  const [state, sum, status] = saved.matrix!.columns.map(column => column.id);
  expect(saved.matrix?.rows.map(row => [row.values[state], row.values[sum], row.values[status]])).toEqual([
    ['Bayern', 10000, 'Freigegeben'], ['Bayern', 11000, 'Freigegeben'], ['Bayern', 12000, 'Direktionsprüfung'],
    ['Hessen', 10000, 'Freigegeben'], ['Hessen', 11000, 'Direktionsprüfung'], ['Hessen', 12000, 'Direktionsprüfung'],
  ]);
  await page.reload();
  await expect(matrix).toContainText('6 von 6 Testfällen werden ausgeführt');
  await expect(matrix.getByLabel('Fall 3: Erwarteter Zustand')).toHaveValue('Direktionsprüfung');
  await expect(matrix.getByLabel('Fall 5: Erwarteter Zustand')).toHaveValue('Direktionsprüfung');
  await matrix.getByRole('button', { name: 'Kombinationen aktualisieren', exact: true }).click();
  await expect(matrix.getByRole('row')).toHaveCount(8);
  for (const [index, value] of expected.entries()) await expect(matrix.getByLabel(`Fall ${index + 1}: Erwarteter Zustand`)).toHaveValue(value);
});

test('Offene Bausteinentscheidung zeigt keinen alten grünen Lauf als aktuelles Ergebnis', async ({ page, request }, testInfo) => {
  const current = await scenarioFixture(request);
  const compiled = await (await request.get(`/api/testing/scenarios/${current.id}/compile`)).json() as TestingCompiledScenario;
  const catalog = await (await request.get('/api/testing/catalog')).json() as TestingCatalog;
  const proposed = catalog.definitions[0], chosen = catalog.definitions.find(item => item.id !== proposed.id)!;
  const blocked = job(current, { phase: 'technical', stage: 'duplicates', status: 'completed', fingerprint: compiled.fingerprint,
    result: { needsBusinessReview: true, plan: { unsupported: ['Die fachliche Überschneidung muss zuerst geklärt werden.'] },
      duplicateDecisions: [{ proposed: { id: proposed.id, version: proposed.version }, chosen: { id: chosen.id, version: chosen.version },
        decision: 'extend', compatible: false, reason: 'Synthetische fachliche Überschneidung mit einer anderen Fähigkeit.' }] } });
  const old: TestingRun = { id: `synthetic-old-run-${randomUUID()}`, scenarioId: current.id, scenarioTitle: current.title, scenarioRevision: current.revision - 1,
    status: 'passed', startedAt: '2026-01-01T10:00:00Z', compiled: { ...compiled, fingerprint: 'synthetic-old-fingerprint', scenarioRevision: current.revision - 1 }, steps: [] };
  await transport(page, { jobs: [blocked], runs: [old] });
  await page.goto(`/testing/editor/${current.id}`);
  await expect(nextHeading(page)).toHaveText('Über vorgeschlagene Bausteine entscheiden');
  await page.getByRole('button', { name: 'Vorschläge ansehen', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Synthetische fachliche Überschneidung');
  await page.getByRole('dialog').getByRole('button', { name: 'Dialog schließen', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Vorschläge ansehen', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Prüfergebnis', exact: true })).toHaveCount(0);
  await expect(page.locator('.t-workflow-progress li[aria-current="step"]')).toContainText('Fachlich prüfen');
  await page.getByRole('link', { name: 'Alle Testfälle', exact: true }).click();
  const row = page.locator('.t-test-row').filter({ hasText: current.title });
  await expect(row).toContainText('Deine Entscheidung'); await expect(row).not.toContainText('Bestanden');
  await row.click(); await page.screenshot({ path: testInfo.outputPath('dublette-statt-historischem-erfolg.png'), fullPage: true });
});

test('Eine Wissenslücke bleibt sichtbar und lässt denselben gespeicherten Test nach Ergänzung erneut planen', async ({ page, request }, testInfo) => {
  const current = await scenarioFixture(request, true);
  const question = 'Welche Rolle darf die fiktive Sonderfreigabe ausführen?';
  const parent = job(current, { status: 'completed', result: { scenario: current, applied: false, needsKnowledge: true, openQuestions: [question], explanation: 'Eine fachliche Angabe fehlt.' } });
  const child = job(current, { phase: 'exploration', status: 'completed', parentJobId: parent.id,
    result: { explored: false, evidence: [], newKnowledge: [], openQuestions: [question], explanation: 'Keine belegte Rollenregel vorhanden.' } });
  parent.childJobIds = [child.id];
  const state: TransportFixture = { jobs: [parent, child], runs: [] }; await transport(page, state);
  let retry: { id: string; revision: number } | undefined;
  await page.route(`**/api/testing/scenarios/${current.id}/plan`, async route => {
    const saved = await readScenario(request, current.id);
    retry = { id: saved.id, revision: route.request().postDataJSON().revision };
    const next = job(saved); state.jobs = [next, ...state.jobs]; await route.fulfill({ status: 202, json: next });
  });
  await page.goto(`/testing/editor/${current.id}`);
  await expect(activity(page)).toContainText(question);
  await expect(page.getByRole('region', { name: 'Erkundungsergebnis', exact: true })).toContainText('Das Wissen braucht noch eine Ergänzung');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const amended = `${current.intent}\nDie Rolle Direktion soll die Sonderfreigabe durchführen.`;
  await page.getByLabel('Anforderung ergänzen', { exact: true }).fill(amended);
  await page.getByRole('button', { name: 'Erkundung und Entwurf fortsetzen', exact: true }).click();
  await expect.poll(() => retry?.id).toBe(current.id);
  expect(retry!.revision).toBe(current.revision + 1);
  expect((await readScenario(request, current.id)).intent).toBe(amended);
  await expect(nextHeading(page)).toHaveText('Wir bereiten deinen Test vor');
  await page.reload(); await expect(page).toHaveURL(new RegExp(`/testing/editor/${current.id}$`));
  await expect(nextHeading(page)).toHaveText('Wir bereiten deinen Test vor');
  await page.screenshot({ path: testInfo.outputPath('wissen-ergaenzen-denselben-test-fortsetzen.png'), fullPage: true });
});

test('Neues Fachwissen wird beim Definieren über die echte API gemeinsam mit dem Block gespeichert', async ({ page, request }, testInfo) => {
  const current = await scenarioFixture(request); await transport(page, { jobs: [], runs: [] });
  await page.goto(`/testing/editor/${current.id}`);
  await expect(page.getByRole('button', { name: 'Freigeben und technisch prüfen', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Block hinzufügen', exact: true }).click();
  await page.getByRole('button', { name: 'Neuen Block definieren', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Einen fachlichen Block definieren', exact: true });
  const name = `Belegprüfung ${randomUUID().slice(0, 8)}`, title = `Regel zur ${name}`;
  await dialog.getByLabel('Name des Blocks', { exact: true }).fill(name);
  await dialog.getByLabel('Blockart', { exact: true }).selectOption('assertion');
  await dialog.getByLabel('Was soll der Block bewirken?', { exact: true }).fill('Prüft einen vollständig synthetischen Fachbeleg.');
  await dialog.getByRole('button', { name: 'Wissen hinzufügen', exact: true }).click();
  await page.getByRole('button', { name: 'Neue Wissensquelle hinzufügen', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Definieren und auf Arbeitsfläche platzieren', exact: true })).toBeDisabled();
  await dialog.getByLabel('Titel des Wissens', { exact: true }).fill(title);
  await dialog.getByLabel('Fachliche Beschreibung', { exact: true }).fill('Für diesen synthetischen Test gilt: Ein vorhandener Fachbeleg muss sichtbar geprüft werden.');
  const sent = page.waitForRequest(req => req.method() === 'POST' && new URL(req.url()).pathname === '/api/testing/definitions');
  await dialog.getByRole('button', { name: 'Definieren und auf Arbeitsfläche platzieren', exact: true }).click();
  const payload = (await sent).postDataJSON();
  await expect(dialog).toHaveCount(0);
  expect(payload.newKnowledge).toHaveLength(1);
  expect(payload.definition.knowledgeRefs).toContain(payload.newKnowledge[0].id);
  const catalog = await (await request.get('/api/testing/catalog')).json() as TestingCatalog;
  const definition = catalog.definitions.find(item => item.id === payload.definition.id)!;
  const document = catalog.knowledge.find(item => item.id === payload.newKnowledge[0].id)!;
  expect(definition.name).toBe(name); expect(document.title).toBe(title);
  expect(document.definitionRefs).toContainEqual({ id: definition.id, version: definition.version });
  await expect(page.locator('.t-inspector').getByRole('heading', { name, exact: true })).toBeVisible();
  await expect.poll(async () => { const response = await request.get('/api/testing/bootstrap'); const data = await response.json(); return data.layouts.find((layout: { scenarioId: string }) => layout.scenarioId === current.id)?.parkedBlocks?.some((block: { definition: { id: string } }) => block.definition.id === definition.id); }).toBe(true);
  expect((await readScenario(request, current.id)).blocks.some(item => item.definition.id === definition.id)).toBe(false);
  // The new definition is available for explicit executable insertion too.
  await page.getByRole('button', { name: 'Block hinzufügen', exact: true }).click();
  await page.getByRole('option').filter({ hasText: name }).click();
  await page.getByRole('button', { name: 'Am Ende anhängen', exact: true }).click();
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Speichern', exact: true })).toBeDisabled();
  expect((await readScenario(request, current.id)).blocks.some(item => item.definition.id === definition.id)).toBe(true);
  await page.reload();
  await page.getByRole('button', { name: 'Ablaufliste', exact: true }).click();
  await page.locator('.t-outline > button').filter({ hasText: name }).click();
  await expect(page.locator('.t-inspector').getByRole('heading', { name, exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('neuer-block-mit-eigenem-fachwissen.png'), fullPage: true });
});


test('Eine manuell gespeicherte neue Revision lässt sich trotz alter offener Bausteinprüfung freigeben', async ({ page, request }) => {
  const current = await scenarioFixture(request);
  const compiled = await (await request.get(`/api/testing/scenarios/${current.id}/compile`)).json() as TestingCompiledScenario;
  const blocked = job(current, { phase: 'technical', stage: 'duplicates', status: 'completed', fingerprint: compiled.fingerprint,
    result: { needsBusinessReview: true, plan: { unsupported: ['Synthetische Entscheidung für den früheren Fachstand.'] } } });
  await transport(page, { jobs: [blocked], runs: [] });
  const technicalRequests: unknown[] = [];
  await page.route('**/api/testing/jobs/technical', async route => {
    const payload = route.request().postDataJSON(); technicalRequests.push(payload);
    await route.fulfill({ status: 202, json: job({ ...current, revision: payload.revision }, { phase: 'technical', stage: 'wiring', status: 'running', model: payload.model, fingerprint: undefined, result: undefined }) });
  });
  await page.goto(`/testing/editor/${current.id}`);
  await expect(page.getByRole('button', { name: 'Vorschläge ansehen', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Ablaufliste', exact: true }).click();
  await page.locator('.t-outline > button').first().click();
  await page.getByLabel(/Versicherungssumme in EUR/).fill('17.654,32');
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Speichern', exact: true })).toBeDisabled();
  const revised = await readScenario(request, current.id);
  expect(revised.revision).toBe(current.revision + 1);
  expect(revised.blocks).not.toEqual(current.blocks);
  await expect(page.getByRole('button', { name: 'Vorschläge ansehen', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Freigeben und technisch prüfen', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Aktueller Arbeitsstand' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Freigeben und technisch prüfen', exact: true }).click();
  await expect(nextHeading(page)).toHaveText('Die Anwendung wird vorbereitet und geprüft');
  expect(technicalRequests).toEqual([{ scenarioId: current.id, revision: revised.revision, model: 'luna' }]);
  const approved = await (await request.get(`/api/testing/scenarios/${current.id}/compile`)).json() as TestingCompiledScenario;
  expect(approved.scenarioRevision).toBe(revised.revision);
  expect(approved.issues.some(item => ['APPROVAL_REQUIRED', 'APPROVAL_STALE'].includes(item.code))).toBe(false);
  await page.reload();
  await expect(nextHeading(page)).toHaveText('Bereit für die technische Prüfung');
  await expect(page.getByRole('button', { name: 'Vorschläge ansehen', exact: true })).toHaveCount(0);
});

test('Schritt zwei zeigt nach technischer Vorbereitung die frühere Erkundung ohne neue Aufträge oder Freigabeänderung', async ({ page, request }) => {
  const current = await scenarioFixture(request);
  await request.post(`/api/testing/scenarios/${current.id}/approve`, { data: { revision: current.revision } });
  const compiled = await (await request.get(`/api/testing/scenarios/${current.id}/compile`)).json() as TestingCompiledScenario;
  const business = job(current, { status: 'completed', startedAt: '2026-01-01T10:00:00Z', result: { scenario: current, applied: true } });
  const child = job(current, { phase: 'exploration', parentJobId: business.id, status: 'completed', result: { explored: false, explanation: 'Die vorhandene Freigaberegel beantwortet die Anforderung.', newKnowledge: [], knowledgeIds: ['kuh-direktionsanfrage'], evidence: [], openQuestions: [] } });
  business.childJobIds = [child.id];
  const technical = job(current, { phase: 'technical', stage: 'wiring', status: 'completed', fingerprint: compiled.fingerprint, result: { plan: { unsupported: ['Die Speicheraktion braucht einen Nachweis.'] } } });
  await transport(page, { jobs: [technical, business, child], runs: [] });
  const mutations: string[] = [];
  page.on('request', req => { if (req.method() === 'POST') mutations.push(req.url()); });
  await page.goto(`/testing/editor/${current.id}`);
  await page.getByRole('button', { name: 'Schritt 2: Erkundung & Entwurf', exact: true }).click();
  await expect(nextHeading(page)).toHaveText('Erkundung und Entwurf ansehen');
  await page.getByRole('region', { name: 'Erkundungsergebnis', exact: true }).getByRole('button', { name: 'Erkenntnisse und Quellen ansehen' }).click();
  await expect(page.getByRole('dialog')).toContainText('Die vorhandene Freigaberegel');
  await page.getByRole('dialog').getByRole('button', { name: 'Dialog schließen', exact: true }).click();
  await expect(activity(page)).not.toContainText('Technische Schritte vorbereiten');
  await expect(page.getByRole('button', { name: 'Erkundung und Entwurf fortsetzen', exact: true })).toHaveCount(0);
  await page.reload();
  await expect(nextHeading(page)).toHaveText('Erkundung und Entwurf ansehen');
  await page.getByRole('button', { name: 'Schritt 3: Fachlich prüfen', exact: true }).click();
  await expect(page.locator('.t-editor-step .blocklySvg')).toBeVisible();
  expect(mutations).toEqual([]);
  expect((await (await request.get(`/api/testing/scenarios/${current.id}/compile`)).json()).approval).toEqual(compiled.approval);
});

test('Eine technische Vertragsgrenze bietet eine angeleitete KI-Überarbeitung mit lokaler Modellwahl an', async ({ page, request }, testInfo) => {
  const current = await scenarioFixture(request);
  await request.post(`/api/testing/scenarios/${current.id}/approve`, { data: { revision: current.revision } });
  const compiled = await (await request.get(`/api/testing/scenarios/${current.id}/compile`)).json() as TestingCompiledScenario;
  const issue = { kind: 'business-contract' as const, summary: 'Der erwartete HTTP-Status kann an einem deaktivierten Bedienelement nicht beobachtet werden.', affectedDefinitionRefs: [current.blocks[0].definition], affectedInputKeys: ['expectedHttpStatus'], blockPaths: [current.blocks[0].id], suggestedBusinessRevision: 'Prüfe stattdessen die tatsächliche Bedienbarkeit des sichtbaren Elements.' };
  const technical = job(current, { phase: 'technical', stage: 'wiring', status: 'completed', fingerprint: compiled.fingerprint, result: { plan: { explanation: 'Die technische Zuordnung wurde geprüft.', unsupported: [issue] }, repairContext: { sourceJobId: 'technical-contract-fixture', scenarioId: current.id, scenarioRevision: current.revision, fingerprint: compiled.fingerprint, issues: [issue] } } });
  technical.id = 'technical-contract-fixture';
  const state = { jobs: [technical], runs: [] }; await transport(page, state);
  const repairs: unknown[] = [];
  await page.route(`**/api/testing/scenarios/${current.id}/jobs/${technical.id}/revise-unsupported`, async route => {
    repairs.push(route.request().postDataJSON());
    await route.fulfill({ status: 202, json: job(current, { phase: 'business', status: 'running', parentJobId: undefined }) });
  });
  await page.goto(`/testing/editor/${current.id}`);
  await expect(nextHeading(page)).toHaveText('Technische Fragen klären');
  await expect(activity(page)).toContainText(issue.summary);
  const repair = page.getByRole('region', { name: 'Technische Grenze mit KI überarbeiten', exact: true });
  await repair.getByLabel('Lokales Modell für die fachliche Überarbeitung', { exact: true }).selectOption('sol');
  await repair.getByLabel('Anweisung für den gesamten Ablauf', { exact: true }).fill('Ersetze die Statuscode-Erwartung durch eine fachliche Prüfung der Bedienbarkeit.');
  await page.screenshot({ path: testInfo.outputPath('technische-grenze-mit-ki-ueberarbeiten.png'), fullPage: true });
  await repair.getByRole('button', { name: 'Mit KI überarbeiten', exact: true }).click();
  await expect.poll(() => repairs.length).toBe(1);
  await expect(repair.getByRole('button', { name: 'Mit KI überarbeiten', exact: true })).toBeEnabled();
  expect(repairs).toEqual([{ issueIndex: 0, model: 'sol', instruction: 'Ersetze die Statuscode-Erwartung durch eine fachliche Prüfung der Bedienbarkeit.' }]);
});

test('Eine alte gespeicherte technische Grenze bleibt über einen normalen KI-Vorschlag reparierbar', async ({ page, request }) => {
  const current = await scenarioFixture(request);
  await request.post(`/api/testing/scenarios/${current.id}/approve`, { data: { revision: current.revision } });
  const compiled = await (await request.get(`/api/testing/scenarios/${current.id}/compile`)).json() as TestingCompiledScenario;
  const technical = job(current, { phase: 'technical', stage: 'wiring', status: 'completed', fingerprint: compiled.fingerprint, result: { plan: { unsupported: ['Die gespeicherte Aktion braucht einen beobachtbaren Nachweis.'] } } });
  await transport(page, { jobs: [technical], runs: [] });
  const revisions: unknown[] = [];
  await page.route(`**/api/testing/scenarios/${current.id}/interpret-revision`, async route => {
    revisions.push(route.request().postDataJSON());
    await route.fulfill({ status: 202, json: job(current, { phase: 'business', status: 'running' }) });
  });
  await page.goto(`/testing/editor/${current.id}`);
  const repair = page.getByRole('region', { name: 'Technische Grenze mit KI überarbeiten', exact: true });
  await repair.getByLabel('Anweisung für den gesamten Ablauf', { exact: true }).fill('Formuliere eine fachlich beobachtbare Prüfung.');
  await repair.getByRole('button', { name: 'Mit KI überarbeiten', exact: true }).click();
  await expect.poll(() => revisions.length).toBe(1);
  await expect(repair.getByRole('button', { name: 'Mit KI überarbeiten', exact: true })).toBeEnabled();
  expect(revisions[0]).toMatchObject({ model: 'luna', revision: current.revision });
  expect((revisions[0] as { text: string }).text).toContain(technical.id);
  expect((revisions[0] as { text: string }).text).toContain('Die gespeicherte Aktion braucht einen beobachtbaren Nachweis.');
});

test('Ein verspäteter KI-Titel aktualisiert nur saubere Felder und bewahrt lokale Bearbeitung', async ({ page, request }) => {
  const current = await scenarioFixture(request, true);
  const parent = job(current); const state: TransportFixture = { jobs: [parent], runs: [] }; await transport(page, state);
  await page.goto(`/testing/editor/${current.id}`);
  await page.getByLabel('Name des Testfalls', { exact: true }).fill('Mein eigener fachlicher Titel');
  const named = await persist(request, { ...current, title: 'Automatisch benannter Test', naming: { title: 'Automatisch benannter Test', summary: 'Eine fiktive Freigabe prüfen.', tags: ['Freigabe'], titleSource: 'agent', jobId: 'synthetic-naming' } });
  state.jobs = [{ ...parent, scenarioRevision: named.revision, result: { scenario: named, applied: false } }];
  await expect(page.getByLabel('Name des Testfalls', { exact: true })).toHaveValue('Mein eigener fachlicher Titel');
  await expect.poll(async () => page.evaluate(id => JSON.parse(sessionStorage.getItem(`folio-testing-draft:${id}`) ?? '{}').revision, current.id)).toBe(named.revision);
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Speichern', exact: true })).toBeDisabled();
  expect((await readScenario(request, current.id)).title).toBe('Mein eigener fachlicher Titel');
  await page.reload();
  await expect(page.getByLabel('Name des Testfalls', { exact: true })).toHaveValue('Mein eigener fachlicher Titel');
});

test('Die fachliche Freigabe bündelt Hinweise und öffnet bei echten Fehlern den genauen Block statt freizugeben', async ({ page, request }) => {
  const source = await scenarioFixture(request);
  const catalog = await (await request.get('/api/testing/catalog')).json() as TestingCatalog;
  const customerName = catalog.definitions.find(item => item.id === 'kunde.anlegen' && item.version === '1.0.0')!.name;
  const definition = { ...catalog.definitions.find(item => item.kind === 'assertion')!, id: `synthetic-info-${randomUUID()}`, semanticKey: `synthetic-info-${randomUUID()}`, name: 'Eigene Nachweisprüfung', inputs: [], outputs: [], bindingId: undefined };
  expect((await request.post('/api/testing/definitions', { data: { definition } })).ok()).toBe(true);
  const current = await persist(request, { ...source, blocks: [...source.blocks,
    { id: 'fehlender-kunde', definition: { id: 'kunde.anlegen', version: '1.0.0' }, inputs: { name: '' }, outputs: { customer: 'neuerkunde' } },
    { id: 'manuelle-pruefung', definition: { id: definition.id, version: definition.version }, inputs: {} }] });
  await transport(page, { jobs: [], runs: [] });
  const requests: string[] = [];
  page.on('request', req => { if (req.method() === 'POST' && req.url().endsWith('/approve')) requests.push(req.url()); });
  await page.goto(`/testing/editor/${current.id}`);
  await expect(page.getByRole('button', { name: '1 Information', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '0 Warnungen', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Freigeben und technisch prüfen', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Hinweise zum Testfall', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.locator('.t-review-issue.error').filter({ hasText: customerName }).first().click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.t-inspector h3')).toHaveText(customerName);
  await expect(page.locator('#testing-value-name')).toBeFocused();
  expect(requests).toEqual([]);
});

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
  await expect(page.locator('.t-workflow-progress [aria-current="step"]')).toContainText('Erkundung & Entwurf');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  const template = await readScenario(request, 'kuh-direktionsanfrage');
  const completed = await persist(request, { ...created!, blocks: template.blocks });
  state.jobs = [{ ...parent, status: 'completed', childJobIds: [child.id], result: { scenario: completed, applied: true } },
    { ...child, status: 'completed', result: { explored: false, evidence: [], newKnowledge: [], openQuestions: [], explanation: 'Vorhandene fiktive Regeln reichen aus.' } }];
  await page.reload();
  await expect(nextHeading(page)).toHaveText('Passt dieser Ablauf zu deiner Anforderung?');
  await expect(page.getByRole('button', { name: 'Fachlich freigeben', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Erkundungsergebnis', exact: true })).toContainText('Das vorhandene Wissen reicht');
  await expect(page.getByRole('region', { name: 'Prüfergebnis', exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('linearer-entwurf-nach-wiederaufnahme.png'), fullPage: true });
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
  await expect(activity(page)).toContainText('Die fachliche Überschneidung muss zuerst geklärt werden.');
  await expect(page.getByRole('button', { name: 'Vorschläge ansehen', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Prüfergebnis', exact: true })).toHaveCount(0);
  await expect(page.locator('.t-workflow-progress [aria-current="step"]')).toContainText('Fachlich prüfen');
  await page.getByRole('link', { name: 'Alle Testfälle', exact: true }).click();
  const row = page.locator('.t-test-row').filter({ hasText: current.title });
  await expect(row).toContainText('Deine Entscheidung'); await expect(row).not.toContainText('Bestanden');
  await row.click(); await page.screenshot({ path: testInfo.outputPath('dublette-statt-historischem-erfolg.png'), fullPage: true });
});

test('Eine Wissenslücke bleibt sichtbar und lässt denselben gespeicherten Test nach Ergänzung erneut planen', async ({ page, request }, testInfo) => {
  const current = await scenarioFixture(request, true);
  const question = 'Welche Rolle darf die fiktive Sonderfreigabe ausführen?';
  const parent = job(current, { status: 'completed', result: { needsKnowledge: true, openQuestions: [question], explanation: 'Eine fachliche Angabe fehlt.' } });
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
  await expect(page.getByRole('button', { name: 'Fachlich freigeben', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Neuen Block definieren und hinzufügen', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Einen fachlichen Block definieren', exact: true });
  const name = `Belegprüfung ${randomUUID().slice(0, 8)}`, title = `Regel zur ${name}`;
  await dialog.getByLabel('Name des Blocks', { exact: true }).fill(name);
  await dialog.getByLabel('Fachliche Bedeutung', { exact: true }).fill('Prüft einen vollständig synthetischen Fachbeleg.');
  await dialog.getByRole('button', { name: 'Neues Wissen beschreiben', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Definieren und zum Ablauf hinzufügen', exact: true })).toBeDisabled();
  await dialog.getByLabel('Titel des Wissens', { exact: true }).fill(title);
  await dialog.getByLabel('Fachliche Beschreibung', { exact: true }).fill('Für diesen synthetischen Test gilt: Ein vorhandener Fachbeleg muss sichtbar geprüft werden.');
  const sent = page.waitForRequest(req => req.method() === 'POST' && new URL(req.url()).pathname === '/api/testing/definitions');
  await dialog.getByRole('button', { name: 'Definieren und zum Ablauf hinzufügen', exact: true }).click();
  const payload = (await sent).postDataJSON();
  await expect(dialog).toHaveCount(0);
  expect(payload.newKnowledge).toHaveLength(1);
  expect(payload.definition.knowledgeRefs).toContain(payload.newKnowledge[0].id);
  const catalog = await (await request.get('/api/testing/catalog')).json() as TestingCatalog;
  const definition = catalog.definitions.find(item => item.id === payload.definition.id)!;
  const document = catalog.knowledge.find(item => item.id === payload.newKnowledge[0].id)!;
  expect(definition.name).toBe(name); expect(document.title).toBe(title);
  expect(document.definitionRefs).toContainEqual({ id: definition.id, version: definition.version });
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Speichern', exact: true })).toBeDisabled();
  expect((await readScenario(request, current.id)).blocks.some(item => item.definition.id === definition.id)).toBeTruthy();
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
  await expect(page.getByRole('button', { name: 'Fachlich freigeben', exact: true })).toBeVisible();
  await expect(page.getByText(`Früherer Auftrag · Revision ${current.revision}`, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Fachlich freigeben', exact: true }).click();
  await expect(nextHeading(page)).toHaveText('Bereit für die technische Prüfung');
  const approved = await (await request.get(`/api/testing/scenarios/${current.id}/compile`)).json() as TestingCompiledScenario;
  expect(approved.scenarioRevision).toBe(revised.revision);
  expect(approved.issues.some(item => ['APPROVAL_REQUIRED', 'APPROVAL_STALE'].includes(item.code))).toBe(false);
  await page.reload();
  await expect(nextHeading(page)).toHaveText('Bereit für die technische Prüfung');
  await expect(page.getByRole('button', { name: 'Vorschläge ansehen', exact: true })).toHaveCount(0);
});

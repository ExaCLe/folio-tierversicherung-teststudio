import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { TestingAgentJob, TestingScenario, TestingApproval, TestingExplorationQuestion } from '../shared/testing';
import { deriveTestingLifecycle } from '../server/testing/lifecycle';

// Transport fixtures prove UI state and never call a model. Writes use only
// the isolated Playwright API; the actual application still derives lifecycle.
async function scenario(request: APIRequestContext, empty = true): Promise<TestingScenario> {
  const source = await (await request.get('/api/testing/scenarios/kuh-direktionsanfrage')).json();
  const response = await request.put(`/api/testing/scenarios/progress-${randomUUID()}`, { data: { ...source, title: 'Fortschritt im Teststudio', intent: 'Prüfe, ob die Direktion eine Sonderfreigabe für eine Kuh erteilen kann.', expectedRevision: 0, ...(empty ? { blocks: [] } : {}) } });
  expect(response.ok()).toBeTruthy(); return response.json();
}
function job(current: TestingScenario, patch: Partial<TestingAgentJob> = {}): TestingAgentJob {
  return { id: randomUUID(), scenarioId: current.id, scenarioRevision: current.revision, model: 'luna', phase: 'business', stage: 'knowledge', status: 'running', prompt: 'Synthetische Fortschrittsprüfung', startedAt: new Date().toISOString(), events: [], ...patch };
}
async function transport(page: Page, state: { jobs: TestingAgentJob[] }) {
  await page.route('**/api/testing/jobs/**', async route => {
    const current = state.jobs.find(item => item.id === new URL(route.request().url()).pathname.split('/').at(-1));
    await route.fulfill(route.request().method() === 'GET' && current ? { json: current } : { status: 409, json: { error: 'Kein echter KI-Aufruf in diesem UI-Test.' } });
  });
  await page.route('**/api/testing/bootstrap', async route => {
    const data = await (await route.fetch()).json();
    await route.fulfill({ json: { ...data, jobs: state.jobs, lifecycles: data.scenarios.map((item: TestingScenario) => deriveTestingLifecycle(item, data.catalog, state.jobs, data.runs, data.approvals.find((approval: TestingApproval) => approval.scenarioId === item.id))) } });
  });
}
test.afterEach(async ({ page }) => { await page.unrouteAll({ behavior: 'wait' }); });

const activity = (page: Page) => page.getByRole('region', { name: 'Aktueller Arbeitsstand', exact: true });
const shot = (name: string) => resolve('.local/verification/progress-workspace', name);

test('Business zeigt echte sequentielle Arbeit, deduplizierte Werkzeugzahlen und aktuelle öffentliche Erläuterungen', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const current = await scenario(request);
  const tool = { id: randomUUID(), at: new Date().toISOString(), kind: 'tool' as const, message: 'RAW_TOOL_COMMAND_MUST_STAY_HIDDEN' };
  const parent = job(current, { events: [tool], workStages: [{ stage: 'knowledge', status: 'running' }] });
  const child = job(current, { phase: 'exploration', parentJobId: parent.id, events: [tool, { id: randomUUID(), at: new Date().toISOString(), kind: 'status', message: 'Die vorhandene Regel zur Sonderfreigabe wird geprüft.' }], workStages: [{ stage: 'knowledge', status: 'running' }] });
  parent.childJobIds = [child.id]; const state = { jobs: [parent, child] }; await transport(page, state);
  await page.goto(`/testing/editor/${current.id}`);
  await expect(activity(page).getByLabel('Fortschritt des Auftrags')).toContainText('1 aktiver KI-Agent');
  await expect(activity(page).locator('[data-stage="planning"]')).toHaveAttribute('data-state', 'waiting');
  await expect(activity(page).locator('.t-activity-current')).toContainText('Die vorhandene Regel zur Sonderfreigabe');
  await expect(page.getByRole('region', { name: 'Anforderung und Modell', exact: true })).toContainText(current.intent);
  await expect(page.getByLabel('Modell für KI-Aufträge', { exact: true })).toBeVisible();
  await activity(page).getByText(/Erläuterungen und Verlauf ansehen/).click();
  await expect(activity(page).locator('.t-activity-details > summary')).toContainText('1 protokollierte Werkzeugmeldung');
  await expect(activity(page)).not.toContainText('RAW_TOOL_COMMAND_MUST_STAY_HIDDEN');
  await activity(page).getByText(/Erläuterungen und Verlauf ansehen/).click();

  const questions: TestingExplorationQuestion[] = [
    { id: 'vermittler', text: 'Darf die Rolle Vermittler eine Sonderfreigabe erteilen?', requiresBrowser: true, status: 'answered', answer: 'Die Entscheidung ist für Vermittler gesperrt.', evidenceIds: ['beobachtung-vermittler'], knowledgeIds: [] },
    { id: 'direktion', text: 'Darf die Rolle Direktion eine Sonderfreigabe erteilen?', requiresBrowser: true, status: 'open', answer: '', evidenceIds: [], knowledgeIds: [] },
  ];
  const progress = { questions, stage: 'exploring' as const, status: 'acting' as const, round: 2, observationCount: 1, actionLimit: 8, startedAt: parent.startedAt, deadlineAt: new Date(Date.now() + 360_000).toISOString(), summary: 'Im Portal wird das Feld Entscheidung untersucht.' };
  state.jobs = [parent, { ...child, stage: 'exploring', progress, workStages: [{ stage: 'knowledge', status: 'completed' }, { stage: 'exploring', status: 'running' }] }];
  await expect(activity(page).locator('.t-activity-current')).toContainText(progress.summary, { timeout: 15_000 });
  await expect(activity(page).getByLabel('Fortschritt des Auftrags')).toContainText('1 von 4 Arbeitsschritten erledigt');
  await expect(activity(page).getByLabel('Fortschritt des Auftrags')).toContainText('1 aktiver KI-Agent');
  const checklist = page.getByRole('region', { name: 'Erkundungsfragen', exact: true });
  await expect(checklist).toContainText('1 von 2 Erkundungsfragen beantwortet');
  await checklist.locator('summary').click();
  await expect(checklist).toContainText('Die Entscheidung ist für Vermittler gesperrt.');
  await expect(checklist.getByText(questions[1].text, { exact: true })).toBeVisible();
  await expect(checklist).toContainText('Noch offen');
  await checklist.locator('summary').click();
  await page.screenshot({ path: shot('business-erkundung.png') });

  const answeredQuestions: TestingExplorationQuestion[] = questions.map(question => question.status === 'answered' ? question : { ...question, status: 'answered', answer: 'Die Direktion kann eine Sonderfreigabe erteilen.', evidenceIds: ['beobachtung-direktion'] });
  await page.route('**/synthetic-evidence.png', route => route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6G8sAAAAASUVORK5CYII=', 'base64') }));
  state.jobs = [{ ...parent, stage: 'planning', progress, workStages: [{ stage: 'planning', status: 'running', summary: 'Die beobachteten Felder werden in fachliche Schritte übersetzt.' }] }, { ...state.jobs[1], status: 'completed', progress: { ...progress, status: 'finished', questions: answeredQuestions }, result: { explored: true, questions: answeredQuestions, evidence: [{ id: 'beobachtung-vermittler', action: JSON.stringify({ op: 'select', targetId: 'internal-target', value: 'Vermittler' }), path: '/portal', screenshot: '/synthetic-evidence.png' }, { id: 'beobachtung-direktion', action: JSON.stringify({ op: 'select', targetId: 'internal-target', value: 'Direktion' }), path: '/portal' }] }, workStages: [{ stage: 'knowledge', status: 'completed' }, { stage: 'exploring', status: 'completed' }] }];
  await expect(activity(page).locator('.t-activity-current')).toContainText('Die beobachteten Felder werden in fachliche Schritte übersetzt.', { timeout: 15_000 });
  await expect(activity(page).locator('.t-activity-current')).not.toContainText(progress.summary);
  await expect(activity(page).getByLabel('Fortschritt des Auftrags')).toContainText('2 von 4 Arbeitsschritten erledigt');
  await expect(checklist).toContainText('2 von 2 Erkundungsfragen beantwortet');
  await checklist.locator('summary').click();
  await expect(checklist.getByRole('link', { name: 'Beleg 1: Auswahl ändern: Vermittler', exact: true })).toHaveAttribute('href', '/synthetic-evidence.png');
  await expect(checklist).not.toContainText('internal-target');

  await expect(activity(page).getByLabel('Fortschritt des Auftrags')).toContainText('1 aktiver KI-Agent');
});

test('Technik zeigt zwei parallele Arbeitszweige, fertige Verdrahtung und wartende Jobs ohne zusätzliche KI-Agenten', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const current = await scenario(request, false);
  const parent = job(current, { phase: 'technical', stage: 'wiring', workStages: [{ stage: 'wiring', status: 'running', summary: 'Die Eingabefelder werden mit den fachlichen Werten verbunden.' }] });
  const child = job(current, { phase: 'duplicates', stage: 'duplicates', parentJobId: parent.id, events: [{ id: randomUUID(), at: new Date().toISOString(), kind: 'status', message: 'Vorhandene Prüfbausteine werden auf passende Ergebnisse verglichen.' }] });
  parent.events = [{ id: randomUUID(), at: new Date().toISOString(), kind: 'status', message: 'Die Speicheraktion wird an das Formular gebunden.' }, { id: randomUUID(), at: new Date().toISOString(), kind: 'status', message: `Dublettenprüfung: ${child.events[0].message}` }];
  parent.childJobIds = [child.id]; const state = { jobs: [parent, child] }; await transport(page, state);
  await page.goto(`/testing/editor/${current.id}`);
  await expect(activity(page).getByLabel('Fortschritt des Auftrags')).toContainText('2 aktive KI-Agenten');
  await expect(activity(page).locator('[data-stage="running"]')).toHaveAttribute('data-state', 'waiting');
  await expect(activity(page).locator('.t-activity-current')).toContainText('Die Eingabefelder');
  await expect(activity(page).locator('.t-activity-current')).toContainText('Vorhandene Prüfbausteine');
  await activity(page).locator('[data-stage="wiring"] summary').click();
  await expect(activity(page).locator('[data-stage="wiring"]')).toContainText('Die Speicheraktion wird an das Formular gebunden.');
  await expect(activity(page).locator('[data-stage="wiring"]')).not.toContainText('Dublettenprüfung:');
  await activity(page).locator('[data-stage="wiring"] summary').click();
  await activity(page).locator('[data-stage="duplicates"] summary').click();
  await expect(activity(page).locator('[data-stage="duplicates"]')).toContainText('Vorhandene Prüfbausteine werden');
  await page.screenshot({ path: shot('technik-parallel.png') });
  state.jobs = [{ ...parent, workStages: [{ stage: 'wiring', status: 'completed', summary: 'Die technische Vorbereitung ist fertig.' }] }, child];
  await expect(activity(page).getByLabel('Fortschritt des Auftrags')).toContainText('1 aktiver KI-Agent', { timeout: 15_000 });
  await expect(activity(page).getByLabel('Fortschritt des Auftrags')).toContainText('1 von 3 Arbeitsschritten erledigt');
  state.jobs = [state.jobs[0], { ...child, status: 'queued' }];
  await expect(activity(page).getByLabel('Fortschritt des Auftrags')).toContainText('0 aktive KI-Agenten', { timeout: 15_000 });
  await expect(activity(page).locator('[data-stage="duplicates"]')).toContainText('Wartet auf Start');
  const waitingEvent = { id: randomUUID(), at: new Date().toISOString(), kind: 'status' as const, message: 'Wartet auf einen der zwei lokalen Agentenplätze.' };
  state.jobs = [state.jobs[0], { ...child, status: 'running', events: [...child.events, waitingEvent] }];
  await expect(activity(page).locator('[data-stage="duplicates"]')).toContainText('Wartet auf KI-Platz', { timeout: 15_000 });
  await expect(activity(page).getByLabel('Fortschritt des Auftrags')).toContainText('0 aktive KI-Agenten');
  state.jobs = [state.jobs[0], { ...state.jobs[1], events: [...state.jobs[1].events, { id: randomUUID(), at: new Date().toISOString(), kind: 'status', message: 'Codex-Sitzung gestartet.' }] }];
  await expect(activity(page).getByLabel('Fortschritt des Auftrags')).toContainText('1 aktiver KI-Agent', { timeout: 15_000 });
  const reuse = job(current, { phase: 'reuse', stage: 'reuse', parentJobId: parent.id, events: [{ id: randomUUID(), at: new Date().toISOString(), kind: 'status', message: 'Der bestandene Ablauf wird auf wiederverwendbare Schrittgruppen geprüft.' }] });
  state.jobs = [{ ...parent, stage: 'reuse', childJobIds: [child.id, reuse.id], workStages: [{ stage: 'wiring', status: 'completed' }, { stage: 'running', status: 'completed' }] }, { ...child, status: 'completed' }, reuse];
  await expect(activity(page).getByLabel('Fortschritt des Auftrags')).toContainText('1 aktiver KI-Agent', { timeout: 15_000 });
  await expect(activity(page).getByLabel('Fortschritt des Auftrags')).toContainText('3 von 4 Arbeitsschritten erledigt');
  await expect(activity(page).locator('[data-stage="reuse"]')).toContainText('(optional)');
  await expect(activity(page).locator('.t-activity-current')).toContainText('Der bestandene Ablauf wird auf wiederverwendbare Schrittgruppen geprüft.');

});

test('Navigation ist ausgerichtet, Spinner bewegt sich und reduzierte Bewegung behält den Arbeitsstatus', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 }); await page.emulateMedia({ reducedMotion: 'no-preference' });
  const current = await scenario(request); const parent = job(current); await transport(page, { jobs: [parent] });
  await page.goto('/testing/new');
  await expect(page.getByLabel('Modell für den Entwurf')).toBeVisible();
  const controls = page.locator('.t-workspace-topbar nav > a, .t-resource-menu > summary');
  await expect(controls).toHaveCount(4);
  const boxes = await controls.evaluateAll(elements => elements.map(element => { const rect = element.getBoundingClientRect(); return { height: rect.height, middle: rect.y + rect.height / 2 }; }));
  expect(Math.max(...boxes.map(box => box.middle)) - Math.min(...boxes.map(box => box.middle))).toBeLessThan(1);
  expect(new Set(boxes.map(box => box.height)).size).toBe(1);
  await page.screenshot({ path: shot('anforderung-navigation.png') });
  await page.goto(`/testing/editor/${current.id}`);
  const spinner = activity(page).locator('.t-activity-symbol .t-spin');
  await expect(spinner).toBeVisible();
  expect(await spinner.evaluate(element => getComputedStyle(element).animationName)).not.toBe('none');
  const transform = await spinner.evaluate(element => getComputedStyle(element).transform);
  await expect.poll(() => spinner.evaluate(element => getComputedStyle(element).transform)).not.toBe(transform);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => spinner.evaluate(element => getComputedStyle(element).animationName)).toBe('none');
  await expect(activity(page)).toContainText('IN BEARBEITUNG');
  await expect(activity(page).getByLabel('Fortschritt des Auftrags')).toContainText('1 aktiver KI-Agent');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Navigation öffnen' }).click();
  await expect(page.getByRole('link', { name: 'Einstellungen', exact: true })).toBeVisible();
  await page.screenshot({ path: shot('schmale-navigation.png') });
});

test('Zeitlimit und historischer falscher Abbruch bleiben verständlich und behaupten keine menschliche Aktion', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const current = await scenario(request);
  const parent = job(current, { status: 'failed', error: 'Die Erkundung konnte nicht abgeschlossen werden: Codex wurde vom Menschen abgebrochen.' });
  const state = { jobs: [parent] }; await transport(page, state);
  await page.goto(`/testing/editor/${current.id}`);
  await expect(activity(page).getByRole('alert')).toContainText('Die Bearbeitung wurde unterbrochen.');
  await expect(activity(page).getByText(/vom Menschen abgebrochen/)).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Erkundung und Entwurf fortsetzen', exact: true })).toBeVisible();
  state.jobs = [{ ...parent, termination: { cause: 'time_limit', message: 'Das interne Zeitlimit wurde erreicht.', at: new Date().toISOString(), limitMs: 360_000 } }];
  await page.reload();
  await expect(activity(page).getByRole('alert')).toContainText('Die Bearbeitungszeit ist abgelaufen.');
  await expect(activity(page)).toContainText('6 Minuten');
  await expect(activity(page).getByText(/vom Menschen abgebrochen/)).not.toBeVisible();
  const notice = (await activity(page).getByRole('alert').boundingBox())!;
  const recovery = (await activity(page).locator('.t-agent-failure > p').boundingBox())!;
  expect(recovery.y - notice.y - notice.height).toBeGreaterThanOrEqual(10);
  await page.screenshot({ path: shot('zeitlimit-fortsetzen.png') });
});

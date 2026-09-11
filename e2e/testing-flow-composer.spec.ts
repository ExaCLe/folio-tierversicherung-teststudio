import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import type { TestingScenario } from '../shared/testing';
import type { TestingChatSnapshot } from '../shared/testing-chat';

const id = 'chat-flow-composer-contract';

async function scenario(request: APIRequestContext) {
  const response = await request.get('/api/testing/scenarios/kuh-direktionsanfrage');
  expect(response.ok()).toBeTruthy();
  return response.json() as Promise<TestingScenario>;
}

function snapshot(scenario?: TestingScenario, tasks: TestingChatSnapshot['tasks'] = []): TestingChatSnapshot {
  return {
    conversation: { id, revision: 1, eventSequence: 1, createdAt: '2026-09-10T08:00:00.000Z', updatedAt: '2026-09-10T08:00:00.000Z', model: 'luna', ...(scenario ? { scenarioId: scenario.id } : {}), entryIds: [] },
    timeline: [], tasks, questions: [], scenario, allowedCommands: scenario ? ['message', 'revise', 'save'] : ['explore', 'message'],
    confirmedFlow: scenario ? { scenarioRevision: scenario.revision, blocks: scenario.blocks } : null,
    ...(scenario ? { scenarioState: { revision: scenario.revision, fingerprint: 'flow-composer-contract' } } : {}),
  };
}

async function mockChat(page: Page, current: TestingChatSnapshot) {
  await page.route(`**/api/testing/chat/conversations/${id}`, route => route.fulfill({ json: current }));
  await page.route(`**/api/testing/chat/conversations/${id}/events`, route => route.fulfill({ contentType: 'text/event-stream', body: `event: snapshot\ndata: ${JSON.stringify({ type: 'snapshot', sequence: current.conversation.eventSequence, revision: current.conversation.revision, snapshot: current })}\n\n` }));
}

test('zeigt Cache-Metrik getrennt, inklusive Null, und lässt unbekannte Werte weg', async ({ page }) => {
  const current = snapshot(undefined, [
    { id: 'cache-zero', purpose: 'Cache mit Null', agent: { name: 'Sol', modelId: 'sol', provider: 'codex', color: '#635bff' }, status: 'completed', activityState: 'done', startedAt: '2026-09-10T08:00:00.000Z', metrics: { elapsedMs: 1000, requestCount: 1, inputTokens: 40, cachedInputTokens: 0, outputTokens: 2, totalTokens: 42 }, publicDetails: [] },
    { id: 'cache-unknown', purpose: 'Cache unbekannt', agent: { name: 'Luna', modelId: 'luna', provider: 'claude', color: '#e56b25' }, status: 'completed', activityState: 'done', startedAt: '2026-09-10T08:00:00.000Z', metrics: { elapsedMs: 1000, requestCount: 1, inputTokens: 40, outputTokens: 2, totalTokens: 42 }, publicDetails: [] },
  ]);
  await mockChat(page, current);
  await page.goto(`/testing/chat/${id}/chat`);
  await expect(page.getByRole('button', { name: /Cache mit Null/ })).toContainText('Eingabe 40');
  await expect(page.getByRole('button', { name: /Cache mit Null/ })).toContainText('Cache 0');
  await expect(page.getByRole('button', { name: /Cache mit Null/ })).not.toContainText('API-Anfragen unbekannt');
  await expect(page.getByRole('button', { name: /Cache mit Null/ })).not.toContainText('1 API-Anfragen');
  await expect(page.getByRole('button', { name: /Cache unbekannt/ }).locator('.tc-task-metrics')).not.toContainText('Cache');
});

test('zentriert den erweiterten Composer, wächst mit Text und sendet auf schmalem Viewport', async ({ page, request }) => {
  const seed = await scenario(request);
  const latest = 'Eine sehr lange letzte Agentenantwort mit vielen Details, die im erweiterten Composer umbrechen muss, ohne rechts aus dem Inhaltsbereich zu laufen.';
  const current = snapshot(seed, [{ id: 'latest', purpose: 'Letzte Antwort', agent: { name: 'Sol', modelId: 'sol', provider: 'codex', color: '#635bff' }, status: 'completed', activityState: 'done', startedAt: '2026-09-10T08:00:00.000Z', publicDetails: [{ id: 'latest-result', at: '2026-09-10T08:01:00.000Z', kind: 'result', message: latest, detail: { type: 'result', label: 'Ergebnis' } }] }]);
  await mockChat(page, current);
  await page.route(`**/api/testing/chat/conversations/${id}/commands`, async route => {
    expect(route.request().postDataJSON()).toMatchObject({ command: 'revise' });
    await route.fulfill({ json: { ...current, conversation: { ...current.conversation, revision: 2, eventSequence: 2 } } });
  });
  await page.setViewportSize({ width: 1200, height: 700 });
  await page.goto(`/testing/chat/${id}/flow`);
  const composer = page.locator('.tc-flow-composer');
  const textarea = page.getByRole('textbox', { name: 'Nachricht zum Ablauf', exact: true });
  await textarea.fill('Kurz');
  await expect(composer).toHaveClass(/is-expanded/);
  const short = await textarea.evaluate(element => ({ height: element.getBoundingClientRect().height, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }));
  const bounds = await composer.evaluate(element => { const rect = element.getBoundingClientRect(); const parent = element.closest('.tc-flow-pane')!.getBoundingClientRect(); return { left: rect.left, right: rect.right, center: rect.left + rect.width / 2, parentCenter: parent.left + parent.width / 2 }; });
  expect(Math.abs(bounds.center - bounds.parentCenter)).toBeLessThan(2);
  expect(short.scrollWidth).toBeLessThanOrEqual(short.clientWidth);
  await textarea.fill('Eine längere Änderung mit mehreren Zeilen, die den Composer wachsen lässt und die maximale Höhe prüft.\nNoch eine zweite Zeile.\nNoch eine dritte Zeile.');
  const long = await textarea.evaluate(element => ({ height: element.getBoundingClientRect().height, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }));
  expect(long.height).toBeGreaterThan(short.height);
  expect(long.height).toBeLessThanOrEqual(162);
  expect(long.scrollWidth).toBeLessThanOrEqual(long.clientWidth);
  const context = page.locator('.tc-flow-context span');
  await expect(context).toContainText(latest);
  expect(await context.evaluate(element => element.scrollWidth)).toBeLessThanOrEqual(await context.evaluate(element => element.clientWidth));
  await page.setViewportSize({ width: 390, height: 520 });
  const mobile = await composer.evaluate(element => { const rect = element.getBoundingClientRect(); return { left: rect.left, right: rect.right }; });
  expect(mobile.left).toBeGreaterThanOrEqual(0);
  expect(mobile.right).toBeLessThanOrEqual(390);
  await expect(page.getByLabel('Modell')).toBeVisible();
  const send = page.getByRole('button', { name: 'Nachricht zum Ablauf senden' });
  await expect(send).toBeVisible();
  await Promise.all([page.waitForRequest(`**/api/testing/chat/conversations/${id}/commands`), send.click()]);
});

test('letzte Matrixzeile bleibt oberhalb des kompakten und geöffneten Eingabefensters erreichbar', async ({ page, request }) => {
  await mockChat(page, snapshot(await scenario(request)));
  await page.setViewportSize({ width: 681, height: 930 });
  await page.goto(`/testing/chat/${id}/flow`);
  const pane = page.locator('.tc-flow-pane');
  const clearBottom = async () => {
    await pane.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect.poll(async () => page.locator('.tc-matrix').evaluate(element => {
      const composer = document.querySelector('.tc-flow-composer')!;
      return element.getBoundingClientRect().bottom <= composer.getBoundingClientRect().top - 8;
    })).toBe(true);
  };
  await expect(page.locator('.blocklySvg').first()).toBeVisible();
  await clearBottom();
  await page.getByRole('textbox', { name: 'Nachricht zum Ablauf' }).fill('Ändere den Ablauf.\nPrüfe die erste Rolle.\nPrüfe die zweite Rolle.\nPrüfe die Direktion.');
  await expect(page.locator('.tc-flow-composer')).toHaveClass(/is-expanded/);
  await clearBottom();
});

test('zeigt laufende Arbeit kompakt über den Blöcken mit Laufzeit, Schritt und Link zur Unterhaltung', async ({ page, request }) => {
  const startedAt = new Date(Date.now() - 12_000).toISOString();
  const task: TestingChatSnapshot['tasks'][number] = { id: 'working', purpose: 'Fachlichen Ablauf planen', agent: { name: 'Luna', modelId: 'luna', provider: 'codex', color: '#635bff' }, status: 'running', activityState: 'working', stage: 'planning', startedAt, executionAt: startedAt, publicDetails: [] };
  const current = snapshot(await scenario(request), [task]);
  current.activeJob = { id: task.id, phase: 'business', status: 'running', stage: 'planning', startedAt };
  current.conversation.activeJobId = task.id;
  await mockChat(page, current);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(`/testing/chat/${id}/flow`);
  const indicator = page.locator('.tc-flow-activity');
  await expect(indicator).toContainText('Luna · Ablaufplanung');
  await expect(indicator.locator('time')).toContainText(/\d+ s/);
  await expect(page.locator('.tc-agent-activity')).toHaveCount(0);
  const initial = await indicator.locator('svg').first().evaluate(element => getComputedStyle(element).transform);
  await expect.poll(() => indicator.locator('svg').first().evaluate(element => getComputedStyle(element).transform)).not.toBe(initial);
  expect(await indicator.evaluate(element => element.getBoundingClientRect().height)).toBeLessThan(40);
  await indicator.click();
  await expect(page).toHaveURL(new RegExp(`/testing/chat/${id}/chat$`));
  await expect(page.getByRole('button', { name: /Fachlichen Ablauf planen, In Arbeit/ })).toBeVisible();
});

test('behält die technische Blockierung an ihrem Zeitpunkt und erlaubt Vorbereitung nach freigegebener Korrektur', async ({ page, request }) => {
  const current = snapshot(await scenario(request), [
    { id: 'old-technical', purpose: 'Technisch vorbereiten', agent: { name: 'Luna', modelId: 'luna', color: '#e56b25' }, status: 'blocked', activityState: 'attention', startedAt: '2026-09-10T08:00:00.000Z', executionAt: '2026-09-10T08:00:01.000Z', finishedAt: '2026-09-10T08:01:00.000Z', publicDetails: [{ id: 'old-problem', at: '2026-09-10T08:01:00.000Z', kind: 'result', message: 'Das sichtbare Formular muss auf deaktiviert geprüft werden.', detail: { type: 'result', label: 'Ergebnis', data: { technicalStatus: 'blocked', nextAction: { kind: 'revise-business', instruction: 'Prüfe deaktiviert statt unsichtbar.' } } } }] },
    { id: 'business-rework', purpose: 'Fachlichen Ablauf planen', agent: { name: 'Luna', modelId: 'luna', color: '#635bff' }, status: 'completed', activityState: 'done', startedAt: '2026-09-10T08:03:00.000Z', executionAt: '2026-09-10T08:03:00.000Z', publicDetails: [] },
  ]);
  current.allowedCommands.push('prepare');
  current.timeline = [
    { id: 'problem', kind: 'agent_summary', at: '2026-09-10T08:01:00.000Z', jobId: 'old-technical', message: 'Das sichtbare Formular muss auf deaktiviert geprüft werden.' },
    { id: 'revision-request', kind: 'user', at: '2026-09-10T08:02:00.000Z', message: 'Bitte prüfe deaktiviert statt unsichtbar.' },
    { id: 'approved', kind: 'user_action', at: '2026-09-10T08:04:00.000Z', message: 'Du hast die korrigierte Fassung freigegeben.' },
  ];
  await mockChat(page, current);
  await page.goto(`/testing/chat/${id}/chat`);
  await expect(page.getByRole('button', { name: 'Technisch vorbereiten', exact: true })).toBeEnabled();
  await expect(page.locator('.tc-queue')).toHaveCount(0);
  await expect(page.locator('.tc-technical-blocked')).toHaveCount(0);
  await expect(page.locator('[data-task-id=old-technical]')).toContainText('Fachliche Korrektur angefordert');
  const contents = await page.locator('.tc-feed').innerText();
  expect(contents.indexOf('Technisch vorbereiten')).toBeLessThan(contents.indexOf('Das sichtbare Formular'));
  expect(contents.indexOf('Das sichtbare Formular')).toBeLessThan(contents.indexOf('Bitte prüfe deaktiviert'));
  expect(contents.indexOf('Bitte prüfe deaktiviert')).toBeLessThan(contents.indexOf('Fachlichen Ablauf planen'));
});

test('zeigt echte Agentenausgaben und breite lesbare Details statt unbekannter API-Zahlen', async ({ page }) => {
  const current = snapshot(undefined, [{ id: 'public-output', purpose: 'Anwendung erkunden', workStages: [{ stage: 'knowledge', status: 'completed' }, { stage: 'exploring', status: 'running' }], agent: { name: 'Luna', modelId: 'luna', color: '#635bff' }, status: 'running', activityState: 'working', startedAt: new Date().toISOString(), metrics: { elapsedMs: 1000, requestCount: 1, modelTurnCount: 3 }, publicDetails: [
    { id: 'reasoning-1', at: new Date().toISOString(), kind: 'progress', message: '**Ich prüfe die Rollen im Formular.**', detail: { type: 'reasoning', label: 'Öffentliche Überlegung' } },
    { id: 'response-1', at: new Date().toISOString(), kind: 'progress', message: 'Das Formular ist sichtbar.', detail: { type: 'message', label: 'Antwort', data: { summary: 'Das Formular ist sichtbar.', scenario: { blocks: [{ technicalKey: 'only-in-original' }] } } } },
  ] }]);
  await mockChat(page, current);
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(`/testing/chat/${id}/chat`);
  const card = page.locator('[data-task-id=public-output]');
  await expect(card).toContainText('2 Agentenausgaben');
  await expect(card).toContainText('3 Modellrunden');
  await expect(card).not.toContainText('API-Anfragen');
  await card.click();
  const dialog = page.getByRole('dialog');
  expect((await dialog.boundingBox())!.width).toBeGreaterThan(1000);
  await expect(dialog.getByRole('list', { name: 'Erkundungsschritte' })).toContainText(/Fachwissen prüfen\s*Abgeschlossen/);
  await expect(dialog.getByRole('list', { name: 'Erkundungsschritte' })).toContainText(/Anwendung erkunden\s*In Arbeit/);
  await expect(dialog.getByText('Ich prüfe die Rollen im Formular.', { exact: true })).toBeVisible();
  await expect(dialog).not.toContainText('only-in-original');
  await expect(dialog.locator('details')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Technische Daten', exact: true }).click();
  await expect(dialog).toContainText('only-in-original');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('behält eine Nachricht nach einem Sendefehler und zeigt den Grund', async ({ page }) => {
  await mockChat(page, snapshot());
  await page.route(`**/api/testing/chat/conversations/${id}/commands`, route => route.fulfill({ status: 503, json: { error: 'Die Modellverbindung ist momentan nicht erreichbar.' } }));
  await page.goto(`/testing/chat/${id}/chat`);
  const input = page.getByRole('textbox', { name: 'Separate Nachricht', exact: true });
  await input.fill('Bitte eine Kuhversicherung erstellen.');
  await page.getByRole('button', { name: 'Separate Nachricht senden', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Die Modellverbindung ist momentan nicht erreichbar.');
  await expect(input).toHaveValue('Bitte eine Kuhversicherung erstellen.');
  await expect(page.getByRole('button', { name: 'Separate Nachricht senden', exact: true })).toBeEnabled();
});

test('zeigt fehlgeschlagenes Laden und stellt den Testfall per Wiederholung wieder her', async ({ page }) => {
  let unavailable = true;
  await page.route(`**/api/testing/chat/conversations/${id}`, route => unavailable ? route.fulfill({ status: 503, json: { error: 'Testdaten vorübergehend nicht erreichbar.' } }) : route.fulfill({ json: snapshot() }));
  await page.route(`**/api/testing/chat/conversations/${id}/events`, route => route.fulfill({ status: 503, body: 'offline' }));
  await page.goto(`/testing/chat/${id}/chat`);
  await expect(page.getByRole('alert')).toContainText('Testdaten vorübergehend nicht erreichbar.');
  await expect(page.getByText('Der Testfall konnte nicht geladen werden. Dein gespeicherter Stand bleibt erhalten.')).toBeVisible();
  unavailable = false;
  await page.getByRole('button', { name: 'Stand erneut laden', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Separate Nachricht', exact: true })).toBeVisible();
});

test('zeigt Wissenserkundung getrennt vom Testlauf und aktualisiert echte Browsernachweise', async ({ page }) => {
  const current = { ...snapshot(), explorationObservation: { jobId: 'explore-job', stage: 'knowledge', status: 'waiting-model', summary: 'Der Agent prüft die vorhandenen Rollenregeln.', observationCount: 0 } };
  await mockChat(page, current as TestingChatSnapshot);
  await page.goto(`/testing/chat/${id}/browser`);
  await expect(page.getByRole('heading', { name: 'Fachwissen prüfen' })).toBeVisible();
  await expect(page.getByText('Der Agent prüft zuerst vorhandenes Fachwissen. Der Browser wurde noch nicht geöffnet.')).toBeVisible();
  await expect(page.locator('.tc-live-frame img')).toHaveCount(0);
  const observed = { ...current, explorationObservation: { ...current.explorationObservation, stage: 'exploring', status: 'observed', observationCount: 1, summary: 'Das Antragsformular wurde geöffnet.', latest: { sequence: 1, path: '/portal/antrag', action: 'open', screenshot: '/api/testing/jobs/explore-job/artifacts/browser.png', observedAt: '2026-09-11T10:00:00.000Z' } } };
  await page.route('**/api/testing/jobs/explore-job/artifacts/browser.png*', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="blue"/></svg>' }));
  await mockChat(page, observed as TestingChatSnapshot);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Anwendung erkunden' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Browserbeobachtung: /portal/antrag' })).toBeVisible();
  await expect(page.getByText(/Letzte Browserbeobachtung/)).toContainText('/portal/antrag');
  await page.getByRole('button', { name: 'Testlauf', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Test starten', exact: true })).toBeVisible();
});

test('macht den Fehler samt Wiederholung in allen Ansichten sichtbar und sendet einen bewachten Chat-Befehl', async ({ page }) => {
  const current = snapshot(undefined, [{ id: 'failed-root', purpose: 'Fachlichen Ablauf planen', agent: { name: 'Luna', modelId: 'luna', color: '#635bff' }, status: 'failed', activityState: 'failed', startedAt: '2026-09-10T08:00:00.000Z', publicDetails: [{ id: 'error', at: '2026-09-10T08:01:00.000Z', kind: 'error', message: 'Codex konnte das ausgewählte Modell nicht erreichen.' }] }]);
  current.retry = { jobId: 'failed-root', label: 'Auftrag erneut versuchen' };
  current.allowedCommands.push('retry');
  await mockChat(page, current);
  let calls = 0;
  await page.route(`**/api/testing/chat/conversations/${id}/commands`, async route => {
    calls += 1;
    expect(route.request().postDataJSON()).toMatchObject({ command: 'retry', expectedRevision: 1 });
    await route.fulfill({ json: { ...current, retry: undefined, allowedCommands: ['cancel'], conversation: { ...current.conversation, revision: 2, eventSequence: 2 } } });
  });
  await page.goto(`/testing/chat/${id}/chat`);
  await expect(page.getByRole('alert')).toContainText('Codex konnte das ausgewählte Modell nicht erreichen.');
  await page.getByRole('button', { name: 'Browser', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Codex konnte das ausgewählte Modell nicht erreichen.');
  await page.getByRole('button', { name: 'Auftrag erneut versuchen', exact: true }).click();
  expect(calls).toBe(1);
  await expect(page.locator('.tc-recovery-notice')).toHaveCount(0);
});

test('zeigt auch bei einem Darstellungsfehler den konkreten Hinweis und einen Neustart', async ({ page }) => {
  const current = snapshot();
  current.timeline = [{ id: 'bad-time', kind: 'agent_summary', at: 'invalid-date', message: 'Antwort mit fehlerhaftem Zeitpunkt' }];
  await mockChat(page, current);
  await page.goto(`/testing/chat/${id}/chat`);
  await expect(page.getByRole('heading', { name: 'Die Ansicht konnte nicht angezeigt werden.' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Invalid time value');
  await expect(page.getByRole('button', { name: 'Seite neu laden', exact: true })).toBeVisible();
});

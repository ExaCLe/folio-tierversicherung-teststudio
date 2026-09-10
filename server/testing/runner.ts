import { chromium, type Browser, type BrowserContext } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { TestingCompiledScenario, TestingMatrixRow, TestingRun, TestingStepResult } from '../../shared/testing';
import { createTestingExecutionState, executeTestingStep } from '../../e2e/helpers/agriculture-driver';
import { endTestingObservation, observeTestingPage } from './observation';

export const TESTING_RUN_ROOT = resolve(process.env.FOLIO_TESTING_RUN_ROOT ?? '.local/testing/runs');
const driverSource = readFileSync(resolve('e2e/helpers/agriculture-driver.ts'), 'utf8');
const driverSha256 = createHash('sha256').update(driverSource).digest('hex');
const moduleLoadedAt = new Date().toISOString();
const activeBrowsers = new Set<Browser>();
export const activeTestingRunCount = () => activeBrowsers.size;
export async function stopTestingBrowsers() { await Promise.allSettled([...activeBrowsers].map(browser => browser.close())); }
const artifact = (id: string, filename: string) => `/api/testing/runs/${encodeURIComponent(id)}/artifacts/${filename}`;
export function generatedTestingSource(): string {
  return `import { test } from '@playwright/test';\nimport { readFileSync } from 'node:fs';\nimport { createTestingExecutionState, executeTestingStep } from '../../../../e2e/helpers/agriculture-driver';\nconst compiled = JSON.parse(readFileSync(new URL('./compiled.json', import.meta.url), 'utf8'));\n// Die Selektoren stehen einmal in der gespeicherten Bindungsrevision.\ntest(compiled.scenario.title, async ({ page }) => {\n  const state = createTestingExecutionState('wiederholung-' + Date.now());\n  for (const step of compiled.steps) {\n    const binding = compiled.bindings.find((item: any) => item.id === step.binding.id && item.revision === step.binding.revision);\n    await test.step(step.path + ': ' + step.label, () => executeTestingStep(page, step, binding, state));\n  }\n});\n`;
}
export function generatedTestingMatrixSource(): string {
  return `import { test } from '@playwright/test';\nimport { readFileSync } from 'node:fs';\nimport { createTestingExecutionState, executeTestingStep } from '../../../../e2e/helpers/agriculture-driver';\nconst snapshot = JSON.parse(readFileSync(new URL('./compiled.json', import.meta.url), 'utf8'));\n// Jede Zeile ist ein eigener Playwright-Test und erhält damit eine frische Browserseite sowie einen eigenen Zustand.\ntest.describe(snapshot.parent.scenario.title, () => {\n  for (const variant of snapshot.rows) test(variant.row.label + ' [' + variant.row.id + ']', async ({ page }) => {\n    const compiled = variant.compiled;\n    const state = createTestingExecutionState('wiederholung-' + variant.row.id + '-' + Date.now());\n    for (const step of compiled.steps) {\n      const binding = compiled.bindings.find((item: any) => item.id === step.binding.id && item.revision === step.binding.revision);\n      await test.step(step.path + ': ' + step.label, () => executeTestingStep(page, step, binding, state));\n    }\n  });\n});\n`;
}
export async function executeTestingRun(compiled: TestingCompiledScenario, options: { id?: string; baseURL?: string; signal?: AbortSignal; onUpdate?: (run: TestingRun) => void; observation?: { channelId: string; parentRunId?: string; rowId?: string; endWithRun?: boolean } } = {}): Promise<TestingRun> {
  if (!compiled.executable) throw new Error('Der fachlich freigegebene Testfall muss vollständig verdrahtet sein.');
  const id = options.id ?? `testlauf-${randomUUID()}`;
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Ungültige Testlauf-ID.');
  const directory = resolve(TESTING_RUN_ROOT, id);
  const run: TestingRun = { id, scenarioId: compiled.scenarioId, scenarioTitle: compiled.scenario.title, scenarioRevision: compiled.scenarioRevision,
    startedAt: new Date().toISOString(), status: 'running', compiled: structuredClone(compiled), steps: [], outputs: {},
    artifacts: { source: artifact(id, 'generated.spec.ts'), manifest: artifact(id, 'manifest.json'), directory } };
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(resolve(directory, 'compiled.json'), JSON.stringify(compiled, null, 2));
  await writeFile(resolve(directory, 'generated.spec.ts'), generatedTestingSource());
  await writeFile(resolve(directory, 'agriculture-driver.ts'), driverSource);
  await writeFile(resolve(directory, 'manifest.json'), JSON.stringify({ runId: id, scenarioId: compiled.scenarioId, scenarioRevision: compiled.scenarioRevision,
    businessFingerprint: compiled.fingerprint, approval: compiled.approval, driverSha256, moduleLoadedAt,
    bindings: compiled.bindings.map(binding => ({ id: binding.id, revision: binding.revision, sourceHash: binding.sourceHash })),
    knowledge: compiled.knowledge.map(doc => ({ id: doc.id, revision: doc.revision })),
    browser: 'Chromium', createdAt: run.startedAt, replay: 'Die gespeicherten Bindungen sind im compiled.json eingefroren; der generierte Test verwendet den zentralen generischen Runner.' }, null, 2));
  const publish = async () => { await writeFile(resolve(directory, 'run.json'), JSON.stringify(run, null, 2)); options.onUpdate?.(structuredClone(run)); };
  let browser: Browser | undefined, context: BrowserContext | undefined;
  const onAbort = () => { void browser?.close(); };
  await publish();
  try {
    if (options.signal?.aborted) throw new Error('Der Testlauf wurde abgebrochen.');
    browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
    activeBrowsers.add(browser);
    options.signal?.addEventListener('abort', onAbort, { once: true });
    context = await browser.newContext({ baseURL: options.baseURL ?? process.env.FOLIO_APP_URL ?? 'http://127.0.0.1:5173', viewport: { width: 1440, height: 1050 }, locale: 'de-DE', timezoneId: 'Europe/Berlin', reducedMotion: 'reduce' });
    await context.tracing.start({ snapshots: true, screenshots: true, sources: true });
    const page = await context.newPage(); page.setDefaultTimeout(12_000); page.setDefaultNavigationTimeout(30_000);
    const browserErrors: string[] = [];
    page.on('pageerror', error => browserErrors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && !/Failed to load resource.*status of (400|403|409)/.test(message.text())) browserErrors.push(message.text()); });
    const state = createTestingExecutionState(id);
    for (const [index, step] of compiled.steps.entries()) {
      const started = Date.now();
      const result: TestingStepResult = { id: step.id, instanceId: step.instanceId, path: step.path, label: step.label, status: 'running', startedAt: new Date(started).toISOString() };
      run.steps.push(result); await publish();
      const observation = observeTestingPage(page, { runId: id, channelId: options.observation?.channelId, parentRunId: options.observation?.parentRunId, rowId: options.observation?.rowId, stepId: step.id, stepPath: step.path, stepLabel: step.label });
      await context.tracing.group(`${step.path}: ${step.label}`);
      try {
        if (options.signal?.aborted) throw new Error('Der Testlauf wurde abgebrochen.');
        const binding = compiled.bindings.find(item => item.id === step.binding?.id && item.revision === step.binding.revision);
        if (!binding) throw new Error(`Die eingefrorene technische Bindung für ${step.path} fehlt.`);
        const executed = await executeTestingStep(page, step, binding, state);
        if (browserErrors.length) throw new Error(`Das Portal meldet einen Browserfehler: ${browserErrors.join('; ')}`);
        result.status = 'passed'; result.outputValues = executed.outputValues; run.outputs = executed.outputs;
      } catch (error) { result.status = 'failed'; result.error = error instanceof Error ? error.message : String(error); run.status = 'failed'; run.error = `${step.label}: ${result.error}`; run.outputs = { ...state.outputs }; }
      finally {
        await observation.captureNow(); await observation.stop();
        result.finishedAt = new Date().toISOString(); result.durationMs = Date.now() - started;
        const filename = `schritt-${String(index + 1).padStart(3, '0')}.png`;
        try { await page.screenshot({ path: resolve(directory, filename), fullPage: true, animations: 'disabled' }); result.screenshot = artifact(id, filename); } catch { /* Browser cancellation can prevent a screenshot. */ }
        await context.tracing.groupEnd().catch(() => undefined); await publish();
      }
      if (result.status === 'failed') {
        run.steps.push(...compiled.steps.slice(index + 1).map(next => ({ id: next.id, instanceId: next.instanceId, path: next.path, label: next.label, status: 'skipped' as const, startedAt: new Date().toISOString(), error: 'Ein vorheriger Block ist fehlgeschlagen. Dieser abhängige Schritt wurde nicht ausgeführt.' })));
        break;
      }
    }
    if (run.status !== 'failed') run.status = 'passed';
  } catch (error) { run.status = 'failed'; run.error = error instanceof Error ? error.message : String(error); }
  finally {
    if (context) { try { await context.tracing.stop({ path: resolve(directory, 'trace.zip') }); run.artifacts!.trace = artifact(id, 'trace.zip'); } catch { /* Preserve the original failure. */ } }
    options.signal?.removeEventListener('abort', onAbort);
    await context?.close().catch(() => undefined); await browser?.close().catch(() => undefined);
    if (browser) activeBrowsers.delete(browser);
    if (!options.observation || options.observation.endWithRun !== false) endTestingObservation(options.observation?.channelId ?? id);
    run.finishedAt = new Date().toISOString(); await publish();
  }
  return run;
}

/** Each row delegates to the proven single-run executor, which gives it a fresh browser context and execution state. */
export async function executeTestingMatrixRun(parent: TestingCompiledScenario, variants: { row: TestingMatrixRow; compiled: TestingCompiledScenario }[], options: { id: string; baseURL?: string; signal?: AbortSignal; onUpdate?: (run: TestingRun) => void }): Promise<TestingRun> {
  const started = Date.now(), directory = resolve(TESTING_RUN_ROOT, options.id);
  const run: TestingRun = { id: options.id, scenarioId: parent.scenarioId, scenarioTitle: parent.scenario.title, scenarioRevision: parent.scenarioRevision,
    status: 'running', startedAt: new Date(started).toISOString(), compiled: structuredClone(parent), steps: [], mode: 'matrix',
    matrixRows: variants.map(({ row }, index) => ({ rowId: row.id, rowLabel: row.label, index, status: 'queued', values: structuredClone(row.values) })),
    summary: { total: variants.length, passed: 0, failed: 0, skipped: 0 }, artifacts: { source: artifact(options.id, 'generated.spec.ts'), manifest: artifact(options.id, 'manifest.json'), directory } };
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(resolve(directory, 'compiled.json'), JSON.stringify({ parent, rows: variants }, null, 2));
  await writeFile(resolve(directory, 'generated.spec.ts'), generatedTestingMatrixSource());
  await writeFile(resolve(directory, 'manifest.json'), JSON.stringify({ runId: options.id, scenarioId: parent.scenarioId, scenarioRevision: parent.scenarioRevision,
    businessFingerprint: parent.fingerprint, approval: parent.approval, matrixRows: variants.map(item => ({ id: item.row.id, label: item.row.label, values: item.row.values })),
    browser: 'Chromium', createdAt: run.startedAt, replay: 'Jede Matrixzeile wird mit eigener Browserinstanz und eigenem Laufzustand ausgeführt.' }, null, 2));
  let publishing=Promise.resolve();
  const publish = () => publishing=publishing.then(async()=>{ run.summary = { total: run.matrixRows!.length, passed: run.matrixRows!.filter(row => row.status === 'passed').length, failed: run.matrixRows!.filter(row => row.status === 'failed').length, skipped: run.matrixRows!.filter(row => row.status === 'skipped').length }; await writeFile(resolve(directory, 'run.json'), JSON.stringify(run, null, 2)); options.onUpdate?.(structuredClone(run)); });
  await publish();
  const exposeRowSteps=(rowId:string,child:TestingRun)=>child.steps.map(step=>({...step,...(step.screenshot?{screenshot:step.screenshot.replace(`/api/testing/runs/${encodeURIComponent(child.id)}/artifacts/`,`/api/testing/runs/${encodeURIComponent(options.id)}/rows/${encodeURIComponent(rowId)}/artifacts/`)}:{})}));
  const exposeRowArtifacts=(rowId:string,child:TestingRun):TestingRun['artifacts']=>child.artifacts&&Object.fromEntries(Object.entries(child.artifacts).map(([key,value])=>[key,typeof value==='string'&&value.startsWith('/api/testing/runs/')?value.replace(`/api/testing/runs/${encodeURIComponent(child.id)}/artifacts/`,`/api/testing/runs/${encodeURIComponent(options.id)}/rows/${encodeURIComponent(rowId)}/artifacts/`):value])) as TestingRun['artifacts'];
  try {
    for (const [index, variant] of variants.entries()) {
      const result = run.matrixRows![index];
      if (options.signal?.aborted) { for (const pending of run.matrixRows!.slice(index)) { pending.status = 'skipped'; pending.error = 'Der Matrixlauf wurde vor dieser Zeile abgebrochen.'; } break; }
      result.status = 'running'; result.startedAt = new Date().toISOString(); await publish();
      const rowStart = Date.now();
      try {
        const child = await executeTestingRun(variant.compiled, { id: `${options.id}-zeile-${String(index + 1).padStart(3, '0')}`, baseURL: options.baseURL, signal: options.signal, observation: { channelId: options.id, parentRunId: options.id, rowId: result.rowId, endWithRun: false }, onUpdate: update => {
          result.status=update.status==='queued'?'running':update.status;result.compiled=update.compiled;result.steps=exposeRowSteps(result.rowId,update);result.error=update.error;result.outputs=update.outputs;result.artifacts=exposeRowArtifacts(result.rowId,update);void publish();
        } });
        result.status = child.status; result.compiled = child.compiled; result.steps = exposeRowSteps(result.rowId,child); result.error = child.error; result.outputs = child.outputs; result.artifacts = exposeRowArtifacts(result.rowId,child);
      } catch (error) { result.status = 'failed'; result.error = error instanceof Error ? error.message : String(error); }
      result.finishedAt = new Date().toISOString(); result.durationMs = Date.now() - rowStart; await publish();
    }
    run.status = run.matrixRows!.length > 0 && run.matrixRows!.every(row => row.status === 'passed') ? 'passed' : 'failed';
    if (run.status === 'failed') run.error = run.matrixRows!.some(row => row.status === 'failed') ? `${run.matrixRows!.filter(row => row.status === 'failed').length} von ${run.matrixRows!.length} Matrixzeilen sind fehlgeschlagen.` : 'Der Matrixlauf wurde abgebrochen.';
    run.finishedAt = new Date().toISOString(); await publish(); return run;
  } finally { endTestingObservation(options.id); }
}

import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, type Browser, type BrowserContext } from '@playwright/test';
import type { CompiledScenario, RunRecord, RunStepEvent } from '../../shared/blocks';
import { createExecutionState, executeCompiledStep } from '../../e2e/helpers/insurance-driver';

export const RUN_ARTIFACTS_ROOT = resolve(process.cwd(), '.local/runs');
// Keep evidence tied to this loaded module when dev:stable survives source edits.
const DRIVER_SOURCE = readFileSync(resolve(process.cwd(), 'e2e/helpers/insurance-driver.ts'), 'utf8');
const DRIVER_SHA256 = createHash('sha256').update(DRIVER_SOURCE).digest('hex');
const IMPLEMENTATION_LOADED_AT = new Date().toISOString();

export interface RunOptions {
  baseURL?: string;
  runId?: string;
  onProgress?: (record: RunRecord) => void | Promise<void>;
  /** Kept as an alias for callers using the first published API contract. */
  onUpdate?: (record: RunRecord) => void | Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function artifactURL(runId: string, filename: string): string {
  return `/api/studio/runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(filename)}`;
}

/** Executes the compiler's saved plan through the actual insurance browser UI. */
export async function runScenario(compiled: CompiledScenario, options: RunOptions = {}): Promise<RunRecord> {
  const runId = options.runId ?? `run-${randomUUID()}`;
  if (!/^[a-zA-Z0-9_-]+$/.test(runId)) throw new Error('Run IDs may contain letters, digits, hyphens, and underscores only.');
  if (!compiled.validation.valid) throw new Error('This scenario must compile successfully before it can run.');
  const baseURL = options.baseURL ?? process.env.FOLIO_APP_URL ?? 'http://127.0.0.1:5173';
  const directory = resolve(RUN_ARTIFACTS_ROOT, runId);
  const started = Date.now();
  const record: RunRecord = {
    id: runId, scenarioId: compiled.scenario.id, scenarioName: compiled.scenario.name,
    scenarioRevision: compiled.scenarioRevision, status: 'running', startedAt: new Date(started).toISOString(),
    compiled: structuredClone(compiled), events: [], objectIds: {}, artifactDirectory: `.local/runs/${runId}`,
    browser: 'Chromium',
  };
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let activeEvent: RunStepEvent | undefined;
  let traceStarted = false;
  const pageErrors: string[] = [];
  const publish = async () => {
    await writeFile(resolve(directory, 'run.json'), JSON.stringify(record, null, 2));
    await (options.onProgress ?? options.onUpdate)?.(structuredClone(record));
  };

  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, 'compiled.json'), JSON.stringify(compiled, null, 2));
  await writeFile(resolve(directory, 'generated.spec.ts'), compiled.generatedSource);
  await writeFile(resolve(directory, 'insurance-driver.ts'), DRIVER_SOURCE);
  await writeFile(resolve(directory, 'implementation.json'), JSON.stringify({
    driverSha256: DRIVER_SHA256, declaredImplementationRevision: compiled.implementationRevision,
    sourcePath: 'e2e/helpers/insurance-driver.ts', moduleLoadedAt: IMPLEMENTATION_LOADED_AT, capturedAt: new Date().toISOString(),
    replay: 'Generated specs import the currently installed compatible helper. This source snapshot records the exact helper used by this run.',
  }, null, 2));
  record.implementationEvidence = { driverSha256: DRIVER_SHA256, source: artifactURL(runId, 'insurance-driver.ts'), manifest: artifactURL(runId, 'implementation.json') };
  await publish();

  try {
    browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
    context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1050 }, locale: 'en-GB', timezoneId: 'Europe/Berlin', reducedMotion: 'reduce' });
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    traceStarted = true;
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    page.setDefaultNavigationTimeout(30_000);
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error' && !/Failed to load resource.*status of 403/.test(message.text())) pageErrors.push(message.text());
    });
    const state = createExecutionState(page, { runId });

    for (const [index, step] of compiled.steps.entries()) {
      const stepStarted = Date.now();
      activeEvent = {
        id: step.id, instanceId: step.instanceId, label: step.label, operation: step.operation,
        actor: step.actor, status: 'running', startedAt: new Date(stepStarted).toISOString(),
      };
      record.events.push(activeEvent);
      await publish();
      const screenshotName = `step-${String(index + 1).padStart(3, '0')}-${step.instanceId.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 90)}.png`;
      await context.tracing.group(`${step.instanceId}: ${step.label}`);
      try {
        const result = await executeCompiledStep(page, step, state);
        if (pageErrors.length) throw new Error(`Uncaught browser error: ${pageErrors.join('; ')}`);
        activeEvent.status = 'passed';
        activeEvent.objectIds = result.objectIds;
        activeEvent.details = result.details;
        record.objectIds = { ...state.objectIds };
      } catch (error) {
        activeEvent.status = 'failed';
        activeEvent.error = errorMessage(error);
        record.status = 'failed';
        record.error = `${step.label}: ${activeEvent.error}`;
        record.objectIds = { ...state.objectIds };
        activeEvent.objectIds = { ...state.objectIds };
      } finally {
        activeEvent.finishedAt = new Date().toISOString();
        activeEvent.durationMs = Date.now() - stepStarted;
        try {
          await page.screenshot({ path: resolve(directory, screenshotName), fullPage: true, animations: 'disabled' });
          activeEvent.screenshot = artifactURL(runId, screenshotName);
          activeEvent.screenshots = [activeEvent.screenshot];
        } catch (error) {
          activeEvent.details = { ...activeEvent.details, screenshotError: errorMessage(error) };
        }
        await context.tracing.groupEnd();
        await publish();
      }

      if (activeEvent.status === 'failed') {
        record.events.push(...compiled.steps.slice(index + 1).map(next => ({
          id: next.id, instanceId: next.instanceId, label: next.label, operation: next.operation,
          actor: next.actor, status: 'skipped' as const, startedAt: new Date().toISOString(),
          error: 'A previous business action failed. This dependent action did not run.',
        })));
        break;
      }
      activeEvent = undefined;
    }
    if (record.status !== 'failed') record.status = 'passed';
  } catch (error) {
    record.status = 'failed';
    record.error = errorMessage(error);
    if (!record.events.length) {
      record.events = compiled.steps.map(step => ({ id: step.id, instanceId: step.instanceId, label: step.label, operation: step.operation, actor: step.actor, status: 'skipped', startedAt: new Date().toISOString(), error: 'The browser could not start this run.' }));
    }
  } finally {
    if (context && traceStarted) {
      try {
        await context.tracing.stop({ path: resolve(directory, 'trace.zip') });
        record.trace = artifactURL(runId, 'trace.zip');
      } catch (error) {
        record.error = [record.error, `Trace could not be saved: ${errorMessage(error)}`].filter(Boolean).join('\n');
      }
    }
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    record.finishedAt = new Date().toISOString();
    record.durationMs = Date.now() - started;
    await publish();
  }

  return record;
}

import { Router, type NextFunction, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { basename, resolve, sep } from 'node:path';
import { existsSync } from 'node:fs';
import { db } from '../store';
import type { RunRecord, Scenario, ScenarioLayout, TextResolution } from '../../shared/blocks';
import { assertScenarioShape, compileScenario, confirmInterpretation, interpretChange, stableJson, StudioError, validateScenario } from './engine';
import { allResolutions, allScenarios, collections, createScenario, dependencyGraph, dependents, duplicateScenario, getCatalog, getResolution, getRun, getScenario, initializeStudio, promoteSelection, publishVersion, saveScenario, scenarioRevisions, upgradeScenario } from './repository';
import { runScenario, RUN_ARTIFACTS_ROOT } from './runner';

type Handler = (req: Request, res: Response, next: NextFunction) => unknown;
const guard = (handler: Handler): Handler => (req, res, next) => { try { const result = handler(req, res, next); if (result && typeof (result as Promise<unknown>).catch === 'function') (result as Promise<unknown>).catch(next); } catch (error) { next(error); } };
function requiredBody(req: Request): Record<string, any> { if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) throw new StudioError('A JSON request body is required.', 400); return req.body; }
const activeRuns = new Set<string>();
export function createStudioRouter(): Router {
  initializeStudio();
  const router = Router();
  router.get('/catalog', guard((_req, res) => res.json(getCatalog())));
  router.get('/scenarios', guard((_req, res) => res.json(allScenarios())));
  router.post('/scenarios', guard((req, res) => res.status(201).json(createScenario(requiredBody(req)))));
  router.get('/scenarios/:id', guard((req, res) => res.json(getScenario(req.params.id))));
  router.put('/scenarios/:id', guard((req, res) => res.json(saveScenario(req.params.id, requiredBody(req) as Scenario))));
  router.post('/scenarios/:id/duplicate', guard((req, res) => res.status(201).json(duplicateScenario(req.params.id, req.body?.name))));
  router.get('/scenarios/:id/revisions', guard((req, res) => res.json(scenarioRevisions(req.params.id))));
  router.get('/scenarios/:id/layout', guard((req, res) => {
    const scenario = getScenario(req.params.id);
    res.json(db.find<ScenarioLayout>(collections.layouts, scenario.id) ?? { id: scenario.id, scenarioId: scenario.id, scenarioRevision: scenario.revision, collapsed: [] });
  }));
  router.put('/scenarios/:id/layout', guard((req, res) => {
    const scenario = getScenario(req.params.id), body = requiredBody(req);
    const layout: ScenarioLayout = { ...body, id: scenario.id, scenarioId: scenario.id, scenarioRevision: Number(body.scenarioRevision) || scenario.revision, collapsed: Array.isArray(body.collapsed) ? body.collapsed.filter((id: unknown) => typeof id === 'string') : [] } as ScenarioLayout;
    res.json(db.upsert(collections.layouts, layout));
  }));
  router.post('/validate', guard((req, res) => res.json(validateScenario(requiredBody(req).scenario, { catalog: getCatalog(), resolutions: allResolutions() }))));
  router.post('/compile', guard((req, res) => res.json(compileScenario(requiredBody(req).scenario, { catalog: getCatalog(), resolutions: allResolutions() }))));
  router.post('/interpret', guard((req, res) => {
    const { scenario, instanceId } = requiredBody(req); assertScenarioShape(scenario);
    const preview = interpretChange(scenario, String(instanceId), getCatalog());
    res.json(db.upsert(collections.resolutions, preview));
  }));
  router.get('/resolutions/:id', guard((req, res) => res.json(getResolution(req.params.id))));
  router.post('/resolutions/:id/confirm', guard((req, res) => {
    const { scenario, instanceId } = requiredBody(req); assertScenarioShape(scenario);
    const confirmed = confirmInterpretation(getResolution(req.params.id), scenario, String(instanceId), getCatalog());
    // Confirmation records are immutable after approval. Reconfirmation returns the same reviewed decision.
    const existing = getResolution(req.params.id);
    res.json(existing.status === 'confirmed' ? existing : db.upsert<TextResolution>(collections.resolutions, confirmed));
  }));
  router.post('/promote', guard((req, res) => res.status(201).json(promoteSelection(requiredBody(req) as any))));
  router.post('/definitions/:id/versions', guard((req, res) => res.status(201).json(publishVersion(req.params.id, requiredBody(req).definition))));
  router.get('/definitions/:id/dependents', guard((req, res) => res.json(dependents(req.params.id))));
  router.post('/scenarios/:id/upgrade', guard((req, res) => { const body = requiredBody(req); res.json(upgradeScenario(req.params.id, String(body.definitionId), Number(body.fromVersion), Number(body.toVersion))); }));
  router.get('/graph', guard((req, res) => res.json(dependencyGraph(typeof req.query.scenarioId === 'string' ? req.query.scenarioId : undefined))));
  router.get('/knowledge/:id', guard((req, res) => { const doc = getCatalog().knowledge.find(item => item.id === req.params.id); if (!doc) throw new StudioError('Knowledge document not found.', 404); res.json(doc); }));
  router.get('/runs', guard((req, res) => res.json(db.read<RunRecord>(collections.runs).filter(run => !req.query.scenarioId || run.scenarioId === req.query.scenarioId).sort((a, b) => b.startedAt.localeCompare(a.startedAt)))));
  router.get('/runs/:id', guard((req, res) => res.json(getRun(req.params.id))));
  router.get('/runs/:id/source', guard((req, res) => { const run = getRun(req.params.id); res.type('text/plain').attachment('generated.spec.ts').send(run.compiled.generatedSource); }));
  router.get('/runs/:id/artifacts/:filename', guard((req, res) => {
    getRun(req.params.id);
    const filename = req.params.filename;
    if (basename(filename) !== filename || !/^[A-Za-z0-9_.-]+$/.test(filename) || !/^run-[A-Za-z0-9-]+$/.test(req.params.id)) throw new StudioError('Invalid artifact path.', 400);
    const directory = resolve(RUN_ARTIFACTS_ROOT, req.params.id), path = resolve(directory, filename);
    if (!path.startsWith(`${directory}${sep}`) || !existsSync(path)) throw new StudioError('Artifact not found.', 404);
    res.sendFile(path);
  }));
  router.post('/runs', guard((req, res) => {
    const body = requiredBody(req);
    let scenario: Scenario;
    if (body.scenario) {
      assertScenarioShape(body.scenario);
      const saved = getScenario(body.scenario.id);
      if (body.scenario.revision !== saved.revision) throw new StudioError('This scenario revision is stale. Reload before running.', 409);
      scenario = stableJson(body.scenario) === stableJson(saved) ? saved : saveScenario(saved.id, body.scenario);
    } else scenario = getScenario(String(body.scenarioId));
    if (db.read<RunRecord>(collections.runs).some(run => run.scenarioId === scenario.id && (run.status === 'queued' || run.status === 'running'))) throw new StudioError('This scenario already has an active run. Wait for it to finish before starting another.', 409);
    if (activeRuns.size >= 2) throw new StudioError('Two browser runs are already active. Start this run after one finishes.', 409);
    const compiled = compileScenario(scenario, { catalog: getCatalog(), resolutions: allResolutions() });
    const run: RunRecord = { id: `run-${randomUUID()}`, scenarioId: scenario.id, scenarioName: scenario.name, scenarioRevision: scenario.revision, status: 'queued', startedAt: new Date().toISOString(), compiled, events: [], objectIds: {} };
    db.upsert(collections.runs, run); activeRuns.add(run.id);
    res.status(202).json(run);
    setImmediate(() => {
      void runScenario(compiled, { runId: run.id, baseURL: process.env.FOLIO_APP_URL ?? 'http://127.0.0.1:5173', onProgress: update => { db.upsert(collections.runs, update); } }).then(result => { db.upsert(collections.runs, result); }).catch(error => { const current = db.find<RunRecord>(collections.runs, run.id) ?? run; db.upsert(collections.runs, { ...current, status: 'failed', finishedAt: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) }); }).finally(() => activeRuns.delete(run.id));
    });
  }));
  router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = error instanceof StudioError ? error.status : 500;
    if (status === 500) console.error('Studio request failed:', error);
    res.status(status).json({ error: error instanceof Error ? error.message : 'Studio request failed.', ...(error instanceof StudioError && error.issues ? { issues: error.issues } : {}) });
  });
  return router;
}

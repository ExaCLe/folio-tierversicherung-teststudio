import { Router, type Request, type Response, type NextFunction } from 'express';
import { basename, resolve, sep } from 'node:path';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import type { TestingAgentJob, TestingApproval, TestingBlockInstance, TestingDefinitionChangeRequest, TestingReuseSuggestion, TestingScenario, TestingScenarioLayout, TestingTechnicalBinding, TestingTechnicalIssue } from '../../shared/testing';
import { currentTestingChildren, currentTestingDefinition, testingVersionKey } from '../../shared/testing';
import { db } from '../store';
import { getTestingCatalog } from './catalog';
import { compileTestingScenario, testingFingerprint } from './compiler';
import { buildTestingGraph, getTestingImpact } from './graph';
import { applyTestingDefinitionChange, approveTestingScenario, getTestingApproval, getTestingLayout, getTestingRun, getTestingScenario, listTestingRuns, listTestingScenarios, previewTestingDefinitionChange, promoteTestingBlocks, saveTestingBinding, saveTestingDefinition, saveTestingKnowledge, saveTestingLayout, saveTestingRun, saveTestingScenario, TestingModelError } from './repository';
import { createStarterBindings } from './bindings/seed';
import { validateTestingBinding } from './bindings/validation';
import { AGENT_ARTIFACTS_ROOT, codexConfiguration } from './agents/cli';
import { applyScenarioEditJob, dismissScenarioEditJob, startScenarioEditJob, cancelTestingJob, getTestingJob, initializeTestingPipeline, listTestingJobs, startBusinessJob, startDirectRun, startReuseJob, startTechnicalJob } from './agents/orchestrator';
import { deriveTestingLifecycle } from './lifecycle';
import { TESTING_RUN_ROOT } from './runner';
import { getTestingAgentSettings, resolveAgentConfiguration, saveTestingAgentSettings } from './agents/settings';
import { generateTestingMatrix, validateTestingMatrix } from './matrix';
import { commandTestingChat, createTestingChatConversation, getTestingChatSnapshot, initializeTestingChat, subscribeTestingChat } from './chat';
import type { TestingChatCommand, TestingChatStreamEvent } from '../../shared/testing-chat';
import { registerTestingObservationRoutes } from './observation';

type Handler = (req: Request, res: Response, next: NextFunction) => unknown;
const guard = (handler: Handler): Handler => (req, res, next) => { try { const result = handler(req, res, next); if (result && typeof (result as Promise<unknown>).catch === 'function') (result as Promise<unknown>).catch(next); } catch (error) { next(error); } };
function body(req: Request): Record<string, any> { if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) throw new TestingModelError('Ein JSON-Objekt als Eingabe ist erforderlich.'); return req.body; }
const revision = (value: unknown) => z.number().int().positive().parse(value);
const model = (value: unknown) => value === undefined ? resolveAgentConfiguration().modelId : z.string().min(1).parse(value);
function sendArtifact(root: string, id: string, name: string, res: Response) {
  if (!/^[a-zA-Z0-9_-]+$/.test(id) || basename(name) !== name || !/^[a-zA-Z0-9_.-]+$/.test(name)) throw new TestingModelError('Ungültiger Nachweispfad.');
  const directory = resolve(root, id), file = resolve(directory, name);
  if (!file.startsWith(`${directory}${sep}`) || !existsSync(file)) throw new TestingModelError('Dieser Nachweis wurde nicht gefunden.', 404);
  if (/\.(?:ts|tsx|js|md|log|jsonl)$/.test(name)) res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.sendFile(file);
}
function reuseContext(jobId: string) {
  const job = getTestingJob(jobId);
  const result = job.result as { runId?: string; suggestions?: TestingReuseSuggestion[] } | undefined;
  if (job.phase !== 'reuse' || job.status !== 'completed' || !result?.runId) throw new TestingModelError('Es liegt kein abgeschlossener Wiederverwendungsvorschlag vor.', 409);
  const run = getTestingRun(result.runId);
  if (run.status !== 'passed') throw new TestingModelError('Nur ein belegter erfolgreicher Lauf kann Wiederverwendung begründen.', 409);
  return { job, result, run };
}
export function createTestingRouter(): Router {
  initializeTestingPipeline();
  initializeTestingChat();
  for (const binding of createStarterBindings(getTestingCatalog())) saveTestingBinding(binding);
  const router = Router();
  registerTestingObservationRoutes(router);
  router.post('/chat/conversations',guard((req,res)=>{const input=body(req);res.status(input.message?202:200).json(createTestingChatConversation({message:z.string().trim().min(5).max(15_000).optional().parse(input.message),model:model(input.model),scenarioId:z.string().optional().parse(input.scenarioId),requestId:z.string().min(1).max(200).parse(input.requestId)}));}));
  router.get('/chat/conversations/:id',guard((req,res)=>res.json(getTestingChatSnapshot(req.params.id))));
  router.post('/chat/conversations/:id/commands',guard((req,res)=>{const input=body(req);res.status(202).json(commandTestingChat(req.params.id,{command:z.enum(['message','explore','resume','revise','save','apply','reject','approve','prepare','run','cancel']).parse(input.command) as TestingChatCommand,expectedRevision:z.number().int().positive().parse(input.expectedRevision),requestId:z.string().min(1).max(200).parse(input.requestId),payload:z.record(z.unknown()).optional().parse(input.payload)}));}));
  router.get('/chat/conversations/:id/events',guard((req,res)=>{
    const snapshot=getTestingChatSnapshot(req.params.id);res.status(200);res.setHeader('Content-Type','text/event-stream');res.setHeader('Cache-Control','no-cache, no-transform');res.setHeader('Connection','keep-alive');res.flushHeaders();
    const send=(event:TestingChatStreamEvent)=>{res.write(`id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);};
    send({type:'snapshot',sequence:snapshot.conversation.eventSequence,revision:snapshot.conversation.revision,snapshot});
    const unsubscribe=subscribeTestingChat(req.params.id,send),heartbeat=setInterval(()=>res.write(': keep-alive\n\n'),25_000);
    req.on('close',()=>{clearInterval(heartbeat);unsubscribe();});
  }));
  router.get('/bootstrap', guard((_req, res) => {
    const catalog=getTestingCatalog(),scenarios=listTestingScenarios(),jobs=listTestingJobs(),runs=listTestingRuns(),approvals=db.read<TestingApproval>('testingApprovals');
    const latestApprovals=new Map([...approvals].sort((a,b)=>a.approvedAt.localeCompare(b.approvedAt)).map(approval=>[approval.scenarioId,approval]));
    return res.json({catalog,scenarios,jobs,runs,lifecycles:scenarios.map(scenario=>deriveTestingLifecycle(scenario,catalog,jobs,runs,latestApprovals.get(scenario.id))),approvals,layouts:db.read<TestingScenarioLayout>('testingLayouts'),cli:codexConfiguration(),settings:getTestingAgentSettings()});
  }));
  router.get('/settings', guard((_req, res) => res.json(getTestingAgentSettings())));
  router.put('/settings', guard((req, res) => res.json(saveTestingAgentSettings(body(req)))));
  router.get('/catalog', guard((_req, res) => res.json(getTestingCatalog())));
  router.get('/scenarios', guard((_req, res) => res.json(listTestingScenarios())));
  router.get('/scenarios/:id', guard((req, res) => res.json(getTestingScenario(req.params.id))));
  router.put('/scenarios/:id', guard((req, res) => {
    const input = body(req), { expectedRevision, ...rest } = input.scenario ?? input;
    const scenario = { ...rest, id: req.params.id } as TestingScenario;
    res.json(saveTestingScenario(scenario, input.expectedRevision ?? expectedRevision ?? scenario.revision));
  }));
  router.get('/scenarios/:id/lifecycle',guard((req,res)=>res.json(deriveTestingLifecycle(getTestingScenario(req.params.id),getTestingCatalog(),listTestingJobs(),listTestingRuns(),getTestingApproval(req.params.id)))));
  router.post('/scenarios/:id/plan',guard((req,res)=>{const input=body(req),scenario=getTestingScenario(req.params.id);res.status(202).json(startBusinessJob({scenarioId:scenario.id,revision:revision(input.revision),request:scenario.intent,model:model(input.model)}));}));
  router.get('/scenarios/:id/compile', guard((req, res) => res.json(compileTestingScenario(getTestingScenario(req.params.id), getTestingCatalog(), getTestingApproval(req.params.id)))));
  router.post('/scenarios/:id/matrix/generate', guard((req, res) => {
    const input = body(req), scenario = getTestingScenario(req.params.id);
    if (scenario.revision !== revision(input.revision)) throw new TestingModelError('Der Testfall wurde zwischenzeitlich geändert. Lade die aktuelle Fassung vor der Matrixerzeugung.', 409, 'REVISION_CONFLICT');
    const columns = z.array(z.object({ id: z.string(), label: z.string(), target: z.object({ blockPath: z.string(), inputPath: z.string() }).strict(), role:z.enum(['input','expectation']).optional(), type: z.enum(['text','number','money','boolean','date','choice','object','list','customer-ref','farm-ref','animal-ref','proposal-ref','referral-ref','contract-ref','policy-ref','document-ref']), values: z.array(z.unknown()) }).strict()).min(1).max(20, 'Eine Testmatrix darf höchstens 20 Spalten enthalten.').parse(input.columns) as any;
    const matrix = generateTestingMatrix(columns,scenario,getTestingCatalog()), candidate = { ...scenario, matrix };
    const issues = validateTestingMatrix(candidate, getTestingCatalog());
    const blocking=issues.filter(issue=>issue.code!=='MATRIX_VALUE_MISSING');
    if (blocking.length) throw new TestingModelError(blocking.map(issue => issue.message).join(' '), 400, 'MATRIX_INVALID');
    res.json({ matrix, issues });
  }));
  router.post('/scenarios/:id/approve', guard((req, res) => res.json(approveTestingScenario(req.params.id, revision(body(req).revision), 'Fachliche Prüfung durch den Menschen', body(req).comment))));
  router.get('/scenarios/:id/layout', guard((req, res) => { getTestingScenario(req.params.id); res.json(getTestingLayout(req.params.id)); }));
  router.put('/scenarios/:id/layout', guard((req, res) => { getTestingScenario(req.params.id); const input = body(req); res.json(saveTestingLayout({ ...input, id: req.params.id, scenarioId: req.params.id, collapsed: z.array(z.string()).parse(input.collapsed ?? []) } as TestingScenarioLayout)); }));
  router.post('/scenarios/:id/interpret-override', guard((req, res) => { const input = body(req); res.status(202).json(startBusinessJob({ scenarioId: req.params.id, revision: revision(input.revision), instanceId: z.string().parse(input.instanceId), request: input.text, model: model(input.model) })); }));
  router.post('/scenarios/:id/interpret-revision', guard((req, res) => { const input = body(req); res.status(202).json(startScenarioEditJob({ scenarioId: req.params.id, revision: revision(input.revision), text: input.text, model: model(input.model) })); }));
  router.post('/scenarios/:scenarioId/jobs/:id/revise-unsupported', guard((req, res) => {
    const input = body(req), source = getTestingJob(req.params.id);
    const result = source.result as { repairContext?: { scenarioId?: string; scenarioRevision?: number; fingerprint?: string; issues?: (string | TestingTechnicalIssue)[] } } | undefined;
    if (source.phase !== 'technical' || source.status !== 'completed' || source.scenarioId !== req.params.scenarioId || result?.repairContext?.scenarioId !== req.params.scenarioId || !result.repairContext.scenarioRevision) throw new TestingModelError('Dieser Auftrag enthält für den angegebenen Testfall keine technische Lücke zur fachlichen Überarbeitung.', 409);
    const index = z.number().int().nonnegative().parse(input.issueIndex ?? 0), issue = result.repairContext.issues?.[index];
    const instruction = z.string().trim().min(3).max(15_000).optional().parse(input.instruction);
    if (!issue || typeof issue === 'string' || issue.kind !== 'business-contract' || !issue.suggestedBusinessRevision) throw new TestingModelError('Diese technische Meldung enthält keinen fachlichen Überarbeitungsvorschlag.', 409);
    const scenario = getTestingScenario(result.repairContext.scenarioId);
    const context = `Technische Prüfung ${source.id} für Revision ${result.repairContext.scenarioRevision} mit Fingerprint ${result.repairContext.fingerprint}: ${issue.summary}\nBetroffene Blockpfade: ${issue.blockPaths.join(', ')}\nBetroffene Definitionen: ${issue.affectedDefinitionRefs.map(ref => `${ref.id}@${ref.version}`).join(', ')}\nBetroffene Eingaben: ${issue.affectedInputKeys.join(', ') || 'keine'}\nGewünschte fachliche Überarbeitung: ${issue.suggestedBusinessRevision}${instruction ? `\nZusätzliche Anweisung des Menschen: ${instruction}` : ''}\nErstelle den Änderungsvorschlag gegen die aktuelle gespeicherte Revision ${scenario.revision}; übernimm die historische technische Meldung nicht ungeprüft, falls sich der Ablauf inzwischen geändert hat.`;
    res.status(202).json(startScenarioEditJob({ scenarioId: scenario.id, revision: scenario.revision, text: context, model: model(input.model) }));
  }));
  router.post('/scenarios/:id/run', guard((req, res) => { const input = body(req); res.status(202).json(startDirectRun({ scenarioId: req.params.id, revision: revision(input.revision), ...(input.model ? { model: model(input.model) } : {}) })); }));
  router.post('/definitions', guard((req, res) => res.status(201).json(saveTestingDefinition(body(req).definition,body(req).newKnowledge??[]))));
  router.post('/definitions/change-preview', guard((req, res) => res.json(previewTestingDefinitionChange(body(req) as unknown as TestingDefinitionChangeRequest))));
  router.post('/definitions/change-apply', guard((req, res) => res.json(applyTestingDefinitionChange(body(req) as unknown as TestingDefinitionChangeRequest & {previewId:string}))));
  router.post('/knowledge', guard((req, res) => res.status(201).json(saveTestingKnowledge(body(req).document))));
  router.post('/bindings', guard((req, res) => res.status(201).json(saveTestingBinding(validateTestingBinding(body(req).binding, getTestingCatalog())))));
  router.get('/bindings/:id/impact', guard((req, res) => res.json(getTestingImpact(req.params.id))));
  router.get('/definitions/:id/impact', guard((req, res) => {
    const catalog = getTestingCatalog();
    const definition = currentTestingDefinition(catalog, req.params.id);
    const binding = definition?.bindingId ?? catalog.bindings.find(item => item.definitionRefs.some(ref => ref.id === req.params.id))?.id ?? req.params.id;
    res.json(getTestingImpact(binding));
  }));
  router.get('/graph', guard((_req, res) => res.json(buildTestingGraph())));
  router.get('/jobs', guard((_req, res) => res.json(listTestingJobs())));
  router.get('/jobs/:id', guard((req, res) => res.json(getTestingJob(req.params.id))));
  router.post('/jobs/:id/apply-revision', guard((req, res) => { const input = body(req); res.json(applyScenarioEditJob({ jobId: req.params.id, expectedRevision: revision(input.expectedRevision), fingerprint: z.string().min(1).parse(input.fingerprint) })); }));
  router.post('/jobs/:id/dismiss-revision', guard((req, res) => res.json(dismissScenarioEditJob(req.params.id))));
  router.post('/jobs/:id/cancel', guard((req, res) => res.json(cancelTestingJob(req.params.id))));
  router.post('/jobs/:id/resolve-duplicates', guard((req, res) => {
    const job = getTestingJob(req.params.id), input = body(req);
    const result = job.result as { needsBusinessReview?: boolean; duplicateDecisions?: { proposed: { id: string; version: string }; chosen: { id: string; version: string } | null; decision: string; compatible: boolean }[] } | undefined;
    if (job.phase !== 'technical' || job.status !== 'completed' || !job.scenarioId || !result?.needsBusinessReview) throw new TestingModelError('Dieser Agentenlauf enthält keine auflösbare Dublettenprüfung.', 409);
    const scenario = getTestingScenario(job.scenarioId), catalog = getTestingCatalog();
    if (scenario.revision !== job.scenarioRevision || testingFingerprint(scenario, catalog) !== job.fingerprint) throw new TestingModelError('Der Fachentwurf hat sich seit der Dublettenprüfung geändert. Bitte die Prüfung erneut starten.', 409);
    const choices = z.array(z.object({ proposed: z.object({ id: z.string(), version: z.string() }), chosen: z.object({ id: z.string(), version: z.string() }) })).min(1).parse(input.choices);
    for (const choice of choices) if (!result.duplicateDecisions?.some(item => item.decision === 'reuse' && item.compatible && item.proposed.id === choice.proposed.id && item.proposed.version === choice.proposed.version && item.chosen?.id === choice.chosen.id && item.chosen.version === choice.chosen.version)) throw new TestingModelError('Dieser Ersatz wurde nicht als fachlich gleichwertiger Kandidat geprüft.');
    function replace(blocks: TestingBlockInstance[], active: string[] = []): { blocks: TestingBlockInstance[]; changed: boolean } {
      let changed = false;
      const next = blocks.map(block => {
        const choice = choices.find(item => item.proposed.id === block.definition.id);
        if (choice) { changed = true; return { ...block, definition: choice.chosen }; }
        const definition = currentTestingDefinition(catalog,block.definition);
        const key = definition ? testingVersionKey(definition) : block.definition.id;
        if (active.includes(key)) return block;
        const nested = replace(currentTestingChildren(block,catalog), [...active, key]);
        if (!nested.changed) return block;
        changed = true; return { ...block,definition:definition?{id:definition.id,version:definition.version}:block.definition, children: nested.blocks };
      });
      return { blocks: next, changed };
    }
    const replaced = replace(scenario.blocks);
    if (!replaced.changed) throw new TestingModelError('Die ausgewählte Definition wird im aktuellen Ablauf nicht verwendet.');
    const updated = { ...scenario, blocks: replaced.blocks };
    const checked = compileTestingScenario(updated, catalog);
    if (!checked.valid) throw new TestingModelError(`Der Ersatz erzeugt noch fachliche Fehler: ${checked.issues.filter(item => item.severity === 'error').map(item => item.message).join(' ')}`);
    const saved = saveTestingScenario(updated, scenario.revision);
    res.json({ scenario: saved, compiled: compileTestingScenario(saved, getTestingCatalog()), requiresApproval: true });
  }));
  router.post('/jobs/business', guard((req, res) => { const input = body(req); res.status(202).json(startBusinessJob({ request: input.request, model: model(input.model) })); }));
  router.post('/jobs/technical', guard((req, res) => { const input = body(req); res.status(202).json(startTechnicalJob({ scenarioId: z.string().parse(input.scenarioId), revision: revision(input.revision), model: model(input.model), ...(input.repairBindingId ? { repairBindingId: z.string().parse(input.repairBindingId) } : {}) })); }));
  router.get('/jobs/:id/artifacts/:filename', guard((req, res) => { getTestingJob(req.params.id); sendArtifact(AGENT_ARTIFACTS_ROOT, req.params.id, req.params.filename, res); }));
  router.get('/jobs/:id/attempts', guard((req, res) => { getTestingJob(req.params.id); res.json(['original', 'correction'].filter(attempt => existsSync(resolve(AGENT_ARTIFACTS_ROOT, `${req.params.id}${attempt === 'correction' ? '-korrektur' : ''}`, 'manifest.json'))).map(attempt => ({ attempt, manifest: `/api/testing/jobs/${req.params.id}/attempts/${attempt}/artifacts/manifest.json`, prompt: `/api/testing/jobs/${req.params.id}/attempts/${attempt}/artifacts/prompt.md`, result: `/api/testing/jobs/${req.params.id}/attempts/${attempt}/artifacts/result.json` }))); }));
  router.get('/jobs/:id/attempts/:attempt/artifacts/:filename', guard((req, res) => { getTestingJob(req.params.id); const attempt = z.enum(['original', 'correction']).parse(req.params.attempt); sendArtifact(AGENT_ARTIFACTS_ROOT, `${req.params.id}${attempt === 'correction' ? '-korrektur' : ''}`, req.params.filename, res); }));
  router.get('/runs', guard((_req, res) => res.json(listTestingRuns())));
  router.post('/runs/:id/reuse', guard(async (req, res) => res.status(202).json(await startReuseJob({ runId: req.params.id, model: model(body(req).model) }))));
  router.get('/runs/:id', guard((req, res) => res.json(getTestingRun(req.params.id))));
  router.get('/runs/:id/rows/:rowId/artifacts/:filename', guard((req, res) => {
    const run=getTestingRun(req.params.id),row=run.matrixRows?.find(item=>item.rowId===req.params.rowId);
    if(!row)throw new TestingModelError('Diese Matrixzeile gehört nicht zu diesem Testlauf.',404,'RUN_ROW_NOT_FOUND');
    const childId=`${run.id}-zeile-${String(row.index+1).padStart(3,'0')}`;sendArtifact(TESTING_RUN_ROOT,childId,req.params.filename,res);
  }));
  router.get('/runs/:id/artifacts/:filename', guard((req, res) => { getTestingRun(req.params.id); sendArtifact(TESTING_RUN_ROOT, req.params.id, req.params.filename, res); }));
  router.post('/reuse/:id/dismiss', guard((req, res) => {
    const context = reuseContext(req.params.id); const ids = z.array(z.string()).parse(body(req).proposalIds);
    const suggestions = (context.run.reuseSuggestions ?? []).map(item => ids.includes(item.id) && item.status === 'suggested' ? { ...item, status: 'dismissed' as const } : item);
    saveTestingRun({ ...context.run, reuseSuggestions: suggestions });
    db.upsert<TestingAgentJob>('testingAgentJobs', { ...context.job, result: { ...context.result, suggestions } }); res.json({ suggestions });
  }));
  router.post('/reuse/:id/accept', guard((req, res) => {
    const context = reuseContext(req.params.id), input = body(req); const ids = z.array(z.string()).length(1, 'Bitte jeden Wiederverwendungsvorschlag einzeln fachlich prüfen und annehmen.').parse(input.proposalIds);
    const scenario = getTestingScenario(context.run.scenarioId);
    if (scenario.revision !== context.run.scenarioRevision || testingFingerprint(scenario, getTestingCatalog()) !== context.run.compiled.fingerprint) throw new TestingModelError('Der Testfall wurde seit dem erfolgreichen Lauf verändert. Bitte diese Fassung erneut prüfen und ausführen, bevor der Vorschlag übernommen wird.', 409, 'REUSE_STALE');
    const selected = (context.run.reuseSuggestions ?? []).filter(item => ids.includes(item.id));
    if (selected.length !== ids.length || selected.some(item => item.status !== 'suggested' || item.fingerprint !== context.run.compiled.fingerprint)) throw new TestingModelError('Ein Vorschlag fehlt, wurde bereits entschieden oder gehört zu einem anderen Fachstand.', 409);
    const definitions = [];
    for (const suggestion of selected) {
      const edit = Array.isArray(input.edits) ? input.edits.find((item: any) => item.id === suggestion.id) : undefined;
      const acceptedParameters = edit?.parameters ?? suggestion.parameters;
      const promoted = promoteTestingBlocks({ scenarioId: scenario.id, expectedRevision: scenario.revision, instanceIds: suggestion.instanceIds,
        parentPath: suggestion.parentPath,
        name: typeof edit?.name === 'string' && edit.name.trim() ? edit.name.trim() : suggestion.name, description: suggestion.reason, parameters: acceptedParameters, replaceSelection: false });
      suggestion.status = 'accepted'; suggestion.name = promoted.definition.name; suggestion.parameters = structuredClone(acceptedParameters);
      suggestion.definitionRef = { id: promoted.definition.id, version: promoted.definition.version }; definitions.push(promoted.definition);
    }
    const suggestions = (context.run.reuseSuggestions ?? []).map(item => selected.find(value => value.id === item.id) ?? item);
    saveTestingRun({ ...context.run, reuseSuggestions: suggestions });
    db.upsert<TestingAgentJob>('testingAgentJobs', { ...context.job, result: { ...context.result, suggestions } }); res.json({ definitions, suggestions });
  }));
  router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = error instanceof TestingModelError ? error.status : error instanceof z.ZodError ? 400 : 500;
    if (status === 500) console.error('Teststudio-Anfrage fehlgeschlagen:', error);
    res.status(status).json({ error: error instanceof z.ZodError ? `Die Eingabe entspricht nicht dem Datenvertrag: ${error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ')}` : error instanceof Error ? error.message : 'Die Anfrage ist fehlgeschlagen.', code: error instanceof TestingModelError ? error.code : 'TESTING_ERROR' });
  });
  return router;
}

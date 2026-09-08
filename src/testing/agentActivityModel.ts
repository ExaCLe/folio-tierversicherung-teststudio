import type { TestingAgentEvent, TestingAgentJob, TestingAgentWorkStage } from '../../shared/testing';

export type ActivityStageState = 'waiting' | 'running' | 'completed' | 'skipped' | 'failed';
export interface ActivityStage { id: string; label: string; state: ActivityStageState; job?: TestingAgentJob; summary?: string }
type TrackedJob = TestingAgentJob;
export const stageLabels: Record<string, string> = { naming: 'Test benennen', knowledge: 'Fachwissen prüfen', exploring: 'Die Anwendung erkunden', planning: 'Den Ablauf entwerfen', validating: 'Entwurf prüfen', duplicates: 'Bausteine vergleichen', wiring: 'Technische Schritte vorbereiten', running: 'Den Test im Portal ausführen', reuse: 'Wiederverwendung untersuchen' };
export const phaseLabels: Record<string, string> = { naming: 'Test benennen', business: 'Fachlichen Ablauf entwerfen', duplicates: 'Bausteine vergleichen', technical: 'Technik vorbereiten und prüfen', reuse: 'Wiederverwendung untersuchen', exploration: 'Wissen und Anwendung erkunden' };
export const isWorking = (job?: TestingAgentJob) => !!job && ['running', 'queued'].includes(job.status);
export function meaningfulExplanation(message?: string): string | undefined {
  if (!message?.trim() || /^[\s]*[\[{]/.test(message) || /^(?:Codex-Sitzung|Claude-Code-Sitzung|Der Agent bearbeitet den Auftrag|Codex hat ein Ergebnis geliefert|Claude Code hat sein strukturiertes Ergebnis|Der Agent hat sein strukturiertes Ergebnis|Browserbeobachtung\s*\d+|Beobachtung\s*\d+|Wartet auf einen der zwei lokalen Agentenplätze)/i.test(message)) return;
  return message;
}
export function publicEvents(job: TestingAgentJob): TestingAgentEvent[] {
  return job.events.filter(event => ['status', 'message'].includes(event.kind) && meaningfulExplanation(event.message));
}
export function waitsForAgent(job: TestingAgentJob) {
  const state = job.events.filter(event => event.kind === 'status' && (event.message === 'Wartet auf einen der zwei lokalen Agentenplätze.' || /^(?:Codex-Sitzung gestartet\.|Claude-Code-Sitzung|Der Agent bearbeitet den Auftrag\.)/.test(event.message))).at(-1);
  return job.status === 'running' && state?.message === 'Wartet auf einen der zwei lokalen Agentenplätze.';
}
function record(job: TrackedJob | undefined, stage: string): TestingAgentWorkStage | undefined { return job?.workStages?.find(item => item.stage === stage); }
function stage(id: string, job: TrackedJob | undefined, fallback: ActivityStageState): ActivityStage {
  const saved = record(job, id);
  const reported = saved?.status === 'running' && job?.status !== 'running' ? currentState(job) : saved?.status ?? fallback;
  const state = reported === 'running' && job && waitsForAgent(job) ? 'waiting' : reported;
  return { id, label: stageLabels[id] ?? phaseLabels[id] ?? 'Auftrag prüfen', state, job, summary: saved?.summary };
}
function currentState(job?: TestingAgentJob): ActivityStageState { return job?.status === 'queued' ? 'waiting' : job?.status === 'running' ? 'running' : job?.status === 'completed' ? 'completed' : job ? 'failed' : 'waiting'; }
export function activityModel(job: TrackedJob, related: TrackedJob[]) {
  const children = related.filter(item => item.id !== job.id);
  const exploration = children.find(item => item.phase === 'exploration');
  const duplicates = children.find(item => item.phase === 'duplicates');
  const running = [job, ...children].some(isWorking);
  const business = job.phase === 'business';
  const technical = job.phase === 'technical';
  let stages: ActivityStage[];
  if (business) {
    const result = exploration?.result as { explored?: boolean } | undefined;
    const childState = currentState(exploration);
    const childPastKnowledge = exploration?.stage === 'exploring' || exploration?.status === 'completed';
    const outcome = job.result as { needsKnowledge?: boolean; scenario?: unknown; draft?: unknown } | undefined;
    const parentFinished = job.status === 'completed' && !running && !outcome?.needsKnowledge && !!(outcome?.scenario || outcome?.draft);
    stages = [
      ...(children.some(item => item.phase === 'naming') || record(job, 'naming') ? [stage('naming', children.find(item => item.phase === 'naming') ?? job, 'waiting')] : []),
      stage('knowledge', exploration ?? job, childPastKnowledge ? 'completed' : exploration ? childState : job.stage === 'knowledge' ? currentState(job) : 'waiting'),
      stage('exploring', exploration, result?.explored === false ? 'skipped' : exploration?.stage === 'exploring' ? childState : result?.explored ? 'completed' : 'waiting'),
      stage('planning', job, parentFinished ? 'completed' : job.stage === 'planning' ? currentState(job) : 'waiting'),
      stage('validating', job, parentFinished ? 'completed' : job.stage === 'validating' ? currentState(job) : 'waiting'),
    ];
  } else if (technical) {
    stages = [stage('wiring', job, job.stage === 'wiring' ? currentState(job) : 'waiting'), stage('duplicates', duplicates, currentState(duplicates))];
    stages.push(stage('running', job, job.stage === 'running' ? currentState(job) : 'waiting'));
    const reuse = children.find(item => item.phase === 'reuse');
    if (reuse) stages.push({ ...stage('reuse', reuse, currentState(reuse)), label: 'Wiederverwendung untersuchen (optional)' });
  } else stages = [stage(job.stage ?? job.phase, job, currentState(job))];
  // An orchestrating parent is not another model invocation. Count stage owners,
  // and exclude local validation/browser execution from the model count.
  const active = stages.filter(item => item.state === 'running' && item.job?.status === 'running' && !['validating', 'running'].includes(item.id));
  const activeJobs = [...new Map(active.map(item => [item.job!.id, item.job!])).values()];
  const current = stages.filter(item => item.state === 'running');
  const heading = current.length > 1 ? 'Mehrere Prüfungen laufen gleichzeitig' : current[0]?.label ?? (job.stage && stageLabels[job.stage]) ?? phaseLabels[job.phase];
  const records = [...new Map([...children, job].map(item => [item.id, item])).values()];
  const events = records.flatMap(item => publicEvents(item).map(event => ({ ...event, source: phaseLabels[item.phase] ?? item.phase })))
    .filter((event, index, all) => all.findIndex(other => other.id === event.id || other.at === event.at && other.kind === event.kind && other.message === event.message) === index)
    .sort((a, b) => a.at.localeCompare(b.at));
  const tools = records.flatMap(item => item.events.filter(event => event.kind === 'tool'));
  const toolCount = tools.filter((event, index) => tools.findIndex(other => other.id === event.id || other.at === event.at && other.message === event.message) === index).length;
  const waitingAgents = new Set(stages.filter(item => item.job && waitsForAgent(item.job) && item.state === 'waiting').map(item => item.job!.id)).size;
  return { running, stages, waitingAgents, activeJobs, current, heading, events, toolCount, completed: stages.filter(item => item.state === 'completed').length, skipped: stages.filter(item => item.state === 'skipped').length };
}

export function branchEvents(job: TestingAgentJob, related: TestingAgentJob[], stageId?: string) {
  const children = related.filter(item => item.id !== job.id && item.parentJobId === job.id);
  const childEvents = children.flatMap(item => item.events);
  const interval = job.workStages?.find(item => item.stage === stageId);
  return publicEvents(job).filter(event =>
    (!interval?.startedAt || event.at >= interval.startedAt) && (!interval?.finishedAt || event.at <= interval.finishedAt) &&
    !(children.some(child => child.phase === 'duplicates') && event.message.startsWith('Dublettenprüfung:')) &&
    !childEvents.some(child => child.id === event.id || child.at === event.at && child.message === event.message));
}

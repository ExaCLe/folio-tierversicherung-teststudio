import type { TestingAgentEvent, TestingAgentJob, TestingAgentWorkStage } from '../../shared/testing';
import { normalizeTestingWorkStages } from '../../shared/testing-work-stages';

export type ActivityStageState = 'waiting' | 'running' | 'completed' | 'skipped' | 'failed';
export interface ActivityStage {
  key: string;
  id: string;
  label: string;
  state: ActivityStageState;
  attempt: number;
  job?: TestingAgentJob;
  summary?: string;
  workStage?: TestingAgentWorkStage;
}
type TrackedJob = TestingAgentJob;
export const stageLabels: Record<string, string> = { naming: 'Test benennen', knowledge: 'Fachwissen prüfen', exploring: 'Die Anwendung erkunden', planning: 'Den Ablauf entwerfen', validating: 'Entwurf prüfen', revising: 'Den Ablauf überarbeiten', duplicates: 'Bausteine vergleichen', wiring: 'Technische Schritte vorbereiten', running: 'Den Test im Portal ausführen', reuse: 'Wiederverwendung untersuchen' };
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
function currentState(job?: TestingAgentJob): ActivityStageState { return job?.status === 'queued' ? 'waiting' : job?.status === 'running' ? 'running' : job?.status === 'completed' ? 'completed' : job ? 'failed' : 'waiting'; }
function records(job?: TrackedJob, ids?: string[]) {
  const history = normalizeTestingWorkStages(job?.workStages ?? []);
  return ids ? history.filter(item => ids.includes(item.stage)) : history;
}
function attemptLabel(id: string, attempt: number) {
  const label = stageLabels[id] ?? phaseLabels[id] ?? 'Auftrag prüfen';
  return attempt > 1 ? `${label} · Überarbeitung${attempt > 2 ? ` ${attempt - 1}` : ''}` : label;
}
function activityStage(id: string, job: TrackedJob | undefined, fallback: ActivityStageState, workStage?: TestingAgentWorkStage): ActivityStage {
  const attempt = workStage?.attempt ?? 1;
  const reported = workStage?.status === 'running' && job?.status !== 'running' ? currentState(job) : workStage?.status ?? fallback;
  const state = reported === 'running' && job && waitsForAgent(job) ? 'waiting' : reported;
  return { key: `${job?.id ?? 'pending'}:${id}:${workStage ? attempt : 'pending'}`, id, label: attemptLabel(id, attempt), state, attempt, job, summary: workStage?.summary, workStage };
}
function historyStages(job: TrackedJob | undefined, history: TestingAgentWorkStage[]) {
  return history.map(item => activityStage(item.stage, job, currentState(job), item));
}
function businessStages(job: TrackedJob, children: TrackedJob[], running: boolean) {
  const naming = children.find(item => item.phase === 'naming');
  const exploration = children.find(item => item.phase === 'exploration');
  const parentHistory = records(job);
  const namingHistory = records(naming, ['naming']);
  const explorationHistory = records(exploration, ['knowledge', 'exploring']);
  const parentExplorationHistory = parentHistory.filter(item => ['knowledge', 'exploring'].includes(item.stage));
  const result = exploration?.result as { explored?: boolean } | undefined;
  const outcome = job.result as { needsKnowledge?: boolean; scenario?: unknown; draft?: unknown } | undefined;
  const parentFinished = job.status === 'completed' && !running && !outcome?.needsKnowledge && !!(outcome?.scenario || outcome?.draft);
  const stages: ActivityStage[] = [];

  const effectiveNaming = namingHistory.length ? namingHistory : parentHistory.filter(item => item.stage === 'naming');
  if (naming || effectiveNaming.length) stages.push(...(effectiveNaming.length ? historyStages(naming ?? job, effectiveNaming) : [activityStage('naming', naming, currentState(naming))]));

  const effectiveExploration = explorationHistory.length ? explorationHistory : parentExplorationHistory;
  const knowledgeHistory = effectiveExploration.filter(item => item.stage === 'knowledge');
  const childPastKnowledge = exploration?.stage === 'exploring' || exploration?.status === 'completed';
  stages.push(...(knowledgeHistory.length ? historyStages(exploration ?? job, knowledgeHistory) : [activityStage('knowledge', exploration ?? job, childPastKnowledge ? 'completed' : exploration ? currentState(exploration) : job.stage === 'knowledge' ? currentState(job) : 'waiting')]));

  const exploringHistory = effectiveExploration.filter(item => item.stage === 'exploring');
  stages.push(...(exploringHistory.length ? historyStages(exploration ?? job, exploringHistory) : [activityStage('exploring', exploration, result?.explored === false ? 'skipped' : exploration?.stage === 'exploring' ? currentState(exploration) : result?.explored ? 'completed' : 'waiting')]));

  const designHistory = parentHistory.filter(item => item.stage === 'planning' || item.stage === 'validating');
  if (designHistory.length) {
    stages.push(...historyStages(job, designHistory));
    if (!designHistory.some(item => item.stage === 'validating')) stages.push(activityStage('validating', job, job.stage === 'validating' ? currentState(job) : 'waiting'));
  } else {
    stages.push(activityStage('planning', job, parentFinished || job.stage === 'validating' ? 'completed' : job.stage === 'planning' ? currentState(job) : 'waiting'));
    stages.push(activityStage('validating', job, parentFinished ? 'completed' : job.stage === 'validating' ? currentState(job) : 'waiting'));
  }
  return stages;
}
function technicalStages(job: TrackedJob, children: TrackedJob[]) {
  const duplicates = children.find(item => item.phase === 'duplicates');
  const reuse = children.find(item => item.phase === 'reuse');
  const parentHistory = records(job, ['wiring', 'running']);
  const duplicateHistory = records(duplicates, ['duplicates']);
  const reuseHistory = records(reuse, ['reuse']);
  const rank: Record<string, number> = { wiring: 0, duplicates: 1, running: 2, reuse: 3 };
  const actual = [
    ...parentHistory.map((item, index) => ({ item, owner: job, index })),
    ...duplicateHistory.map((item, index) => ({ item, owner: duplicates!, index })),
    ...reuseHistory.map((item, index) => ({ item, owner: reuse!, index })),
  ].sort((a, b) => a.item.startedAt && b.item.startedAt ? a.item.startedAt.localeCompare(b.item.startedAt) : (rank[a.item.stage] - rank[b.item.stage]) || a.index - b.index);
  const stages = actual.map(({ item, owner }) => activityStage(item.stage, owner, currentState(owner), item));
  if (!parentHistory.some(item => item.stage === 'wiring')) stages.unshift(activityStage('wiring', job, job.stage === 'wiring' ? currentState(job) : 'waiting'));
  if (!duplicateHistory.length) stages.splice(Math.min(1, stages.length), 0, activityStage('duplicates', duplicates, currentState(duplicates)));
  if (!parentHistory.some(item => item.stage === 'running')) stages.push(activityStage('running', job, job.stage === 'running' ? currentState(job) : 'waiting'));
  if (reuse && !reuseHistory.length) stages.push({ ...activityStage('reuse', reuse, currentState(reuse)), label: 'Wiederverwendung untersuchen (optional)' });
  for (const stage of stages) if (stage.id === 'reuse' && !stage.label.includes('(optional)')) stage.label = `${stage.label} (optional)`;
  return stages;
}
export function activityModel(job: TrackedJob, related: TrackedJob[]) {
  const children = related.filter(item => item.id !== job.id);
  const running = [job, ...children].some(isWorking);
  // A flow revision is a single-agent business job; it has no first-draft
  // pipeline, so render its own work stages instead of the draft stages.
  const flowRevision = job.phase === 'business' && (job.result as { scope?: string } | undefined)?.scope === 'scenario';
  let stages: ActivityStage[];
  if (job.phase === 'business' && !flowRevision) stages = businessStages(job, children, running);
  else if (job.phase === 'technical') stages = technicalStages(job, children);
  else {
    const history = records(job);
    stages = history.length ? historyStages(job, history) : [activityStage(job.stage ?? job.phase, job, currentState(job))];
  }
  const active = stages.filter(item => item.state === 'running' && item.job?.status === 'running' && !['validating', 'running'].includes(item.id));
  const activeJobs = [...new Map(active.map(item => [item.job!.id, item.job!])).values()];
  const current = stages.filter(item => item.state === 'running');
  const heading = current.length > 1 ? 'Mehrere Prüfungen laufen gleichzeitig' : current[0]?.label ?? (job.stage && stageLabels[job.stage]) ?? phaseLabels[job.phase];
  const jobRecords = [...new Map([...children, job].map(item => [item.id, item])).values()];
  const events = jobRecords.flatMap(item => publicEvents(item).map(event => ({ ...event, source: phaseLabels[item.phase] ?? item.phase })))
    .filter((event, index, all) => all.findIndex(other => other.id === event.id || other.at === event.at && other.kind === event.kind && other.message === event.message) === index)
    .sort((a, b) => a.at.localeCompare(b.at));
  const tools = jobRecords.flatMap(item => item.events.filter(event => event.kind === 'tool'));
  const toolCount = tools.filter((event, index) => tools.findIndex(other => other.id === event.id || other.at === event.at && other.message === event.message) === index).length;
  const waitingAgents = new Set(stages.filter(item => item.job && waitsForAgent(item.job) && item.state === 'waiting').map(item => item.job!.id)).size;
  return { running, stages, waitingAgents, activeJobs, current, heading, events, toolCount, completed: stages.filter(item => item.state === 'completed').length, skipped: stages.filter(item => item.state === 'skipped').length };
}

export function branchEvents(job: TestingAgentJob, related: TestingAgentJob[], stageId?: string, workStage?: TestingAgentWorkStage) {
  const children = related.filter(item => item.id !== job.id && item.parentJobId === job.id);
  const childEvents = children.flatMap(item => item.events);
  const interval = workStage ?? job.workStages?.find(item => item.stage === stageId);
  return publicEvents(job).filter(event =>
    (!interval?.startedAt || event.at >= interval.startedAt) && (!interval?.finishedAt || event.at <= interval.finishedAt) &&
    !(children.some(child => child.phase === 'duplicates') && event.message.startsWith('Dublettenprüfung:')) &&
    !childEvents.some(child => child.id === event.id || child.at === event.at && child.message === event.message));
}

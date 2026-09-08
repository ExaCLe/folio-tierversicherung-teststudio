import type { ReactNode } from 'react';
import { CheckCircle2, Circle, LoaderCircle, AlertCircle, Minus } from 'lucide-react';
import type { TestingAgentJob } from '../../shared/testing';
import { AgentFailure } from './AgentFailure';
import { ExplorationQuestions } from './ExplorationQuestions';
import { jobModelLabel } from './AgentModels';
import { activityModel, branchEvents, waitsForAgent, type ActivityStageState } from './agentActivityModel';
const stateLabels: Record<ActivityStageState, string> = { waiting: 'Noch offen', running: 'In Bearbeitung', completed: 'Erledigt', skipped: 'Nicht nötig', failed: 'Unterbrochen' };
function StageIcon({ state }: { state: ActivityStageState }) {
  return state === 'running' ? <LoaderCircle className="t-spin" size={16}/> : state === 'completed' ? <CheckCircle2 size={16}/> : state === 'skipped' ? <Minus size={16}/> : state === 'failed' ? <AlertCircle size={16}/> : <Circle size={16}/>;
}
export function InlineAgentActivity({ job, related = [], onCancel, children }: { job: TestingAgentJob; related?: TestingAgentJob[]; onCancel?: () => void; children?: ReactNode }) {
  const model = activityModel(job, related);
  const toolLabel = `${model.toolCount} ${model.toolCount === 1 ? 'protokollierte Werkzeugmeldung' : 'protokollierte Werkzeugmeldungen'}`;
  const attention = !!(job.result as { needsBusinessReview?: boolean; needsKnowledge?: boolean } | undefined)?.needsBusinessReview || !!(job.result as { needsKnowledge?: boolean } | undefined)?.needsKnowledge;
  const cancelled = job.status === 'cancelled';
  const failed = job.status === 'failed';
  const progress = related.find(item => item.phase === 'exploration')?.progress ?? job.progress;
  return <section className={`t-inline-activity ${model.running ? 'running' : failed ? 'failed' : ''}`} aria-label="Aktueller Arbeitsstand">
    <div className="t-activity-heading"><span className="t-activity-symbol">{model.running ? <LoaderCircle className="t-spin" size={22}/> : failed ? <AlertCircle size={22}/> : <Circle size={22}/>}</span><div><span className="t-eyebrow">{model.running ? 'IN BEARBEITUNG' : failed || attention ? 'AUFMERKSAMKEIT NÖTIG' : cancelled ? 'ABGEBROCHEN' : 'ERGEBNIS PRÜFEN'}</span><h2>{model.heading}</h2></div>{model.running && onCancel && <button className="t-button small" onClick={onCancel}>Auftrag abbrechen</button>}</div>
    <div className="t-activity-metrics" aria-label="Fortschritt des Auftrags"><span>{model.activeJobs.length} {model.activeJobs.length === 1 ? 'aktiver KI-Agent' : 'aktive KI-Agenten'}</span><span>{model.completed} von {model.stages.length} Arbeitsschritten erledigt{model.skipped > 0 ? ` · ${model.skipped} nicht nötig` : ''}</span></div>
    <ol className={`t-agent-stages ${job.phase === 'technical' ? 'parallel' : 'sequential'}`} aria-label="Arbeitsschritte der KI">{model.stages.map(stage => <li key={stage.id} data-stage={stage.id} data-state={stage.state}><StageIcon state={stage.state}/><span>{stage.label}</span><small>{stage.id === 'exploring' && stage.state === 'waiting' ? 'Bei Bedarf' : stage.job && waitsForAgent(stage.job) && stage.state === 'waiting' ? 'Wartet auf KI-Platz' : stage.job?.status === 'queued' && stage.state === 'waiting' ? 'Wartet auf Start' : stateLabels[stage.state]}</small>{job.phase === 'technical' && stage.job && stage.state !== 'waiting' && <details className="t-branch-details"><summary>Erläuterungen zu „{stage.label}“</summary>{stage.summary && <p>{stage.summary}</p>}{branchEvents(stage.job, related, stage.id).map(event => <p key={event.id}>{event.message}</p>)}</details>}</li>)}</ol>
    {model.running && <div className="t-activity-current" aria-live="polite">{model.current.length ? model.current.map(stage => <div key={stage.id}>{model.current.length > 1 && <strong>{stage.label}</strong>}<p>{(stage.job?.progress?.stage === stage.id && stage.job.progress.status !== 'finished' ? stage.job.progress.summary : undefined) ?? stage.summary ?? branchEvents(stage.job ?? job, related, stage.id).at(-1)?.message ?? 'Der nächste Arbeitsschritt wird vorbereitet.'}</p></div>) : <p>{model.waitingAgents ? 'Die Bearbeitung wartet auf einen freien lokalen KI-Platz.' : 'Der Auftrag wartet auf den nächsten Arbeitsschritt.'}</p>}<small>{job.phase === 'technical' ? 'Technische Vorbereitung und Bausteinvergleich können gleichzeitig arbeiten. Danach folgt der Probelauf.' : 'Die Schritte werden nacheinander bearbeitet. Ein Zwischenergebnis beendet den Auftrag noch nicht.'}</small></div>}
    {progress && <p className="t-exploration-counts">{progress.observationCount} {progress.observationCount === 1 ? 'Beobachtung' : 'Beobachtungen'} in der Anwendung · {progress.round} {progress.round === 1 ? 'Erkundungsrunde' : 'Erkundungsrunden'}</p>}
    {!related.some(item => item.phase === 'exploration' && item.status === 'completed' && item.result) && <ExplorationQuestions questions={progress?.questions}/>}
    <AgentFailure job={job}/>{children}
    <details className="t-activity-details"><summary>Erläuterungen und Verlauf ansehen <span>{model.events.length} {model.events.length === 1 ? 'Meldung' : 'Meldungen'} · {toolLabel}</span></summary><p className="t-caption">Öffentliche Statusmeldungen und Ergebnisse. Die Auftragskoordination zählt nicht als zusätzlicher KI-Agent.</p><ol className="t-public-events">{model.events.map(event => <li key={event.id}><time>{new Date(event.at).toLocaleTimeString('de-DE')}</time><div><strong>{event.source}</strong><p>{event.message}</p></div></li>)}</ol><div className="t-activity-diagnostics"><span>{jobModelLabel(job)}</span><span>{toolLabel} im verfügbaren Verlauf</span><span>Gespeicherter Fachstand: Revision {job.scenarioRevision ?? '–'}</span></div></details>
  </section>;
}

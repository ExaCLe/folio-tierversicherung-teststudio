import type { ReactNode } from 'react';
import { CheckCircle2, Circle, LoaderCircle, AlertCircle } from 'lucide-react';
import type { TestingAgentJob } from '../../shared/testing';
import { AgentFailure } from './AgentFailure';
import { jobModelLabel } from './AgentModels';
import { JsonView } from './ui';
const stagesLabels: Record<string, string> = { knowledge: 'Fachwissen prüfen', exploring: 'Die Anwendung erkunden', planning: 'Den Ablauf entwerfen', duplicates: 'Bausteine vergleichen', wiring: 'Technische Schritte vorbereiten', running: 'Den Test im Portal ausführen', reuse: 'Wiederverwendung untersuchen' };
const labels: Record<string, string> = { business: 'Fachlichen Ablauf entwerfen', duplicates: 'Vorhandene Bausteine vergleichen', technical: 'Technik vorbereiten und prüfen', reuse: 'Wiederverwendung vorschlagen', exploration: 'Wissen und Anwendung erkunden' };
export function InlineAgentActivity({ job, related = [], onCancel, children }: { job: TestingAgentJob; related?: TestingAgentJob[]; onCancel?: () => void; children?: ReactNode }) {
  const running = [job, ...related].some(item => ['queued', 'running'].includes(item.status));
  const attention = !!(job.result as { needsBusinessReview?: boolean; needsKnowledge?: boolean } | undefined)?.needsBusinessReview || !!(job.result as { needsKnowledge?: boolean } | undefined)?.needsKnowledge;
  const cancelled = job.status === 'cancelled';
  const failed = job.status === 'failed';
  const stages = [job, ...related.filter(item => item.id !== job.id)];
  const working = related.find(item => ['queued', 'running'].includes(item.status)) ?? job;
  const recent = working.events.filter(event => event.kind === 'status' || event.kind === 'message' && event.message.length < 240 && !/^[\s]*[\[{]/.test(event.message)).at(-1);
  return <section className={`t-inline-activity ${running ? 'running' : failed ? 'failed' : ''}`} aria-label="Aktueller Arbeitsstand">
    <div className="t-activity-heading"><span className="t-activity-symbol">{running ? <LoaderCircle className="t-spin" size={22}/> : failed ? <AlertCircle size={22}/> : <Circle size={22}/>}</span><div><span className="t-eyebrow">{running ? 'IN BEARBEITUNG' : failed || attention ? 'AUFMERKSAMKEIT NÖTIG' : cancelled ? 'ABGEBROCHEN' : 'ERGEBNIS PRÜFEN'}</span><h2>{stagesLabels[working.stage ?? ''] ?? labels[job.phase] ?? job.phase}</h2><p>{running ? 'Du kannst diesen Testfall verlassen und später hier fortsetzen.' : failed ? 'Der Auftrag konnte nicht abgeschlossen werden.' : cancelled ? 'Der gespeicherte Testfall bleibt erhalten.' : 'Prüfe das Ergebnis und den nächsten Schritt unten.'}</p></div>{running && onCancel && <button className="t-button small" onClick={onCancel}>Auftrag abbrechen</button>}</div>
    {running && <div className="t-activity-current" aria-live="polite"><i/>{recent?.message ?? 'Der Auftrag wird vorbereitet.'}<small>Ein Zwischenergebnis beendet den Auftrag noch nicht.</small></div>}
    <AgentFailure job={job}/>
    {stages.length > 1 && <ul className="t-agent-stages" aria-label="Arbeitsschritte der KI">{stages.map(stage => <li key={stage.id}>{['running', 'queued'].includes(stage.status) ? <LoaderCircle className="t-spin" size={15}/> : stage.status === 'completed' ? <CheckCircle2 size={15}/> : <Circle size={15}/>}<span>{labels[stage.phase] ?? stage.phase}</span><small>{stage.status === 'completed' ? 'Abgeschlossen' : stage.status === 'failed' ? 'Benötigt Aufmerksamkeit' : stage.status === 'cancelled' ? 'Abgebrochen' : 'In Bearbeitung'}</small></li>)}</ul>}
    {children}
    <details className="t-activity-details"><summary>Verlauf und technische Details <span>{jobModelLabel(job)}</span></summary><p>Auftrag für Revision {job.scenarioRevision ?? '–'}</p><div className="t-agent-events">{job.events.map(event => <div key={event.id} className={event.kind}><time>{new Date(event.at).toLocaleTimeString('de-DE')}</time><span>{event.message}</span></div>)}</div>{job.result !== undefined && <JsonView value={job.result} label="Vollständiges Auftragsergebnis anzeigen"/>}</details>
  </section>;
}

import type { TestingAgentJob } from '../../shared/testing';
import { JsonView, Notice } from './ui';

export function AgentFailure({ job }: { job: TestingAgentJob }) {
  if (!job.error) return null;
  const duplicateFailure = job.phase === 'duplicates' || /^(?:Dublettenprüfung:|Die unabhängige Dublettenprüfung ist fehlgeschlagen:)/.test(job.error);
  if (!duplicateFailure) return <Notice tone="error">{job.error}</Notice>;
  return <section className="t-agent-failure" aria-label="Auftrag konnte nicht abgeschlossen werden">
    <Notice tone="error"><strong>Der Vergleich mit vorhandenen Bausteinen konnte nicht abgeschlossen werden.</strong><p>Die KI hat keinen gültigen Vergleich geliefert. Dieses Ergebnis wurde nicht übernommen. Dein gespeicherter fachlicher Ablauf bleibt erhalten.</p></Notice>
    <p>Öffne den Testfall und starte dort „Technik &amp; Probelauf“ erneut. Du kannst vorher ein anderes Modell wählen. Ungespeicherte Änderungen musst du zuerst speichern und fachlich freigeben.</p>
    <JsonView value={job.error} label="Technische Fehlerdetails anzeigen" />
  </section>;
}

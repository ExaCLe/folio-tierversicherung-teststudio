import type { TestingAgentJob } from '../../shared/testing';
import { JsonView, Notice } from './ui';
export function AgentFailure({ job }: { job: TestingAgentJob }) {
  if (!job.error) return null;
  const duplicate = job.phase === 'duplicates' || /^(?:Dublettenprüfung:|Die unabhängige Dublettenprüfung ist fehlgeschlagen:)/.test(job.error);
  const login = /not logged in|please run \/login|authentication|unauthorized|nicht angemeldet/i.test(job.error);
  const startup = /ENOENT|executable|nicht gefunden|could not start|spawn/i.test(job.error);
  const title = login ? 'Die gewählte KI ist noch nicht angemeldet.' : startup ? 'Die gewählte KI konnte nicht gestartet werden.' : duplicate ? 'Der Vergleich mit vorhandenen Bausteinen konnte nicht abgeschlossen werden.' : job.phase === 'business' ? 'Der fachliche Entwurf konnte nicht abgeschlossen werden.' : job.phase === 'exploration' ? 'Die Erkundung konnte nicht abgeschlossen werden.' : job.phase === 'reuse' ? 'Die Wiederverwendungsanalyse konnte nicht abgeschlossen werden.' : 'Die technische Prüfung konnte nicht abgeschlossen werden.';
  return <section className="t-agent-failure" aria-label="Auftrag konnte nicht abgeschlossen werden"><Notice tone="error"><strong>{title}</strong><p>{duplicate ? 'Die KI hat keinen gültigen Vergleich geliefert. Dieses Ergebnis wurde nicht übernommen. ' : ''}Dein gespeicherter fachlicher Ablauf bleibt erhalten.</p></Notice><p>{login ? 'Melde dich in der CLI des gewählten Anbieters an. Prüfe unter Einstellungen, welcher Anbieter und welches Modell verwendet werden.' : startup ? 'Prüfe unter Einstellungen den Anbieter und den Pfad seiner CLI. Danach kannst du den Auftrag erneut starten.' : 'Prüfe die Hinweise und nutze die nächste Aktion in diesem Testfall, um fortzusetzen.'}</p><JsonView value={job.error} label="Technische Fehlerdetails anzeigen"/></section>;
}

import { CheckCircle2, CircleX, Info, Lightbulb, MessageSquareText, Wrench, type LucideIcon } from 'lucide-react';
import type { TestingAgentEvent, TestingAgentJob, TestingExplorationQuestion, TestingKnowledgeDocument } from '../../shared/testing';
import type { ExplorationEvidenceView } from './explorationEvidence';
import { ExplorationQuestionList } from './ExplorationQuestions';

type EventPresentation = { label: string; Icon: LucideIcon };
type ExplorationResult = { questions?: TestingExplorationQuestion[]; evidence?: ExplorationEvidenceView[]; newKnowledge?: TestingKnowledgeDocument[] };

const eventPresentations: Record<TestingAgentEvent['kind'], EventPresentation> = {
  status: { label: 'Status', Icon: Info },
  message: { label: 'Erläuterung', Icon: MessageSquareText },
  tool: { label: 'Werkzeug', Icon: Wrench },
  error: { label: 'Fehler', Icon: CircleX },
  metrics: { label: 'Messwerte', Icon: Info },
};
const timeFormatter = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });

function StageMessages({ events }: { events: TestingAgentEvent[] }) {
  if (!events.length) return null;
  return <section className="t-stage-dialog-section" aria-label="Meldungen dieses Arbeitsschritts">
    <h3>Meldungen</h3>
    <ol className="t-stage-messages">{events.map(event => {
      const { label, Icon } = eventPresentations[event.kind];
      return <li key={event.id} className={`t-stage-message ${event.kind}`}>
        <span className="t-stage-message-icon" aria-hidden="true"><Icon size={17}/></span>
        <div><header><strong>{label}</strong><time dateTime={event.at}>{timeFormatter.format(new Date(event.at))}</time></header><p>{event.message}</p></div>
      </li>;
    })}</ol>
  </section>;
}

export function StageDialogContent({ stageId, job, summary, details, events, knowledge }: { stageId: string; job: TestingAgentJob; summary?: string; details: string[]; events: TestingAgentEvent[]; knowledge: TestingKnowledgeDocument[] }) {
  const exploration = stageId === 'exploring' ? job.result as ExplorationResult | undefined : undefined;
  const questions = exploration?.questions ?? (stageId === 'exploring' ? job.progress?.questions : undefined);
  const evidence = exploration?.evidence ?? [];
  const documents = [...new Map([...(exploration?.newKnowledge ?? []), ...knowledge].map(document => [`${document.id}@${document.revision}`, document])).values()];
  return <>
    {summary && <section className="t-stage-dialog-section"><h3>Ergebnis</h3><div className="t-stage-outcome"><CheckCircle2 size={19} aria-hidden="true"/><p>{summary}</p></div></section>}
    {!!questions?.length && <section className="t-stage-dialog-section" aria-label="Erkundungsfragen dieses Arbeitsschritts"><h3>Erkundungsfragen</h3><p className="t-stage-section-intro">Jede untersuchte Frage wird mit ihrem eigenen Ergebnis und den zugehörigen Quellen dargestellt.</p><ExplorationQuestionList questions={questions} evidence={evidence} knowledge={documents}/></section>}
    {!!details.length && <section className="t-stage-dialog-section" aria-label="Erkenntnisse dieses Arbeitsschritts"><h3>{details.length === 1 ? 'Erkenntnis' : 'Erkenntnisse'}</h3><ul className="t-stage-insights">{details.map((line, index) => <li key={`result-${index}`}><Lightbulb size={17} aria-hidden="true"/><p>{line}</p></li>)}</ul></section>}
    <StageMessages events={events}/>
  </>;
}

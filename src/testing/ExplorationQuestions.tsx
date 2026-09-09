import { CheckCircle2, CircleHelp } from 'lucide-react';
import type { TestingExplorationQuestion, TestingKnowledgeDocument } from '../../shared/testing';
import type { ExplorationEvidenceView } from './explorationEvidence';
import { DetailsButton } from './DetailsButton';
import { EvidenceLinks, KnowledgeLinks } from './ExplorationSources';

type ExplorationQuestionListProps = { questions: TestingExplorationQuestion[]; evidence?: ExplorationEvidenceView[]; knowledge?: TestingKnowledgeDocument[] };

export function ExplorationQuestionList({ questions, evidence = [], knowledge = [] }: ExplorationQuestionListProps) {
  return <ol className="t-exploration-question-list">{questions.map((question, index) => {
    const answered = question.status === 'answered';
    const Icon = answered ? CheckCircle2 : CircleHelp;
    return <li key={question.id}><section className={`t-exploration-question ${question.status}`} aria-label={`Frage ${index + 1}: ${question.text}`}>
      <header><span className="t-exploration-question-number"><Icon size={17} aria-hidden="true"/>Frage {index + 1}</span><span className="t-exploration-question-status">{answered ? 'Beantwortet' : 'Noch offen'}</span></header>
      <h4>{question.text}</h4>
      {question.answer ? <p>{question.answer}</p> : <p className="t-exploration-question-empty">Für diese Frage liegt noch keine Antwort vor.</p>}
      <EvidenceLinks ids={question.evidenceIds} evidence={evidence}/><KnowledgeLinks ids={question.knowledgeIds} knowledge={knowledge}/>
    </section></li>;
  })}</ol>;
}

export function ExplorationQuestions({ questions, evidence = [], knowledge = [] }: { questions?: TestingExplorationQuestion[]; evidence?: ExplorationEvidenceView[]; knowledge?: TestingKnowledgeDocument[] }) {
  if (!questions?.length) return null;
  const answered = questions.filter(question => question.status === 'answered').length;
  return <section className="t-exploration-questions" aria-label="Erkundungsfragen"><DetailsButton label={`${answered} von ${questions.length} Erkundungsfragen beantwortet`} title="Erkundungsfragen und ihre Belege"><ExplorationQuestionList questions={questions} evidence={evidence} knowledge={knowledge}/></DetailsButton></section>;
}

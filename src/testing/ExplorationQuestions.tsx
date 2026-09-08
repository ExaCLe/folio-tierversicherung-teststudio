import type { TestingExplorationQuestion, TestingKnowledgeDocument } from '../../shared/testing';
import type { ExplorationEvidenceView } from './explorationEvidence';
import { DetailsButton } from './DetailsButton';
import { EvidenceLinks, KnowledgeLinks } from './ExplorationSources';
export function ExplorationQuestions({ questions, evidence = [], knowledge = [] }: { questions?: TestingExplorationQuestion[]; evidence?: ExplorationEvidenceView[]; knowledge?: TestingKnowledgeDocument[] }) {
  if (!questions?.length) return null;
  const answered = questions.filter(question => question.status === 'answered').length;
  return <section className="t-exploration-questions" aria-label="Erkundungsfragen"><DetailsButton label={`${answered} von ${questions.length} Erkundungsfragen beantwortet`} title="Erkundungsfragen und ihre Belege"><ul>{questions.map(question => <li key={question.id}>
    <div><strong>{question.text}</strong><span>{question.status === 'answered' ? 'Beantwortet' : 'Noch offen'}</span></div>{question.answer && <p>{question.answer}</p>}
    <EvidenceLinks ids={question.evidenceIds} evidence={evidence}/><KnowledgeLinks ids={question.knowledgeIds} knowledge={knowledge}/>
  </li>)}</ul></DetailsButton></section>;
}

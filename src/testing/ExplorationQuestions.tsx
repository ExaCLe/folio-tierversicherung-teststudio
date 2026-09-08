import type { TestingExplorationQuestion } from '../../shared/testing';
import { explorationEvidenceLabel, type ExplorationEvidenceView } from './explorationEvidence';

export function ExplorationQuestions({ questions, evidence = [] }: { questions?: TestingExplorationQuestion[]; evidence?: ExplorationEvidenceView[] }) {
  if (!questions?.length) return null;
  const answered = questions.filter(question => question.status === 'answered').length;
  return <section className="t-exploration-questions" aria-label="Erkundungsfragen"><details><summary>{answered} von {questions.length} Erkundungsfragen beantwortet</summary><ul>{questions.map(question => <li key={question.id}>
    <div><strong>{question.text}</strong><span>{question.status === 'answered' ? 'Beantwortet' : 'Noch offen'}</span></div>
    {question.answer && <p>{question.answer}</p>}
    {question.status === 'answered' && <small>{question.evidenceIds.length} Browserbelege · {question.knowledgeIds.length} Wissensquellen</small>}
    {question.evidenceIds.map(id => evidence.find(item => item.id === id)).filter(item => item?.screenshot).map(item => <a key={item!.id} href={item!.screenshot} target="_blank" rel="noreferrer">{explorationEvidenceLabel(item!, evidence.findIndex(source => source.id === item!.id))}</a>)}
  </li>)}</ul></details></section>;
}

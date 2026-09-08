import type { TestingAgentJob, TestingExplorationQuestion, TestingBusinessDraft, TestingKnowledgeDocument } from '../../shared/testing';
import { Notice } from './ui';
import { ExplorationQuestions } from './ExplorationQuestions';
import { explorationEvidenceLabel } from './explorationEvidence';
export function AgentOutcome({ result }: { result: unknown }) {
  const parsed = result as { draft?: TestingBusinessDraft; plan?: { explanation?: string; unsupported?: string[] }; explanation?: string; openQuestions?: string[]; assumptions?: string[]; unsupported?: string[] };
  const value = parsed.draft ?? parsed.plan ?? parsed;
  const questions = parsed.openQuestions ?? ('openQuestions' in value ? value.openQuestions : []) ?? [];
  const unsupported = ('unsupported' in value ? value.unsupported : []) ?? [];
  return <div className="t-agent-outcome">{questions.length > 0 && <Notice><strong>Diese Angaben fehlen noch</strong><ul>{questions.map((question, index) => <li key={index}>{question}</li>)}</ul></Notice>}{unsupported.length > 0 && <Notice><strong>Vor der Ausführung muss Folgendes geklärt werden</strong><ul>{unsupported.map((question, index) => <li key={index}>{question}</li>)}</ul></Notice>}{value.explanation && <details><summary>Begründung und Annahmen ansehen</summary><p>{value.explanation}</p>{'assumptions' in value && value.assumptions?.map((assumption, index) => <p key={index}>{assumption}</p>)}</details>}</div>;
}
export function ExplorationSummary({ jobs }: { jobs: TestingAgentJob[] }) {
  const job = jobs.find(item => item.phase === 'exploration' && item.status === 'completed');
  if (!job?.result) return null;
  const result = job.result as { questions?: TestingExplorationQuestion[]; explored?: boolean; explanation?: string; openQuestions?: string[]; newKnowledge?: TestingKnowledgeDocument[]; evidence?: { id: string; action: string; path: string; screenshot?: string }[] };
  return <section className="t-exploration-summary" aria-label="Erkundungsergebnis"><div><strong>{result.openQuestions?.length ? 'Das Wissen braucht noch eine Ergänzung' : result.explored ? 'Die Anwendung wurde untersucht' : 'Das vorhandene Wissen reicht für den Entwurf'}</strong><span>{result.newKnowledge?.length ?? 0} neue Wissensbelege · {result.evidence?.length ?? 0} Beobachtungen</span></div><ExplorationQuestions questions={result.questions} evidence={result.evidence}/><details><summary>Erkenntnisse und Belege ansehen</summary><p>{result.explanation}</p>{result.newKnowledge?.map(doc => <article key={doc.id}><h4>{doc.title}</h4><p>{doc.summary}</p></article>)}{result.evidence?.map((item, index) => <a className="t-exploration-evidence" key={item.id} href={item.screenshot} target="_blank" rel="noreferrer"><span>{explorationEvidenceLabel(item, index)}</span>{item.screenshot && <img src={item.screenshot} alt={explorationEvidenceLabel(item, index)} loading="lazy"/>}</a>)}</details></section>;
}

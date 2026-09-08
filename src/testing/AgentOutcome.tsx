import type { TestingAgentJob, TestingExplorationQuestion, TestingBusinessDraft, TestingCatalog, TestingKnowledgeDocument } from '../../shared/testing';
import { Notice } from './ui';
import { ExplorationQuestions } from './ExplorationQuestions';
import { DetailsButton } from './DetailsButton';
import { EvidenceLinks, KnowledgeLinks } from './ExplorationSources';
export function AgentOutcome({ result, catalog }: { result: unknown; catalog?: TestingCatalog }) {
  type TechnicalIssue = { summary: string; kind?: string; affectedDefinitionRefs?: { id: string; version: string }[]; affectedInputKeys?: string[]; blockPaths?: string[]; suggestedBusinessRevision?: string };
  const parsed = result as { draft?: TestingBusinessDraft; plan?: { explanation?: string; unsupported?: Array<string | TechnicalIssue> }; explanation?: string; openQuestions?: string[]; assumptions?: string[]; unsupported?: Array<string | TechnicalIssue> };
  const value = parsed.draft ?? parsed.plan ?? parsed;
  const questions = parsed.openQuestions ?? ('openQuestions' in value ? value.openQuestions : []) ?? [];
  const unsupported = ('unsupported' in value ? value.unsupported : []) ?? [];
  const definition = (id: string, version: string) => catalog?.definitions.find(item => item.id === id && item.version === version);
  const inputLabel = (key: string, issue: TechnicalIssue) => issue.affectedDefinitionRefs?.map(ref => definition(ref.id, ref.version)?.inputs.find(input => input.key === key)?.label).find(Boolean) ?? key;
  return <div className="t-agent-outcome">{questions.length > 0 && <Notice><strong>Diese Angaben fehlen noch</strong><ul>{questions.map((question, index) => <li key={index}>{question}</li>)}</ul></Notice>}{unsupported.length > 0 && <Notice><strong>Vor der Ausführung muss Folgendes geklärt werden</strong><ul>{unsupported.map((issue, index) => <li key={index}>{typeof issue === 'string' ? issue : <><span>{issue.summary}</span>{!!issue.affectedDefinitionRefs?.length && <small> Betroffene Bausteine: {issue.affectedDefinitionRefs.map(ref => `${definition(ref.id, ref.version)?.name ?? ref.id} · Version ${ref.version}`).join(', ')}</small>}{!!issue.affectedInputKeys?.length && <small> Betroffene Eingaben: {issue.affectedInputKeys.map(key => inputLabel(key, issue)).join(', ')}</small>}</>}</li>)}</ul></Notice>}{value.explanation && <DetailsButton label="Begründung und Annahmen ansehen"><p>{value.explanation}</p>{'assumptions' in value && value.assumptions?.map((assumption, index) => <p key={index}>{assumption}</p>)}</DetailsButton>}</div>;
}
export function ExplorationSummary({ jobs, knowledge = [] }: { jobs: TestingAgentJob[]; knowledge?: TestingKnowledgeDocument[] }) {
  const job = jobs.find(item => item.phase === 'exploration' && ['completed', 'failed', 'cancelled'].includes(item.status) && item.result);
  if (!job?.result) return null;
  const result = job.result as { knowledgeIds?: string[]; questions?: TestingExplorationQuestion[]; explored?: boolean; explanation?: string; openQuestions?: string[]; newKnowledge?: TestingKnowledgeDocument[]; evidence?: { id: string; action: string; path: string; screenshot?: string }[] };
  const documents = [...(result.newKnowledge ?? []), ...knowledge];
  return <section className="t-exploration-summary" aria-label="Erkundungsergebnis"><strong>{job.status !== 'completed' ? 'Die Erkundung wurde nicht abgeschlossen' : result.openQuestions?.length || result.questions?.some(question => question.status === 'open') ? 'Das Wissen braucht noch eine Ergänzung' : result.explored ? 'Die Anwendung wurde untersucht' : 'Das vorhandene Wissen reicht für den Entwurf'}</strong><div className="t-exploration-actions"><ExplorationQuestions questions={result.questions} evidence={result.evidence} knowledge={documents}/><DetailsButton label="Erkenntnisse und Quellen ansehen"><p>{result.explanation}</p><KnowledgeLinks ids={[...new Set([...(result.knowledgeIds ?? []), ...(result.newKnowledge ?? []).map(doc => doc.id)])]} knowledge={documents}/><EvidenceLinks ids={(result.evidence ?? []).map(item => item.id)} evidence={result.evidence ?? []}/></DetailsButton></div></section>;
}

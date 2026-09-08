import type { TestingKnowledgeDocument } from '../../shared/testing';
import { DetailsButton } from './DetailsButton';
import { explorationEvidenceLabel, type ExplorationEvidenceView } from './explorationEvidence';
export function EvidenceLinks({ ids, evidence }: { ids: string[]; evidence: ExplorationEvidenceView[] }) {
  return <div className="t-source-links">{ids.map((id, index) => {
    const item = evidence.find(source => source.id === id);
    const label = item ? explorationEvidenceLabel(item, evidence.indexOf(item), evidence) : `Browserbeleg ${index + 1}`;
    return <DetailsButton key={id} label={label} className="t-source-button">{item?.screenshot ? <><img className="t-source-image" src={item.screenshot} alt={label}/><a href={item.screenshot} target="_blank" rel="noreferrer">Bild separat öffnen</a></> : <p>Für diesen Beleg ist kein Bild verfügbar.</p>}{item?.snapshot && <><h3>Beobachteter Seiteninhalt</h3><pre className="t-source-text">{item.snapshot}</pre></>}</DetailsButton>;
  })}</div>;
}
export function KnowledgeLinks({ ids, knowledge }: { ids: string[]; knowledge: TestingKnowledgeDocument[] }) {
  return <div className="t-source-links">{ids.map(id => {
    const doc = knowledge.find(item => item.id === id);
    return <DetailsButton key={id} label={doc?.title ?? 'Wissensquelle nicht verfügbar'} className="t-source-button">{doc ? <article className="t-source-document"><p className="t-lead small">{doc.summary}</p>{doc.content.split('\n\n').map((paragraph, index) => paragraph.startsWith('# ') ? null : paragraph.startsWith('## ') ? <h3 key={index}>{paragraph.slice(3)}</h3> : paragraph.startsWith('- ') ? <ul key={index}>{paragraph.split('\n').map((line, row) => <li key={row}>{line.replace(/^- /, '')}</li>)}</ul> : <p key={index}>{paragraph}</p>)}</article> : <p>Diese Quelle ist im aktuellen Wissensbestand nicht vorhanden. Die Referenz des früheren Auftrags bleibt erhalten.</p>}</DetailsButton>;
  })}</div>;
}

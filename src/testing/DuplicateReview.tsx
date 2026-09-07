import { useState } from 'react';
import type { TestingAgentJob, TestingCatalog, TestingScenario, TestingVersionRef } from '../../shared/testing';
import { testingVersionKey } from '../../shared/testing';
import { testingPost, messageOf } from './api';
import { Notice, Spinner } from './ui';
interface Decision { proposed: TestingVersionRef; chosen: TestingVersionRef | null; reason: string; decision: string; compatible: boolean }
export function DuplicateReview({ job, catalog, onResolved }: { job: TestingAgentJob; catalog: TestingCatalog; onResolved: (scenario: TestingScenario) => Promise<void> }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const result = job.result as { needsBusinessReview?: boolean; duplicateDecisions?: Decision[]; decisions?: Decision[] } | undefined;
  const decisions = result?.duplicateDecisions ?? result?.decisions ?? [];
  if (!decisions.length) return null;
  const choices = decisions.filter(item => item.compatible && item.chosen && item.decision === 'reuse' && testingVersionKey(item.proposed) !== testingVersionKey(item.chosen));
  const versions = decisions.filter(item => item.chosen?.id === item.proposed.id && item.chosen.version !== item.proposed.version);
  const overlaps = decisions.filter(item => item.chosen && item.chosen.id !== item.proposed.id && item.decision !== 'keep');
  const name = (ref: TestingVersionRef) => catalog.definitions.find(item => testingVersionKey(item) === testingVersionKey(ref))?.name ?? ref.id;
  async function resolve() { setBusy(true); setError(''); try { const next = await testingPost<{ scenario: TestingScenario }>(`/jobs/${encodeURIComponent(job.id)}/resolve-duplicates`, { choices: choices.map(item => ({ proposed: item.proposed, chosen: item.chosen })) }); await onResolved(next.scenario); } catch (cause) { setError(messageOf(cause)); } finally { setBusy(false); } }
  return <section className="t-duplicate-review"><h3>{result?.needsBusinessReview ? 'Vorhandene Fähigkeiten bewusst wiederverwenden' : 'Der Bausteinvergleich ist abgeschlossen'}</h3><div className="t-comparison-counts"><span><strong>{decisions.length}</strong> Bausteine bewertet</span><span><strong>{overlaps.length}</strong> mögliche Überschneidungen</span><span><strong>{versions.length}</strong> Versionsunterschiede</span></div>{result?.needsBusinessReview && <p>Entscheide über die vorgeschlagene Wiederverwendung. Ein Versionsunterschied bezeichnet denselben Baustein in einer anderen Fassung.</p>}<details open={!!result?.needsBusinessReview}><summary>Verglichene Bausteine und Vorschläge</summary>{decisions.map(item => {
    const sameId = item.chosen?.id === item.proposed.id;
    const sameVersion = sameId && item.chosen?.version === item.proposed.version;
    return <article className="t-comparison-item" key={testingVersionKey(item.proposed)}><span className="t-eyebrow">{sameVersion ? 'DIESELBE GESPEICHERTE FASSUNG' : sameId ? 'VERSIONSUNTERSCHIED' : item.chosen ? 'MÖGLICHE FACHLICHE ÜBERSCHNEIDUNG' : 'EIGENSTÄNDIGER BAUSTEIN'}</span><div><strong>{name(item.proposed)} <small>Version {item.proposed.version}</small></strong>{item.chosen && <><span>verglichen mit</span><strong>{name(item.chosen)} <small>Version {item.chosen.version}</small></strong></>}</div><p>{item.reason}</p><p className="t-caption">{sameVersion ? 'Kein neuer anderer Baustein. Diese Fassung bleibt unverändert.' : item.decision === 'keep' ? 'Vorschlag: Den bisherigen Baustein behalten.' : item.compatible ? 'Vorschlag: Wiederverwenden. Eingaben und Ergebnisse passen.' : 'Die Definition muss fachlich überarbeitet werden'}</p></article>;
  })}</details>{error && <Notice tone="error">{error}</Notice>}{result?.needsBusinessReview && choices.length > 0 && <button className="t-button primary" onClick={() => void resolve()} disabled={busy}>{busy ? <Spinner label="Wird übernommen"/> : 'Vorhandenen Block übernehmen und neu prüfen'}</button>}</section>;
}

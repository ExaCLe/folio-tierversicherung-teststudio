import { ArrowRight, ArrowUpRight, UnfoldVertical } from 'lucide-react';
import type { ValueChange } from './valueChanges';
import './value-changes.css';

export function ValueChanges({ changes, composite, onSource, onShowChanges }: { changes: ValueChange[]; composite: boolean; onSource?: (path: string) => void; onShowChanges?: (paths: string[]) => void }) {
  const paths = [...new Set(changes.map(change => change.path))];
  return <section className="t-value-changes" aria-label="Abweichungen vom Standard"><details><summary>Abweichungen vom Standard <span>{changes.length}</span></summary><p>{changes.length ? 'Verglichen mit den Standardwerten dieser Bibliotheksversion. Angezeigt werden die wirksamen Werte dieses Tests.' : 'Die wirksamen Werte entsprechen dem Standard dieser Bibliotheksversion.'}</p>
    {composite && changes.length > 0 && onShowChanges && <button type="button" className="t-button small" onClick={() => onShowChanges(paths)}><UnfoldVertical size={14}/>Geänderte Schritte aufklappen</button>}
    {changes.map(change => <div className="t-value-change" key={`${change.path}:${change.field}`}><strong>{change.label}</strong><small>Schritt {change.step} · {change.blockLabel}</small><div className="t-value-change-comparison"><span><small>Standard</small><del>{change.beforeLabel}</del></span><ArrowRight size={14}/><span><small>In diesem Test</small><ins>{change.afterLabel}</ins></span></div>{onSource && <button type="button" className="t-result-source" onClick={() => onSource(change.path)}><ArrowUpRight size={14}/>Geänderten Schritt zeigen · Schritt {change.step}</button>}</div>)}
  </details></section>;
}

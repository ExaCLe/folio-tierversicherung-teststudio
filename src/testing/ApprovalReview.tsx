import { AlertTriangle, CircleX, Info, ChevronRight } from 'lucide-react';
import type { TestingValidationIssue, TestingInput } from '../../shared/testing';
import type { BlockEntry } from './model';
import { entryStep } from './references';
import { Modal } from './ui';
export type ReviewSeverity = 'info' | 'warning' | 'error';
export function reviewSeverity(issue: TestingValidationIssue): ReviewSeverity {
  return issue.code === 'BINDING_MISSING' ? 'info' : issue.severity;
}
function fieldLabel(inputs: TestingInput[] | undefined, path: string) { let fields = inputs; const labels: string[] = []; for (const key of path.split('.')) { const field = fields?.find(input => input.key === key); if (!field) return labels.length ? labels.join(' › ') : 'Eingabe'; labels.push(field.label); fields = field.fields; } return labels.join(' › '); }
const icons = { info: Info, warning: AlertTriangle, error: CircleX };
const label = (severity: ReviewSeverity, count: number) => `${count} ${severity === 'info' ? count === 1 ? 'Information' : 'Informationen' : severity === 'warning' ? count === 1 ? 'Warnung' : 'Warnungen' : 'Fehler'}`;
export function ValidationCounters({ issues, onOpen }: { issues: TestingValidationIssue[]; onOpen: () => void }) {
  return <div className="t-validation-counters" aria-label="Hinweise zur Freigabe">{(['info', 'warning', 'error'] as const).map(severity => {
    const count = issues.filter(issue => reviewSeverity(issue) === severity).length, Icon = icons[severity];
    return <button type="button" key={severity} className={severity} onClick={onOpen} aria-label={label(severity, count)}><Icon size={16}/><span>{count}</span></button>;
  })}</div>;
}
export function ValidationDialog({ issues, entries, onClose, onShow }: { issues: TestingValidationIssue[]; entries: BlockEntry[]; onClose: () => void; onShow: (issue: TestingValidationIssue) => void }) {
  return <Modal title="Hinweise zum Testfall" subtitle="Fehler müssen vor der fachlichen Freigabe behoben werden. Fehlende Technik wird erst danach erstellt." onClose={onClose} wide><div className="t-review-issues">{!issues.length && <p>Es sind keine Hinweise offen.</p>}{issues.map((issue, index) => {
    const target = entries.find(entry => entry.path === issue.path || !issue.path && entry.block.id === issue.instanceId);
    const source = entries.find(entry => entry.path === issue.sourcePath);
    const severity = reviewSeverity(issue), Icon = icons[severity];
    return <button key={index} className={`t-review-issue ${severity}`} onClick={() => target && onShow(issue)} disabled={!target}><Icon size={19}/><div>{target && <strong>Schritt {entryStep(target, entries)} · {target.block.label || target.definition?.name}{issue.field ? ` · ${fieldLabel(target.definition?.inputs, issue.field)}` : ''}</strong>}<p>{issue.message}</p>{source && <small>Verwendetes Ergebnis aus Schritt {entryStep(source, entries)} · {issue.sourceLabel}</small>}</div>{target && <ChevronRight size={16}/>}</button>;
  })}</div></Modal>;
}

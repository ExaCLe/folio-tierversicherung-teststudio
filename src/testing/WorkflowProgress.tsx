import { Check } from 'lucide-react';
export const workflowPhases = ['Anforderung', 'Erkundung & Entwurf', 'Fachlich prüfen', 'Technik & Prüfen', 'Ergebnis'];
export function WorkflowProgress({ phase }: { phase: number }) {
  return <ol className="t-workflow-progress" aria-label="Ablauf der Testerstellung">{workflowPhases.map((label, index) => <li key={label} className={index === phase ? 'current' : index < phase ? 'complete' : ''} aria-current={index === phase ? 'step' : undefined}><span>{index + 1}</span><strong>{label}</strong></li>)}</ol>;
}

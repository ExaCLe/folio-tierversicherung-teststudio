import type { ReactNode } from 'react';
import { WorkflowProgress } from './WorkflowProgress';
export function WorkspaceFrame({ phase, title, description, action, children }: { phase: number; title: string; description: string; action?: ReactNode; children?: ReactNode }) {
  return <section className="t-workspace-frame"><WorkflowProgress phase={phase}/><div className="t-phase-heading"><div><span className="t-eyebrow">DEIN NÄCHSTER SCHRITT</span><h2>{title}</h2><p>{description}</p></div>{action && <div className="t-phase-action">{action}</div>}</div>{children}</section>;
}

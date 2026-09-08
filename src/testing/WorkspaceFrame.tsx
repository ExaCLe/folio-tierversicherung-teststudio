import type { ReactNode } from 'react';
import { WorkflowProgress } from './WorkflowProgress';
export function WorkspaceFrame({ phase, title, description, action, children, available, onSelect }: { phase: number; title: string; description: string; action?: ReactNode; children?: ReactNode; available?: number[]; onSelect?: (phase: number) => void }) {
  return <section className="t-workspace-frame"><WorkflowProgress phase={phase} available={available} onSelect={onSelect}/><div className="t-phase-heading"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{action && <div className="t-phase-action">{action}</div>}</div>{children}</section>;
}

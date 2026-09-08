import type { ReactNode } from 'react';
import type { TestingScenario } from '../../shared/testing';
import { ModelSelect } from './AgentModels';

export function WorkspaceContext({ scenario, model, onModel, disabled, children }: { scenario: TestingScenario; model: string; onModel: (model: string) => void; disabled: boolean; children?: ReactNode }) {
  return <section className="t-workspace-brief" aria-label="Anforderung und Modell">
    <div><span className="t-brief-label">Deine Anforderung</span><p className="t-brief-intent">{scenario.intent}</p>
      <details className="t-workspace-context"><summary>Ziel und gespeicherten Fachstand ansehen</summary><p>{scenario.intent}</p><h3>Erwartetes Ergebnis</h3><p>{scenario.expectedOutcome}</p><small>Gespeicherter Fachstand: Revision {scenario.revision}</small>{children}</details>
    </div>
    <ModelSelect value={model} onChange={onModel} disabled={disabled}/>
  </section>;
}

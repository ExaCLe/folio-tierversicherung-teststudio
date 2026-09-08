import type { TestingScenario } from '../../shared/testing';
export function WorkspaceContext({ scenario }: { scenario: TestingScenario }) {
  return <section className="t-workspace-brief" aria-label="Deine Anforderung"><span className="t-brief-label">Deine Anforderung</span><p>{scenario.intent}</p></section>;
}

import { createContext, useContext } from 'react';
import type { TestingAgentJob, TestingAgentSettings } from '../../shared/testing';

export const AgentSettingsContext = createContext<TestingAgentSettings | undefined>(undefined);
export function useAgentModels() {
  const settings = useContext(AgentSettingsContext);
  return settings?.models ?? [{ id: 'luna', label: 'Luna', provider: 'codex', slug: 'gpt-5.6-luna', extraArgs: [] }, { id: 'sol', label: 'Sol', provider: 'codex', slug: 'gpt-5.6-sol', extraArgs: [] }];
}
export function ModelSelect({ value, onChange, label = 'Modell für KI-Aufträge', disabled }: { value: string; onChange: (value: string) => void; label?: string; disabled?: boolean }) {
  const models = useAgentModels();
  return <label className="t-field">{label}<select aria-label={label} value={value} disabled={disabled} onChange={event => onChange(event.target.value)}>{models.map(model => <option key={model.id} value={model.id}>{model.label} · {model.provider === 'claude' ? 'Claude Code' : 'Codex'}</option>)}</select></label>;
}
export function jobModelLabel(job: TestingAgentJob) { return job.agentConfig ? `${job.agentConfig.modelLabel} · ${job.agentConfig.provider === 'claude' ? 'Claude Code' : 'Codex'}` : job.model === 'luna' ? 'Luna' : job.model === 'sol' ? 'Sol' : job.model; }

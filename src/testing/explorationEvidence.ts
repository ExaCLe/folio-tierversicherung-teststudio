export interface ExplorationEvidenceView { id: string; action?: string; screenshot?: string; snapshot?: string; path?: string; targets?: { id: string; name: string }[] }
export function explorationEvidenceLabel(evidence: ExplorationEvidenceView, index: number, sources: ExplorationEvidenceView[] = [evidence]) {
  let description = 'Seitenzustand beobachten';
  if (evidence.action?.trim().startsWith('{')) {
    try {
      const action = JSON.parse(evidence.action) as { op?: string; targetId?: string; value?: unknown; checked?: boolean };
      const target = sources.flatMap(item => item.targets ?? []).find(item => item.id === action.targetId)?.name;
      const value = typeof action.value === 'string' ? action.value.slice(0, 80) : undefined;
      description = action.op === 'select' ? `Auswahl ändern${value ? `: ${value}` : ''}`
        : action.op === 'fill' ? `Feld ausfüllen${value ? `: ${value}` : ''}`
        : action.op === 'click' ? 'Schaltfläche betätigen'
        : action.op === 'goto' ? 'Seite öffnen'
        : action.op === 'check' ? action.checked ? 'Option aktivieren' : 'Option deaktivieren'
        : description;
      if (target) description = `${target} · ${description}`;
    } catch { /* A legacy technical payload is not a readable evidence label. */ }
  } else if (evidence.action && evidence.action.length <= 140) description = evidence.action;
  return `Beleg ${index + 1}: ${description}`;
}

export interface ExplorationEvidenceView { id: string; action?: string; screenshot?: string }
export function explorationEvidenceLabel(evidence: ExplorationEvidenceView, index: number) {
  let description = 'Seitenzustand beobachten';
  if (evidence.action?.trim().startsWith('{')) {
    try {
      const action = JSON.parse(evidence.action) as { op?: string; value?: unknown; checked?: boolean };
      const value = typeof action.value === 'string' ? action.value.slice(0, 80) : undefined;
      description = action.op === 'select' ? `Auswahl ändern${value ? `: ${value}` : ''}`
        : action.op === 'fill' ? `Feld ausfüllen${value ? `: ${value}` : ''}`
        : action.op === 'click' ? 'Schaltfläche betätigen'
        : action.op === 'goto' ? 'Seite öffnen'
        : action.op === 'check' ? action.checked ? 'Option aktivieren' : 'Option deaktivieren'
        : description;
    } catch { /* A legacy technical payload is not a readable evidence label. */ }
  } else if (evidence.action && evidence.action.length <= 140) description = evidence.action;
  return `Beleg ${index + 1}: ${description}`;
}

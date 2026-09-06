import type { TestingAgentEvent, TestingCatalog, TestingCompiledScenario, TestingModel, TestingScenario } from '../../../shared/testing';
import { invokeCodex } from './cli';
import { decodeDuplicates, decodeReuse } from './schemas';

/** A rejected answer is returned to the same real model; no local answer is substituted. */
export async function reviewWithCodex<T>(input: { id: string; model: TestingModel; prompt: string; schema: Record<string, unknown>;
  files: Record<string, string>; label: string; validate: (value: unknown) => T; signal?: AbortSignal; onEvent?: (event: TestingAgentEvent) => void }) {
  let previous: unknown, diagnostic = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await invokeCodex({ id: attempt ? `${input.id}-korrektur` : input.id, model: input.model, schema: input.schema,
      prompt: `${input.prompt}${attempt ? `\n\nDeine vorherige Antwort wurde nicht übernommen. Lies vorherige-antwort.json und validierungsfehler.txt. Korrigiere ausschließlich die dort belegten Vertrags- oder Referenzfehler und liefere eine vollständige Antwort. Fehlerbericht: ${JSON.stringify(diagnostic)}` : ''}`,
      files: { ...input.files, ...(attempt ? { 'vorherige-antwort.json': JSON.stringify(previous, null, 2), 'validierungsfehler.txt': diagnostic } : {}) }, signal: input.signal, onEvent: input.onEvent });
    previous = result.value;
    try { return { result, parsed: input.validate(result.value), attempts: attempt + 1 }; }
    catch (error) {
      diagnostic = error instanceof Error ? error.message : String(error);
      if (attempt) throw new Error(`${input.label}: Auch die echte Codex-Korrektur verletzt den Vertrag: ${diagnostic}`);
      input.onEvent?.({ id: `${input.id}-korrektur`, at: new Date().toISOString(), kind: 'status', message: `${input.label}: Das gleiche Modell erhält den genauen Validierungsbericht und korrigiert seine Antwort einmal.` });
    }
  }
  throw new Error(`${input.label} hat kein gültiges Ergebnis geliefert.`);
}

export function validateDuplicateReview(raw: unknown, compiled: TestingCompiledScenario, catalog: TestingCatalog) {
  const parsed = decodeDuplicates(raw);
  const candidates = compiled.definitions.filter(item => item.origin !== 'seed');
  const keys = new Set<string>();
  for (const decision of parsed.decisions) {
    const key = `${decision.proposed.id}@${decision.proposed.version}`;
    if (!candidates.some(item => item.id === decision.proposed.id && item.version === decision.proposed.version)) throw new Error(`Die vorgeschlagene Definition ${key} wird in diesem freigegebenen Testfall nicht als neue menschliche oder agentische Definition verwendet. Erlaubte Prüfgegenstände: ${candidates.map(item => `${item.id}@${item.version}`).join(', ') || 'keine; decisions muss [] sein'}. Andere Katalogdefinitionen dienen nur als Vergleichskandidaten.`);
    if (keys.has(key)) throw new Error(`Die Definition ${key} wurde mehrfach beurteilt.`); keys.add(key);
    if (decision.decision === 'new' && decision.chosen) throw new Error(`Eine neue Fähigkeit ${key} darf keine chosen-Definition nennen.`);
    if (decision.decision !== 'new' && !decision.chosen) throw new Error(`Die Entscheidung ${decision.decision} für ${key} braucht eine existierende chosen-Definition.`);
    if (decision.chosen && (!catalog.definitions.some(item => item.id === decision.chosen!.id && item.version === decision.chosen!.version) || `${decision.chosen.id}@${decision.chosen.version}` === key)) throw new Error(`Der Vergleichsblock für ${key} muss eine andere vorhandene Definition sein.`);
  }
  for (const candidate of candidates) if (!keys.has(`${candidate.id}@${candidate.version}`)) throw new Error(`Die verwendete neue Definition ${candidate.id}@${candidate.version} fehlt in der unabhängigen Dublettenprüfung.`);
  return parsed;
}

export function validateReuseReview(raw: unknown, scenario: TestingScenario, catalog: TestingCatalog) {
  const parsed = decodeReuse(raw);
  for (const item of parsed.suggestions) {
    let siblings = scenario.blocks;
    for (const part of (item.parentPath ?? '').split('/').filter(Boolean)) {
      const parent = siblings.find(block => block.id === part);
      const definition = catalog.definitions.find(value => value.id === parent?.definition.id && value.version === parent.definition.version);
      if (!parent || !definition || !['context', 'workflow'].includes(definition.kind)) throw new Error(`Der vorgeschlagene übergeordnete Blockpfad ${item.parentPath} fehlt oder ist keine Komposition.`);
      siblings = parent.children ?? definition.body ?? [];
    }
    const positions = item.instanceIds.map(id => siblings.findIndex(block => block.id === id)).sort((a, b) => a - b);
    if (positions.some(index => index < 0) || new Set(positions).size !== positions.length || positions.at(-1)! - positions[0] + 1 !== positions.length) throw new Error(`„${item.name}“ muss vorhandene zusammenhängende Kind-IDs auf der Ebene ${item.parentPath ?? 'oberste Ebene'} verwenden. Dort verfügbar: ${siblings.map(block => block.id).join(', ')}.`);
    if (new Set(item.parameters.map(parameter => parameter.key)).size !== item.parameters.length) throw new Error(`„${item.name}“ enthält mehrfach vergebene Parameternamen.`);
    for (const parameter of item.parameters) {
      const block = siblings.find(value => value.id === parameter.instanceId);
      const definition = catalog.definitions.find(value => value.id === block?.definition.id && value.version === block.definition.version);
      if (!item.instanceIds.includes(parameter.instanceId) || !definition?.inputs.some(value => value.key === parameter.input)) throw new Error(`Der Wiederverwendungsparameter ${parameter.key} verweist mit input=${JSON.stringify(parameter.input)} nicht auf einen Schemafeldnamen des ausgewählten Blocks ${parameter.instanceId}. input ist ein Schlüssel, niemals der eingetragene Wert. Erlaubte Felder: ${definition?.inputs.map(value => value.key).join(', ') ?? 'Zielblock fehlt'}.`);
    }
  }
  return parsed;
}

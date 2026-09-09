import type { TestingAgentEvent, TestingCatalog, TestingCompiledScenario, TestingModel, TestingScenario } from '../../../shared/testing';
import { currentTestingChildren, currentTestingDefinition } from '../../../shared/testing';
import { invokeCodex } from './cli';
import { decodeDuplicates, decodeReuse } from './schemas';
import { duplicateComparisonCandidates, duplicateReviewSubjects } from './duplicate-context';

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
      if (attempt) throw new Error(`${input.label}: Auch die KI-Korrektur verletzt den Vertrag: ${diagnostic}`);
      input.onEvent?.({ id: `${input.id}-korrektur`, at: new Date().toISOString(), kind: 'status', message: `${input.label}: Das gleiche Modell erhält den genauen Validierungsbericht und korrigiert seine Antwort einmal.` });
    }
  }
  throw new Error(`${input.label} hat kein gültiges Ergebnis geliefert.`);
}

export function validateDuplicateReview(raw: unknown, compiled: TestingCompiledScenario, catalog: TestingCatalog) {
  const parsed = decodeDuplicates(raw);
  const candidates = duplicateReviewSubjects(compiled), keys = new Set<string>(), issues:string[]=[];
  for (const [index,decision] of parsed.decisions.entries()) {
    const key = `${decision.proposed.id}@${decision.proposed.version}`, location = `decisions[${index}] (${key})`;
    const subject = candidates.find(item => item.id === decision.proposed.id && item.version === decision.proposed.version);
    if (!subject) issues.push(`${location}: Dieser Block gehört nicht zu den verwendeten eigenen Definitionen. Erlaubte Prüfgegenstände: ${candidates.map(item => `${item.id}@${item.version}`).join(', ') || 'keine; decisions muss [] sein'}. Andere Katalogdefinitionen dienen nur als Vergleichskandidaten.`);
    if (keys.has(key)) issues.push(`${location}: Die Definition wurde mehrfach beurteilt. Prüfe jeden Prüfgegenstand genau einmal.`);
    keys.add(key);
    if (decision.decision === 'new' && decision.chosen) issues.push(`${location}: new bedeutet keine passende andere Definition; chosen muss null sein.`);
    if (decision.decision !== 'new' && !decision.chosen) issues.push(`${location}: ${decision.decision} braucht ein anderes vorhandenes chosen-Paar aus vergleichskandidaten.json.`);
    if (decision.chosen) {
      const chosenKey = `${decision.chosen.id}@${decision.chosen.version}`;
      if (chosenKey === key) issues.push(`${location}: Der Vergleichsblock ist der Prüfgegenstand selbst. Selbstvergleiche sind keine Dubletten. Vergleiche mit den anderen Kandidaten aus vergleichskandidaten.json. Falls keine passende ANDERE Definition existiert, liefere decision:"new", chosen:null mit fachlicher Begründung, auch wenn die eigene Version bereits im Katalog steht.`);
      else if (decision.chosen.id === decision.proposed.id) issues.push(`${location}: ${chosenKey} ist eine andere Version desselben Bausteins, keine Dublette. Behalte die freigegebene Version; einen Versionswechsel entscheidet der Mensch ausdrücklich im Editor. Prüfe hier nur andere Baustein-IDs.`);
      else if (!duplicateComparisonCandidates(decision.proposed, catalog).some(item => item.id === decision.chosen!.id && item.version === decision.chosen!.version)) issues.push(`${location}: Der Vergleichsblock ${chosenKey} ist nicht vorhanden. Wähle nur ein vollständiges ID-Versionspaar aus vergleichskandidaten.json.`);
    }
  }
  for (const candidate of candidates) if (!keys.has(`${candidate.id}@${candidate.version}`)) issues.push(`Die verwendete eigene Definition ${candidate.id}@${candidate.version} fehlt in der unabhängigen Dublettenprüfung.`);
  if (issues.length) throw new Error(`Die Dublettenprüfung enthält ${issues.length} Vertragsfehler. Korrigiere alle folgenden Entscheidungen gemeinsam:\n${issues.map(issue=>`- ${issue}`).join('\n')}`);

  return parsed;
}

export function validateReuseReview(raw: unknown, scenario: TestingScenario, catalog: TestingCatalog) {
  const parsed = decodeReuse(raw);
  for (const item of parsed.suggestions) {
    let siblings = scenario.blocks;
    for (const part of (item.parentPath ?? '').split('/').filter(Boolean)) {
      const parent = siblings.find(block => block.id === part);
      const definition = parent && currentTestingDefinition(catalog,parent.definition);
      if (!parent || !definition || !['context', 'workflow'].includes(definition.kind)) throw new Error(`Der vorgeschlagene übergeordnete Blockpfad ${item.parentPath} fehlt oder ist keine Komposition.`);
      siblings = currentTestingChildren(parent,catalog);
    }
    const positions = item.instanceIds.map(id => siblings.findIndex(block => block.id === id)).sort((a, b) => a - b);
    if (positions.some(index => index < 0) || new Set(positions).size !== positions.length || positions.at(-1)! - positions[0] + 1 !== positions.length) throw new Error(`„${item.name}“ muss vorhandene zusammenhängende Kind-IDs auf der Ebene ${item.parentPath ?? 'oberste Ebene'} verwenden. Dort verfügbar: ${siblings.map(block => block.id).join(', ')}.`);
    if (new Set(item.parameters.map(parameter => parameter.key)).size !== item.parameters.length) throw new Error(`„${item.name}“ enthält mehrfach vergebene Parameternamen.`);
    for (const parameter of item.parameters) {
      const block = siblings.find(value => value.id === parameter.instanceId);
      const definition = block && currentTestingDefinition(catalog,block.definition);
      if (!item.instanceIds.includes(parameter.instanceId) || !definition?.inputs.some(value => value.key === parameter.input)) throw new Error(`Der Wiederverwendungsparameter ${parameter.key} verweist mit input=${JSON.stringify(parameter.input)} nicht auf einen Schemafeldnamen des ausgewählten Blocks ${parameter.instanceId}. input ist ein Schlüssel, niemals der eingetragene Wert. Erlaubte Felder: ${definition?.inputs.map(value => value.key).join(', ') ?? 'Zielblock fehlt'}.`);
    }
  }
  return parsed;
}

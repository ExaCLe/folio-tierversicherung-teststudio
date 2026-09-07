import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { TestingAgentEvent, TestingCatalog, TestingModel, TestingScenario } from '../../../shared/testing';
import { previewTestingBusinessDraft } from '../repository';
import { invokeCodex } from './cli';
import { agentContext, businessPrompt } from './prompts';
import { BUSINESS_SCHEMA, decodeBusinessDraft } from './schemas';

/** A failed schema or compiler check is fed back to the real model once. No local
 * template changes the model's business proposal. Both attempts stay on disk. */
export async function planBusinessWithCodex(input: { id: string; model: TestingModel; request: string; catalog: TestingCatalog; scenario?: TestingScenario;
  instanceId?: string; signal?: AbortSignal; onEvent?: (event: TestingAgentEvent) => void }) {
  const prompt = businessPrompt(input.request, input.scenario ? { scenarioId: input.scenario.id, instanceId: input.instanceId! } : undefined);
  const files = agentContext(input.catalog, undefined, input.scenario);
  let previous: unknown, diagnostic = '';
  const attempts: { id: string; contextHash: string; valid: boolean; errors: string[] }[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const id = attempt === 0 ? input.id : `${input.id}-korrektur`;
    const result = await invokeCodex({ id, model: input.model, prompt: attempt === 0 ? prompt : `${prompt}\n\nDie vorherige Antwort steht in vorherige-antwort.json. Der lokale Schema-/Compilerprüfer hat diese konkreten Fehler gefunden: ${JSON.stringify(diagnostic)}. Korrigiere diese Fehler. Halte alle bereits korrekten fachlichen Werte unverändert. knowledgeRefs dürfen ausschließlich IDs aus wissen.json oder newKnowledge verwenden, niemals Dateinamen. Ein Rollen-Kontext enthält seine Schritte als children, ein leerer Kontext hat keine Wirkung. Jede Nutzererwartung braucht eine echte Assertion mit Eingabeschema; eine Note ist kein Test. Gib erneut das vollständige strukturierte Ergebnis zurück.`,
      schema: BUSINESS_SCHEMA, files: { ...files, ...(attempt ? { 'vorherige-antwort.json': JSON.stringify(previous, null, 2), 'validierungsfehler.txt': diagnostic } : {}) }, signal: input.signal, onEvent: input.onEvent });
    previous = result.value;
    try {
      const draft = decodeBusinessDraft(result.value);
      const preview = previewTestingBusinessDraft(input.request, draft, input.model, input.catalog);
      const errors = preview.compiled.issues.filter(issue => issue.severity === 'error').map(issue => `${issue.code}: ${issue.message}`);
      attempts.push({ id, contextHash: result.contextHash, valid: preview.compiled.valid, errors });
      await writeFile(resolve(result.directory, 'validated-draft.json'), JSON.stringify({ draft, preview, attempts }, null, 2));
      if (preview.compiled.valid || attempt === 1) return { result, draft, preview, attempts };
      diagnostic = errors.join('\n');
    } catch (error) {
      diagnostic = error instanceof Error ? error.message : String(error);
      attempts.push({ id, contextHash: result.contextHash, valid: false, errors: [diagnostic] });
      if (attempt === 1) throw new Error(`Auch die KI-Korrektur entspricht noch nicht dem Datenvertrag: ${diagnostic}`);
    }
    input.onEvent?.({ id: `${input.id}-korrekturhinweis`, at: new Date().toISOString(), kind: 'status', message: 'Der Prüfer hat Fehler im Agentenentwurf gefunden. Das gleiche Modell erhält den Validierungsbericht und korrigiert seine Antwort einmal.' });
  }
  throw new Error('Der fachliche Agent lieferte keinen Entwurf.');
}

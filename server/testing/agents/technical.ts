import type { TestingAgentEvent, TestingCatalog, TestingCompiledScenario, TestingModel, TestingRun } from '../../../shared/testing';
import { stableTestingStringify } from '../compiler';
import { validateTestingBinding } from '../bindings/validation';
import { invokeCodex } from './cli';
import { technicalPrompt } from './prompts';
import { decodeTechnicalPlan, TECHNICAL_SCHEMA } from './schemas';

export async function planTechnicalWithCodex(input: { id: string; model: TestingModel; catalog: TestingCatalog; compiled: TestingCompiledScenario;
  files: Record<string, string>; repairBindingId?: string; failedRun?: TestingRun; signal?: AbortSignal; onEvent?: (event: TestingAgentEvent) => void }) {
  let previous: unknown, diagnostic = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await invokeCodex({ id: attempt ? `${input.id}-korrektur` : input.id, model: input.model, schema: TECHNICAL_SCHEMA,
      prompt: `${technicalPrompt(input.repairBindingId)}${attempt ? `\n\nDie vorherige Antwort wurde NICHT übernommen. vorherige-antwort.json und validierungsfehler.txt enthalten Ergebnis und genaue Fehler. Korrigiere deine Antwort gemäß diesem Bericht: ${JSON.stringify(diagnostic)}. Verwende exakt den operation-Wert aus freigegeben.json.steps für jede definitionRef. Fehlt definition.operation, gilt unverändert definition.semanticKey. Bereits funktionierende Bindungen ohne belegten Defekt unverändert wiederverwenden. Der Bericht benennt Bindung und recipe-Index; behebe alle gemeldeten Aktionen. Bei unlessVisible trenne optionales Formularöffnen strikt vom immer auszuführenden Ausfüllen und Speichern mit capture. Entferne keine fachliche Aktion, Antwortprüfung oder Ergebniserfassung, um die Validierung zu umgehen. Gib den vollständigen korrigierten technischen Plan zurück.` : ''}`,
      files: { ...input.files, ...(attempt ? { 'vorherige-antwort.json': JSON.stringify(previous, null, 2), 'validierungsfehler.txt': diagnostic } : {}) }, signal: input.signal, onEvent: input.onEvent });
    previous = result.value;
    try {
      const plan = decodeTechnicalPlan(result.value);
      const issues: string[] = [];
      for (const item of plan.newBindings) {
        try {
          const refs = item.binding?.definitionRefs;
          if (Array.isArray(refs)) {
            const composite = refs.find(ref => input.catalog.definitions.some(definition => definition.id === ref.id && definition.version === ref.version && (definition.kind === 'workflow' || definition.kind === 'context')));
            if (composite) throw new Error(`Die Definition ${composite.id}@${composite.version} ist ein zusammengesetzter Workflow oder Rollenblock. Der Compiler führt dessen elementare Schritte aus; eine eigene UI-Bindung für den Container ist nicht zulässig. Entferne nur diese neue Container-Bindung aus dem Plan und verwende die vorhandenen Bindungsrevisionen ihrer elementaren Schritte wieder. Fachlichen Ablauf und Parameter nicht ändern.`);
            if (!refs.some(ref => input.compiled.steps.some(step => step.definition.id === ref.id && step.definition.version === ref.version))) throw new Error('Die neue Bindung gehört zu keinem elementaren Schritt dieser Freigabe. Verwende als technische Prüfgegenstände ausschließlich freigegeben.json.steps[].definition.');
          }
          const binding = validateTestingBinding(item.binding, input.catalog);
          const existing = input.catalog.bindings.filter(value => value.id === binding.id && value.status === 'ready').sort((a, b) => b.revision - a.revision)[0];
          if (!existing) continue;
          const changed = stableTestingStringify({ locators: existing.locators, recipe: existing.recipe, inputKeys: existing.inputKeys }) !== stableTestingStringify({ locators: binding.locators, recipe: binding.recipe, inputKeys: binding.inputKeys });
          const failedStep = input.failedRun?.steps.find(step => step.status === 'failed');
          const failedBinding = input.failedRun?.compiled.steps.find(step => step.path === failedStep?.path)?.binding?.id;
          const missingInput = input.compiled.steps.some(step => step.binding?.id === binding.id && Object.keys(step.inputs).some(key => !existing.inputKeys?.includes(key)));
          if (changed && input.repairBindingId !== binding.id && failedBinding !== binding.id && !missingInput) throw new Error(`Die vorhandene Bindung ${binding.id}@${existing.revision} deckt ihre Eingaben ab und hat keinen belegten Fehler. Verwende diese exakte Revision wieder. Ändere nur die neue fehlende Bindung beziehungsweise den nachweislich defekten kleinsten Block. Insbesondere bleibt die nullable Referenz proposal.referralId bei submitProposal erhalten, damit Standardverträge ohne Direktionsanfrage weiter funktionieren.`);
        } catch (error) { issues.push(`Technische Bindung ${item.binding?.id ?? '(ohne ID)'}: ${error instanceof Error ? error.message : String(error)}`); }
      }
      if (issues.length) throw new Error(issues.join('\n\n'));
      return result;
    } catch (error) {
      diagnostic = error instanceof Error ? error.message : String(error);
      if (attempt) throw new Error(`Die technische Codex-Korrektur ist weiterhin ungültig: ${diagnostic}`);
      input.onEvent?.({ id: `${input.id}-technische-korrektur`, at: new Date().toISOString(), kind: 'status', message: 'Die technische Antwort enthält einen Vertrags- oder Referenzfehler. Das gleiche Modell erhält den genauen Bericht und korrigiert den Plan einmal.' });
    }
  }
  throw new Error('Der technische Agent hat keinen gültigen Plan geliefert.');
}

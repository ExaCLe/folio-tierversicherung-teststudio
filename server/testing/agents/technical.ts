import type { TestingAgentEvent, TestingCatalog, TestingCompiledScenario, TestingModel, TestingRun } from '../../../shared/testing';
import { stableTestingStringify } from '../compiler';
import { validateTestingBinding } from '../bindings/validation';
import { invokeCodex, redactCLIText } from './cli';
import { technicalPrompt } from './prompts';
import { decodeTechnicalPlan, TECHNICAL_SCHEMA } from './schemas';

export async function planTechnicalWithCodex(input: { id: string; model: TestingModel; catalog: TestingCatalog; compiled: TestingCompiledScenario;
  files: Record<string, string>; repairBindingId?: string; failedRun?: TestingRun; signal?: AbortSignal; onEvent?: (event: TestingAgentEvent) => void }) {
  let previous: unknown, diagnostic = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await invokeCodex({ id: attempt ? `${input.id}-korrektur` : input.id, model: input.model, schema: TECHNICAL_SCHEMA,
      prompt: `${technicalPrompt(input.repairBindingId)}\n\nEin HTTP-Status ist nur belegt, wenn capture direkt an dem UI-Klick hängt, der genau diese Antwort auslöst. Ein deaktiviertes Bedienelement löst keine Anfrage aus; expectDisabled darf deshalb keinen erwarteten HTTP-Status als geprüft ausgeben. Kann eine freigegebene Forderung mit dem sicheren Rezeptvertrag nicht beobachtet werden, liefere ein strukturiertes unsupported-Objekt mit exakten Definitionsverweisen, Eingabeschlüsseln und Blockpfaden. Bei kind business-contract muss suggestedBusinessRevision einen konkreten deutschen Auftrag für die neue, menschlich zu prüfende Fachrevision enthalten. Erzeuge für dieselbe Definition keine scheinbar ausführbare Bindung.\n\n${attempt ? `Die vorherige Antwort wurde NICHT übernommen. vorherige-antwort.json und validierungsfehler.txt enthalten Ergebnis und genaue Fehler. Korrigiere deine Antwort gemäß diesem Bericht: ${JSON.stringify(diagnostic)}. Verwende exakt den operation-Wert aus freigegeben.json.steps für jede definitionRef. Fehlt definition.operation, gilt unverändert definition.semanticKey. Bereits funktionierende Bindungen ohne belegten Defekt unverändert wiederverwenden. Der Bericht benennt Bindung und recipe-Index; behebe alle gemeldeten Aktionen. Bei unlessVisible trenne optionales Formularöffnen strikt vom immer auszuführenden Ausfüllen und Speichern mit capture. Entferne keine fachliche Aktion, Antwortprüfung oder Ergebniserfassung, um die Validierung zu umgehen. Gib den vollständigen korrigierten technischen Plan zurück.` : ''}`,
      files: { ...input.files, ...(attempt ? { 'vorherige-antwort.json': JSON.stringify(previous, null, 2), 'validierungsfehler.txt': diagnostic } : {}) }, signal: input.signal, onEvent: input.onEvent });
    previous = result.value;
    const candidate=JSON.parse(redactCLIText(JSON.stringify(result.value)));
    input.onEvent?.({id:`${input.id}-entwurf-${attempt+1}`,at:new Date().toISOString(),kind:'message',message:attempt?'Korrigierter technischer Agentenplan, noch nicht geprüft.':'Technischer Agentenplan, noch nicht geprüft.',publicDetail:{type:'message',label:attempt?'Korrigierter technischer Plan · noch nicht geprüft':'Technischer Plan · noch nicht geprüft',data:candidate}});
    try {
      const plan = decodeTechnicalPlan(result.value);
      const issues: string[] = [];
      for (const unsupported of plan.unsupported) {
        const referenced = input.compiled.steps.filter(step => unsupported.affectedDefinitionRefs.some(ref => ref.id === step.definition.id && ref.version === step.definition.version));
        for (const ref of unsupported.affectedDefinitionRefs) if (!input.compiled.steps.some(step => ref.id === step.definition.id && ref.version === step.definition.version)) issues.push(`Unsupported-Meldung ${JSON.stringify(unsupported.summary)} nennt die unbekannte Definition ${ref.id}@${ref.version}.`);
        for (const path of unsupported.blockPaths) if (!referenced.some(step => step.path === path)) issues.push(`Unsupported-Meldung ${JSON.stringify(unsupported.summary)} nennt den unbekannten oder unpassenden Blockpfad ${JSON.stringify(path)}.`);
        const allowedInputs = new Set(referenced.flatMap(step => Object.keys(step.inputs)));
        for (const key of unsupported.affectedInputKeys) if (!allowedInputs.has(key)) issues.push(`Unsupported-Meldung ${JSON.stringify(unsupported.summary)} nennt die unpassende Eingabe ${JSON.stringify(key)}.`);
        if (unsupported.kind === 'business-contract' && !unsupported.suggestedBusinessRevision) issues.push(`Unsupported-Meldung ${JSON.stringify(unsupported.summary)} braucht einen konkreten Vorschlag für die fachliche KI-Überarbeitung.`);
      }
      for (const item of plan.newBindings) {
        try {
          const refs = item.binding?.definitionRefs;
          if (Array.isArray(refs)) {
            const composite = refs.find(ref => input.catalog.definitions.some(definition => definition.id === ref.id && definition.version === ref.version && (definition.kind === 'workflow' || definition.kind === 'context')));
            if (composite) throw new Error(`Die Definition ${composite.id}@${composite.version} ist ein zusammengesetzter Workflow oder Rollenblock. Der Compiler führt dessen elementare Schritte aus; eine eigene UI-Bindung für den Container ist nicht zulässig. Entferne nur diese neue Container-Bindung aus dem Plan und verwende die vorhandenen Bindungsrevisionen ihrer elementaren Schritte wieder. Fachlichen Ablauf und Parameter nicht ändern.`);
            if (!refs.some(ref => input.compiled.steps.some(step => step.definition.id === ref.id && step.definition.version === ref.version))) throw new Error('Die neue Bindung gehört zu keinem elementaren Schritt dieser Freigabe. Verwende als technische Prüfgegenstände ausschließlich freigegeben.json.steps[].definition.');
          }
          const binding = validateTestingBinding(item.binding, input.catalog);
          if (plan.unsupported.some(issue => issue.affectedDefinitionRefs.some(ref => binding.definitionRefs.some(bound => bound.id === ref.id && bound.version === ref.version)))) throw new Error('Für dieselbe Definition wurde zugleich eine ausführbare Bindung und unsupported geliefert. Entferne die scheinbar ausführbare Bindung; ein unbelegter Fachwert darf nicht nur als when-Bedingung verwendet werden.');
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
      if (attempt) throw new Error(`Die technische KI-Korrektur ist weiterhin ungültig: ${diagnostic}`);
      input.onEvent?.({ id: `${input.id}-technische-korrektur`, at: new Date().toISOString(), kind: 'status', message: 'Die automatische Prüfung hat diese Punkte im technischen Plan beanstandet. Der Agent überarbeitet sie.', publicDetail:{type:'validation',label:'Automatische Prüfung',data:{valid:false,errors:diagnostic.split('\n\n').filter(Boolean),correction:'Der bisherige Agent erhält den Fehlerbericht; es findet keine unabhängige Begutachtung statt.'}} });
    }
  }
  throw new Error('Der technische Agent hat keinen gültigen Plan geliefert.');
}

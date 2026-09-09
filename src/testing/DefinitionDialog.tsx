import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { TestingBlockDefinition, TestingKnowledgeDocument, TestingCatalog, TestingInput, TestingValue, TestingValueType } from '../../shared/testing';
import { isTestingReference } from '../../shared/testing';
import { nextDefinitionVersion } from './definitionVersions';
import { typeLabels } from './model';
import { InputDefaultEditor, findDefaultIssue } from './InputDefaultEditor';
import { Modal, Notice, Spinner } from './ui';
import { DefinitionKnowledge } from './DefinitionKnowledge';
import './testing-definitions.css';

type DraftInput = TestingInput & { generatedKey?: boolean };
const words = (name: string) => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ß/g, 'ss').toLowerCase().match(/[a-z0-9]+/g) ?? [];
export function automaticInputKey(label: string, used: string[]) {
  const parts = words(label); let base = parts.map((part, index) => index ? part[0].toUpperCase() + part.slice(1) : part).join('') || 'eingabe';
  if (!/^[a-z]/.test(base) || ['constructor', 'prototype', '__proto__'].includes(base)) base = `eingabe${base[0]?.toUpperCase() ?? ''}${base.slice(1)}`;
  let key = base; for (let suffix = 2; used.includes(key); suffix++) key = `${base}${suffix}`;
  return key;
}
function cleanInputs(inputs: DraftInput[]): TestingInput[] { return inputs.map(({ generatedKey: _generated, ...input }) => ({ ...input, ...(input.options ? { options: input.options.filter(option => option.value.trim()) } : {}), ...(input.fields ? { fields: cleanInputs(input.fields) } : {}) })); }
function incompleteInputs(inputs: TestingInput[]): boolean { return inputs.some(input => !input.label.trim() || !input.type || input.type === 'choice' && !input.options?.some(option => option.value.trim()) || incompleteInputs(input.fields ?? [])); }
const newInput = (inputs: TestingInput[]): DraftInput => ({ key: automaticInputKey('', inputs.map(input => input.key)), label: '', type: '' as TestingValueType, required: false, generatedKey: true });

export function DefinitionDialog({ definition, catalog, onSave, onClose, saveLabel, insertionHint, usageHint }: { usageHint?: string; saveLabel?: string; insertionHint?: string; definition?: TestingBlockDefinition; catalog: TestingCatalog; onSave: (definition: TestingBlockDefinition, newKnowledge?: TestingKnowledgeDocument[]) => Promise<void>; onClose: () => void }) {
  const [draft, setDraft] = useState<TestingBlockDefinition>(() => definition ? { ...structuredClone(definition), version: nextDefinitionVersion(definition, catalog.definitions), origin: 'human', status: 'draft', supersedes: { id: definition.id, version: definition.version }, createdAt: new Date().toISOString() } : { id: `fachlich.${crypto.randomUUID()}`, version: '1.0.0', name: '', description: '', kind: '' as TestingBlockDefinition['kind'], category: 'Eigene Bausteine', semanticKey: '', inputs: [], outputs: [], knowledgeRefs: [], preconditions: [], postconditions: [], status: 'draft', createdAt: new Date().toISOString(), origin: 'human' });
  const [newKnowledge, setNewKnowledge] = useState<TestingKnowledgeDocument[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const schemaIssue = findDefaultIssue(draft.inputs);
  const knowledgeIssue = !draft.knowledgeRefs.length || newKnowledge.some(doc => !doc.title.trim() || !doc.content.trim());
  const update = (patch: Partial<TestingBlockDefinition>) => setDraft(current => ({ ...current, ...patch }));
  async function save() {
    if (schemaIssue || !draft.kind || incompleteInputs(draft.inputs) || knowledgeIssue) return;
    setBusy(true); setError('');
    try {
      const preconditions=draft.preconditions.filter(value=>value.trim()),postconditions=draft.postconditions.filter(value=>value.trim());
      const description = [...preconditions.map(value => `Voraussetzung: ${value}`), ...postconditions.map(value => `Erwartete Wirkung: ${value}`)].join('\n');
      const saved = { ...draft, inputs: cleanInputs(draft.inputs),preconditions,postconditions, description: description || draft.description || draft.name };
      await onSave(saved, newKnowledge.map(doc => ({ ...doc, definitionRefs: [{ id: draft.id, version: draft.version }] }))); onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Der Block konnte nicht gespeichert werden.'); } finally { setBusy(false); }
  }
  return <Modal title={definition ? 'Eine neue Blockversion definieren' : 'Einen fachlichen Block definieren'} subtitle={definition ? usageHint ?? 'Die Änderung wird als neue Version gespeichert. Andere Verwendungen behalten ihren bisherigen Stand.' : 'Beschreibe den Block und seine Eingaben. Interne Zuordnungen entstehen automatisch.'} onClose={() => { if (!busy) onClose(); }} wide>
    <div className="t-definition-form t-definition-simple">
      {insertionHint && <Notice>{insertionHint}</Notice>}{error && <Notice tone="error">{error}</Notice>}
      <div className="t-two-fields"><div className="t-field"><label htmlFor="definition-name">Name des Blocks</label><input id="definition-name" value={draft.name} onChange={event => update({ name: event.target.value, ...(!definition ? { semanticKey: `fachlich.${words(event.target.value).join('.') || 'block'}.${draft.id.split('.').pop()}` } : {}) })} placeholder="Zum Beispiel: Tierärztlichen Nachweis prüfen" /></div>
      <div className="t-field"><label htmlFor="definition-kind">Blockart</label><select id="definition-kind" value={draft.kind} onChange={event => update({ kind: event.target.value as TestingBlockDefinition['kind'], ...(event.target.value === 'workflow' ? { body: draft.body ?? [] } : {}) })}><option value="" disabled>Blockart auswählen</option><option value="action">Aktion</option><option value="assertion">Prüfung</option><option value="workflow">Zusammengesetzter Baustein</option><option value="context">Rolle oder Gruppe</option></select></div></div>
      <section><div className="t-section-heading"><h3>Eingaben</h3><button className="t-button small" onClick={() => update({ inputs: [...draft.inputs, newInput(draft.inputs)] })}><Plus size={14}/>Eingabe ergänzen</button></div><p className="t-caption">Ein Standardwert passt, wenn er stabil und sicher ist und der Block auch ohne den ausgeblendeten Wert eindeutig bleibt. Fachlich entscheidende Werte generischer Rollen-, Berechtigungs-, Entscheidungs- und Prüfblöcke werden ausdrücklich gewählt. Ein spezialisierter Block darf einen Wert kapseln, den sein Name klar nennt.</p><InputSchemaEditor inputs={draft.inputs} onChange={inputs => update({ inputs })}/></section>
      <section><h3>Beschreibung für den Agenten</h3><div className="t-two-fields"><div className="t-field"><label htmlFor="definition-preconditions">Was muss vorher gegeben sein?</label><textarea id="definition-preconditions" rows={3} value={draft.preconditions.join('\n')} onChange={event => update({ preconditions: event.target.value.split('\n') })} placeholder="Zum Beispiel: Ein Antrag liegt zur Prüfung vor."/></div><div className="t-field"><label htmlFor="definition-postconditions">Was soll der Block bewirken?</label><textarea id="definition-postconditions" rows={3} value={draft.postconditions.join('\n')} onChange={event => update({ postconditions: event.target.value.split('\n') })} placeholder="Zum Beispiel: Die Entscheidung ist gespeichert und sichtbar."/></div></div></section>
      <DefinitionKnowledge documents={catalog.knowledge} selected={draft.knowledgeRefs} newDocuments={newKnowledge} onSelected={knowledgeRefs => update({ knowledgeRefs })} onNew={setNewKnowledge}/>
      <footer className="t-dialog-actions"><button className="t-button" onClick={onClose} disabled={busy}>Abbrechen</button><button className="t-button primary" onClick={save} disabled={busy || !!schemaIssue || knowledgeIssue || !draft.name.trim() || !draft.kind || incompleteInputs(draft.inputs)}>{busy ? <Spinner label="Wird gespeichert"/> : saveLabel ?? 'Definition speichern'}</button></footer>
    </div>
  </Modal>;
}

function InputSchemaEditor({ inputs, onChange }: { inputs: DraftInput[]; onChange: (inputs: DraftInput[]) => void }) {
  const withoutReferenceTypes = (value: TestingValue): TestingValue => isTestingReference(value) ? { ref: value.ref } : Array.isArray(value) ? value.map(withoutReferenceTypes) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, withoutReferenceTypes(item)])) : value;
  const update = (index: number, patch: Partial<DraftInput>) => onChange(inputs.map((input, i) => i === index ? { ...input, ...patch, ...(patch.type && patch.type !== input.type && input.default !== undefined ? { default: withoutReferenceTypes(input.default) } : {}) } : input));
  return <div className="t-schema-fields">{inputs.map((input, index) => <div key={index} className="t-schema-field">
    <div className="t-schema-row"><label className="t-field">Name<input aria-label={`Bezeichnung der Eingabe ${index + 1}`} value={input.label} placeholder="Name der Eingabe" onChange={event => update(index, { label: event.target.value, ...(input.generatedKey ? { key: automaticInputKey(event.target.value, inputs.filter((_, i) => i !== index).map(item => item.key)) } : {}) })}/></label>
      <label className="t-field">Typ<select aria-label={`Datentyp der Eingabe ${index + 1}`} value={input.type} onChange={event => update(index, { type: event.target.value as TestingValueType })}><option value="" disabled>Typ auswählen</option>{Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="t-check-label"><input type="checkbox" aria-label={`Pflichteingabe ${index + 1}`} checked={input.required ?? false} onChange={event => update(index, { required: event.target.checked })}/>Pflicht</label>
      <InputDefaultEditor input={input} compact onChange={value => update(index, { default: value })}/>
      <button className="t-icon danger" aria-label={`Eingabe ${index + 1} entfernen`} onClick={() => onChange(inputs.filter((_, i) => i !== index))}><Trash2 size={15}/></button>
    </div>
    {input.type === 'object' && <div className="t-schema-nested"><InputSchemaEditor inputs={input.fields ?? []} onChange={fields => update(index, { fields })}/><button className="t-button small" onClick={() => update(index, { fields: [...input.fields ?? [], newInput(input.fields ?? [])] })}><Plus size={14}/>Unterfeld ergänzen</button></div>}
    {input.type === 'choice' && <div className="t-field"><label>Auswahlwerte<small>Ein Wert pro Zeile</small></label><textarea rows={2} value={input.options?.map(option => option.value).join('\n') ?? ''} onChange={event => update(index, { options: event.target.value.split('\n').map(value => ({ value, label: value })) })}/></div>}
  </div>)}</div>;
}

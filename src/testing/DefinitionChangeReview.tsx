import { useState } from 'react';
import { ArrowRight, Check, GitBranch } from 'lucide-react';
import type {
  TestingCatalog,
  TestingDefaultDecision,
  TestingDefinitionChangePreview,
  TestingDefinitionChangeRequest,
  TestingDefinitionScenarioChange,
  TestingInput,
  TestingScenario,
  TestingValidationIssue,
  TestingValue,
} from '../../shared/testing';
import { flattenBlocks } from './model';
import { buildReferenceIndex } from './references';
import { ValueEditor } from './Inspector';
import { Modal, Notice, Spinner } from './ui';

const behaviorLabels: Record<TestingDefinitionScenarioChange['behavior'], string> = {
  'fachlich-unveraendert': 'Fachliche Werte bleiben erhalten',
  'testdefinition-aendern': 'Testdefinition wird angepasst',
  'nicht-anwendbar': 'Nicht automatisch anwendbar',
};
const sourceLabels: Record<NonNullable<TestingDefinitionScenarioChange['changes'][number]['source']>, string> = {
  standard: 'Bisher aus dem Standard übernommen',
  ausdruecklich: 'Ausdrücklich in diesem Testfall gesetzt',
  override: 'Lokale Abweichung im zusammengesetzten Block',
  parameter: 'Über einen Blockparameter gesetzt',
  matrix: 'Aus der Testdatenzeile',
};
type ValueResolution = NonNullable<TestingDefinitionChangeRequest['valueResolutions']>[string];

function valueLabel(value: TestingValue | undefined) {
  if (value === undefined) return 'Kein Wert';
  if (typeof value === 'string') return value || 'Leerer Text';
  if (typeof value === 'number') return new Intl.NumberFormat('de-DE').format(value);
  if (typeof value === 'boolean') return value ? 'Ja' : 'Nein';
  return JSON.stringify(value);
}

function decisionKey(scenarioId: string, path: string, field: string) {
  return `${scenarioId}:${path}:${field}`;
}

function inputHasDefault(inputs: TestingInput[], field: string): boolean {
  const [head, ...tail] = field.split('.');
  const input = inputs.find(item => item.key === head);
  return !!input && (tail.length ? inputHasDefault(input.fields ?? [], tail.join('.')) : input.default !== undefined);
}

function inputAtPath(inputs: TestingInput[], field: string): TestingInput | undefined {
  const [head, ...tail] = field.split('.');
  const input = inputs.find(item => item.key === head);
  return tail.length ? inputAtPath(input?.fields ?? [], tail.join('.')) : input;
}

function validResolutionValue(input: TestingInput, value: TestingValue | undefined) {
  if (value === undefined || value === '') return !input.required;
  if (input.type === 'number' || input.type === 'money') return typeof value === 'number' && Number.isFinite(value);
  if (input.type === 'boolean') return typeof value === 'boolean';
  if (input.type.endsWith('-ref')) return !!value && typeof value === 'object' && !Array.isArray(value) && 'ref' in value && !!value.ref;
  if (input.type === 'object') return !!value && typeof value === 'object' && !Array.isArray(value);
  if (input.type === 'list') return Array.isArray(value);
  return typeof value === 'string';
}

function blockLabel(scenario: TestingScenario | undefined, catalog: TestingCatalog, path: string) {
  const entry = scenario && flattenBlocks(scenario.blocks, catalog).find(item => item.path === path);
  if (!entry) return path;
  const labels: string[] = [];
  let current = entry;
  while (current) { labels.unshift(current.block.label || current.definition?.name || current.block.id); current = current.parent!; }
  return labels.join(' › ');
}

function pathList(label: string, paths: string[], labelFor: (path: string) => string) {
  if (!paths.length) return null;
  return <div className="t-definition-change-paths"><strong>{label}</strong><ul>{paths.map(path => <li key={path}><span>{labelFor(path)}</span><code>{path}</code></li>)}</ul></div>;
}

function ResolutionEditor({ diagnostic, resolutionKey, preview, scenario, catalog, busy, onResolution }: { diagnostic: TestingValidationIssue; resolutionKey: string; preview: TestingDefinitionChangePreview; scenario?: TestingScenario; catalog: TestingCatalog; busy: boolean; onResolution: (key: string, resolution: ValueResolution) => Promise<void> }) {
  const current = preview.valueResolutions[resolutionKey];
  const input = diagnostic.field ? inputAtPath(preview.definition.inputs, diagnostic.field) : undefined;
  const [value, setValue] = useState<TestingValue | undefined>(() => current?.action === 'wert-setzen' ? current.value : input?.default);
  const [targetField, setTargetField] = useState(() => current?.action === 'feld-zuordnen' ? current.targetField : '');
  const [submitting, setSubmitting] = useState(false);
  const submit = async (resolution: ValueResolution) => { setSubmitting(true); try { await onResolution(resolutionKey, resolution); } finally { setSubmitting(false); } };
  const canDiscard = diagnostic.code === 'INPUT_REMOVED';
  const candidates = preview.definition.inputs.filter(input => input.key !== diagnostic.field);
  const references = buildReferenceIndex(scenario ? flattenBlocks(scenario.blocks, catalog) : [], scenario?.parameters);
  return <fieldset className="t-definition-resolution" disabled={busy || submitting}>
    <legend>Diesen Wert auflösen</legend>
    {!canDiscard && input && <div className="t-definition-resolution-value"><ValueEditor input={input} path={`definition-change-${diagnostic.field}`} value={value} onChange={setValue} references={references} entryPath={diagnostic.path ?? ''}/><button className="t-button small" disabled={!validResolutionValue(input, value)} onClick={() => void submit({ action: 'wert-setzen', value: value! })}>Wert übernehmen</button></div>}
    {!canDiscard && !input && <Notice tone="error">Das betroffene Feld ist in der neuen Definition nicht eindeutig auffindbar. Prüfe die Felddefinition erneut.</Notice>}
    {canDiscard && <button className="t-button small" onClick={() => void submit({ action: 'feld-verwerfen' })}>Bisherigen Feldwert geprüft verwerfen</button>}
    {canDiscard && !!candidates.length && <div className="t-definition-resolution-map"><select aria-label={`Neues Zielfeld für ${diagnostic.field ?? 'das entfernte Feld'}`} value={targetField} onChange={event => setTargetField(event.target.value)}><option value="">Anderem Feld zuordnen …</option>{candidates.map(input => <option key={input.key} value={input.key}>{input.label}</option>)}</select><button className="t-button small" disabled={!targetField} onClick={() => void submit({ action: 'feld-zuordnen', targetField })}>Zuordnen</button></div>}
    {(submitting || current) && <small>{submitting ? 'Die Auswirkung wird neu berechnet …' : current?.action === 'wert-setzen' ? 'Ein neuer Wert ist festgelegt.' : current?.action === 'feld-verwerfen' ? 'Der bisherige Feldwert wird verworfen.' : 'Der bisherige Wert wird einem neuen Feld zugeordnet.'}</small>}
  </fieldset>;
}

export function DefinitionChangeReview({
  preview,
  catalog,
  scenarios,
  busy,
  error,
  onDecision,
  onResolution,
  onRefresh,
  onApply,
  onClose,
}: {
  preview: TestingDefinitionChangePreview;
  catalog: TestingCatalog;
  scenarios: TestingScenario[];
  busy: boolean;
  error?: string;
  onDecision: (key: string, decision: TestingDefaultDecision) => Promise<void>;
  onResolution: (key: string, resolution: ValueResolution) => Promise<void>;
  onRefresh: () => Promise<void>;
  onApply: () => Promise<void>;
  onClose: () => void;
}) {
  const [changingDecision, setChangingDecision] = useState('');
  const blockedCount = preview.blockedCaseCount;
  const decide = async (key: string, decision: TestingDefaultDecision) => {
    setChangingDecision(key);
    try { await onDecision(key, decision); } finally { setChangingDecision(''); }
  };
  return <Modal title="Änderung der Blockdefinition prüfen" subtitle={`„${preview.definition.name}“ wird erst nach deiner Bestätigung gemeinsam aktualisiert.`} onClose={() => { if (!busy && !changingDecision) onClose(); }} wide>
    <div className="t-definition-change-review">
      {error && <Notice tone="error">{error}</Notice>}
      {preview.blocked && <Notice tone="error">Die Änderung kann so noch nicht übernommen werden. Prüfe die markierten Testfälle und Hinweise.</Notice>}
      <div className="t-definition-change-summary with-blocked" aria-label="Auswirkung der Definitionsänderung">
        <div><strong>{preview.affectedCaseCount}</strong><span>betroffene Testausprägungen</span></div>
        <div><strong>{preview.changedCaseCount}</strong><span>fachlich geändert</span></div>
        <div><strong>{preview.unchangedCaseCount}</strong><span>fachlich unverändert</span></div>
        <div><strong>{blockedCount}</strong><span>noch nicht anwendbar</span></div>
      </div>
      <p className="t-definition-change-intro">{preview.affectedScenarioCount} {preview.affectedScenarioCount === 1 ? 'Testfall' : 'Testfälle'} mit insgesamt {preview.affectedCaseCount} Ausprägung{preview.affectedCaseCount === 1 ? '' : 'en'} {preview.affectedScenarioCount === 1 ? 'ist' : 'sind'} betroffen. Direkte und verschachtelte Verwendungen sind getrennt ausgewiesen. Bei geänderten Standardwerten entscheidest du für jeden betroffenen Wert, ob der neue Standard gelten oder der bisherige Wert ausdrücklich erhalten bleiben soll.</p>
      {preview.technicalPreparation && <Notice>{preview.technicalPreparation.status === 'wiederverwendbar' ? 'Die vorhandene technische Umsetzung kann weiterverwendet werden.' : 'Die technische Umsetzung muss nach dieser fachlichen Änderung erneut geprüft werden.'} {preview.technicalPreparation.reason}</Notice>}
      {!preview.scenarios.length && <Notice>Kein bearbeitbarer Testfall verwendet diese Definition. Die neue Definition kann ohne Testfalländerung veröffentlicht werden.</Notice>}
      <div className="t-definition-change-scenarios">
        {preview.scenarios.map(scenario => {
          const savedScenario = scenarios.find(item => item.id === scenario.scenarioId);
          const labelFor = (path: string) => blockLabel(savedScenario, catalog, path);
          const renderedResolutions = new Set<string>();
          return <article key={scenario.scenarioId} className={`t-definition-change-scenario ${scenario.behavior}`}>
          <header>
            <div><h3><a href={`/testing/editor/${encodeURIComponent(scenario.scenarioId)}`} target="_blank" rel="noreferrer">{scenario.title}</a></h3><small>Revision {scenario.revision} · {scenario.affectedCaseCount} Ausprägung{scenario.affectedCaseCount === 1 ? '' : 'en'}</small></div>
            <span>{scenario.direct ? 'Direkt verwendet' : 'Verschachtelt verwendet'}</span>
          </header>
          <p className="t-definition-change-behavior"><Check size={14}/>{behaviorLabels[scenario.behavior]}</p>
          <div className="t-definition-change-path-grid">
            {pathList('Direkte Stellen', scenario.directPaths, labelFor)}
            {pathList('Verschachtelte Stellen', scenario.transitivePaths, labelFor)}
          </div>
          {!!scenario.changes.length && <div className="t-definition-change-list">
            {scenario.changes.map((change, index) => {
              const key = change.decisionKey ?? decisionKey(scenario.scenarioId, change.path, change.field);
              const selectable = !!change.decisionKey || change.decisionRequired || scenario.diagnostics.some(diagnostic => diagnostic.code === 'DEFAULT_DECISION_REQUIRED' && diagnostic.path === change.path && diagnostic.field === change.field) || inputHasDefault(preview.definition.inputs, change.field) && /standardwert|standard/i.test(change.reason);
              return <section key={`${change.path}:${change.field}:${index}`}>
                <div className="t-definition-change-field">
                  <div><strong>{change.label}</strong><small>{labelFor(change.path)} · <code>{change.field}</code></small></div>
                  <div className="t-definition-change-values"><span>{valueLabel(change.before)}</span><ArrowRight size={14}/><span>{valueLabel(change.after)}</span></div>
                </div>
                {change.source && <span className="t-definition-change-source">{sourceLabels[change.source]}</span>}
                <p>{change.reason}</p>
                {selectable && <fieldset disabled={busy || !!changingDecision}>
                  <legend>Welcher Wert soll für diese Teststelle gelten?</legend>
                  <label><input type="radio" name={key} checked={preview.defaultDecisions[key] === 'neuen-standard-uebernehmen'} onChange={() => void decide(key, 'neuen-standard-uebernehmen')}/>Neuen Standard übernehmen</label>
                  <label><input type="radio" name={key} checked={preview.defaultDecisions[key] === 'bisherigen-wert-beibehalten' || !change.decisionRequired && change.source === 'ausdruecklich' && !preview.defaultDecisions[key]} onChange={() => void decide(key, 'bisherigen-wert-beibehalten')}/>Bisherigen Wert ausdrücklich beibehalten</label>
                  {changingDecision === key && <Spinner label="Auswirkung wird neu berechnet"/>}
                </fieldset>}
              </section>;
            })}
          </div>}
          {!!scenario.matrixRows.length && <div className="t-definition-change-matrix"><strong>Testdatenzeilen</strong>{scenario.matrixRows.map(row => <details key={row.rowId}><summary><span>{row.rowLabel}</span><small>{behaviorLabels[row.behavior]}</small></summary>{!!row.changes?.length && <ul>{row.changes.map((change, index) => <li key={`${change.path}:${change.field}:${index}`}><strong>{change.label}:</strong> {valueLabel(change.before)} → {valueLabel(change.after)}</li>)}</ul>}{!!row.diagnostics?.length && <div>{row.diagnostics.map((diagnostic, index) => <Notice key={`${diagnostic.code}:${index}`} tone={diagnostic.severity === 'error' ? 'error' : 'info'}>{diagnostic.message}</Notice>)}</div>}</details>)}</div>}
          {!!scenario.diagnostics.length && <div className="t-definition-change-diagnostics">{scenario.diagnostics.map((diagnostic, index) => { const key = `${scenario.scenarioId}:${diagnostic.path ?? ''}:${diagnostic.field ?? ''}`; const showResolution = diagnostic.severity === 'error' && !!diagnostic.field && diagnostic.code !== 'DEFAULT_DECISION_REQUIRED' && !renderedResolutions.has(key); if (showResolution) renderedResolutions.add(key); return <div key={`${diagnostic.code}:${index}`}><Notice tone={diagnostic.severity === 'error' ? 'error' : 'info'}>{diagnostic.message}</Notice>{showResolution && <ResolutionEditor diagnostic={diagnostic} resolutionKey={key} preview={preview} scenario={savedScenario} catalog={catalog} busy={busy || !!changingDecision} onResolution={onResolution}/>}</div>; })}</div>}
        </article>;})}
      </div>
      <Notice>Beim Entfernen eines Standardwerts wird der bisherige Standard als ausdrücklicher Testwert gespeichert. Bereits ausdrücklich gesetzte abweichende Werte bleiben erhalten.</Notice>
      <footer className="t-dialog-actions"><button className="t-button" onClick={onClose} disabled={busy || !!changingDecision}>Abbrechen</button><button className="t-button" onClick={() => void onRefresh()} disabled={busy || !!changingDecision}>Vorschau aktualisieren</button><button className="t-button primary" onClick={() => void onApply()} disabled={busy || !!changingDecision || preview.blocked}>{busy ? <Spinner label="Änderung wird übernommen"/> : <><GitBranch size={15}/>Geprüfte Änderung übernehmen</>}</button></footer>
    </div>
  </Modal>;
}

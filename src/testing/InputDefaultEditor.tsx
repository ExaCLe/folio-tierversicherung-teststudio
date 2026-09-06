import { useEffect, useId, useState } from 'react';
import type { TestingInput, TestingValue } from '../../shared/testing';
import { isTestingParameter, isTestingReference } from '../../shared/testing';
import { defaultsForInput, formatGermanNumber, parseGermanNumber } from './model';

function defaultIssue(input: TestingInput): string | undefined {
  const value = input.default;
  if (value === undefined || value === null) return;
  if (isTestingParameter(value)) return value.param.trim() ? undefined : 'Bitte den Namen des übergeordneten Parameters angeben.';
  if (isTestingReference(value)) return value.ref.trim() ? undefined : 'Bitte die Ergebnisreferenz eines früheren Schritts angeben.';
  if (input.type.endsWith('-ref')) return 'Dieser Standardwert muss auf ein Ergebnis eines früheren Schritts verweisen.';
  if (input.type === 'number' || input.type === 'money') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 'Bitte eine gültige Zahl eingeben, zum Beispiel 15.000,50.';
    if (input.minimum !== undefined && value < input.minimum) return `Der Standardwert muss mindestens ${formatGermanNumber(input.minimum)} betragen.`;
    if (input.maximum !== undefined && value > input.maximum) return `Der Standardwert darf höchstens ${formatGermanNumber(input.maximum)} betragen.`;
  } else if (input.type === 'boolean' && typeof value !== 'boolean') return 'Bitte Ja oder Nein auswählen.';
  else if (input.type === 'list' && !Array.isArray(value)) return 'Bitte eine gültige JSON-Liste eingeben, zum Beispiel ["Wert"].';
  else if (input.type === 'object' && (typeof value !== 'object' || Array.isArray(value))) return 'Bitte gültige JSON-Wertepaare eingeben, zum Beispiel {"name": "Wert"}.';
  else if (['text', 'date', 'choice'].includes(input.type)) {
    if (typeof value !== 'string') return 'Bitte einen Textwert angeben.';
    if (input.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'Bitte ein Datum auswählen.';
    if (input.type === 'choice' && input.options?.length && !input.options.some(option => option.value === value)) return 'Bitte einen der definierten Auswahlwerte wählen.';
  }
}

export function findDefaultIssue(inputs: TestingInput[]): string | undefined {
  for (const input of inputs) {
    const issue = defaultIssue(input);
    if (issue) return `${input.label || input.key}: ${issue}`;
    const nested = findDefaultIssue(input.fields ?? []);
    if (nested) return nested;
  }
}

function valueText(value: TestingValue | undefined): string {
  if (typeof value === 'number') return formatGermanNumber(value);
  if (value === undefined) return '';
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

export function InputDefaultEditor({ input, onChange }: { input: TestingInput; onChange: (value: TestingValue | undefined) => void }) {
  const id = useId();
  const value = input.default;
  const label = input.label || input.key || 'diese Eingabe';
  const numeric = input.type === 'number' || input.type === 'money';
  const structured = input.type === 'object' || input.type === 'list';
  const mode = value === undefined ? 'none' : value === null ? 'null' : isTestingParameter(value) ? 'parameter' : isTestingReference(value) ? 'reference' : 'literal';
  const [text, setText] = useState(() => valueText(value));
  useEffect(() => {
    // Preserve partially typed German decimals and JSON formatting. Display
    // state never rewrites an untouched parameter, reference or default.
    if (numeric && typeof value === 'number' && parseGermanNumber(text) === value) return;
    if (structured && value && typeof value === 'object') {
      try { if (JSON.stringify(JSON.parse(text)) === JSON.stringify(value)) return; } catch { /* A different default replaces the previous editor text. */ }
    }
    setText(valueText(value));
  }, [value, input.type]);
  const issue = defaultIssue(input);
  const inputProps = { id: `${id}-value`, 'aria-label': `Standardwert für ${label}`, 'aria-invalid': !!issue, 'aria-describedby': issue ? `${id}-error` : undefined };
  function changeMode(next: string) {
    if (next === 'none') onChange(undefined);
    else if (next === 'parameter') onChange({ param: '' });
    else if (next === 'reference') onChange({ ref: '', ...(input.type.endsWith('-ref') ? { type: input.type } : {}) });
    else if (next === 'null') onChange(null);
    else onChange(defaultsForInput({ ...input, default: undefined }));
  }
  let control;
  if (mode === 'parameter' && isTestingParameter(value)) {
    control = <><input {...inputProps} value={value.param} placeholder="Name des übergeordneten Parameters" onChange={event => onChange({ ...value, param: event.target.value })} /><p>Der Wert wird beim Verwenden aus dem übergeordneten Baustein gelesen.</p></>;
  } else if (mode === 'reference' && isTestingReference(value)) {
    control = <><input {...inputProps} value={value.ref} placeholder="Zum Beispiel: vorschlag" onChange={event => onChange({ ...value, ref: event.target.value })} /><p>Die Referenz muss im jeweiligen Ablauf durch einen früheren Schritt erzeugt werden.</p></>;
  } else if (mode === 'literal') {
    if (input.type === 'boolean') control = <select {...inputProps} value={String(value)} onChange={event => onChange(event.target.value === 'true')}><option value="true">Ja</option><option value="false">Nein</option></select>;
    else if (input.type === 'choice' && input.options?.length) control = <select {...inputProps} value={typeof value === 'string' ? value : ''} onChange={event => onChange(event.target.value)}>{!input.options.some(option => option.value === value) && <option value={typeof value === 'string' ? value : ''}>{typeof value === 'string' && value ? `${value} (bisheriger Wert)` : 'Bitte auswählen'}</option>}{input.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>;
    else if (structured) control = <><textarea {...inputProps} rows={3} value={text} onChange={event => { const raw = event.target.value; setText(raw); try { onChange(JSON.parse(raw) as TestingValue); } catch { onChange(raw); } }} /><p>{input.type === 'list' ? 'Die Liste wird als JSON gespeichert, zum Beispiel ["Rind", "Pferd"].' : 'Wertepaare werden als JSON gespeichert. Einzelne Unterfelder können zusätzlich eigene Standardwerte erhalten.'}</p></>;
    else control = <div className="t-value-with-unit"><input {...inputProps} type={input.type === 'date' ? 'date' : 'text'} inputMode={numeric ? 'decimal' : undefined} value={numeric ? text : typeof value === 'string' ? value : valueText(value)} onChange={event => { if (numeric) { setText(event.target.value); onChange(parseGermanNumber(event.target.value) ?? event.target.value); } else onChange(event.target.value); }} onBlur={() => { if (numeric && typeof value === 'number') setText(formatGermanNumber(value)); }} />{input.type === 'money' && <span>EUR</span>}</div>;
  }
  return <div className="t-schema-default"><div className="t-field"><label htmlFor={`${id}-mode`}>Standardwert<small>{label}</small></label><select id={`${id}-mode`} aria-label={`Art des Standardwerts für ${label}`} value={mode} onChange={event => changeMode(event.target.value)}><option value="none">Kein Standardwert</option><option value="literal" disabled={input.type.endsWith('-ref')}>Fester Wert</option><option value="parameter">Wert aus übergeordnetem Baustein</option><option value="reference">Ergebnis eines früheren Schritts</option>{value === null && <option value="null">Leerwert (null)</option>}</select></div>{control && <div className="t-field"><label htmlFor={`${id}-value`}>{mode === 'parameter' ? 'Parametername' : mode === 'reference' ? 'Ergebnisreferenz' : `Standardwert für ${label}`}</label>{control}{issue && <p id={`${id}-error`} role="alert">{issue}</p>}</div>}</div>;
}

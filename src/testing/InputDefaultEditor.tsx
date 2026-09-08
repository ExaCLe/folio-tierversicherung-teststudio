import { useEffect, useId, useState } from 'react';
import type { TestingInput, TestingValue } from '../../shared/testing';
import { isTestingParameter, isTestingReference } from '../../shared/testing';
import { formatGermanNumber, parseGermanNumber } from './model';

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

export function InputDefaultEditor({ input, onChange, compact = false }: { input: TestingInput; compact?: boolean; onChange: (value: TestingValue | undefined) => void }) {
  const id = useId();
  const value = input.default;
  const label = input.label || input.key || 'diese Eingabe';
  const numeric = input.type === 'number' || input.type === 'money';
  const structured = input.type === 'object' || input.type === 'list';
  const [chosenMode,setChosenMode] = useState('none');
  const mode = value === undefined ? chosenMode : value === null ? 'null' : isTestingParameter(value) ? 'parameter' : isTestingReference(value) ? 'reference' : 'literal';
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
    setChosenMode(next);
    if (next === 'none') onChange(undefined);
    else if (next === 'literal') onChange(input.type === 'list' ? [] : undefined);
  }
  let control;
  if (mode === 'parameter' || mode === 'reference') {
    control = <p>Der gespeicherte Standardwert verwendet {mode === 'parameter' ? 'einen Wert aus dem übergeordneten Baustein' : 'das Ergebnis eines früheren Schritts'}. Er bleibt erhalten. Wähle die konkrete Zuordnung beim Verwenden im Testfall.</p>;
  } else if (mode === 'literal') {
    if (input.type === 'boolean') control = <select {...inputProps} value={value === undefined ? '' : String(value)} onChange={event => onChange(event.target.value === 'true')}><option value="" disabled>Bitte auswählen</option><option value="true">Ja</option><option value="false">Nein</option></select>;
    else if (input.type === 'choice' && input.options?.length) control = <select {...inputProps} value={typeof value === 'string' ? value : ''} onChange={event => onChange(event.target.value)}>{!input.options.some(option => option.value === value) && <option value={typeof value === 'string' ? value : ''}>{typeof value === 'string' && value ? `${value} (bisheriger Wert)` : 'Bitte auswählen'}</option>}{input.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>;
    else if (input.type === 'list' && (!value || Array.isArray(value) && value.every(item => ['string','number','boolean'].includes(typeof item)))) {
      const items = Array.isArray(value) ? value : [];
      control = <div className="t-default-list">{items.map((item,index) => <div key={index}>{typeof item === 'boolean' ? <select aria-label={`${label}: Standardwert ${index+1}`} value={String(item)} onChange={event => onChange(items.map((old,i) => i===index ? event.target.value==='true' : old))}><option value="true">Ja</option><option value="false">Nein</option></select> : <input aria-label={`${label}: Standardwert ${index+1}`} value={String(item)} onChange={event => onChange(items.map((old,i) => i===index ? typeof item==='number' ? parseGermanNumber(event.target.value) ?? event.target.value : event.target.value : old))}/>}<button type="button" aria-label={`${label}: Standardwert ${index+1} entfernen`} onClick={() => onChange(items.filter((_,i) => i!==index))}>Entfernen</button></div>)}<button type="button" className="t-button small" onClick={() => onChange([...items,''])}>Wert hinzufügen</button></div>;
    } else if (structured) control = <p>Die gespeicherten {input.type==='object'?'Werte der Unterfelder':'zusammengesetzten Listenwerte'} bleiben erhalten. Bearbeite konkrete Werte beim Verwenden im Testfall. Für neue Unterfelder kannst du unten eigene Standardwerte festlegen.</p>;
    else control = <div className="t-value-with-unit"><input {...inputProps} type={input.type === 'date' ? 'date' : 'text'} inputMode={numeric ? 'decimal' : undefined} value={numeric ? text : typeof value === 'string' ? value : valueText(value)} onChange={event => { if (numeric) { setText(event.target.value); onChange(event.target.value.trim() ? parseGermanNumber(event.target.value) ?? event.target.value : undefined); } else onChange(event.target.value); }} onBlur={() => { if (numeric && typeof value === 'number') setText(formatGermanNumber(value)); }} />{input.type === 'money' && <span>EUR</span>}</div>;
  }
  return <div className={`t-schema-default ${compact ? 'compact' : ''}`}><div className="t-field"><label htmlFor={`${id}-mode`}>Standardwert{!compact && <small>{label}</small>}</label><select id={`${id}-mode`} disabled={!input.type} aria-label={`Art des Standardwerts für ${label}`} value={mode} onChange={event => changeMode(event.target.value)}><option value="none">Kein Standardwert</option><option value="literal" disabled={input.type.endsWith('-ref') || input.type==='object'}>Fester Wert</option>{mode==='parameter' && <option value="parameter">Übergeordneter Wert (gespeichert)</option>}{mode==='reference' && <option value="reference">Früheres Ergebnis (gespeichert)</option>}{value === null && <option value="null">Leerwert (gespeichert)</option>}</select>{input.type.endsWith('-ref') && value===undefined && <p>Das Ergebnis wählst du beim Verwenden im Testfall.</p>}{input.type==='object' && value===undefined && <p>Standardwerte kannst du für die einzelnen Unterfelder festlegen.</p>}</div>{control && <div className="t-field t-default-control"><label htmlFor={`${id}-value`}>{compact ? 'Wert' : `Standardwert für ${label}`}</label>{control}{issue && <p id={`${id}-error`} role="alert">{issue}</p>}</div>}</div>;
}

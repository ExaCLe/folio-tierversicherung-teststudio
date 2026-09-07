import { ArrowUpRight, Link2 } from 'lucide-react';
import type { TestingValue, TestingValueType } from '../../shared/testing';
import { isTestingReference } from '../../shared/testing';
import { describeReference, referenceChoices, type ReferenceIndex } from './references';
import './references.css';
import { typeLabels } from './model';

export function ReferenceValue({ id, value, type, index, path, onChange, onSource, typeIsAnnotation = false }: {
  typeIsAnnotation?: boolean; id: string; value?: TestingValue; type?: TestingValueType; index: ReferenceIndex; path: string;
  onChange?: (value: TestingValue) => void; onSource?: (path: string) => void;
}) {
  const description = describeReference(index, path, value, type, typeIsAnnotation);
  const options = referenceChoices(index, path, type?.endsWith('-ref') ? type : undefined);
  const current = description.status === 'available' ? description.source?.value : '__unavailable__';
  return <div className="t-result-reference" data-reference-status={description.status}>
    {onChange && <select id={id} value={current ?? '__unavailable__'} onChange={event => { const option = options.find(item => item.value === event.target.value); if (option) onChange({ ref: option.value, type: option.type }); }}>
      {description.status !== 'available' && <option value="__unavailable__" disabled>{description.status === 'type' && type ? `Benötigt: ${typeLabels[type]} · Ergebnis neu auswählen` : description.label}</option>}
      {options.map(option => <option key={`${option.value}:${option.key}`} value={option.value}>{option.label}</option>)}
    </select>}
    <div className="t-result-description"><Link2 size={14} /><span>{description.label}</span></div>
    {description.source && onSource && <button type="button" className="t-result-source" onClick={() => onSource(description.source!.sourcePath)}><ArrowUpRight size={14} />Quelle im Ablauf zeigen · Schritt {description.source.step}</button>}
    {onChange && !options.length && <p>Vor diesem Schritt ist kein passendes Ergebnis verfügbar.</p>}
    {value !== undefined && <details className="t-result-details"><summary>Technischen Verweis anzeigen</summary><code>{isTestingReference(value) ? value.ref || 'Leer' : JSON.stringify(value)}</code></details>}
  </div>;
}

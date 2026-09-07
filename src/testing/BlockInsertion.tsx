import { useState } from 'react';
import { Plus, Search } from 'lucide-react';
import type { TestingBlockDefinition, TestingCatalog } from '../../shared/testing';
import type { BlockEntry } from './model';
import { kindLabels } from './model';
import { Modal } from './ui';

export interface InsertionTarget { scenarioId: string; parentPath?: string }

export function BlockInsertion({ scenarioId, entry, catalog, onAdd, onDefine }: {
  scenarioId: string;
  entry?: BlockEntry;
  catalog: TestingCatalog;
  onAdd: (definition: TestingBlockDefinition, target: InsertionTarget) => void;
  onDefine: (target: InsertionTarget) => void;
}) {
  const [within, setWithin] = useState(false);
  const [picker, setPicker] = useState(false);
  const [query, setQuery] = useState('');
  const container = entry && (entry.definition?.kind === 'workflow' || entry.definition?.kind === 'context') ? entry : undefined;
  const target = { scenarioId, ...(within && container ? { parentPath: container.path } : {}) };
  const targetLabel = target.parentPath ? `Am Ende von „${container?.block.label || container?.definition?.name}“` : 'Am Ende des Ablaufs';
  const matches = catalog.definitions.filter(definition => `${definition.name} ${definition.description} ${definition.category} ${definition.id}`.toLocaleLowerCase('de').includes(query.toLocaleLowerCase('de')));
  return <section className="t-block-insertion" aria-label="Blöcke zum Ablauf hinzufügen">
    <div className="t-insertion-heading"><strong>Ablauf ergänzen</strong><label>Einfügestelle<select aria-label="Einfügestelle" value={target.parentPath ? 'within' : 'end'} onChange={event => setWithin(event.target.value === 'within')}><option value="end">Am Ende des Ablaufs</option>{container && <option value="within">Innerhalb von {container.block.label || container.definition?.name}</option>}</select></label></div>
    <div className="t-insertion-actions"><button className="t-button" onClick={() => { setQuery(''); setPicker(true); }}><Search size={15} />Vorhandenen Block hinzufügen</button><button className="t-button primary" onClick={() => onDefine(target)}><Plus size={15} />Neuen Block definieren und hinzufügen</button></div>
    {picker && <Modal title="Vorhandenen Block hinzufügen" subtitle={targetLabel} onClose={() => setPicker(false)} wide><label className="t-field">Block suchen<input autoFocus type="search" aria-label="Block suchen" placeholder="Name, fachliche Bedeutung oder Kategorie" value={query} onChange={event => setQuery(event.target.value)} /></label><p className="t-caption">Wähle einen Block aus. Er wird direkt an der gewählten Stelle eingefügt.</p><div className="t-block-picker">{matches.length ? matches.map(definition => <button className="t-block-picker-item" key={`${definition.id}@${definition.version}`} onClick={() => { onAdd(definition, target); setPicker(false); }}><span><strong>{definition.name}</strong><small>{kindLabels[definition.kind]} · Version {definition.version}</small><p>{definition.description}</p>{!definition.bindingId && !definition.body?.length && <em>Technische Bindung fehlt noch</em>}</span><Plus size={18} /></button>) : <p role="status">Kein passender Block gefunden. Du kannst die fehlende Fähigkeit selbst definieren.</p>}</div><div className="t-dialog-actions"><button className="t-button primary" onClick={() => { setPicker(false); onDefine(target); }}><Plus size={15} />Neuen Block definieren und hinzufügen</button></div></Modal>}
  </section>;
}

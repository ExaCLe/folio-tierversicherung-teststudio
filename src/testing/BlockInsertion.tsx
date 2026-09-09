import { useState } from 'react';
import { ArrowDown, MousePointer2, Plus, Search } from 'lucide-react';
import type { TestingBlockDefinition, TestingCatalog } from '../../shared/testing';
import { currentTestingDefinitions } from '../../shared/testing';
import type { BlockEntry } from './model';
import { kindLabels } from './model';
import { Modal } from './ui';

export interface InsertionTarget { scenarioId: string; parentPath?: string; placement?: 'canvas' | 'end' }

export function BlockInsertion({ scenarioId, entry, catalog, onAdd, onDefine }: {
  scenarioId: string; entry?: BlockEntry; catalog: TestingCatalog;
  onAdd: (definition: TestingBlockDefinition, target: InsertionTarget) => void;
  onDefine: (target: InsertionTarget) => void;
}) {
  const [within, setWithin] = useState(false);
  const [picker, setPicker] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string>();
  const container = entry && ['workflow', 'context'].includes(entry.definition?.kind ?? '') ? entry : undefined;
  const definitions=currentTestingDefinitions(catalog);
  const matches = definitions.filter(definition => `${definition.name} ${definition.description} ${definition.category}`.toLocaleLowerCase('de').includes(query.toLocaleLowerCase('de')));
  const chosen = definitions.find(definition => `${definition.id}@${definition.version}` === selected);
  const add = (placement: 'canvas' | 'end') => { if (!chosen) return; onAdd(chosen, { scenarioId, placement, ...(placement === 'end' && within && container ? { parentPath: container.path } : {}) }); setPicker(false); };
  return <section className="t-block-insertion" aria-label="Block hinzufügen">
    <button className="t-button" onClick={() => { setQuery(''); setSelected(undefined); setPicker(true); }}><Plus size={16}/>Block hinzufügen</button>
    {picker && <Modal title="Block hinzufügen" subtitle="Wähle einen Baustein für deine Arbeitsfläche." onClose={() => setPicker(false)} wide>
      <label className="t-field t-block-search"><span><Search size={16}/>Block suchen</span><input autoFocus type="search" aria-label="Block suchen" placeholder="Name, Aufgabe oder Kategorie" value={query} onChange={event => setQuery(event.target.value)}/></label>
      <div className="t-block-picker" role="listbox" aria-label="Verfügbare Blöcke">{matches.length ? matches.map(definition => <button role="option" aria-selected={selected === `${definition.id}@${definition.version}`} className="t-block-picker-item" key={`${definition.id}@${definition.version}`} onClick={() => setSelected(`${definition.id}@${definition.version}`)}><i className={`t-block-dot ${definition.kind}`}/><span><strong>{definition.name}</strong><small>{definition.category} · {kindLabels[definition.kind]} · Version {definition.version}</small><p>{definition.description}</p></span></button>) : <p role="status">Kein passender Block gefunden.</p>}</div>
      <button className="t-define-from-search" onClick={() => { setPicker(false); onDefine({ scenarioId, placement: 'canvas' }); }}><Plus size={16}/>Neuen Block definieren</button>
      <div className="t-placement-actions"><div><strong>{chosen?.name ?? 'Wähle einen Block aus'}</strong><p>Lose Blöcke werden erst ausgeführt, wenn du sie mit dem Ablauf verbindest.</p></div><button className="t-button primary" disabled={!chosen} onClick={() => add('canvas')}><MousePointer2 size={16}/>Auf Arbeitsfläche platzieren</button><button className="t-button" disabled={!chosen} onClick={() => add('end')}><ArrowDown size={16}/>Am Ende anhängen</button>{container && <label>Anhängen an<select aria-label="Einfügestelle" value={within ? 'within' : 'end'} onChange={event => setWithin(event.target.value === 'within')}><option value="end">Ende des Ablaufs</option><option value="within">Innerhalb von {container.block.label || container.definition?.name}</option></select></label>}</div>
    </Modal>}
  </section>;
}

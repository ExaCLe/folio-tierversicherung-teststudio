import { ArrowDown, ArrowRight, ArrowUp, Blocks, BookOpen, Braces, Check, CheckCheck, ChevronDown, ChevronRight, CircleHelp, Code2, CornerDownRight, GripVertical, Layers3, MessageSquareText, PanelLeftClose, Plus, Search, Settings2, ShieldCheck, Sparkles, Trash2, UserRound, WandSparkles, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { isParameterReference, versionKey, type BlockDefinition, type BlockInstance, type BlockKind, type BlockValue, type Scenario, type StudioCatalog, type ValidationResult } from '../../shared/blocks';
import { displayValue, findDefinition, KIND_LABELS, KIND_SHORT, KINDS, newestDefinitions } from './model';
import { EmptyState } from './ui';

export function kindClass(kind: BlockKind) { return `st-kind-${kind === 'free-text' ? 'free_text_modifier' : kind}`; }
export function KindIcon({ kind, size = 13, contextType }: { kind: BlockKind; size?: number; contextType?: string }) {
  const Icon = kind === 'action' ? Blocks : kind === 'modifier' ? Settings2 : kind === 'free-text' ? MessageSquareText : kind === 'context' ? contextType === 'actor' ? UserRound : Layers3 : kind === 'workflow' ? Layers3 : ShieldCheck;
  return <span className={`st-kind-icon ${kindClass(kind)}`}><Icon size={size}/></span>;
}

export function Palette({ catalog, onAdd, selected, onHelp, open, onClose }: {
  catalog: StudioCatalog; onAdd: (definition: BlockDefinition) => void; selected?: BlockInstance; onHelp: () => void; open: boolean; onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const definitions = newestDefinitions(catalog).filter(def => `${def.label} ${def.description} ${KIND_LABELS[def.kind]}`.toLowerCase().includes(query.toLowerCase()));
  const selectedDef = selected && findDefinition(catalog, selected);
  return <aside className={`st-palette ${open ? 'st-palette-open' : ''}`} aria-label="Block catalog">
    <div className="st-panel-heading"><h2>Block catalog</h2><button className="st-icon-button st-mobile-only" onClick={onClose} aria-label="Close block catalog"><PanelLeftClose size={15}/></button><span className="st-count">{newestDefinitions(catalog).length}</span></div>
    <label className="st-search"><Search size={13}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Find a block…" aria-label="Search block catalog"/><span className="st-small">⌕</span></label>
    {selectedDef && <div className="st-catalog-target">Adding near<strong>{selectedDef.contextType === 'actor' ? `As ${displayValue(selected?.inputs.role)}` : selectedDef.label}</strong></div>}
    {KINDS.map(kind => {
      const group = definitions.filter(def => def.kind === kind);
      if (!group.length) return null;
      return <div className="st-palette-group" key={kind}><div className="st-palette-label"><span>{KIND_SHORT[kind]}</span><span>{group.length}</span></div>{group.map(def => <button key={versionKey(def)} data-testid={`add-block-${def.id}`} className={`st-palette-item ${kindClass(def.kind)}`} onClick={() => onAdd(def)} title={def.description} aria-label={`Add ${def.label}`}><KindIcon kind={def.kind} contextType={def.contextType}/><span>{def.label}</span><Plus size={12} className="st-item-plus"/></button>)}</div>;
    })}
    {!definitions.length && <p className="st-muted st-small">No blocks match “{query}”. Try a business action such as quote or policy.</p>}
    <div className="st-palette-note"><button onClick={onHelp}><CircleHelp size={12}/>How do blocks work?<ArrowRight size={11}/></button><p>Choose a block to add it. Select any block on the canvas to change its inputs.</p></div>
  </aside>;
}

interface CanvasProps {
  scenario: Scenario; catalog: StudioCatalog; selectedId?: string; collapsed: string[]; validation?: ValidationResult;
  onSelect: (id: string) => void; onToggle: (id: string) => void; onMove: (id: string, direction: -1 | 1) => void;
  onDelete: (id: string) => void; onAdd: () => void; onPromote: () => void; onCollapseAll: () => void; onExpandAll: () => void;
}

export function ScenarioCanvas(props: CanvasProps) {
  const { scenario, validation } = props;
  const errors = validation?.issues?.filter(issue => issue.severity === 'error') || [];
  return <main className="st-canvas" aria-label="Scenario canvas">
    <div className="st-canvas-top"><h2><Layers3 size={13}/>BUSINESS FLOW<span className="st-count">{validation?.stepCount ?? '…'} steps</span></h2><div className="st-canvas-controls"><button className="st-icon-button" title="Expand all blocks" aria-label="Expand all blocks" onClick={props.onExpandAll}><ChevronDown size={14}/></button><button className="st-icon-button" title="Collapse all blocks" aria-label="Collapse all blocks" onClick={props.onCollapseAll}><ChevronRight size={14}/></button></div></div>
    {errors.length > 0 && <div className="st-issues" role="status" data-testid="validation-issues"><div className="st-issues-heading"><CircleHelp size={14}/>{errors.length} {errors.length === 1 ? 'thing' : 'things'} to review before running</div><ul>{errors.map((issue, index) => <li key={`${issue.code}-${index}`}>{issue.instanceId ? <button onClick={() => props.onSelect(issue.instanceId!)}>{issue.message}</button> : issue.message}</li>)}</ul></div>}
    {scenario.blocks.length ? <div className="st-sequence">{scenario.blocks.map((block, index) => <BusinessBlock key={block.id} block={block} index={index} siblingCount={scenario.blocks.length} {...props}/>)}</div> : <EmptyState icon={<Blocks size={22}/>} title="Start with a business action" action={<button className="st-button st-button-primary" onClick={props.onAdd}><Plus size={13}/>Add your first block</button>}>Add an actor context, then the actions they take. The catalog includes a standard draft policy to start with.</EmptyState>}
    <div style={{ maxWidth: 720, margin: '14px auto 0' }}><button className="st-add-step" onClick={props.onAdd} data-testid="add-step"><Plus size={13}/>Add a block</button><p className="st-insert-hint">Build the flow. Keep the details in its inputs.</p></div>
    <div className="st-canvas-footer"><span><CheckCheck size={12}/>Canonical definition · revision {scenario.revision}</span><button className="st-button st-button-quiet st-button-small" onClick={props.onPromote}><Layers3 size={12}/>Save as reusable block</button></div>
  </main>;
}

function BusinessBlock({ block, index, siblingCount, ...props }: CanvasProps & { block: BlockInstance; index: number; siblingCount: number }) {
  const [showComposition, setShowComposition] = useState(false);
  const def = findDefinition(props.catalog, block);
  if (!def) return <div className="st-alert st-alert-error">Missing definition {versionKey(block.definition)}<button className="st-button st-button-small" onClick={() => props.onDelete(block.id)}>Remove</button></div>;
  const collapsed = props.collapsed.includes(block.id);
  const selected = props.selectedId === block.id;
  const container = def.contextType === 'actor';
  const location = def.contextType === 'location';
  const hasNested = !!(block.children?.length || block.changes?.length || def.body?.length);
  const label = block.label || (container ? `As ${displayValue(block.inputs.role)}` : location ? `For location · ${displayValue(block.inputs.location)}` : def.label);
  const inputs = def.inputs.filter(input => !(container && input.key === 'role') && !(location && input.key === 'location') && !(def.kind === 'free-text' && input.key === 'text')).slice(0, 3);
  const output = Object.values(block.outputs || {})[0];
  function select() { props.onSelect(block.id); }
  return <div className={`st-block ${kindClass(def.kind)} ${selected ? 'st-block-selected' : ''} ${container ? 'st-context-container' : ''} ${location ? 'st-config-container' : ''}`} id={`st-block-${block.id}`} data-testid={`block-${block.id}`} data-block-id={block.id} data-kind={def.kind}>
    <div className="st-block-card">
      <div className="st-block-head" role="button" tabIndex={0} aria-label={`Select ${label}`} aria-pressed={selected} onClick={select} onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); select(); } }}>
        {container ? <span className="st-block-number">{String(index + 1).padStart(2, '0')}</span> : <KindIcon kind={def.kind} contextType={def.contextType}/>}
        <span className="st-block-title">{label}</span>
        {container && <span className="st-badge">{block.children?.length || 0} actions</span>}
        {def.kind === 'workflow' && <span className="st-block-version">v{def.version}</span>}
        {!container && output && <span className="st-output"><ArrowRight size={10}/>{output}</span>}
        <div className="st-block-controls" onClick={event => event.stopPropagation()}>
          <button className="st-icon-button" aria-label={`Move ${label} up`} title="Move up" disabled={index === 0} onClick={() => props.onMove(block.id, -1)}><ArrowUp size={11}/></button>
          <button className="st-icon-button" aria-label={`Move ${label} down`} title="Move down" disabled={index === siblingCount - 1} onClick={() => props.onMove(block.id, 1)}><ArrowDown size={11}/></button>
          <button className="st-icon-button" aria-label={`Delete ${label}`} title="Remove block" onClick={() => props.onDelete(block.id)}><X size={11}/></button>
        </div>
        {(hasNested || container || location) && <button className="st-icon-button" aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${label}`} onClick={event => { event.stopPropagation(); props.onToggle(block.id); }}>{collapsed ? <ChevronRight size={13}/> : <ChevronDown size={13}/>}</button>}
      </div>
      {!collapsed && <>
        {inputs.length > 0 && <div className="st-block-meta" onClick={select}>{inputs.map(input => <span key={input.key} className="st-value">{input.label}<strong>{input.options?.find(option => option.value === block.inputs[input.key])?.label || displayValue(block.inputs[input.key], input.type)}</strong></span>)}</div>}
        {def.kind === 'free-text' && <div className="st-free-text-preview" onClick={select}>“{String(block.inputs.text || 'Describe a change to this location…')}”<br/><span className={`st-review-indicator ${block.resolutionId ? '' : 'st-review-pending'}`}>{block.resolutionId ? <Check size={9}/> : <CircleHelp size={9}/>}{block.resolutionId ? 'Interpretation confirmed' : 'Review interpretation'}</span></div>}
        {(block.children?.length || container) ? <div className="st-block-children">{!block.children?.length && <button className="st-add-step" onClick={() => { select(); props.onAdd(); }}><Plus size={11}/>Add an action as {displayValue(block.inputs.role)}</button>}{block.children?.map((child, childIndex) => <BusinessBlock key={child.id} block={child} index={childIndex} siblingCount={block.children!.length} {...props}/>)}</div> : null}
        {block.changes?.length ? <div className="st-block-children">{!location && <div className="st-block-children-label"><Settings2 size={10}/>With changes<span className="st-count">{block.changes.length}</span></div>}{block.changes.map((change, childIndex) => <BusinessBlock key={change.id} block={change} index={childIndex} siblingCount={block.changes!.length} {...props}/>)}</div> : null}
        {def.kind === 'workflow' && <div className="st-workflow-preview"><button onClick={() => setShowComposition(!showComposition)} aria-expanded={showComposition} data-testid={`expand-workflow-${block.id}`}><Layers3 size={12}/>{showComposition ? 'Hide shared composition' : `Explore ${def.body?.length || 0} composed blocks`} · v{def.version}{showComposition ? <ChevronDown size={11}/> : <ChevronRight size={11}/>}</button>{showComposition && <div className="st-shared-composition"><p>Shared composition. Values shown for this use.</p><CompositionTree blocks={def.body || []} catalog={props.catalog} parameters={{ ...Object.fromEntries(def.inputs.map(input => [input.key, input.default ?? null])), ...block.inputs }}/></div>}</div>}
      </>}
    </div>
  </div>;
}

function CompositionTree({ blocks, catalog, parameters, depth = 0 }: { blocks: BlockInstance[]; catalog: StudioCatalog; parameters: Record<string, BlockValue>; depth?: number }) {
  if (depth > 10) return <p>Open the shared definition to inspect deeper composition.</p>;
  function value(input: BlockValue | undefined) { return isParameterReference(input) ? parameters[input.param] : input; }
  return <div className="st-composition-tree">{blocks.map(block => {
    const def = findDefinition(catalog, block); if (!def) return <div key={block.id}>{versionKey(block.definition)}</div>;
    const label = def.contextType === 'actor' ? `As ${displayValue(value(block.inputs.role))}` : def.contextType === 'location' ? `For location · ${displayValue(value(block.inputs.location))}` : def.label;
    const inputs = def.inputs.filter(input => !['role', 'location'].includes(input.key)).slice(0, 3);
    return <div className="st-composition-node" key={block.id}><div className="st-composition-heading"><KindIcon kind={def.kind} size={10} contextType={def.contextType}/><strong>{label}</strong>{def.kind === 'workflow' && <small>v{def.version}</small>}</div>{inputs.length > 0 && <div className="st-composition-inputs">{inputs.map(input => <span key={input.key}>{input.label} <b>{displayValue(value(block.inputs[input.key]), input.type)}</b></span>)}</div>}{block.children?.length ? <CompositionTree blocks={block.children} catalog={catalog} parameters={parameters} depth={depth + 1}/> : null}{block.changes?.length ? <><div className="st-composition-slot">{def.contextType === 'location' ? 'Location changes' : 'With changes'}</div><CompositionTree blocks={block.changes} catalog={catalog} parameters={parameters} depth={depth + 1}/></> : null}{def.kind === 'workflow' && def.body && <CompositionTree blocks={def.body} catalog={catalog} parameters={Object.fromEntries(def.inputs.map(input => [input.key, value(block.inputs[input.key]) ?? input.default ?? null]))} depth={depth + 1}/>}</div>;
  })}</div>;
}

export function KindLegend() { return <div className="st-kind-legend">{KINDS.map(kind => <span key={kind} className={kindClass(kind)}><i/>{KIND_LABELS[kind]}</span>)}</div>; }

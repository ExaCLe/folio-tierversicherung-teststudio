import { ArrowRight, BookOpen, Braces, Check, CircleHelp, Code2, CornerDownRight, Database, FileCheck2, GitBranch, Layers3, Link2, LoaderCircle, LockKeyhole, MapPin, MessageSquareText, Plus, ShieldCheck, Sparkles, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { isEntityReference, isParameterReference, versionKey, type BlockDefinition, type BlockInstance, type BlockValue, type InputDefinition, type ResolvedConfiguration, type Scenario, type StudioCatalog, type TextResolution, type ValidationResult } from '../../shared/blocks';
import { countryName, displayValue, findDefinition, flattenBlocks, KIND_LABELS, locateBlock } from './model';
import { KindIcon } from './Canvas';
import { Field, formatAmount, JsonView } from './ui';

interface InspectorProps {
  scenario: Scenario; catalog: StudioCatalog; block?: BlockInstance; validation?: ValidationResult;
  tab: 'configuration' | 'references' | 'storage'; onTab: (tab: 'configuration' | 'references' | 'storage') => void;
  onInput: (id: string, key: string, value: BlockValue) => void; onInterpret: () => void; onConfirm: () => void;
  resolution?: TextResolution; interpreting: boolean; interpretationError?: string;
  onDefinition: (definition: BlockDefinition) => void; onKnowledge: (id: string) => void; onGraph: () => void;
  onPromote: () => void; onAdd: () => void; open: boolean; onClose: () => void;
}

export function Inspector(props: InspectorProps) {
  const { block, catalog, scenario, tab, onTab } = props;
  const [storagePart, setStoragePart] = useState<'instance' | 'definition' | 'implementation'>('instance');
  const def = block && findDefinition(catalog, block);
  const located = block && locateBlock(scenario.blocks, block.id);
  const scope = located ? [...located.ancestors].reverse().find(ancestor => findDefinition(catalog, ancestor)?.contextType === 'location') : undefined;
  const creation = located ? [...located.ancestors, located.block].find(ancestor => findDefinition(catalog, ancestor)?.acceptsChanges) : undefined;
  const effective = props.validation?.resolvedConfigurations.find(config => config.instanceId === creation?.id || config.instanceId === block?.id || config.instanceId.startsWith(`${block?.id}/`));
  const binding = catalog.implementations.find(item => `${item.id}@${item.revision}` === def?.implementationRef || item.id === def?.implementationRef);
  return <aside className={`st-inspector ${props.open ? 'st-inspector-open' : ''}`} aria-label="Block inspector">
    <div className="st-inspector-head"><div className="st-inspector-eyebrow"><span>BLOCK INSPECTOR</span><button className="st-icon-button st-mobile-only" onClick={props.onClose} aria-label="Close inspector"><X size={14}/></button><span className="st-small">⌘ I</span></div>{def ? <div className="st-inspector-title"><KindIcon kind={def.kind} size={15} contextType={def.contextType}/><div><h2>{block?.label || def.label}</h2><p>{KIND_LABELS[def.kind]} · version {def.version}</p></div></div> : <div className="st-inspector-title"><KindIcon kind="action" size={15}/><div><h2>Inspect a block</h2><p>Inputs, connections, and storage</p></div></div>}</div>
    <div className="st-inspector-tabs" role="tablist" aria-label="Inspector sections">{(['configuration', 'references', 'storage'] as const).map(value => <button key={value} role="tab" aria-selected={tab === value} data-testid={`inspect-${value}`} onClick={() => onTab(value)}>{value.charAt(0).toUpperCase() + value.slice(1)}</button>)}</div>
    {!def || !block ? <div className="st-selection-empty"><CornerDownRight size={27}/><strong>Every block has a story.</strong>Select a block to see what it changes, the knowledge it uses, and how it is stored.</div> : <div className="st-inspector-body" role="tabpanel">
      {tab === 'configuration' && <>
        <p className="st-inspector-description">{def.description}</p>
        {def.kind === 'workflow' && <div className="st-review-box st-confirmed-box"><h3><GitBranch size={12}/>Changes apply to this use</h3><p>These inputs override the shared defaults. Other scenarios remain pinned to their own version.</p></div>}
        {def.kind === 'free-text' && scope && <Field label="Location scope" hint="The request applies only to this insured location."><select aria-label="Modifier location scope" value={String(scope.inputs.location)} onChange={event => props.onInput(scope.id, 'location', event.target.value)}><option>Factory</option><option>Warehouse</option></select></Field>}
        {def.inputs.map(input => <InputEditor key={`${block.id}-${input.key}`} input={input} value={block.inputs[input.key]} catalog={catalog} scenario={scenario} currentId={block.id} multiline={def.kind === 'free-text' || input.key === 'notes' || input.key === 'reason'} onChange={value => props.onInput(block.id, input.key, value)}/>)}
        {def.kind === 'free-text' && <TextInterpretation {...props}/>}
        {effective && <EffectiveConfiguration value={effective}/>}
        {!!def.outputs.length && <div className="st-inspector-section"><h3 className="st-inspector-section-title">Produces typed references<Link2 size={12}/></h3>{def.outputs.map(output => <div className="st-field" key={output.key}><span>{output.label}<span className="st-small st-muted"> · {output.type}</span></span><div className="st-readonly"><CornerDownRight size={12}/>{block.outputs?.[output.key] || 'Not assigned'}</div></div>)}</div>}
        {def.completion && <div className="st-section-note"><Check size={12}/><span>Ends with <strong>{def.completion.toLowerCase()}</strong>.</span></div>}
        {def.kind === 'context' && <div className="st-review-box"><h3>{def.contextType === 'actor' ? 'Actions execute in order' : 'Changes resolve before creation'}</h3><p>{def.contextType === 'actor' ? 'Every action inside this context runs as the selected role. Switch roles with another actor context.' : 'The template and all location changes combine into one configuration before a draft is saved.'}</p><button className="st-button st-button-small" style={{ marginTop: 10 }} onClick={props.onAdd}><Plus size={11}/>Add {def.contextType === 'actor' ? 'an action' : 'a modifier'}</button></div>}
        {def.knowledgeRefs.includes('rule:flood-referral') && <button className="st-rule-link" onClick={() => props.onKnowledge('rule:flood-referral')} style={{ width: '100%', textAlign: 'left', marginTop: 18 }}><BookOpen size={13}/><span><strong>Flood referral rule</strong><small>Above €500,000 per location: senior review and a risk survey.</small></span><ArrowRight size={12}/></button>}
        <div className="st-inspector-actions"><button className="st-button st-button-small" onClick={() => props.onDefinition(def)}><Layers3 size={11}/>Shared definition</button><button className="st-button st-button-small" onClick={props.onPromote}><Plus size={11}/>Make reusable</button></div>
      </>}
      {tab === 'references' && <>
        <p className="st-inspector-description">A block links to small, versioned records. Open a link to see the business meaning or implementation it depends on.</p>
        <div className="st-inspector-section-title">Definition</div><button className="st-reference" onClick={() => props.onDefinition(def)}><Layers3 size={13}/><span>{def.label}<small>{versionKey(def)}</small></span><ArrowRight size={11}/></button>
        <div className="st-inspector-section"><h3 className="st-inspector-section-title">Business knowledge<span className="st-count">{def.knowledgeRefs.length}</span></h3><div className="st-link-list">{def.knowledgeRefs.map(id => <button className="st-reference" key={id} onClick={() => props.onKnowledge(id)}><BookOpen size={13}/><span>{catalog.knowledge.find(doc => doc.id === id)?.title || id}<small>{id}</small></span><ArrowRight size={11}/></button>)}</div></div>
        <div className="st-inspector-section"><h3 className="st-inspector-section-title">Implementation<Code2 size={12}/></h3>{def.implementationRef ? <><div className="st-readonly"><Code2 size={12}/>{def.implementationRef}</div>{binding && <JsonView value={binding} label="Implementation manifest"/>}</> : <p className="st-note">{def.kind === 'workflow' ? 'The compiler expands this workflow into its versioned business actions.' : 'The compiler resolves this block as context or configuration. It has no browser action.'}</p>}</div>
        <div className="st-inspector-section"><h3 className="st-inspector-section-title">References in this use</h3>{Object.entries(block.inputs).filter(([, value]) => isEntityReference(value)).map(([key, value]) => <div className="st-reference" key={key}><Link2 size={12}/><span>{key}<small>uses {(value as { ref: string }).ref}</small></span></div>)}{!Object.values(block.inputs).some(isEntityReference) && <p className="st-note">This block uses literal inputs and template defaults.</p>}</div>
        <button className="st-button st-wide-button" onClick={props.onGraph} style={{ marginTop: 20 }}><GitBranch size={13}/>Explore connections</button>
      </>}
      {tab === 'storage' && <>
        <div className="st-storage-explain"><span>1</span><div><h3>Definition</h3><p>One shared meaning. Version {def.version} describes its inputs, outputs, and knowledge.</p></div></div>
        <div className="st-storage-explain"><span>2</span><div><h3>Instance</h3><p>This scenario's use. Stores its values, nested blocks, and confirmed changes.</p></div></div>
        <div className="st-storage-explain"><span>3</span><div><h3>Implementation</h3><p>Maintained browser code. Can evolve without rewriting the business flow.</p></div></div>
        <div className="st-filter-tabs" role="tablist" aria-label="Stored record" style={{ marginTop: 17, gap: 0 }}>{(['instance', 'definition', 'implementation'] as const).map(part => <button key={part} role="tab" aria-selected={storagePart === part} onClick={() => setStoragePart(part)} style={{ padding: '5px 8px', fontSize: 9 }}>{part}</button>)}</div>
        <JsonView value={storagePart === 'instance' ? block : storagePart === 'definition' ? def : binding || { kind: 'compiler', meaning: def.kind === 'workflow' ? 'Expand reusable workflow body' : 'Resolve context and configuration', definition: block.definition }} label={`${storagePart.charAt(0).toUpperCase() + storagePart.slice(1)} JSON`}/>
        <div className="st-section-note"><LockKeyhole size={11}/><span>The scenario JSON determines execution. Canvas layout is stored separately.</span></div>
        {props.resolution && <JsonView value={props.resolution} label="Saved interpretation"/>}
        <button className="st-button st-wide-button" onClick={props.onGraph} style={{ marginTop: 18 }} data-testid="explore-storage-graph"><GitBranch size={13}/>Explore storage connections</button>
      </>}
    </div>}
  </aside>;
}

export function InputEditor({ input, value, onChange, catalog, scenario, currentId, multiline }: {
  input: InputDefinition; value?: BlockValue; onChange: (value: BlockValue) => void; catalog: StudioCatalog; scenario?: Scenario; currentId?: string; multiline?: boolean;
}) {
  let field: ReactNode;
  const referenceType = input.type.endsWith('Ref') && !input.type.includes('Fixture') && input.type !== 'PolicyTemplateRef';
  if (isParameterReference(value)) {
    field = <div className="st-readonly"><Braces size={12}/>Parameter: {value.param}</div>;
  } else if (input.type === 'Boolean') {
    field = <select aria-label={input.label} value={value ? 'true' : 'false'} onChange={event => onChange(event.target.value === 'true')}><option value="true">Yes</option><option value="false">No</option></select>;
  } else if (input.options || input.type === 'Role' || input.type === 'Country' || input.type === 'LocationName' || input.type === 'PolicyTemplateRef' || input.type === 'CustomerFixtureRef' || input.type === 'DocumentFixtureRef') {
    let options = input.options;
    if (!options && input.type === 'PolicyTemplateRef') options = catalog.templates.map(template => ({ value: versionKey(template), label: `${template.label} · v${template.version}` }));
    if (!options && input.type === 'Role') options = catalog.roles.map(role => ({ value: role.value, label: role.label }));
    if (!options && input.type === 'Country') options = [{ value: 'DE', label: 'Germany' }, { value: 'IT', label: 'Italy' }];
    if (!options && input.type === 'LocationName') options = ['Factory', 'Warehouse'].map(item => ({ value: item, label: item }));
    if (!options && input.type === 'CustomerFixtureRef') options = [{ value: 'synthetic-manufacturer@1', label: 'Standard manufacturer · v1' }];
    if (!options && input.type === 'DocumentFixtureRef') options = [{ value: 'approved-synthetic-survey@1', label: 'Approved synthetic survey · v1' }];
    field = <select aria-label={input.label} value={String(value ?? '')} onChange={event => onChange(event.target.value)}>{!options?.some(option => option.value === value) && <option value={String(value ?? '')}>{String(value || 'Select a value')}</option>}{options?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>;
  } else if (referenceType) {
    const ref = isEntityReference(value) ? value.ref : String(value ?? '');
    const all = scenario ? flattenBlocks(scenario.blocks) : [];
    const currentIndex = currentId ? all.findIndex(instance => instance.id === currentId) : all.length;
    const choices = all.slice(0, currentIndex === -1 ? all.length : currentIndex).flatMap(instance => {
      const def = findDefinition(catalog, instance);
      return (def?.outputs || []).filter(output => output.type === input.type || input.type === 'ApprovalRef' && output.type === 'QuoteRef').map(output => ({ ref: instance.outputs?.[output.key], label: output.label }));
    }).filter(choice => choice.ref);
    field = <select aria-label={input.label} value={ref} onChange={event => onChange({ ref: event.target.value })}>{!choices.some(choice => choice.ref === ref) && <option value={ref}>{ref ? `${ref} · reference unavailable` : `Choose a ${input.type} output`}</option>}{choices.map(choice => <option key={choice.ref} value={choice.ref}>{choice.ref} · {choice.label}</option>)}</select>;
  } else if (input.type === 'Money' || input.type === 'Number') {
    field = <input aria-label={input.label} type="number" min={0} step={input.type === 'Money' ? 1000 : 1} value={value === null || value === undefined ? '' : String(value)} onChange={event => onChange(event.target.value === '' ? null : Number(event.target.value))}/>;
  } else if (input.type === 'Object') {
    field = <JsonInput label={input.label} value={value} onChange={onChange}/>;
  } else if (multiline) {
    field = <textarea aria-label={input.label} value={String(value ?? '')} onChange={event => onChange(event.target.value)}/>;
  } else {
    field = <input aria-label={input.label} value={String(value ?? '')} onChange={event => onChange(event.target.value)} placeholder={input.type === 'Date' ? 'YYYY-MM-DD or a date rule' : undefined}/>;
  }
  return <Field label={`${input.label}${referenceType ? ` · ${input.type}` : ''}`} hint={input.description}>{field}</Field>;
}

function JsonInput({ label, value, onChange }: { label: string; value?: BlockValue; onChange: (value: BlockValue) => void }) {
  const [draft, setDraft] = useState(JSON.stringify(value ?? null));
  useEffect(() => setDraft(JSON.stringify(value ?? null)), [value]);
  return <textarea aria-label={label} value={draft} onChange={event => { setDraft(event.target.value); try { onChange(JSON.parse(event.target.value)); event.target.setCustomValidity(''); } catch { event.target.setCustomValidity('Enter valid JSON, for example ["Factory", "Warehouse"].'); } }} onBlur={event => event.target.reportValidity()}/>;
}

function TextInterpretation(props: InspectorProps) {
  const { resolution, block } = props;
  const validPreview = resolution && resolution.originalText === String(block?.inputs.text) && (resolution.status !== 'confirmed' || resolution.id === block?.resolutionId);
  const confirmed = validPreview && block?.resolutionId === resolution.id;
  return <>
    <p className="st-note" style={{ marginBottom: 11 }}>Local interpreter · country changes for Germany and Italy, amounts, and flood coverage. No runtime AI call.</p>
    <button className="st-button st-wide-button" onClick={props.onInterpret} disabled={props.interpreting || !block?.inputs.text} data-testid="interpret-modifier">{props.interpreting ? <LoaderCircle className="st-spin" size={13}/> : <Sparkles size={13}/>}Preview interpretation</button>
    {props.interpretationError && <div className="st-review-box" role="alert"><h3><CircleHelp size={12}/>More detail needed</h3><p>{props.interpretationError}</p><p style={{ marginTop: 8 }}>Try “Warehouse should be in Italy” inside a location context.</p></div>}
    {!block?.resolutionId && !validPreview && <div className="st-section-note"><CircleHelp size={12}/><span>Not confirmed. A change to the text, scope, or template needs a new preview.</span></div>}
    {validPreview && <div className={`st-review-box ${confirmed ? 'st-confirmed-box' : ''}`} data-testid="interpretation-preview"><h3>{confirmed ? <Check size={12}/> : <MessageSquareText size={12}/>}{confirmed ? resolution.source === 'seeded-demo' ? 'Reviewed demo example' : 'Confirmed interpretation' : 'Proposed interpretation'}</h3><p>Applies to {resolution.scope.location} risk location.</p><div className="st-inspector-section-title" style={{ margin: '13px 0 6px' }}>Change</div>{resolution.changes.map((change, index) => <div key={index} style={{ marginTop: 7 }}><p style={{ fontSize: 10 }}>{change.label || change.field}</p><p style={{ fontSize: 10, marginTop: 2 }}><span style={{ textDecoration: 'line-through', opacity: .6 }}>{displayValue(change.previousValue)}</span> → <strong style={{ fontWeight: 550 }}>{displayValue(change.value)}</strong></p></div>)}<div className="st-inspector-section-title" style={{ margin: '15px 0 6px' }}>Keep unchanged</div>{resolution.preserved.map((entry, index) => <p key={index} style={{ fontSize: 10, marginTop: 5 }}><Check size={9} style={{ marginRight: 5 }}/>{entry.label || entry.field} · {displayValue(entry.value)}</p>)}{!confirmed && <button className="st-button st-button-primary st-wide-button" style={{ marginTop: 15 }} onClick={props.onConfirm} disabled={props.interpreting} data-testid="confirm-interpretation"><Check size={12}/>Confirm these changes</button>}{confirmed && <p style={{ marginTop: 12, fontSize: 9 }}>Saved structured changes will run exactly as reviewed.</p>}</div>}
  </>;
}

function EffectiveConfiguration({ value }: { value: ResolvedConfiguration }) {
  const [view, setView] = useState<'final' | 'defaults' | 'changes'>('final');
  const config = view === 'defaults' ? value.defaults : value.configuration;
  return <div className="st-inspector-section" data-testid="effective-configuration"><h3 className="st-inspector-section-title">Resolved policy<Check size={12}/></h3><div className="st-filter-tabs" style={{ gap: 0, margin: '-5px -5px 12px' }} role="tablist" aria-label="Policy configuration view">{(['final', 'defaults', 'changes'] as const).map(item => <button key={item} role="tab" aria-selected={view === item} style={{ fontSize: 9, padding: '5px 7px' }} onClick={() => setView(item)}>{item === 'final' ? 'Final configuration' : item === 'defaults' ? 'Defaults' : 'Changes'}</button>)}</div>{view === 'changes' ? <>{value.changes.length ? value.changes.map((change, index) => <div className="st-storage-explain" key={index}><span><SettingsIcon/></span><div><h3>{change.label || change.field}</h3><p>{displayValue(change.previousValue)} → {displayValue(change.value)}</p></div></div>) : <p className="st-note">This draft uses the template defaults.</p>}</> : <>
      <dl className="st-property-list" style={{ marginBottom: 15 }}><dt>Headquarters</dt><dd>{countryName(config.customer.headquartersCountry)}</dd><dt>Issuing market</dt><dd>{countryName(config.issuingMarket)}</dd><dt>Currency</dt><dd>{config.currency}</dd></dl>
      <div className="st-effective-locations">{config.locations.map(location => {
        const original = value.defaults.locations.find(item => item.id === location.id || item.name === location.name);
        const changed = view === 'final' && JSON.stringify(location) !== JSON.stringify(original);
        return <div className="st-location-card" key={location.id}><div className="st-location-head"><MapPin size={11}/>{location.name}{changed && <span className="st-badge">Modified</span>}</div><dl className="st-property-list"><dt>Country</dt><dd>{countryName(location.country)}</dd><dt>Sum insured</dt><dd>{formatAmount(location.sumInsured)}</dd><dt>Flood limit</dt><dd>{location.coverages.some(coverage => coverage.type === 'Flood') ? formatAmount(location.coverages.find(coverage => coverage.type === 'Flood')?.limit) : 'Not included'}</dd><dt>Address</dt><dd>{location.address.line1}<br/>{location.address.postcode} {location.address.city}</dd></dl></div>;
      })}</div><div className="st-section-note"><Braces size={11}/><span>Template defaults + this scenario's changes = the draft that gets created.</span></div>
    </>}</div>;
}

function SettingsIcon() { return <Braces size={10}/>; }

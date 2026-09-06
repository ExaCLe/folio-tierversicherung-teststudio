import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowRight, Check, ChevronRight, CircleHelp, Copy, GitBranch, Layers3, LoaderCircle, PanelLeft, PanelRight, Pencil, Play, Plus, Save, X } from 'lucide-react';
import type { BlockDefinition, BlockValue, DependencyGraph, PromotionRequest, PromotionResult, RunRecord, Scenario, ScenarioLayout, StudioCatalog, TextResolution, ValidationResult } from '../../shared/blocks';
import { post, studioApi, StudioApiError } from './api';
import { addBlock, findDefinition, flattenBlocks, invalidateResolutions, locateBlock, newestDefinitions, relocateBlock, removeBlock, updateBlock } from './model';
import { Palette, ScenarioCanvas } from './Canvas';
import { Inspector } from './Inspector';
import { BlockLibrary, DefinitionDialog, KnowledgeArticle, KnowledgeBrowser, StorageGraph } from './Library';
import { RunDrawer, RunHistory } from './Runs';
import { AddBlockDialog, HelpDialog, NewScenarioDialog, PromotionDialog, ScenarioDetailsDialog } from './Dialogs';
import { EmptyState, Loading, Modal } from './ui';
import './studio.css';

type Section = 'studio' | 'library' | 'knowledge' | 'runs';
type Dialog = 'help' | 'new' | 'clone' | 'details' | 'promote' | 'add' | null;
const TITLES: Record<Section, string> = { studio: 'Scenario studio', library: 'Block library', knowledge: 'Business knowledge', runs: 'Run history' };
const DESCRIPTIONS: Record<Section, string> = { studio: 'Design the business journey. Test the real application.', library: 'A shared vocabulary of business actions, changes, and checks.', knowledge: 'The meaning and rules behind your business blocks.', runs: 'Every business step, its exact inputs, and the browser evidence.' };
function readSession(key: string) { try { return sessionStorage.getItem(key); } catch { return null; } }
function writeSession(key: string, value: string | null) { try { if (value === null) sessionStorage.removeItem(key); else sessionStorage.setItem(key, value); } catch { /* Canonical saves remain available if session storage is disabled. */ } }
function defaultSelection(scenario: Scenario, catalog: StudioCatalog) { return flattenBlocks(scenario.blocks).find(block => findDefinition(catalog, block)?.acceptsChanges)?.id || scenario.blocks[0]?.id; }

export function StudioApp({ section = 'studio', onNavigate }: { section?: Section; onNavigate?: (section: string) => void }) {
  const [catalog, setCatalog] = useState<StudioCatalog>();
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [scenario, setScenario] = useState<Scenario>();
  const scenarioRef = useRef<Scenario | undefined>(undefined);
  const [savedSnapshot, setSavedSnapshot] = useState('');
  const snapshotRef = useRef('');
  const [selectedId, setSelectedId] = useState<string>();
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [tab, setTab] = useState<'configuration' | 'references' | 'storage'>('configuration');
  const [validation, setValidation] = useState<ValidationResult>();
  const [validating, setValidating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadKey, setLoadKey] = useState(0);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [resolution, setResolution] = useState<TextResolution>();
  const [interpretationError, setInterpretationError] = useState('');
  const [definition, setDefinition] = useState<BlockDefinition>();
  const [knowledgeId, setKnowledgeId] = useState<string>();
  const [knowledgeModalId, setKnowledgeModalId] = useState<string>();
  const [graphOpen, setGraphOpen] = useState(false);
  const [graph, setGraph] = useState<DependencyGraph>();
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string>();
  const [runDrawerOpen, setRunDrawerOpen] = useState(false);
  const [promotionError, setPromotionError] = useState('');
  const [undoScenario, setUndoScenario] = useState<Scenario>();
  const dirty = !!scenario && JSON.stringify(scenario) !== savedSnapshot;
  const selected = scenario && selectedId ? locateBlock(scenario.blocks, selectedId)?.block : undefined;
  const activeRun = runs.find(run => run.id === selectedRunId);
  const scenarioRunning = runs.some(run => run.scenarioId === scenario?.id && (run.status === 'queued' || run.status === 'running'));
  const runInFlight = useRef(false);
  const pendingSave = useRef<Promise<Scenario | undefined> | null>(null);
  const layoutReady = useRef<string | undefined>(undefined);

  function acceptScenario(value: Scenario, saved = true) {
    scenarioRef.current = value; setScenario(value);
    if (saved) { const snapshot = JSON.stringify(value); snapshotRef.current = snapshot; setSavedSnapshot(snapshot); writeSession('folio-studio-draft', null); }
    else writeSession('folio-studio-draft', JSON.stringify(value));
    writeSession('folio-studio-scenario', value.id);
  }

  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    Promise.all([studioApi<StudioCatalog>('/catalog', { signal: controller.signal }), studioApi<Scenario[]>('/scenarios', { signal: controller.signal }), studioApi<RunRecord[]>('/runs', { signal: controller.signal })]).then(([nextCatalog, nextScenarios, nextRuns]) => {
      if (controller.signal.aborted) return;
      setCatalog(nextCatalog); setScenarios(nextScenarios); setRuns(nextRuns);
      const desired = new URLSearchParams(window.location.search).get('scenario') || readSession('folio-studio-scenario') || 'standard-draft';
      const next = nextScenarios.find(item => item.id === desired) || nextScenarios.find(item => item.id === 'standard-draft') || nextScenarios[0];
      if (next) {
        const sessionDraft = readSession('folio-studio-draft'); let restored: Scenario | undefined;
        if (sessionDraft) { try { const parsed = JSON.parse(sessionDraft) as Scenario; if (parsed.id === next.id && parsed.blocks) restored = parsed; } catch { writeSession('folio-studio-draft', null); } }
        acceptScenario(next); setSelectedId(defaultSelection(restored || next, nextCatalog));
        if (restored && JSON.stringify(restored) !== JSON.stringify(next)) { acceptScenario(restored, false); setNotice('Your unsaved changes were restored from this browser session.'); }
      }
      setSelectedRunId(nextRuns[0]?.id); setLoading(false);
    }).catch(error => { if (error.name !== 'AbortError') { setError(error.message); setLoading(false); } });
    return () => controller.abort();
  }, [loadKey]);

  useEffect(() => {
    if (!scenario) return;
    const controller = new AbortController(); layoutReady.current = undefined;
    studioApi<ScenarioLayout>(`/scenarios/${encodeURIComponent(scenario.id)}/layout`, { signal: controller.signal }).then(layout => {
      if (controller.signal.aborted) return;
      setCollapsed(layout.collapsed || []);
      if (layout.selectedId && locateBlock(scenarioRef.current?.blocks || [], layout.selectedId)) setSelectedId(layout.selectedId);
      layoutReady.current = scenario.id;
    }).catch(error => { if (error.name !== 'AbortError') { setCollapsed([]); layoutReady.current = scenario.id; } });
    return () => controller.abort();
  }, [scenario?.id]);

  useEffect(() => {
    if (!scenario || layoutReady.current !== scenario.id) return;
    const timer = window.setTimeout(() => { void studioApi(`/scenarios/${encodeURIComponent(scenario.id)}/layout`, { method: 'PUT', body: JSON.stringify({ id: `layout-${scenario.id}`, scenarioId: scenario.id, scenarioRevision: scenario.revision, collapsed, selectedId, viewport: { x: 0, y: 0, zoom: 1 } }) }).catch(() => {}); }, 350);
    return () => window.clearTimeout(timer);
  }, [scenario?.id, scenario?.revision, collapsed, selectedId]);

  useEffect(() => {
    if (!scenario) return;
    const controller = new AbortController(); setValidating(true);
    const timer = window.setTimeout(() => {
      studioApi<ValidationResult>('/validate', { method: 'POST', body: JSON.stringify({ scenario }), signal: controller.signal }).then(result => { if (controller.signal.aborted) return; setValidation(result); setValidating(false); }).catch(error => { if (!controller.signal.aborted && error.name !== 'AbortError') { setValidating(false); setError(error.message); } });
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [scenario]);

  useEffect(() => {
    setInterpretationError(''); setResolution(undefined);
    if (!selected?.resolutionId) return;
    const controller = new AbortController();
    studioApi<TextResolution>(`/resolutions/${encodeURIComponent(selected.resolutionId)}`, { signal: controller.signal }).then(result => { if (!controller.signal.aborted) setResolution(result); }).catch(error => { if (!controller.signal.aborted && error.name !== 'AbortError') setInterpretationError(error.message); });
    return () => controller.abort();
  }, [selected?.id, selected?.resolutionId]);

  const activeRunIds = runs.filter(run => run.status === 'queued' || run.status === 'running').map(run => run.id).join(',');
  useEffect(() => {
    if (!activeRunIds) return;
    const controller = new AbortController();
    const timer = window.setInterval(() => { Promise.all(activeRunIds.split(',').map(id => studioApi<RunRecord>(`/runs/${encodeURIComponent(id)}`, { signal: controller.signal }))).then(updated => setRuns(current => current.map(run => updated.find(item => item.id === run.id) || run))).catch(error => { if (error.name !== 'AbortError') setError('Run updates are temporarily unavailable. The local runner continues; reopen Run history to retry.'); }); }, 1000);
    return () => { window.clearInterval(timer); controller.abort(); };
  }, [activeRunIds]);

  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => { setNotice(''); setUndoScenario(undefined); }, 7000); return () => window.clearTimeout(timer); }, [notice]);
  useEffect(() => { function leave(event: BeforeUnloadEvent) { if (dirty) { event.preventDefault(); event.returnValue = ''; } } window.addEventListener('beforeunload', leave); return () => window.removeEventListener('beforeunload', leave); }, [dirty]);

  function report(problem: unknown) {
    setError(problem instanceof Error ? problem.message : 'This action could not be completed.');
    if (problem instanceof StudioApiError && problem.issues.length) setValidation(previous => ({ valid: false, issues: problem.issues, resolvedConfigurations: previous?.resolvedConfigurations || [], stepCount: previous?.stepCount || 0, dependencyCount: previous?.dependencyCount || 0 }));
  }
  async function save(showNotice = false): Promise<Scenario | undefined> {
    const current = scenarioRef.current;
    if (!current) return undefined;
    if (pendingSave.current) return pendingSave.current;
    if (JSON.stringify(current) === snapshotRef.current) { if (showNotice) setNotice('All changes are saved.'); return current; }
    const requestSnapshot = JSON.stringify(current);
    const operation = studioApi<Scenario>(`/scenarios/${encodeURIComponent(current.id)}`, { method: 'PUT', body: requestSnapshot }).then(saved => {
      setScenarios(list => list.map(item => item.id === saved.id ? saved : item));
      if (scenarioRef.current?.id === current.id) {
        if (JSON.stringify(scenarioRef.current) === requestSnapshot) acceptScenario(saved);
        else { snapshotRef.current = JSON.stringify(saved); setSavedSnapshot(snapshotRef.current); acceptScenario({ ...scenarioRef.current!, revision: saved.revision, updatedAt: saved.updatedAt }, false); }
      }
      if (showNotice) setNotice(`Saved revision ${saved.revision}.`);
      return saved;
    });
    pendingSave.current = operation;
    try { return await operation; } finally { pendingSave.current = null; }
  }
  async function saveAction() { setBusy('save'); setError(''); try { await save(true); } catch (error) { report(error); } finally { setBusy(''); } }
  function edit(next: Scenario) { acceptScenario(next, false); setError(''); setUndoScenario(undefined); }
  function select(id: string) {
    const blocks = scenarioRef.current?.blocks || [];
    const all = flattenBlocks(blocks);
    const canonicalId = all.find(block => block.id === id || id.endsWith(`/${block.id}`))?.id || all.find(block => id.startsWith(`${block.id}/`))?.id || id;
    const located = locateBlock(blocks, canonicalId);
    if (located) setCollapsed(current => current.filter(item => !located.ancestors.some(ancestor => ancestor.id === item)));
    setSelectedId(canonicalId); setInspectorOpen(true);
    requestAnimationFrame(() => document.getElementById(`st-block-${canonicalId}`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
  }
  function editInput(id: string, key: string, value: BlockValue) {
    if (!scenarioRef.current) return;
    edit(updateBlock(scenarioRef.current, id, block => { block.inputs[key] = value; if (key === 'text' || key === 'template' || key === 'location') invalidateResolutions(block); }));
    if (key === 'text' || key === 'template' || key === 'location') { setResolution(undefined); setInterpretationError(''); }
  }
  async function chooseScenario(id: string) {
    if (!catalog) return; setBusy('switch'); setError('');
    try { await save(); const next = await studioApi<Scenario>(`/scenarios/${encodeURIComponent(id)}`); acceptScenario(next); setSelectedId(defaultSelection(next, catalog)); setValidation(undefined); setCollapsed([]); setDialog(null); setDefinition(undefined); setRunDrawerOpen(false); setInspectorOpen(false); onNavigate?.('studio'); }
    catch (error) { report(error); } finally { setBusy(''); }
  }
  async function createScenario(name: string, starter: string) {
    setBusy('create'); setError('');
    try {
      const current = await save(); if (!current || !catalog) return;
      const source = scenarios.find(item => item.id === starter);
      const next = dialog === 'clone' ? await post<Scenario>(`/scenarios/${encodeURIComponent(current.id)}/duplicate`, { name }) : await post<Scenario>('/scenarios', { name, description: source?.description || 'A custom commercial property business flow.', blocks: starter === 'empty' ? [] : structuredClone(source?.blocks || []), tags: ['custom'] });
      setScenarios(list => [...list, next]); acceptScenario(next); setSelectedId(defaultSelection(next, catalog)); setDialog(null); setValidation(undefined); setNotice(dialog === 'clone' ? 'Variation created. Its input changes stay independent.' : 'Scenario created. Select a block to make it yours.'); onNavigate?.('studio');
    } catch (error) { report(error); } finally { setBusy(''); }
  }
  function insert(def: BlockDefinition) {
    if (!scenarioRef.current || !catalog) return;
    try {
      const result = addBlock(scenarioRef.current, def, catalog, selectedId); edit(result.scenario); setSelectedId(result.block.id); setDialog(null); setDefinition(undefined); setPaletteOpen(false); setInspectorOpen(true); setTab('configuration'); setNotice(`Added ${def.label.toLowerCase()}. Its inputs are ready to edit.`); onNavigate?.('studio');
      const path = locateBlock(result.scenario.blocks, result.block.id); if (path) setCollapsed(current => current.filter(id => !path.ancestors.some(ancestor => ancestor.id === id)));
    } catch (error) { report(error); }
  }
  function deleteBlock(id: string) {
    if (!scenarioRef.current) return;
    const previous = scenarioRef.current; const found = locateBlock(previous.blocks, id); edit(removeBlock(previous, id)); setUndoScenario(previous); setNotice('Block removed from this scenario.');
    if (selectedId === id || found && flattenBlocks([found.block]).some(block => block.id === selectedId)) setSelectedId(found?.parent?.id);
  }
  async function interpret() {
    if (!scenarioRef.current || !selectedId) return; setBusy('interpret'); setInterpretationError(''); setResolution(undefined);
    try { setResolution(await post<TextResolution>('/interpret', { scenario: scenarioRef.current, instanceId: selectedId })); }
    catch (error) { setInterpretationError(error instanceof Error ? error.message : 'Describe the location, field, and new value.'); } finally { setBusy(''); }
  }
  async function confirmInterpretation() {
    if (!resolution || !selectedId || !scenarioRef.current) return; setBusy('interpret'); setInterpretationError('');
    try { const result = await post<TextResolution>(`/resolutions/${encodeURIComponent(resolution.id)}/confirm`, { scenario: scenarioRef.current, instanceId: selectedId }); edit(updateBlock(scenarioRef.current, selectedId, block => { block.resolutionId = result.id; })); setResolution(result); await save(); setNotice('Interpretation confirmed and saved with this scenario.'); }
    catch (error) { setInterpretationError(error instanceof Error ? error.message : 'The preview changed. Interpret the request again.'); } finally { setBusy(''); }
  }
  async function openPromotion() { setBusy('save'); setPromotionError(''); setError(''); try { await save(); setDialog('promote'); } catch (error) { report(error); } finally { setBusy(''); } }
  async function promote(request: PromotionRequest) {
    setBusy('promote'); setPromotionError('');
    try { await save(); const result = await post<PromotionResult>('/promote', request); const nextCatalog = await studioApi<StudioCatalog>('/catalog'); setCatalog(nextCatalog); acceptScenario(result.scenario); setScenarios(list => list.map(item => item.id === result.scenario.id ? result.scenario : item)); setSelectedId(flattenBlocks(result.scenario.blocks).find(block => block.definition.id === result.definition.id)?.id || defaultSelection(result.scenario, nextCatalog)); setCollapsed([]); setDialog(null); setNotice(`“${result.definition.label}” is now a reusable block. Find it in your block library.`); setInspectorOpen(true); }
    catch (error) { setPromotionError(error instanceof Error ? error.message : 'The selection could not be promoted.'); } finally { setBusy(''); }
  }
  async function runScenario() {
    if (runInFlight.current) return;
    const existing = runs.find(run => run.scenarioId === scenarioRef.current?.id && (run.status === 'queued' || run.status === 'running'));
    if (existing) { setSelectedRunId(existing.id); setRunDrawerOpen(true); return; }
    runInFlight.current = true;
    setBusy('run'); setError('');
    try { const saved = await save(); if (!saved) return; const run = await post<RunRecord>('/runs', { scenarioId: saved.id }); setRuns(current => [run, ...current.filter(item => item.id !== run.id)]); setSelectedRunId(run.id); setRunDrawerOpen(true); setInspectorOpen(false); }
    catch (error) { report(error); } finally { setBusy(''); runInFlight.current = false; }
  }
  async function openGraph() {
    setGraphOpen(true); setGraph(undefined);
    try { await save(); setGraph(await studioApi<DependencyGraph>(`/graph${scenarioRef.current ? `?scenarioId=${encodeURIComponent(scenarioRef.current.id)}` : ''}`)); }
    catch (error) { report(error); setGraphOpen(false); }
  }
  async function published(def: BlockDefinition) { try { setCatalog(await studioApi<StudioCatalog>('/catalog')); setDefinition(def); setNotice(`Published version ${def.version}. Existing scenarios keep their pinned versions.`); } catch (error) { report(error); } }
  async function upgradeSelected() {
    if (!selected || !catalog || !scenario) return; const latest = newestDefinitions(catalog).find(def => def.id === selected.definition.id); if (!latest || latest.version <= selected.definition.version) return; setBusy('upgrade'); setError('');
    try { await save(); const next = await post<Scenario>(`/scenarios/${encodeURIComponent(scenario.id)}/upgrade`, { definitionId: selected.definition.id, fromVersion: selected.definition.version, toVersion: latest.version }); acceptScenario(next); setScenarios(list => list.map(item => item.id === next.id ? next : item)); setNotice(`This scenario now uses version ${latest.version}. Other scenarios retain their versions.`); }
    catch (error) { report(error); } finally { setBusy(''); }
  }
  const actionsRef = useRef({ saveAction, runScenario }); actionsRef.current = { saveAction, runScenario };
  useEffect(() => { function keys(event: KeyboardEvent) { if (!(event.metaKey || event.ctrlKey)) return; if (event.key.toLowerCase() === 's') { event.preventDefault(); void actionsRef.current.saveAction(); } if (event.key === 'Enter') { event.preventDefault(); void actionsRef.current.runScenario(); } if (event.key.toLowerCase() === 'i') { event.preventDefault(); setInspectorOpen(current => !current); } } window.addEventListener('keydown', keys); return () => window.removeEventListener('keydown', keys); }, []);
  const closeDialog = useCallback(() => setDialog(null), []);
  const closeDefinition = useCallback(() => setDefinition(undefined), []);
  const closeKnowledge = useCallback(() => setKnowledgeModalId(undefined), []);
  const closeGraph = useCallback(() => setGraphOpen(false), []);
  const latestSelected = selected && catalog && newestDefinitions(catalog).find(def => def.id === selected.definition.id);
  const hasUpgrade = latestSelected && selected && latestSelected.version > selected.definition.version;

  if (loading) return <div className="st-app"><Loading/></div>;
  if (!catalog || !scenario) return <div className="st-app"><EmptyState icon={<AlertCircle size={23}/>} title="The workspace could not be loaded" action={<button className="st-button st-button-primary" onClick={() => setLoadKey(value => value + 1)}>Try again</button>}>{error || 'Start the local Folio server and reload this page.'}</EmptyState></div>;

  return <div className="st-app">
    <header className="st-header"><div><div className="st-breadcrumb"><span>Workspace</span><ChevronRight size={10}/><span>{TITLES[section]}</span>{section === 'studio' && <><ChevronRight size={10}/><span>Commercial property</span></>}</div><div className="st-title-row"><h1>{section === 'studio' ? scenario.name : TITLES[section]}</h1>{section === 'studio' && <><button className="st-icon-button" aria-label="Edit scenario details" onClick={() => setDialog('details')}><Pencil size={13}/></button><span className="st-badge"><span className="st-badge-dot"/>Draft scenario</span></>}</div>{section !== 'studio' && <p className="st-page-description">{DESCRIPTIONS[section]}</p>}</div><div className="st-header-actions"><button className="st-button st-button-quiet st-help-button" onClick={() => setDialog('help')} data-testid="how-it-works"><CircleHelp size={14}/>How this works</button>{section === 'studio' ? <><button className="st-button" onClick={saveAction} disabled={!!busy} data-testid="save-scenario">{busy === 'save' ? <LoaderCircle className="st-spin" size={13}/> : <Save size={13}/>}Save</button><button className="st-button st-button-primary" onClick={runScenario} disabled={!!busy || validating || validation?.valid === false || scenarioRunning} data-testid="run-scenario" title={validation?.valid === false ? 'Review the highlighted issues before running' : 'Save and run this scenario · ⌘ Enter'}>{busy === 'run' ? <LoaderCircle className="st-spin" size={13}/> : <Play size={12} fill="currentColor"/>}{scenarioRunning ? 'Running…' : 'Run scenario'}</button></> : section === 'library' ? <button className="st-button st-button-primary" onClick={() => { onNavigate?.('studio'); void openPromotion(); }}><Plus size={13}/>Create reusable block</button> : section === 'knowledge' ? <button className="st-button" onClick={openGraph}><GitBranch size={13}/>Explore connections</button> : <button className="st-button st-button-primary" onClick={() => onNavigate?.('studio')}><Plus size={13}/>Run a scenario</button>}</div></header>
    {error && <div className="st-alert st-alert-error" role="alert"><AlertCircle size={15}/><span>{error}</span><button className="st-icon-button" onClick={() => setError('')} aria-label="Dismiss error"><X size={13}/></button></div>}
    {notice && <div className="st-alert st-alert-success" role="status"><Check size={14}/><span>{notice}</span>{undoScenario && <button className="st-button st-button-small" onClick={() => { edit(undoScenario); setNotice('Block restored.'); setUndoScenario(undefined); }}>Undo</button>}<button className="st-icon-button" onClick={() => setNotice('')} aria-label="Dismiss notification"><X size={13}/></button></div>}
    {section === 'studio' && <>
      <div className="st-toolbar"><div className="st-toolbar-start"><button className="st-icon-button st-mobile-only" onClick={() => setPaletteOpen(!paletteOpen)} aria-label="Open block catalog"><PanelLeft size={15}/></button><span className="st-toolbar-label">SCENARIO</span><select aria-label="Scenario" data-testid="scenario-select" value={scenario.id} onChange={event => void chooseScenario(event.target.value)} disabled={!!busy}>{scenarios.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button className="st-icon-button" aria-label="Create scenario" onClick={() => setDialog('new')} data-testid="new-scenario"><Plus size={14}/></button><span className="st-divider-v"/><span className={`st-save-status ${dirty ? 'st-dirty' : ''}`}>{dirty ? <span style={{ fontSize: 7 }}>●</span> : <Check size={12}/>}<span data-testid="save-status">{busy === 'save' ? 'Saving…' : dirty ? 'Unsaved changes' : 'All changes saved'}</span></span></div><div className="st-toolbar-end"><button className="st-button st-button-quiet st-button-small" onClick={() => setDialog('clone')} data-testid="clone-scenario"><Copy size={12}/><span className="st-clone-label">Create variation</span></button><button className="st-icon-button" onClick={openPromotion} aria-label="Save as reusable block" data-testid="promote-workflow"><Layers3 size={14}/></button><button className="st-icon-button st-toggle-inspector" onClick={() => setInspectorOpen(!inspectorOpen)} aria-label="Toggle block inspector" data-active={inspectorOpen}><PanelRight size={15}/></button></div></div>
      {scenario.id === 'standard-draft' && <div className="st-starter-strip"><span><span className="st-starter-dot"/>Start here: save a draft, then verify its state.</span><button onClick={() => void chooseScenario('italy-referral')}>Explore the full Italy referral<ArrowRight size={12}/></button></div>}
      {hasUpgrade && <div className="st-alert" style={{ marginBottom: 12 }}><GitBranch size={14}/><span>A newer version of this reusable block is available. This scenario is pinned to v{selected.definition.version}.</span><button className="st-button st-button-small" onClick={upgradeSelected} disabled={!!busy} data-testid="upgrade-block-version">Use v{latestSelected.version} here</button></div>}
      <div className="st-workbench"><Palette catalog={catalog} selected={selected} onAdd={insert} onHelp={() => setDialog('help')} open={paletteOpen} onClose={() => setPaletteOpen(false)}/><ScenarioCanvas scenario={scenario} catalog={catalog} selectedId={selectedId} collapsed={collapsed} validation={validation} onSelect={select} onToggle={id => setCollapsed(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id])} onMove={(id, direction) => edit(relocateBlock(scenarioRef.current!, id, direction))} onDelete={deleteBlock} onAdd={() => setDialog('add')} onPromote={openPromotion} onCollapseAll={() => setCollapsed(flattenBlocks(scenario.blocks).filter(block => block.children?.length || block.changes?.length).map(block => block.id))} onExpandAll={() => setCollapsed([])}/><Inspector scenario={scenario} catalog={catalog} block={selected} validation={validation} tab={tab} onTab={setTab} onInput={editInput} onInterpret={interpret} onConfirm={confirmInterpretation} resolution={resolution} interpreting={busy === 'interpret'} interpretationError={interpretationError} onDefinition={setDefinition} onKnowledge={setKnowledgeModalId} onGraph={openGraph} onPromote={openPromotion} onAdd={() => setDialog('add')} open={inspectorOpen} onClose={() => setInspectorOpen(false)}/></div>
    </>}
    {section === 'library' && <BlockLibrary catalog={catalog} onDefinition={setDefinition} onGraph={openGraph}/>}
    {section === 'knowledge' && <KnowledgeBrowser catalog={catalog} selectedId={knowledgeId} onSelect={setKnowledgeId}/>}
    {section === 'runs' && <RunHistory runs={runs} selectedId={selectedRunId} onSelect={setSelectedRunId} onStart={() => onNavigate?.('studio')} onNavigate={destination => onNavigate?.(destination)}/>}
    {dialog === 'help' && <HelpDialog onClose={closeDialog} onExample={id => void chooseScenario(id)}/>}
    {(dialog === 'new' || dialog === 'clone') && <NewScenarioDialog mode={dialog} current={scenario} busy={busy === 'create'} onClose={closeDialog} onCreate={createScenario}/>}
    {dialog === 'details' && <ScenarioDetailsDialog scenario={scenario} onClose={closeDialog} onSave={values => { edit({ ...scenarioRef.current!, ...values }); setDialog(null); }}/>}
    {dialog === 'promote' && <PromotionDialog scenario={scenario} catalog={catalog} busy={busy === 'promote'} error={promotionError} onClose={closeDialog} onPromote={promote}/>}
    {dialog === 'add' && <AddBlockDialog catalog={catalog} onClose={closeDialog} onAdd={insert}/>}
    {definition && <DefinitionDialog definition={definition} catalog={catalog} onClose={closeDefinition} onUse={insert} onKnowledge={id => { setDefinition(undefined); setKnowledgeModalId(id); }} onSelectVersion={setDefinition} onPublished={published} onOpenScenario={id => void chooseScenario(id)}/>}
    {knowledgeModalId && catalog.knowledge.find(doc => doc.id === knowledgeModalId) && <Modal title="Business knowledge" subtitle="A linked document used by the block definition." onClose={closeKnowledge} wide><div className="st-modal-body"><KnowledgeArticle document={catalog.knowledge.find(doc => doc.id === knowledgeModalId)!} catalog={catalog} onSelect={setKnowledgeModalId}/></div></Modal>}
    {graphOpen && <StorageGraph graph={graph} onClose={closeGraph}/>}
    {runDrawerOpen && activeRun && <RunDrawer run={activeRun} onClose={() => setRunDrawerOpen(false)} onHistory={() => { setRunDrawerOpen(false); onNavigate?.('runs'); }} onNavigate={destination => onNavigate?.(destination)}/>}
  </div>;
}

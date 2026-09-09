import { lazy, Suspense, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Check, CheckCheck, ChevronDown, ChevronRight, Code2, FileText, GitBranch, History, Layers3, Leaf, List, Maximize2, Menu, Minus, Play, Plus, Redo2, Save, Settings2, Sparkles, Undo2, X } from 'lucide-react';
import type { TestingAgentJob, TestingScenarioLifecycle, TestingKnowledgeDocument, TestingAgentSettings, TestingApproval, TestingBlockDefinition, TestingBlockInstance, TestingBusinessDraft, TestingCatalog, TestingCompiledScenario, TestingDefaultDecision, TestingDefinitionChangeApplyResult, TestingDefinitionChangePreview, TestingDefinitionChangeRequest, TestingModel, TestingRun, TestingReuseSuggestion, TestingScenario, TestingScenarioLayout, TestingValidationIssue, TestingValue } from '../../shared/testing';
import { createTestingInstance, testingVersionKey } from '../../shared/testing';
import { testingApi, testingPost, messageOf } from './api';
import { Method } from './Method';
import { WorkspaceNavigation } from './WorkspaceNavigation';
import { RequestStep } from './RequestStep';
import { WorkspaceFrame } from './WorkspaceFrame';
import { WorkspaceContext } from './WorkspaceContext';
import { InlineAgentActivity } from './InlineAgentActivity';
import { WorkspaceRunResult, InlineReview } from './WorkspaceRunResult';
import { AgentOutcome, ExplorationSummary } from './AgentOutcome';
import { AgentFailure } from './AgentFailure';
import { DuplicateReview } from './DuplicateReview';
import { ScenarioOverview } from './ScenarioOverview';
import './testing-workspace.css';
import { Library, Knowledge, KnowledgeArticle } from './Library';
import { Graph } from './Graph';
import { DefinitionDialog } from './DefinitionDialog';
import { DefinitionChangeReview } from './DefinitionChangeReview';
import { Inspector } from './Inspector';
import type { ScratchWorkspaceHandle } from './ScratchWorkspace';
const ScratchWorkspace = lazy(() => import('./ScratchWorkspace').then(module => ({ default: module.ScratchWorkspace })));
import { flattenBlocks, kindLabels, newInstance, phaseLabels, resolvedBlockInputs, statusLabels, updateBlockAtPath } from './model';
import { Empty, formatDate, JsonView, Modal, Notice, Spinner } from './ui';
import './testing.css';
import { BlockInsertion, type InsertionTarget } from './BlockInsertion';
import { buildReferenceIndex, entryStep, referenceChoices } from './references';
import './testing-navigation.css';
import './testing-settings.css';
import { AgentSettings } from './AgentSettings';
import { AgentSettingsContext, ModelSelect, jobModelLabel, useAgentModels } from './AgentModels';
import { DetailsButton } from './DetailsButton';
import { ValidationCounters, ValidationDialog } from './ApprovalReview';
import './testing-review-workspace.css';
import { ScenarioInstruction, ScenarioRevisionDiff } from './ScenarioRevision';
import { TestMatrix } from './TestMatrix';


interface Bootstrap { lifecycles?: TestingScenarioLifecycle[]; catalog: TestingCatalog; scenarios: TestingScenario[]; jobs: TestingAgentJob[]; runs: TestingRun[]; approvals: TestingApproval[]; layouts: TestingScenarioLayout[]; cli: { executable: string; models: { luna: string; sol: string }; timeoutMs: number; sandbox: string; maxConcurrentCalls: number; invocation: string; explanation: string } }
type View = 'scenarios' | 'start' | 'editor' | 'library' | 'knowledge' | 'graph' | 'runs' | 'method' | 'settings';
interface OverrideProposal { scope?: 'scenario'; reviewStatus?: 'pending' | 'dismissed' | 'applied'; before?: TestingScenario; scenario: TestingScenario; changes?: unknown; draft?: TestingBusinessDraft; applied: false }
type OverrideReview = OverrideProposal & { job: TestingAgentJob };
interface PendingDefinitionChange { definition: TestingBlockDefinition; newKnowledge: TestingKnowledgeDocument[]; preview: TestingDefinitionChangePreview; busy: boolean; error?: string }
function overrideProposal(job?: TestingAgentJob): OverrideProposal | undefined {
  if (job?.phase !== 'business' || job.status !== 'completed') return;
  const result = job.result as Partial<OverrideProposal> | undefined;
  if (result?.applied === false && result.scenario?.id === job.scenarioId && (result.scope === 'scenario' ? result.reviewStatus === 'pending' : Array.isArray(result.changes) && !(result as { needsKnowledge?: boolean }).needsKnowledge)) return result as OverrideProposal;
}
function overrideReviewIssue(review: OverrideReview, scenario: TestingScenario | undefined, compiled: TestingCompiledScenario | undefined, dirty: boolean): string | undefined {
  if (!scenario || scenario.id !== review.job.scenarioId) return 'Öffne den Testfall, zu dem dieser Änderungsvorschlag gehört.';
  if (scenario.revision !== review.job.scenarioRevision || review.scenario.revision !== scenario.revision) return 'Dieser Vorschlag gehört zu einer früheren Testfallrevision. Bitte die Änderung für den aktuellen Entwurf erneut beschreiben.';
  if (dirty) return 'Der Entwurf enthält eigene, ungespeicherte Änderungen. Speichere oder verwerfe sie, bevor du einen KI-Vorschlag übernimmst.';
  if (!compiled || compiled.scenarioId !== scenario.id) return 'Der aktuelle Fachstand wird noch geprüft. Die Übernahme ist danach möglich.';
  if (compiled.scenarioRevision !== scenario.revision) return 'Der gespeicherte Testfall hat inzwischen eine andere Revision. Lade ihn erneut, bevor du den Vorschlag prüfst.';
  if (!review.job.fingerprint || compiled.fingerprint !== review.job.fingerprint) return 'Der fachliche Ablauf oder sein Wissen hat sich seit diesem Vorschlag geändert. Bitte die Änderung auf dem aktuellen Stand erneut beschreiben.';
}
const knownViews: View[] = ['scenarios', 'start', 'editor', 'library', 'knowledge', 'graph', 'runs', 'method', 'settings'];
const examples = [
  { tag: 'DIREKTIONSANFRAGE', title: 'Eine besonders wertvolle Kuh', text: 'Ich möchte eine Lebensversicherung für eine Kuh auf einem Betrieb in Bayern. Die Versicherungssumme beträgt 15.000 Euro. Prüfe, dass nach Einreichung des Antrags eine Direktionsanfrage entsteht.', detail: 'Kuh · 15.000 € · Betrieb in Bayern' },
  { tag: 'POLICE ERNEUT DRUCKEN', title: 'Ein Dokument für den Kunden', text: 'Erstelle eine Standard-Kuhlebensversicherung mit 3.500 Euro Versicherungssumme und schließe den Vertrag ab. Danach möchte ich als Sachbearbeiter die Police erneut ausdrucken und das Dokument prüfen.', detail: 'Abgeschlossener Vertrag · Sachbearbeiter' },
  { tag: 'BESTAND VERSICHERN', title: 'Ein Betrieb mit Schweinemast', text: 'Ich möchte für einen landwirtschaftlichen Betrieb einen Mastschweinebestand mit 120 Tieren versichern. Erstelle einen passenden Antrag und prüfe, welche Anforderungen für diese Tierart gelten.', detail: 'Schweine · Bestand · Eigene Pflichtangaben' },
];

function initialView(): View { const path = window.location.pathname.split('/')[2]; return path === 'new' ? 'start' : knownViews.includes(path as View) ? path as View : path === 'editor' ? 'editor' : 'scenarios'; }
function viewPath(view: View) { return `/testing/${view === 'start' ? 'new' : view}`; }
function storageDraft(scenario: TestingScenario): TestingScenario { try { const saved = sessionStorage.getItem(`folio-testing-draft:${scenario.id}`); if (saved) { const draft = JSON.parse(saved) as TestingScenario; if (draft.id === scenario.id && Array.isArray(draft.blocks)) return draft; } } catch { /* The editor remains usable without browser storage. */ } return scenario; }

function routeScenarioId() { try { return decodeURIComponent(window.location.pathname.split('/')[3] ?? ''); } catch { return ''; } }
function lastScenarioId() { try { return sessionStorage.getItem('folio-testing-last-scenario') ?? ''; } catch { return ''; } }
function jobScenario(job: TestingAgentJob) { const result = job.result as { scenario?: TestingScenario; run?: TestingRun } | undefined; return { id: job.scenarioId ?? result?.scenario?.id ?? result?.run?.scenarioId, revision: job.scenarioRevision ?? result?.scenario?.revision ?? result?.run?.scenarioRevision, title: result?.scenario?.title ?? result?.run?.scenarioTitle }; }

export function TestingApp() {
  const [data, setData] = useState<Bootstrap>();
  const [settings, setAgentSettings] = useState<TestingAgentSettings>();
  const [view, setView] = useState<View>(initialView);
  const [routeId, setRouteId] = useState(routeScenarioId);
  const [lastId, setLastId] = useState(lastScenarioId);
  const dataRef = useRef(data); dataRef.current = data;
  const drafts = useRef(new Map<string, TestingScenario>());
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [request, setRequest] = useState(() => { try { return sessionStorage.getItem('folio-testing-request') ?? ''; } catch { return ''; } });
  const [model, setModel] = useState<TestingModel>('luna');
  const [draft, setDraft] = useState<TestingScenario>();
  const draftRef = useRef(draft); draftRef.current = draft;
  const [savedJson, setSavedJson] = useState('');
  const savedRef = useRef(savedJson); savedRef.current = savedJson;
  const [layout, setLayoutState] = useState<TestingScenarioLayout>();
  const layoutRef = useRef(layout);
  function setLayout(value: TestingScenarioLayout | undefined | ((previous: TestingScenarioLayout | undefined) => TestingScenarioLayout | undefined)) {
    const next = typeof value === 'function' ? value(layoutRef.current) : value;
    layoutRef.current = next;
    if (next) try { sessionStorage.setItem(`folio-testing-layout:${next.scenarioId}`, JSON.stringify(next)); } catch { /* The current layout remains in memory. */ }
    setLayoutState(next);
  }
  const [compiled, setCompiled] = useState<TestingCompiledScenario>();
  const [selected, setSelected] = useState<string>();
  const [issueFocus, setIssueFocus] = useState<{ path: string; field?: string; token: number }>();
  const [activeJob, setActiveJob] = useState<TestingAgentJob>();
  const [activeRun, setActiveRun] = useState<TestingRun>();
  const [busy, setBusy] = useState('');
  const [knowledgeId, setKnowledgeId] = useState<string>();
  const [knowledgeModal, setKnowledgeModal] = useState<string>();
  const [definitionModal, setDefinitionModal] = useState<{ definition?: TestingBlockDefinition; insertion?: InsertionTarget }>();
  const [definitionChange, setDefinitionChange] = useState<PendingDefinitionChange>();
  const [bindingId, setBindingId] = useState<string>();
  const [libraryId, setLibraryId] = useState<string>();
  const [outline, setOutline] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [validationOpen, setValidationOpen] = useState(false);
  const [phaseView, setPhaseView] = useState<{ id: string; phase: number }>(() => ({ id: routeScenarioId(), phase: Number(new URLSearchParams(window.location.search).get('step') ?? 0) - 1 }));
  const [manualScenarioId, setManualScenarioId] = useState<string>();
  const [mobileNav, setMobileNav] = useState(false);
  const [pendingOverride, setPendingOverride] = useState<OverrideReview>();
  const approvalStarting = useRef(false);
  const [overrideError, setOverrideError] = useState('');
  const [dismissedProposals, setDismissedProposals] = useState<string[]>(() => { try { return JSON.parse(sessionStorage.getItem('folio-testing-dismissed-proposals') ?? '[]'); } catch { return []; } });
  useEffect(() => { try { sessionStorage.setItem('folio-testing-dismissed-proposals', JSON.stringify(dismissedProposals)); } catch { /* Local state still supports dismissal. */ } }, [dismissedProposals]);
  const scratch = useRef<ScratchWorkspaceHandle>(null);
  const dirty = !!draft && JSON.stringify(draft) !== savedJson;
  const jobRunning = activeJob?.status === 'queued' || activeJob?.status === 'running';
  const runRunning = activeRun?.status === 'queued' || activeRun?.status === 'running';
  const scenarioLifecycle = data?.lifecycles?.find(item => item.scenarioId === draft?.id);
  const linkedWorking = !!data?.jobs.some(item => scenarioLifecycle?.childJobIds.includes(item.id) && ['queued', 'running'].includes(item.status));
  const actionLocked = !!busy || jobRunning || linkedWorking || runRunning;
  const isApproved = !!compiled?.approval && !dirty && compiled.approval.scenarioRevision === draft?.revision && compiled.approval.fingerprint === compiled.fingerprint;
  const backgroundJobsRunning = data?.jobs.some(job => job.status === 'queued' || job.status === 'running') ?? false;
  const savedOverrideJob = data?.jobs.find(job => job.scenarioId === draft?.id && !dismissedProposals.includes(job.id) && overrideProposal(job));
  const pendingOverrideIssue = pendingOverride ? overrideReviewIssue(pendingOverride, draft, compiled, dirty) : undefined;

  useEffect(() => { const controller = new AbortController(); testingApi<TestingAgentSettings>('/settings', { signal: controller.signal }).then(value => { if (!controller.signal.aborted) { setAgentSettings(value); setModel(value.defaultModel); } }).catch(cause => { if (!controller.signal.aborted) setError(messageOf(cause)); }); return () => controller.abort(); }, []);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const response = await testingApi<Bootstrap>('/bootstrap', { signal });
    // Ordinary knowledge links refer to an identity and show its latest
    // revision. Historical run snapshots and the graph retain their history.
    const knowledge = [...new Map([...response.catalog.knowledge].sort((a, b) => a.revision - b.revision).map(document => [document.id, document])).values()];
    const next = { ...response, catalog: { ...response.catalog, knowledge } };
    setData(next);
    setActiveRun(current => current ? next.runs.find(run => run.id === current.id) ?? current : current);
    return next;
  }, []);
  useEffect(() => { const controller = new AbortController(); refresh(controller.signal).catch(cause => { if (!controller.signal.aborted) setError(messageOf(cause)); }); return () => controller.abort(); }, [refresh]);
  useEffect(() => { const onPop = () => { persistDraft(); setView(initialView()); setRouteId(routeScenarioId()); setPhaseView({ id: routeScenarioId(), phase: Number(new URLSearchParams(window.location.search).get('step') ?? 0) - 1 }); setMobileNav(false); }; window.addEventListener('popstate', onPop); return () => window.removeEventListener('popstate', onPop); }, []);
  useEffect(() => {
    if (!data || view !== 'editor') return;
    const id = routeId || draftRef.current?.id || lastId;
    const scenario = data.scenarios.find(item => item.id === id);
    if (scenario) {
      loadScenario(scenario, data);
      if (!routeId) { window.history.replaceState({}, '', `/testing/editor/${encodeURIComponent(id)}`); setRouteId(id); }
    } else if (id) { persistDraft(); setDraft(undefined); draftRef.current = undefined; setError('Dieser Testfall wurde nicht gefunden. Die gespeicherten Testfälle sind weiterhin in der Übersicht verfügbar.'); }
  }, [!!data, view, routeId]);
  useEffect(() => {
    if (!data || !draft) return;
    const state = data.lifecycles?.find(item => item.scenarioId === draft.id);
    const currentJob = data.jobs.find(item => item.id === state?.currentJobId);
    if (currentJob && activeJob?.id !== currentJob.id) setActiveJob(currentJob);
    const linked = data.runs.find(item => item.id === state?.runId && item.scenarioRevision === draft.revision && item.compiled.fingerprint === state.fingerprint);
    if (linked && activeRun?.id !== linked.id) setActiveRun(linked);
  }, [data, draft?.id, draft?.revision]);
  useEffect(() => {
    const current = draftRef.current;
    const incoming = data?.scenarios.find(item => item.id === current?.id);
    if (!current || !incoming || incoming.revision <= current.revision) return;
    let saved: TestingScenario;
    try { saved = JSON.parse(savedRef.current); } catch { return; }
    const content = (value: TestingScenario) => { const { title, naming, revision, updatedAt, ...rest } = value; return JSON.stringify(rest); };
    if (JSON.stringify(current) === savedRef.current) { loadScenario(incoming, data); return; }
    if (content(saved) !== content(incoming)) return;
    const rebased = { ...current, revision: incoming.revision, updatedAt: incoming.updatedAt, naming: incoming.naming, title: current.title === saved.title ? incoming.title : current.title };
    savedRef.current = JSON.stringify(incoming); setSavedJson(savedRef.current);
    draftRef.current = rebased; setDraft(rebased);
  }, [data?.scenarios]);
  useEffect(() => { persistDraft(); }, [draft, dirty]);
  useEffect(() => { const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } }; window.addEventListener('beforeunload', beforeUnload); return () => window.removeEventListener('beforeunload', beforeUnload); }, [dirty]);
  useEffect(() => { if (!draft || dirty) { setCompiled(undefined); return; } const controller = new AbortController(); testingApi<TestingCompiledScenario>(`/scenarios/${encodeURIComponent(draft.id)}/compile`, { signal: controller.signal }).then(result => { if (!controller.signal.aborted && draftRef.current?.id === result.scenarioId && draftRef.current.revision === result.scenarioRevision && JSON.stringify(draftRef.current) === savedRef.current) setCompiled(result); }).catch(cause => { if (!controller.signal.aborted) setError(messageOf(cause)); }); return () => controller.abort(); }, [draft?.id, draft?.revision, dirty, data?.catalog]);
  useEffect(() => { if (!layout || !draft) return; const controller = new AbortController(); const timer = setTimeout(() => { testingApi(`/scenarios/${encodeURIComponent(layout.scenarioId)}/layout`, { method: 'PUT', body: JSON.stringify(layout), signal: controller.signal }).catch(cause => { if (!controller.signal.aborted) setError(messageOf(cause)); }); }, 700); return () => { clearTimeout(timer); controller.abort(); }; }, [layout, draft?.id]);
  useEffect(() => {
    if (!jobRunning || !activeJob) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const job = await testingApi<TestingAgentJob>(`/jobs/${encodeURIComponent(activeJob.id)}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (job.status === 'queued' || job.status === 'running') {
          await refresh(controller.signal);
          if (controller.signal.aborted) return;
          setActiveJob(job);
          timer = setTimeout(poll, 1300);
          return;
        }
        // Keep the polling effect alive until its terminal result has been
        // processed. Publishing the completed job earlier aborts this refresh.
        const next = await refresh(controller.signal);
        if (controller.signal.aborted) return;
        const result = job.result as { scenario?: TestingScenario; run?: TestingRun } | undefined;
        const proposal = overrideProposal(job);
        if (proposal) {
          if (draftRef.current?.id === job.scenarioId) {
            setPendingOverride({ ...proposal, job });
            setOverrideError('');

          }
        } else if (job.status === 'completed' && job.phase === 'business' && result?.scenario) {
          // Completion must not replace a draft the user opened or edited meanwhile.
          if ((!draftRef.current && initialView() === 'start') || draftRef.current?.id === result.scenario.id && JSON.stringify(draftRef.current) === savedRef.current) { loadScenario(result.scenario, next); navigate('editor', result.scenario.id); }
          else setNotice(`Der Entwurf „${result.scenario.title}“ ist bereit. Öffne ihn über den Agentenauftrag.`);
        }
        if (job.status === 'completed' && job.phase === 'technical') {
          const run = result?.run;
          if (run && draftRef.current?.id === run.scenarioId) setActiveRun(run);
        }
        setActiveJob(job);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(messageOf(cause));
          timer = setTimeout(poll, 2500);
        }
      }
    };
    timer = setTimeout(poll, 700);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [activeJob?.id, jobRunning, refresh]);
  useEffect(() => {
    if (!activeRun || !['queued', 'running'].includes(activeRun.status)) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const run = await testingApi<TestingRun>(`/runs/${encodeURIComponent(activeRun.id)}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setActiveRun(run);
        if (run.status === 'queued' || run.status === 'running') timer = setTimeout(poll, 1000);
        else await refresh(controller.signal);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(messageOf(cause));
          timer = setTimeout(poll, 2500);
        }
      }
    };
    timer = setTimeout(poll, 600);
    return () => { clearTimeout(timer); controller.abort(); };
    // A terminal status must not abort the final refresh. A different run or
    // unmount cancels this effect; a completed run schedules no further poll.
  }, [activeRun?.id, refresh]);

  useEffect(() => { try { sessionStorage.setItem('folio-testing-request', request); } catch { /* The request remains editable without browser storage. */ } }, [request]);
  useEffect(() => { if (!backgroundJobsRunning || jobRunning) return; const controller = new AbortController(); const timer = setInterval(() => { refresh(controller.signal).catch(cause => { if (!controller.signal.aborted) setError(messageOf(cause)); }); }, 1800); return () => { clearInterval(timer); controller.abort(); }; }, [backgroundJobsRunning, jobRunning, refresh]);

  function persistDraft() {
    const current = draftRef.current;
    if (!current) return;
    const changed = JSON.stringify(current) !== savedRef.current;
    if (changed) drafts.current.set(current.id, current); else drafts.current.delete(current.id);
    try { if (changed) sessionStorage.setItem(`folio-testing-draft:${current.id}`, JSON.stringify(current)); else sessionStorage.removeItem(`folio-testing-draft:${current.id}`); } catch { /* In-memory drafts still survive navigation. */ }
  }
  function navigate(next: View, id?: string) {
    persistDraft();
    const targetId = next === 'editor' ? id || draftRef.current?.id || lastId : id;
    const path = `${viewPath(next)}${targetId ? `/${encodeURIComponent(targetId)}` : ''}`;
    if (window.location.pathname !== path) window.history.pushState({}, '', path);
    setView(next); setRouteId(targetId ?? ''); setMobileNav(false); window.scrollTo({ top: 0 });
  }
  function loadScenario(scenario: TestingScenario, bootstrap = dataRef.current) {
    if (draftRef.current?.id === scenario.id && (JSON.stringify(draftRef.current) !== savedRef.current || scenario.revision <= draftRef.current.revision)) return;
    persistDraft();
    const restored = drafts.current.get(scenario.id) ?? storageDraft(scenario);
    draftRef.current = restored; savedRef.current = JSON.stringify(scenario);
    setDraft(restored); setSavedJson(JSON.stringify(scenario));
    const lifecycle = bootstrap?.lifecycles?.find(item => item.scenarioId === scenario.id);
    setActiveJob(bootstrap?.jobs.find(item => item.id === lifecycle?.currentJobId));
    let restoredLayout = bootstrap?.layouts.find(item => item.scenarioId === scenario.id) ?? { id: `layout:${scenario.id}`, scenarioId: scenario.id, collapsed: [] };
    try { const local = JSON.parse(sessionStorage.getItem(`folio-testing-layout:${scenario.id}`) ?? 'null'); if (local?.scenarioId === scenario.id) restoredLayout = local; } catch { /* Saved server layout remains available. */ }
    setLayout(restoredLayout);
    setSelected(undefined); setCompiled(undefined); setActiveRun(undefined); setLastId(scenario.id);
    try { sessionStorage.setItem('folio-testing-last-scenario', scenario.id); } catch { /* The current test remains accessible in memory. */ }
    if (restored.revision !== scenario.revision) setNotice('Deine ungespeicherten Änderungen wurden wiederhergestellt. Inzwischen gibt es eine neuere gespeicherte Revision. Prüfe deinen Entwurf; er wurde nicht automatisch ersetzt.');
  }
  async function saveDraft(): Promise<TestingScenario | undefined> {
    const current = draftRef.current;
    if (!current) return;
    if (JSON.stringify(current) === savedJson) return current;
    setBusy('save');
    try {
      const result = await testingApi<TestingScenario | { scenario: TestingScenario }>(`/scenarios/${encodeURIComponent(current.id)}`, { method: 'PUT', body: JSON.stringify({ ...current, expectedRevision: current.revision }) });
      const saved = 'scenario' in result ? result.scenario : result;
      if (draftRef.current?.id === current.id) { setSavedJson(JSON.stringify(saved)); savedRef.current = JSON.stringify(saved); }
      const cached = drafts.current.get(current.id);
      if (cached) { const revised = JSON.stringify(cached) === JSON.stringify(current) ? saved : { ...cached, revision: saved.revision, updatedAt: saved.updatedAt }; drafts.current.set(current.id, revised); try { sessionStorage.setItem(`folio-testing-draft:${current.id}`, JSON.stringify(revised)); } catch { /* Keep the in-memory draft. */ } }
      const latest = draftRef.current;
      if (latest?.id === current.id) { const revised = JSON.stringify(latest) === JSON.stringify(current) ? saved : { ...latest, revision: saved.revision, updatedAt: saved.updatedAt }; draftRef.current = revised; setDraft(revised); }
      setData(previous => previous ? { ...previous, scenarios: [saved, ...previous.scenarios.filter(item => item.id !== saved.id)] } : previous);
      return saved;
    } catch (cause) { setError(messageOf(cause)); return; } finally { setBusy(''); }
  }
  useEffect(() => { const onKey = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's' && draftRef.current) { event.preventDefault(); if (!busy) void saveDraft(); } if (event.key === 'Escape' && !event.defaultPrevented && !document.querySelector('dialog[open]') && !(event.target instanceof HTMLElement && (event.target.matches('input,textarea,[contenteditable=true]') || event.target.closest('.blocklyWidgetDiv')))) { setMobileNav(false); setFullscreen(false); } }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, [savedJson, busy]);
  function openScenario(id: string) {
    const scenario = dataRef.current?.scenarios.find(item => item.id === id);
    if (!scenario) { setError('Der zugehörige Testfall wurde nicht gefunden.'); return; }
    loadScenario(scenario); setActiveJob(undefined); navigate('editor', scenario.id);
  }
  function openJobDraft(job: TestingAgentJob) {
    const context = jobScenario(job);
    if (!context.id) { setError('Dieser Auftrag hat noch keinen Testfall erzeugt.'); return; }
    openScenario(context.id);
    const current = dataRef.current?.scenarios.find(item => item.id === context.id);
    if (current && context.revision && (current.revision !== context.revision || draftRef.current?.revision !== current.revision)) setNotice(`Der Auftrag gehört zu Revision ${context.revision}. Gespeichert ist Revision ${current.revision}. Der geöffnete Entwurf hat Revision ${draftRef.current?.revision}${JSON.stringify(draftRef.current) !== savedRef.current ? ' mit deinen ungespeicherten Änderungen' : ''}.`);
  }
  async function action(name: string, task: () => Promise<void>) { if (busy) return; setBusy(name); setError(''); try { await task(); } catch (cause) { setError(messageOf(cause)); } finally { setBusy(''); } }
  async function beginBusiness() { if (!request.trim()) return; await action('business', async () => { const job = await testingPost<TestingAgentJob>('/jobs/business', { request, model }); const next = await refresh(); const scenario = next.scenarios.find(item => item.id === job.scenarioId); if (scenario) { loadScenario(scenario, next); navigate('editor', scenario.id); } setActiveJob(job); setRequest(''); }); }
  function followProgress() { setPhaseView({ id: '', phase: -1 }); if (window.location.search) window.history.replaceState({}, '', window.location.pathname); }
  async function planScenario() { followProgress(); const saved = await saveDraft(); if (!saved) return; await action('plan', async () => { const job = await testingPost<TestingAgentJob>(`/scenarios/${encodeURIComponent(saved.id)}/plan`, { revision: saved.revision, model }); setActiveJob(job); await refresh(); }); }
  async function approve() {
    if (approvalStarting.current) return;
    approvalStarting.current = true;
    try {
      const saved = await saveDraft();
      if (!saved) return;
      await action('approve', async () => {
        const checked = await testingApi<TestingCompiledScenario>(`/scenarios/${encodeURIComponent(saved.id)}/compile`);
        if (draftRef.current?.id === saved.id && draftRef.current.revision === saved.revision && JSON.stringify(draftRef.current) === savedRef.current) setCompiled(checked);
        if (checked.issues.some(issue => issue.severity === 'error')) { setValidationOpen(true); return; }
        await testingPost(`/scenarios/${encodeURIComponent(saved.id)}/approve`, { revision: saved.revision });
        const approved = await testingApi<TestingCompiledScenario>(`/scenarios/${encodeURIComponent(saved.id)}/compile`);
        const stillCurrent = draftRef.current?.id === saved.id && draftRef.current.revision === saved.revision && JSON.stringify(draftRef.current) === savedRef.current;
        if (approved.scenarioRevision !== saved.revision || approved.fingerprint !== checked.fingerprint || approved.approval?.scenarioRevision !== saved.revision || approved.approval?.fingerprint !== approved.fingerprint) throw new Error('Der Fachstand hat sich während der Freigabe geändert. Prüfe die aktuelle Revision erneut.');
        if (!stillCurrent) throw new Error('Der fachliche Ablauf wurde freigegeben, aber der geöffnete Entwurf hat sich inzwischen geändert. Die technische Prüfung wurde deshalb nicht gestartet.');
        setCompiled(approved);
        followProgress();
        try {
          const job = await testingPost<TestingAgentJob>('/jobs/technical', { scenarioId: saved.id, revision: approved.scenarioRevision, model });
          setActiveJob(job);
          await refresh();
          setNotice('Der fachliche Ablauf ist freigegeben. Die technische Prüfung wurde gestartet.');
        } catch (cause) {
          await refresh();
          throw cause;
        }
      });
    } finally { approvalStarting.current = false; }
  }
  async function technical() { if (!draft || dirty) return; followProgress(); await action('technical', async () => { const job = await testingPost<TestingAgentJob>('/jobs/technical', { scenarioId: draft.id, revision: draft.revision, model }); setActiveJob(job); await refresh(); }); }
  async function run() { if (!draft || dirty) return; followProgress(); await action('run', async () => { const next = await testingPost<TestingRun>(`/scenarios/${encodeURIComponent(draft.id)}/run`, { revision: draft.revision, model }); if (draftRef.current?.id === next.scenarioId) setActiveRun(next); await refresh(); }); }
  async function reviseScenario(text: string) {
    const intended = draftRef.current?.id;
    const saved = await saveDraft();
    if (!saved || saved.id !== intended || draftRef.current?.id !== intended) return;
    if (JSON.stringify(draftRef.current) !== savedRef.current) { setError('Der lokale Entwurf wurde während des Speicherns geändert. Speichere diese Änderungen vor dem KI-Auftrag.'); return; }
    followProgress();
    await action('revision', async () => { const job = await testingPost<TestingAgentJob>(`/scenarios/${encodeURIComponent(saved.id)}/interpret-revision`, { text, model, revision: saved.revision }); setActiveJob(job); await refresh(); });
  }
  async function repairTechnicalResult(text: string) {
    const technicalJob = technicalWorkspaceJob;
    const result = technicalJob?.result as { plan?: { unsupported?: Array<string | { kind?: string; summary?: string }> }; repairContext?: { sourceJobId: string; issues: Array<string | { kind?: string; summary?: string }> } } | undefined;
    const sourceJobId = result?.repairContext?.sourceJobId ?? technicalJob?.id;
    const issues = result?.repairContext?.issues ?? result?.plan?.unsupported ?? [];
    const issueIndex = issues.findIndex(item => typeof item !== 'string' && item.kind === 'business-contract');
    if (technicalJob?.scenarioId && sourceJobId && issueIndex >= 0) {
      followProgress();
      await action('technical-repair', async () => {
        const next = await testingPost<TestingAgentJob>(`/scenarios/${encodeURIComponent(technicalJob.scenarioId!)}/jobs/${encodeURIComponent(sourceJobId)}/revise-unsupported`, { issueIndex, model, instruction: text });
        setActiveJob(next);
        await refresh();
      });
      return;
    }
    const summaries = issues.map(item => typeof item === 'string' ? item : item.summary).filter(Boolean);
    const context = sourceJobId ? `Der technische Auftrag ${sourceJobId} konnte den freigegebenen Fachstand nicht umsetzen.${summaries.length ? ` Gemeldete Grenzen: ${summaries.join(' ')}` : technicalJob?.error ? ` Gemeldeter Fehler: ${technicalJob.error}` : ''}` : 'Die technische Prüfung konnte den freigegebenen Fachstand nicht umsetzen.';
    await reviseScenario(`${context}\n\nGewünschte fachliche Überarbeitung: ${text}`);
  }
  async function override(text: string) { if (!draft || !selected) return; const saved = await saveDraft(); if (!saved) return; await action('override', async () => { const job = await testingPost<TestingAgentJob>(`/scenarios/${encodeURIComponent(saved.id)}/interpret-override`, { instanceId: selected, text, model, revision: saved.revision }); setActiveJob(job); await refresh(); }); }
  function reviewOverride(job: TestingAgentJob) {
    const proposal = overrideProposal(job);
    if (!proposal) return;
    setPendingOverride({ ...proposal, job });
    setOverrideError('');
    setActiveJob(job);

  }
  async function dismissOverride() {
    const review = pendingOverride;
    if (!review) return;
    await action('dismiss-override', async () => {
      if (review.scope === 'scenario') await testingPost(`/jobs/${encodeURIComponent(review.job.id)}/dismiss-revision`, {});
      setDismissedProposals(ids => [...ids, review.job.id]); setPendingOverride(undefined);
      await refresh();
    });
  }
  async function applyOverride() {
    const review = pendingOverride;
    if (!review) return;
    await action('apply-override', async () => {
      setOverrideError('');
      try {
        const current = draftRef.current;
        const issue = overrideReviewIssue(review, current, compiled, JSON.stringify(current) !== savedJson);
        if (!current || issue) { setOverrideError(issue ?? 'Der zugehörige Testfall ist nicht geöffnet.'); return; }
        const currentJson = JSON.stringify(current);
        const fresh = await testingApi<TestingCompiledScenario>(`/scenarios/${encodeURIComponent(current.id)}/compile`);
        const latest = draftRef.current;
        const freshIssue = overrideReviewIssue(review, latest, fresh, JSON.stringify(latest) !== savedJson);
        if (freshIssue || JSON.stringify(latest) !== currentJson) { setOverrideError(freshIssue ?? 'Der lokale Entwurf wurde während der Prüfung geändert. Bitte prüfe die Ausnahme erneut.'); return; }
        if (review.scope === 'scenario') {
          const result = await testingPost<{ scenario: TestingScenario; compiled: TestingCompiledScenario }>(`/jobs/${encodeURIComponent(review.job.id)}/apply-revision`, { expectedRevision: current.revision, fingerprint: fresh.fingerprint });
          await refresh();
          if (draftRef.current?.id === current.id && JSON.stringify(draftRef.current) === currentJson) {
            drafts.current.delete(current.id); sessionStorage.removeItem(`folio-testing-draft:${current.id}`);
            draftRef.current = result.scenario; savedRef.current = JSON.stringify(result.scenario);
            setDraft(result.scenario); setSavedJson(JSON.stringify(result.scenario)); setCompiled(result.compiled);
            setSelected(result.scenario.blocks[0]?.id);
          } else { setNotice('Der KI-Vorschlag wurde gespeichert. Dein inzwischen geänderter lokaler Entwurf bleibt erhalten; lade die neue Revision zur Prüfung.'); }
          setPendingOverride(undefined);
          setDismissedProposals(ids => [...ids, review.job.id]);
          if (draftRef.current?.revision === result.scenario.revision) setNotice('Die Ablaufänderung wurde als neue Revision gespeichert. Prüfe den Fachstand und gib ihn erneut frei.');
          return;
        }
        setDraft(structuredClone(review.scenario));
        setPendingOverride(undefined);

        setNotice('Die Ausnahme wurde in den lokalen Entwurf übernommen. Speichere den Testfall, um die Änderung zu sichern.');
      } catch (cause) { setOverrideError(messageOf(cause)); }
    });
  }
  function editBlocks(blocks: TestingBlockInstance[]) { setDraft(current => current ? { ...current, blocks } : current); }
  function startWith(text: string) { setRequest(text); navigate('start'); setTimeout(() => document.getElementById('testing-request')?.focus(), 0); }
  function addDefinition(definition: TestingBlockDefinition, target?: InsertionTarget, catalog = dataRef.current?.catalog) {
    const current = draftRef.current;
    if (!current || !catalog) { setNotice('Öffne zuerst einen Testfall oder lasse einen fachlichen Entwurf erstellen.'); navigate('scenarios'); return; }
    const scenarioId = target?.scenarioId ?? current.id;
    const scenario = current.id === scenarioId ? current : drafts.current.get(scenarioId) ?? dataRef.current?.scenarios.find(item => item.id === scenarioId);
    if (!scenario) throw new Error('Der Testfall für den neuen Block ist nicht mehr verfügbar.');
    if (target?.placement === 'canvas') {
      if (current.id !== scenarioId || !scratch.current) throw new Error('Öffne die Arbeitsfläche dieses Testfalls, um den neuen Block dort zu platzieren.');
      scratch.current.place(definition);
      return;
    }
    const parent = target?.parentPath ? flattenBlocks(scenario.blocks, catalog).find(item => item.path === target.parentPath) : undefined;
    if (target?.parentPath && !parent) throw new Error('Die Einfügestelle wurde entfernt. Öffne den Testfall und wähle eine neue Stelle.');
    const block = newInstance(definition, scenario.blocks, catalog);
    const blocks = parent ? updateBlockAtPath(scenario.blocks, parent.path, catalog, container => ({ ...container, children: [...container.children ?? parent.definition?.body ?? [], block] })) : [...scenario.blocks, block];
    const insertedPath = parent ? `${parent.path}/${block.id}` : block.id;
    const referenceIndex = buildReferenceIndex(flattenBlocks(blocks, catalog), scenario.parameters);
    for (const input of definition.inputs) {
      if (!input.type.endsWith('-ref')) continue;
      const choices = referenceChoices(referenceIndex, insertedPath, input.type);
      block.inputs[input.key] = input.default !== undefined ? structuredClone(input.default) : { ref: choices.length === 1 ? choices[0].key : '', type: input.type };
    }
    const updated = { ...scenario, blocks };
    if (current.id === scenarioId) { draftRef.current = updated; setDraft(updated); selectReferenceSource(parent ? `${parent.path}/${block.id}` : block.id); }
    drafts.current.set(scenarioId, updated);
    try { sessionStorage.setItem(`folio-testing-draft:${scenarioId}`, JSON.stringify(updated)); } catch { /* The new block remains in the in-memory draft. */ }
    setNotice(`„${definition.name}“ wurde zum Ablauf hinzugefügt. Speichere den Testfall.`);
    if (!target) navigate('editor', scenarioId);
  }
  const entries = draft && data ? flattenBlocks(draft.blocks, data.catalog) : [];
  const parkedIndex = data ? layout?.parkedStacks?.findIndex(stack => flattenBlocks(stack, data.catalog).some(item => item.path === selected)) ?? -1 : -1;
  const selectedBlocks = parkedIndex >= 0 ? layout!.parkedStacks![parkedIndex] : draft?.blocks ?? [];
  const inspectorEntries = parkedIndex >= 0 && data ? flattenBlocks(selectedBlocks, data.catalog) : entries;
  const entry = inspectorEntries.find(item => item.path === selected);
  function editSelectedScope(blocks: TestingBlockInstance[]) {
    if (parkedIndex < 0) { editBlocks(blocks); return; }
    setLayout(current => { if (!current?.parkedStacks) return current; const stacks = current.parkedStacks.map((stack, index) => index === parkedIndex ? blocks : stack).filter(stack => stack.length); return { ...current, parkedStacks: stacks, parkedBlocks: stacks.flat() }; });
  }
  function selectPhase(phase: number) {
    if (!draft) return;
    setPhaseView({ id: draft.id, phase }); setFullscreen(false);
    const url = `/testing/editor/${encodeURIComponent(draft.id)}?step=${phase + 1}`;
    window.history.pushState({}, '', url);
  }
  function selectReferenceSource(path: string) {
    setSelected(path); scratch.current?.select(path);
    requestAnimationFrame(() => {
      scratch.current?.select(path);
      const row = Array.from(document.querySelectorAll<HTMLButtonElement>('.t-outline [data-block-path]')).find(button => button.dataset.blockPath === path);
      row?.scrollIntoView({ block: 'nearest' }); row?.focus({ preventScroll: true });
    });
  }
  function showIssue(issue: TestingValidationIssue) {
    const target = entries.find(item => item.path === issue.path || !issue.path && item.block.id === issue.instanceId);
    if (!target) return;
    selectReferenceSource(target.path);
    setIssueFocus({ path: target.path, field: issue.field, token: Date.now() });
  }
  useEffect(() => {
    if (!issueFocus || selected !== issueFocus.path) return;
    const timer = requestAnimationFrame(() => {
      const panel = document.querySelector<HTMLElement>('.t-inspector');
      panel?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      const id = `testing-value-${issueFocus.field?.replace(/[^a-z0-9]/gi, '-')}`;
      const field = panel?.querySelector<HTMLElement>(`[id="${id}"]`) ?? panel?.querySelector<HTMLElement>(`[id^="${id}-"]`);
      field?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(timer);
  }, [issueFocus, selected]);
  function updateSelected(update: (block: TestingBlockInstance) => TestingBlockInstance | null) { if (draft && data && selected) editSelectedScope(updateBlockAtPath(selectedBlocks, selected, data.catalog, update)); }
  function updateValue(key: string, value: TestingValue) { if (!draft || !data || !entry) return; if (entry.inherited && entry.parent) { const relative = entry.path.slice(entry.parent.path.length + 1); editSelectedScope(updateBlockAtPath(selectedBlocks, entry.parent.path, data.catalog, parent => ({ ...parent, overrides: { ...parent.overrides, [relative]: { ...parent.overrides?.[relative], [key]: value } } }))); } else updateSelected(block => ({ ...block, inputs: { ...block.inputs, [key]: value } })); }
  function moveSelected(direction: number) { if (!draft || !data || !entry) return; const move = (blocks: TestingBlockInstance[]) => { const index = blocks.findIndex(block => block.id === entry.block.id); if (index < 0 || index + direction < 0 || index + direction >= blocks.length) return blocks; const next = [...blocks]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; return next; }; if (entry.parent) editSelectedScope(updateBlockAtPath(selectedBlocks, entry.parent.path, data.catalog, parent => ({ ...parent, children: move(parent.children ?? entry.parent?.definition?.body ?? []) }))); else editSelectedScope(move(selectedBlocks)); }
  function duplicateSelected() { if (!entry || !draft || !data || !entry.definition) return; const copy = createTestingInstance(entry.definition); copy.inputs = structuredClone(entry.block.inputs); copy.overrides = structuredClone(entry.block.overrides); copy.children = structuredClone(entry.block.children); const append = (blocks: TestingBlockInstance[]) => { const next = [...blocks]; next.splice(next.findIndex(block => block.id === entry.block.id) + 1, 0, copy); return next; }; if (entry.parent) editSelectedScope(updateBlockAtPath(selectedBlocks, entry.parent.path, data.catalog, parent => ({ ...parent, children: append(parent.children ?? entry.parent?.definition?.body ?? []) }))); else editSelectedScope(append(selectedBlocks)); setSelected(entry.parent ? `${entry.parent.path}/${copy.id}` : copy.id); }
  async function saveDefinition(definition: TestingBlockDefinition, newKnowledge: TestingKnowledgeDocument[] = []) {
    const insertion = definitionModal?.insertion;
    if (definitionModal?.definition) {
      const current = draftRef.current;
      if (current && JSON.stringify(current) !== savedRef.current) {
        const saved = await saveDraft();
        if (!saved || draftRef.current?.id !== current.id || JSON.stringify(draftRef.current) !== savedRef.current) throw new Error('Der offene Testfall konnte vor der Definitionsprüfung nicht eindeutig gespeichert werden. Prüfe seine Änderungen und versuche es erneut.');
      }
      const preview = await testingPost<TestingDefinitionChangePreview>('/definitions/change-preview', { definition, newKnowledge });
      setDefinitionChange({ definition, newKnowledge, preview, busy: false });
      return;
    }
    await testingPost('/definitions', { definition, newKnowledge });
    // A successful definition save is sufficient to insert it. A later
    // bootstrap failure must not leave a silently detached library entry.
    const base = dataRef.current;
    if (!base) throw new Error('Der Katalog ist nicht verfügbar.');
    const next = { ...base, catalog: { ...base.catalog, knowledge: [...base.catalog.knowledge, ...newKnowledge], definitions: [...base.catalog.definitions.filter(item => testingVersionKey(item) !== testingVersionKey(definition)), definition] } };
    dataRef.current = next; setData(next);
    void refresh().catch(cause => setError(`Der Block wurde gespeichert, aber der Katalog konnte nicht neu geladen werden: ${messageOf(cause)}`));
    if (insertion) { addDefinition(definition, insertion, next.catalog); return; }
    setNotice(`„${definition.name}“ wurde als gemeinsame aktuelle Definition aktualisiert. Die Änderung gilt für alle bearbeitbaren Testfälle.`);
  }
  async function chooseDefinitionDefault(key: string, decision: TestingDefaultDecision) {
    const pending = definitionChange;
    if (!pending || pending.busy) return;
    setDefinitionChange({ ...pending, busy: true, error: undefined });
    try {
      const defaultDecisions = { ...pending.preview.defaultDecisions, [key]: decision };
      const preview = await testingPost<TestingDefinitionChangePreview>('/definitions/change-preview', { definition: pending.definition, newKnowledge: pending.newKnowledge, defaultDecisions, valueResolutions: pending.preview.valueResolutions });
      setDefinitionChange({ ...pending, preview, busy: false });
    } catch (cause) { setDefinitionChange({ ...pending, busy: false, error: messageOf(cause) }); }
  }
  async function chooseDefinitionResolution(key: string, resolution: NonNullable<TestingDefinitionChangeRequest['valueResolutions']>[string]) {
    const pending = definitionChange;
    if (!pending || pending.busy) return;
    setDefinitionChange({ ...pending, busy: true, error: undefined });
    try {
      const valueResolutions = { ...pending.preview.valueResolutions, [key]: resolution };
      const preview = await testingPost<TestingDefinitionChangePreview>('/definitions/change-preview', { definition: pending.definition, newKnowledge: pending.newKnowledge, defaultDecisions: pending.preview.defaultDecisions, valueResolutions });
      setDefinitionChange({ ...pending, preview, busy: false });
    } catch (cause) { setDefinitionChange({ ...pending, busy: false, error: messageOf(cause) }); }
  }
  async function refreshDefinitionChange() {
    const pending = definitionChange;
    if (!pending || pending.busy) return;
    setDefinitionChange({ ...pending, busy: true, error: undefined });
    const current = draftRef.current;
    if (current && JSON.stringify(current) !== savedRef.current) {
      const saved = await saveDraft();
      if (!saved || draftRef.current?.id !== current.id || JSON.stringify(draftRef.current) !== savedRef.current) { setDefinitionChange({ ...pending, busy: false, error: 'Der offene Testfall konnte nicht eindeutig gespeichert werden. Prüfe seine Änderungen und aktualisiere die Vorschau erneut.' }); return; }
    }
    try {
      const preview = await testingPost<TestingDefinitionChangePreview>('/definitions/change-preview', { definition: pending.definition, newKnowledge: pending.newKnowledge, defaultDecisions: pending.preview.defaultDecisions, valueResolutions: pending.preview.valueResolutions });
      setDefinitionChange({ ...pending, preview, busy: false });
    } catch (cause) { setDefinitionChange({ ...pending, busy: false, error: messageOf(cause) }); }
  }
  async function applyDefinitionChange() {
    const pending = definitionChange;
    if (!pending || pending.busy || pending.preview.blocked) return;
    const openDraft = draftRef.current;
    if (openDraft && JSON.stringify(openDraft) !== savedRef.current) {
      await refreshDefinitionChange();
      setDefinitionChange(current => current ? { ...current, error: 'Der offene Testfall wurde zuerst gespeichert und die Vorschau aktualisiert. Prüfe die Auswirkungen noch einmal und übernimm sie anschließend.' } : current);
      return;
    }
    setDefinitionChange({ ...pending, busy: true, error: undefined });
    let result: TestingDefinitionChangeApplyResult | undefined;
    try {
      result = await testingPost<TestingDefinitionChangeApplyResult>('/definitions/change-apply', { definition: pending.definition, newKnowledge: pending.newKnowledge, defaultDecisions: pending.preview.defaultDecisions, valueResolutions: pending.preview.valueResolutions, previewId: pending.preview.id });
    } catch (cause) { setDefinitionChange({ ...pending, busy: false, error: messageOf(cause) }); }
    if (!result) return;
    let next: Bootstrap;
    try { next = await refresh(); }
    catch (cause) {
      const base = dataRef.current!;
      next = { ...base, catalog: { ...base.catalog, definitions: [...base.catalog.definitions.filter(item => testingVersionKey(item) !== testingVersionKey(result.definition)), result.definition], knowledge: [...base.catalog.knowledge, ...result.preview.newKnowledge], ...(result.binding ? { bindings: [...base.catalog.bindings.filter(item => !(item.id === result.binding!.id && item.revision === result.binding!.revision)), result.binding] } : {}) }, scenarios: [...result.scenarios, ...base.scenarios.filter(item => !result.scenarios.some(saved => saved.id === item.id))] };
      dataRef.current = next; setData(next);
      setError(`Die Änderung wurde gespeichert, aber der Arbeitsbereich konnte nicht vollständig neu geladen werden: ${messageOf(cause)}`);
    }
    const current = draftRef.current;
    const updated = result.scenarios.find(item => item.id === current?.id) ?? next.scenarios.find(item => item.id === current?.id);
    if (current && updated && JSON.stringify(current) === savedRef.current) loadScenario(updated, next);
    setDefinitionChange(undefined);
    const affected = result.scenarios.length, changed = result.preview.changedCaseCount;
    setNotice(`„${result.definition.name}“ wurde aktualisiert. ${affected} ${affected === 1 ? 'betroffener Testfall wurde' : 'betroffene Testfälle wurden'} als neue Revision gespeichert; ${changed} Testausprägung${changed === 1 ? '' : 'en'} ${changed === 1 ? 'ändert' : 'ändern'} ihren fachlichen Wert.`);
  }
  const lastSaved = data?.scenarios.find(scenario => scenario.id === lastId);
  const resumeScenario = draft ?? (lastSaved ? storageDraft(lastSaved) : undefined);

  const lifecycle = data?.lifecycles?.find(item => item.scenarioId === draft?.id && item.scenarioRevision === draft?.revision);
  const persistedJob = data?.jobs.find(item => item.id === lifecycle?.currentJobId);
  const currentFingerprint = compiled?.fingerprint ?? lifecycle?.fingerprint;
  const matchingActiveJob = activeJob && activeJob.scenarioId === draft?.id && activeJob?.scenarioRevision === draft?.revision && (!activeJob?.fingerprint || activeJob.fingerprint === currentFingerprint) ? activeJob : undefined;
  const workspaceJob = persistedJob ? activeJob?.id === persistedJob.id ? activeJob : persistedJob : matchingActiveJob;
  const technicalWorkspaceJob = workspaceJob && !['business', 'exploration', 'naming'].includes(workspaceJob.phase) ? workspaceJob : data?.jobs.filter(item => item.scenarioId === draft?.id && item.scenarioRevision === draft?.revision && item.phase === 'technical' && !item.parentJobId && (!item.fingerprint || item.fingerprint === currentFingerprint)).sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  const historicalJob = activeJob && activeJob.scenarioId === draft?.id && !workspaceJob && !['queued', 'running'].includes(activeJob.status) ? activeJob : undefined;
  const workspaceRelatedJobs = data?.jobs.filter(item => lifecycle?.childJobIds.includes(item.id)) ?? [];
  const linkedRun = lifecycle?.runId ? activeRun?.id === lifecycle.runId ? activeRun : data?.runs.find(item => item.id === lifecycle.runId) : undefined;
  const workspaceRun = !dirty && linkedRun?.scenarioRevision === draft?.revision && compiled?.fingerprint === linkedRun?.compiled.fingerprint ? linkedRun : undefined;
  const visibleIssues = compiled?.issues.filter(item => !['APPROVAL_REQUIRED', 'APPROVAL_STALE'].includes(item.code)) ?? [];
  const technicalReview = !!(workspaceJob?.result as { needsBusinessReview?: boolean } | undefined)?.needsBusinessReview;
  const technicalQuestions = lifecycle?.nextAction === 'review' && lifecycle.phase === 'technical';
  const technicalRepairNeeded = technicalQuestions || technicalWorkspaceJob?.status === 'failed';
  const manualEditing = manualScenarioId === draft?.id || !!layout?.parkedStacks?.length || !!layout?.parkedBlocks?.length;
  const reviewNeeded = technicalReview || !!pendingOverride || !!savedOverrideJob || dirty || !!compiled?.issues.some(item => item.severity === 'error');
  const currentWorking = lifecycle?.status === 'running' || [workspaceJob, ...workspaceRelatedJobs].some(item => item && ['queued', 'running'].includes(item.status));
  const automaticPhase = workspaceRun?.status === 'passed' ? 4 : currentWorking ? lifecycle?.phase === 'exploration' || workspaceJob?.phase === 'business' || workspaceJob?.phase === 'exploration' ? 1 : 3 : reviewNeeded && !!draft?.blocks.length ? 2 : workspaceRun ? 4 : !draft?.blocks.length && !manualEditing ? 1 : isApproved ? 3 : 2;
  const availablePhases = [0, 1, ...(draft?.blocks.length || manualEditing ? [2] : []), ...(isApproved || workspaceJob && !['business', 'exploration', 'naming'].includes(workspaceJob.phase) || workspaceRun ? [3] : []), ...(workspaceRun ? [4] : [])];
  const workspacePhase = phaseView.id === draft?.id && availablePhases.includes(phaseView.phase) ? phaseView.phase : automaticPhase;
  const displayedJob = workspacePhase === 1 ? (workspaceJob?.phase === 'business' && (currentWorking || (!(workspaceJob.result as { scope?: string; changes?: unknown } | undefined)?.scope && !Array.isArray((workspaceJob.result as { changes?: unknown } | undefined)?.changes))) ? workspaceJob : data?.jobs.filter(item => item.scenarioId === draft?.id && item.phase === 'business' && !(item.result as { scope?: string } | undefined)?.scope && !Array.isArray((item.result as { changes?: unknown } | undefined)?.changes)).sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0]) : technicalWorkspaceJob;
  const displayedRelatedJobs = data?.jobs.filter(item => item.parentJobId === displayedJob?.id || displayedJob?.childJobIds?.includes(item.id)) ?? [];
  const workspaceTitle = workspacePhase === 0 ? 'Deine Anforderung' : workspacePhase === 1 ? currentWorking && displayedJob?.id === workspaceJob?.id ? 'Wir bereiten deinen Test vor' : draft?.blocks.length ? 'Erkundung und Entwurf ansehen' : 'Den Entwurf fortsetzen' : workspacePhase === 2 ? technicalReview ? 'Über vorgeschlagene Bausteine entscheiden' : pendingOverride || savedOverrideJob ? 'Änderungsvorschlag prüfen' : 'Passt dieser Ablauf zu deiner Anforderung?' : workspacePhase === 3 ? technicalRepairNeeded ? 'Technische Fragen klären' : currentWorking ? 'Die Anwendung wird vorbereitet und geprüft' : 'Bereit für die technische Prüfung' : workspaceRun?.status === 'passed' ? 'Dein Test ist bestanden' : 'Das Prüfergebnis ansehen';
  const workspaceDescription = workspacePhase === 0 ? 'Diese Anforderung ist die Grundlage deines Testfalls.' : lifecycle?.analysisAttention && workspaceRun?.status === 'passed' ? 'Der Test ist bestanden. Die optionale Wiederverwendungsanalyse braucht Aufmerksamkeit; ihre Details stehen beim Ergebnis.' : technicalReview || technicalRepairNeeded ? lifecycle?.message ?? '' : lifecycle?.analysisRunning && workspaceRun?.status === 'passed' ? 'Der Test ist bestanden. Die optionale Wiederverwendungsanalyse läuft noch.' : currentWorking ? 'Der aktuelle Arbeitsschritt und seine Zwischenergebnisse erscheinen hier.' : workspacePhase === 1 ? draft?.blocks.length ? 'Die bisherigen Erkenntnisse bleiben hier nachvollziehbar. Der Ablauf bleibt unverändert.' : 'Die Anforderung ist gespeichert. Du kannst die Erkundung und Planung erneut starten.' : workspacePhase === 2 ? dirty ? 'Speichere deine Änderungen und prüfe den Ablauf, bevor du ihn freigibst.' : 'Prüfe die Schritte und Werte. Mit der Freigabe startet die technische Prüfung im gewählten lokalen Modell.' : workspacePhase === 3 ? 'Die freigegebene Revision wird im Portal ausgeführt. Ergebnisse bleiben nachvollziehbar.' : 'Die Nachweise gehören genau zu dieser Revision deines Testfalls.';
  const modelControl = (label: string) => <ModelSelect value={model} onChange={setModel} disabled={actionLocked} label={label}/>;
  const approvalAction = <div className="t-approval-action"><ValidationCounters issues={visibleIssues} onOpen={() => setValidationOpen(true)}/>{modelControl('Lokales Modell für die technische Prüfung')}<button className="t-button primary" disabled={!!busy || !draft?.blocks.length || !!pendingOverride || currentWorking} onClick={() => compiled?.issues.some(issue => issue.severity === 'error') ? setValidationOpen(true) : void approve()}><CheckCheck size={16}/>{dirty ? 'Speichern, freigeben und technisch prüfen' : 'Freigeben und technisch prüfen'}</button></div>;
  const workspaceAction = workspacePhase === 0 ? <button className="t-button" onClick={() => selectPhase(1)}>Erkundung ansehen <ArrowRight size={15}/></button> : workspacePhase === 1 ? draft?.blocks.length && !currentWorking ? <button className="t-button primary" onClick={() => selectPhase(2)}>Fachlichen Ablauf prüfen <ArrowRight size={15}/></button> : currentWorking ? undefined : <div className="t-local-ai-action">{modelControl('Modell für den Entwurf')}<button className="t-button primary" disabled={!!busy} onClick={() => void planScenario()}>Erkundung und Entwurf fortsetzen</button></div> : workspacePhase === 2 ? technicalReview ? <DetailsButton label="Vorschläge ansehen" title="Vorgeschlagene Bausteine">{workspaceJob && data && <DuplicateReview job={workspaceJob} catalog={data.catalog} onResolved={async scenario => { const next = await refresh(); loadScenario(scenario, next); }}/>}</DetailsButton> : savedOverrideJob && !pendingOverride ? <button className="t-button primary" onClick={() => reviewOverride(savedOverrideJob)}>Änderungsvorschlag prüfen</button> : approvalAction : currentWorking ? undefined : technicalRepairNeeded ? <button className="t-button" onClick={() => selectPhase(2)}>Manuell im Ablauf bearbeiten</button> : <div className="t-local-ai-action">{lifecycle?.nextAction !== 'run' && modelControl('Modell für technische Vorbereitung')}<button className="t-button primary" disabled={actionLocked} onClick={lifecycle?.nextAction === 'run' ? run : technical}><Play size={16}/>{workspacePhase === 4 ? 'Erneut prüfen' : lifecycle?.nextAction === 'run' ? 'Mit vorhandener Technik ausführen' : 'Technik & Probelauf'}</button>{lifecycle?.nextAction === 'run' && <DetailsButton label="Technik neu vorbereiten"><p>Du kannst die vorhandene technische Umsetzung mit der KI erneut prüfen und vorbereiten lassen.</p><div className="t-local-ai-action">{modelControl('Modell für technische Vorbereitung')}<button className="t-button primary" disabled={actionLocked} onClick={technical}>Technik & Probelauf</button></div></DetailsButton>}</div>;
  const pendingOverridePanel = pendingOverride && <InlineReview title={pendingOverride.scope === 'scenario' ? 'Ablaufänderung prüfen' : 'Vorgeschlagene Ausnahme prüfen'} subtitle="Der gespeicherte Testfall bleibt bis zur Übernahme unverändert." onClose={() => setPendingOverride(undefined)} wide><p>{pendingOverride.draft?.explanation ?? 'Die KI hat die Anforderung auf die Werte dieses Bausteins abgebildet.'}</p>{pendingOverrideIssue && <Notice>{pendingOverrideIssue}</Notice>}{overrideError && <Notice tone="error">{overrideError}</Notice>}{pendingOverride.scope === 'scenario' && pendingOverride.before ? <ScenarioRevisionDiff previous={pendingOverride.before} next={pendingOverride.scenario} catalog={{ ...data!.catalog, definitions: [...data!.catalog.definitions, ...pendingOverride.draft?.newDefinitions ?? []] }} /> : <OverrideDiff previous={draft?.blocks ?? []} next={pendingOverride.scenario.blocks} catalog={data!.catalog} />}{pendingOverride.scope === 'scenario' && <><section aria-label="Neue fachliche Definitionen">{pendingOverride.draft?.newDefinitions.map(definition => <article key={testingVersionKey(definition)}><h3>Neue Definition: {definition.name}</h3><p>{definition.description}</p><p>Fachwissen: {definition.knowledgeRefs.map(id => pendingOverride.draft?.newKnowledge.find(item => item.id === id)?.title ?? data!.catalog.knowledge.find(item => item.id === id)?.title ?? id).join(', ')}</p></article>)}</section><section aria-label="Neues Fachwissen">{pendingOverride.draft?.newKnowledge.map(document => <article key={document.id}><h3>Neues Fachwissen: {document.title}</h3><p>{document.summary}</p><p style={{ whiteSpace: 'pre-wrap' }}>{document.content}</p></article>)}</section>{!!pendingOverride.draft?.assumptions.length && <section><h3>Annahmen</h3><ul>{pendingOverride.draft.assumptions.map((assumption, index) => <li key={index}>{assumption}</li>)}</ul></section>}{!!pendingOverride.draft?.openQuestions.length && <Notice>{pendingOverride.draft.openQuestions.join(' ')}</Notice>}</>}<JsonView value={pendingOverride.scope === 'scenario' ? { scenario: pendingOverride.scenario, newDefinitions: pendingOverride.draft?.newDefinitions ?? [], newKnowledge: pendingOverride.draft?.newKnowledge ?? [], assumptions: pendingOverride.draft?.assumptions ?? [], openQuestions: pendingOverride.draft?.openQuestions ?? [] } : pendingOverride.changes ?? pendingOverride.scenario} label="Vollständigen Änderungsvorschlag anzeigen" /><div className="t-dialog-actions"><button className="t-button" disabled={!!busy} onClick={() => void dismissOverride()}>Verwerfen</button><button className="t-button primary" disabled={!!pendingOverrideIssue || !!busy} onClick={() => void applyOverride()}>{busy === 'apply-override' ? <Spinner label="Fachstand wird geprüft" /> : pendingOverride.scope === 'scenario' ? 'Ablaufänderung übernehmen und speichern' : 'Änderungen in Entwurf übernehmen'}</button></div></InlineReview>;


  return <AgentSettingsContext.Provider value={settings}><div className={`testing-app ${mobileNav ? 'nav-open' : ''}`}><a className="t-skip" href="#testing-main">Zum Inhalt</a><WorkspaceNavigation view={view} open={mobileNav} onToggle={() => setMobileNav(!mobileNav)} onNavigate={navigate} scenarioId={resumeScenario?.id} onResume={() => resumeScenario && openScenario(resumeScenario.id)} /><main id="testing-main">{error && <div className="t-global-notice"><Notice tone="error" onClose={() => setError('')}>{error}</Notice></div>}{notice && <div className="t-global-notice"><Notice tone="success" onClose={() => setNotice('')}>{notice}</Notice></div>}{!data ? <div className="t-loading-page">{error ? <button className="t-button" onClick={() => { setError(''); refresh().catch(cause => setError(messageOf(cause))); }}>Erneut verbinden</button> : <Spinner label="Teststudio wird geöffnet" />}</div> : <>
    {view === 'scenarios' && <ScenarioOverview lifecycles={data.lifecycles} scenarios={data.scenarios} runs={data.runs} jobs={data.jobs} localDraft={scenario => draft?.id === scenario.id ? draft : drafts.current.get(scenario.id) ?? storageDraft(scenario)} onOpen={openScenario} onCreate={() => navigate('start')} onJob={job => { if (job.scenarioId) openScenario(job.scenarioId); setActiveJob(job); }} />}
    {view === 'start' && <RequestStep value={request} onChange={setRequest} model={model} onModel={setModel} busy={busy === 'business'} onSubmit={beginBusiness} examples={examples} />}
    {view === 'editor' && (!draft ? <Empty title="Testfall wird geöffnet"/> : <div className="t-editor-page t-linear-workspace">
      <header className="t-editor-header"><div className="t-editor-title"><input aria-label="Name des Testfalls" value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })}/><span>{dirty ? 'Ungespeicherte Änderungen' : 'Gespeichert'}</span></div><div className="t-editor-actions">{dirty && <button className="t-button small" disabled={!!busy} onClick={() => { const saved = data.scenarios.find(item => item.id === draft.id); if (saved) { draftRef.current = saved; setDraft(saved); setSavedJson(JSON.stringify(saved)); } }}>Verwerfen</button>}<button className="t-button small" disabled={!!busy || !dirty} onClick={() => void saveDraft()}><Save size={14}/>Speichern</button></div></header>
      <WorkspaceFrame phase={workspacePhase} available={availablePhases} onSelect={selectPhase} title={workspaceTitle} description={workspaceDescription} action={workspaceAction}>
        {workspacePhase === 0 && <WorkspaceContext scenario={draft}/>}
        {displayedJob && (workspacePhase === 1 || workspacePhase === 3) && <section className="t-workspace-job"><InlineAgentActivity catalog={data.catalog} knowledge={data.catalog.knowledge} job={displayedJob} related={displayedRelatedJobs} onCancel={jobRunning && displayedJob.id === workspaceJob?.id ? () => void action('cancel', async () => { const next = await testingPost<TestingAgentJob>(`/jobs/${encodeURIComponent(displayedJob.id)}/cancel`, {}); setActiveJob(next); await refresh(); }) : undefined}>{!jobRunning && displayedJob.result !== undefined && <><AgentOutcome result={displayedJob.result} catalog={data.catalog}/><DuplicateReview job={displayedJob} catalog={data.catalog} onResolved={async scenario => { const next = await refresh(); loadScenario(scenario, next); navigate('editor', scenario.id); }}/></>}</InlineAgentActivity></section>}
        {workspacePhase === 3 && technicalRepairNeeded && draft && <section className="t-workspace-edit t-technical-repair" aria-label="Technische Grenze mit KI überarbeiten"><ScenarioInstruction scenarioId={`${draft.id}:technical-repair`} dirty={dirty} busy={actionLocked} onSubmit={repairTechnicalResult} controls={modelControl('Lokales Modell für die fachliche Überarbeitung')} title="Mit KI überarbeiten" description="Beschreibe, wie der fachliche Ablauf auf die gemeldete technische Grenze reagieren soll. Die KI erstellt einen Vorschlag. Du entscheidest danach selbst über die Übernahme und Freigabe." submitLabel="Mit KI überarbeiten" /></section>}
        {workspacePhase === 2 && workspaceJob?.status === 'failed' && <DetailsButton label="Früheren Auftrag ansehen"><AgentFailure job={workspaceJob}/><JsonView value={workspaceJob} label="Technische Auftragsdetails anzeigen"/></DetailsButton>}
        {historicalJob && (workspacePhase === 1 || workspacePhase === 2) && <DetailsButton label="Früheren Auftrag ansehen"><p>Dieser Auftrag gehört zu einem früheren Fachstand.</p><AgentFailure job={historicalJob}/><JsonView value={historicalJob} label="Historische Auftragsdetails anzeigen"/></DetailsButton>}
        {workspacePhase === 1 && <ExplorationSummary jobs={displayedRelatedJobs} knowledge={data.catalog.knowledge}/>}{workspacePhase === 2 && pendingOverridePanel}
        {workspacePhase === 1 && !draft.blocks.length && !currentWorking && !manualEditing && <><button className="t-button small" onClick={() => { setManualScenarioId(draft.id); setPhaseView({ id: draft.id, phase: 2 }); }}>Ablauf selbst erstellen</button><div className="t-field t-request-clarification"><label htmlFor="request-clarification">Anforderung ergänzen</label><textarea id="request-clarification" rows={4} value={draft.intent} onChange={event => setDraft({ ...draft, intent: event.target.value })}/></div></>}
        {workspacePhase === 2 && (draft.blocks.length > 0 || manualEditing) && <section className="t-editor-step" aria-label="Fachlichen Ablauf prüfen und bearbeiten">
          <div className={`t-workbench ${fullscreen ? 'is-fullscreen' : ''}`}><section className="t-canvas-panel"><div className="t-canvas-toolbar"><div className="t-tabs compact"><button className={!outline ? 'active' : ''} onClick={() => setOutline(false)}><Layers3 size={14} />Scratch-Blöcke</button><button className={outline ? 'active' : ''} onClick={() => setOutline(true)}><List size={14} />Ablaufliste</button></div><BlockInsertion key={draft.id} scenarioId={draft.id} entry={entry} catalog={data.catalog} onAdd={addDefinition} onDefine={insertion => setDefinitionModal({ insertion })} /><div className="t-canvas-tools"><button className="t-icon" aria-label={fullscreen ? 'Vollbild beenden' : 'Arbeitsfläche vergrößern'} onClick={() => setFullscreen(!fullscreen)}>{fullscreen ? <X size={15}/> : <Maximize2 size={15}/>}</button><button className="t-icon" aria-label="Rückgängig" onClick={() => scratch.current?.undo()}><Undo2 size={15} /></button><button className="t-icon" aria-label="Wiederholen" onClick={() => scratch.current?.redo()}><Redo2 size={15} /></button><span /><button className="t-icon" aria-label="Verkleinern" onClick={() => scratch.current?.zoom(-1)}><Minus size={15} /></button><button className="t-icon" aria-label="Vergrößern" onClick={() => scratch.current?.zoom(1)}><Plus size={15} /></button><button className="t-icon" aria-label="Alle Blöcke ins Bild setzen" onClick={() => scratch.current?.center()}><Maximize2 size={15} /></button></div></div><div className={`t-canvas ${outline ? 'outline-active' : ''}`}><Suspense fallback={<div className="t-scratch-loading"><Spinner label="Scratch-Arbeitsfläche wird geladen" /></div>}><ScratchWorkspace key={draft.id} ref={scratch} blocks={draft.blocks} catalog={data.catalog} parameters={draft.parameters} layout={layout} selected={selected} onChange={editBlocks} onSelect={setSelected} onLayout={patch => setLayout(current => current ? { ...current, ...patch } : current)} /></Suspense>{outline && <div className="t-outline" aria-label="Tastaturbedienbare Ablaufliste">{entries.map(item => <button key={item.path} data-block-path={item.path} className={selected === item.path ? 'active' : ''} style={{ paddingLeft: `${16 + item.depth * 20}px` }} onClick={() => setSelected(item.path)}><span>{entryStep(item, entries)}</span><i className={`t-block-dot ${item.definition?.kind}`} /><strong>{item.block.label || item.definition?.name || item.block.definition.id}</strong></button>)}</div>}</div><footer className="t-canvas-footer"><span><i />Nur die verbundene Startkette wird ausgeführt</span><span>{entries.length} sichtbare Schritte</span></footer>{!!layout?.parkedBlocks?.length && <div className="t-parked-warning">{layout.parkedBlocks.length} lose Blöcke sind noch nicht im Ablauf. Verbinde sie mit dem Startblock, um sie auszuführen.</div>}</section><Inspector aiModelControl={modelControl('Modell für die Blockänderung')} key={`${entry?.block.definition.version ?? ''}:${selected ?? 'none'}:${issueFocus && issueFocus.path === selected ? issueFocus.token : ''}`} entry={entry} entries={inspectorEntries} catalog={data.catalog} onChange={updateSelected} onValue={updateValue} onDefinition={definition => setDefinitionModal({ definition })} onKnowledge={setKnowledgeModal} onClose={() => setSelected(undefined)} onOverride={text => parkedIndex >= 0 ? (setNotice('Verbinde den Block mit dem Ablauf, bevor du eine KI-Ausnahme beschreibst.'), Promise.resolve()) : override(text)} busy={actionLocked} onMove={moveSelected} onDuplicate={duplicateSelected} scenarioParameters={parkedIndex >= 0 ? {} : draft.parameters} onReferenceSource={selectReferenceSource} onShowChanges={paths => scratch.current?.showChanges(paths)} /></div>
          <TestMatrix scenario={draft} catalog={data.catalog} disabled={actionLocked} onChange={matrix => setDraft({ ...draft, matrix })}/>
          <section className="t-workspace-edit" aria-label="Ablauf mit KI ändern"><ScenarioInstruction key={draft.id} scenarioId={draft.id} dirty={dirty} busy={actionLocked} onSubmit={reviseScenario} controls={modelControl('Modell für die Änderung')}/>{savedOverrideJob && <button className="t-button" onClick={() => reviewOverride(savedOverrideJob)}>Gespeicherten Änderungsvorschlag prüfen</button>}</section>
        </section>}
        {workspacePhase === 4 && workspaceRun && <WorkspaceRunResult run={workspaceRun}>{workspaceRun.status === 'passed' && <ReuseReview run={workspaceRun} jobs={data.jobs} onRefresh={async () => { await refresh(); }}/>}</WorkspaceRunResult>}
      </WorkspaceFrame>
    </div>)}
    {view === 'library' && <Library initialId={libraryId} catalog={data.catalog} onEdit={definition => setDefinitionModal({ definition })} onAdd={addDefinition} onKnowledge={setKnowledgeModal} onImpact={id => { setBindingId(id); navigate('graph'); }} />}
    {view === 'knowledge' && <Knowledge catalog={data.catalog} selectedId={knowledgeId} onSelect={setKnowledgeId} onDefinition={id => { setLibraryId(id); navigate('library'); }} />}
    {view === 'graph' && <Graph key={bindingId ?? 'graph'} catalog={data.catalog} initialBinding={bindingId} onScenario={id => void openScenario(id)} />}
    {view === 'runs' && <RunsPage runs={data.runs} jobs={data.jobs} activeRun={activeRun} onScenario={id => void openScenario(id)} onRefresh={async () => { const next = await refresh(); setActiveRun(current => next.runs.find(run => run.id === current?.id)); }} onImpact={id => { setBindingId(id); navigate('graph'); }} />}
    {view === 'settings' && <AgentSettings onSaved={value => { setAgentSettings(value); setModel(value.defaultModel); }} />}
    {view === 'method' && <Method onStart={startWith} />}
  </>}</main>{validationOpen && <ValidationDialog issues={visibleIssues} entries={entries} onClose={() => setValidationOpen(false)} onShow={issue => { setValidationOpen(false); selectPhase(2); requestAnimationFrame(() => showIssue(issue)); }}/>} {definitionModal && data && <DefinitionDialog saveLabel={definitionModal.insertion ? definitionModal.insertion.placement === 'canvas' ? 'Definieren und auf Arbeitsfläche platzieren' : 'Definieren und zum Ablauf hinzufügen' : undefined} insertionHint={definitionModal.insertion ? definitionModal.insertion.placement === 'canvas' ? 'Der neue Block wird frei auf der Arbeitsfläche platziert. Verbinde ihn anschließend mit deinem Ablauf.' : definitionModal.insertion.parentPath ? 'Der neue Block wird am Ende des ausgewählten zusammengesetzten Blocks eingefügt.' : 'Der neue Block wird am Ende des Ablaufs eingefügt.' : undefined} definition={definitionModal.definition} catalog={data.catalog} onSave={saveDefinition} onClose={() => setDefinitionModal(undefined)} />}{definitionChange && data && <DefinitionChangeReview preview={definitionChange.preview} catalog={data.catalog} scenarios={data.scenarios} busy={definitionChange.busy} error={definitionChange.error} onDecision={chooseDefinitionDefault} onResolution={chooseDefinitionResolution} onRefresh={refreshDefinitionChange} onApply={applyDefinitionChange} onClose={() => { if (!definitionChange.busy) setDefinitionChange(undefined); }}/>} {knowledgeModal && data && <Modal title="Verknüpftes Fachwissen" onClose={() => setKnowledgeModal(undefined)} wide>{data.catalog.knowledge.find(doc => doc.id === knowledgeModal) ? <KnowledgeArticle doc={data.catalog.knowledge.find(doc => doc.id === knowledgeModal)!} catalog={data.catalog} onDefinition={id => { setKnowledgeModal(undefined); setLibraryId(id); navigate('library'); }} onKnowledge={setKnowledgeModal} /> : <Empty title="Wissensdokument nicht gefunden" />}</Modal>}</div></AgentSettingsContext.Provider>;
}


function RunsPage({ runs, jobs, activeRun, onScenario, onRefresh, onImpact }: { runs: TestingRun[]; jobs: TestingAgentJob[]; activeRun?: TestingRun; onScenario: (id: string) => void; onRefresh: () => Promise<void>; onImpact: (id: string) => void }) { const [selectedId, setSelectedId] = useState(activeRun?.id ?? runs[0]?.id); const allRuns = activeRun ? [activeRun, ...runs.filter(run => run.id !== activeRun.id)] : runs; const selected = allRuns.find(run => run.id === selectedId) ?? allRuns[0]; return <div className="t-page t-runs-page"><header className="t-page-heading"><div><span className="t-eyebrow">TECHNISCHES TESTFRAMEWORK</span><h1>Ausführungen und Nachweise</h1><p>Beobachtete Ergebnisse aus dem echten Browser mit den ausgeführten Block- und Bindungsversionen.</p></div></header>{!allRuns.length ? <Empty title="Noch kein Test ausgeführt">Prüfe einen fachlichen Entwurf und starte danach die technische Umsetzung.</Empty> : <div className="t-runs-layout"><aside>{allRuns.map(run => <button key={run.id} className={selected?.id === run.id ? 'active' : ''} onClick={() => setSelectedId(run.id)}><i className={`t-result-dot ${run.status}`} /><span><strong>{run.scenarioTitle}</strong><small>{statusLabels[run.status]} · Revision {run.scenarioRevision} · {formatDate(run.startedAt)}</small></span></button>)}</aside><section>{selected && <><div className="t-run-heading"><div><span className={`t-status ${selected.status}`}>{statusLabels[selected.status]}</span><h2>{selected.scenarioTitle}</h2><p>Revision {selected.scenarioRevision} · {formatDate(selected.startedAt)}</p></div><button className="t-button small" onClick={() => onScenario(selected.scenarioId)}>Testfall öffnen <ArrowRight size={14} /></button></div>{selected.error && <Notice tone="error">{selected.error}</Notice>}<div className="t-run-steps">{selected.steps.map((step, index) => <details key={step.id}><summary><span className={`t-step-status ${step.status}`}>{step.status === 'passed' ? <Check size={14} /> : index + 1}</span><strong>{step.label}</strong><small>{step.durationMs === undefined ? statusLabels[step.status] : `${(step.durationMs / 1000).toLocaleString('de-DE')} s`}</small><ChevronDown size={14} /></summary><div><p>{step.path}</p>{step.error && <Notice tone="error">{step.error}</Notice>}{step.screenshot && <a className="t-evidence-image" href={step.screenshot} target="_blank" rel="noreferrer"><img src={step.screenshot} alt={`Browsernachweis für ${step.label}`} /></a>}<JsonView value={step} label="Schrittnachweis anzeigen" />{selected.compiled.steps.find(item => item.id === step.id)?.binding && <button className="t-button small" onClick={() => onImpact(selected.compiled.steps.find(item => item.id === step.id)!.binding!.id)}><GitBranch size={14} />Bindung und betroffene Tests anzeigen</button>}</div></details>)}</div><div className="t-run-artifacts">{selected.artifacts?.trace && <a className="t-button small" href={selected.artifacts.trace} download>Playwright-Trace</a>}{selected.artifacts?.source && <a className="t-button small" href={selected.artifacts.source} target="_blank" rel="noreferrer">Ausgeführter Testcode</a>}{selected.artifacts?.manifest && <a className="t-button small" href={selected.artifacts.manifest} target="_blank" rel="noreferrer">Laufmanifest</a>}</div><JsonView value={selected.compiled} label="Unveränderliche Ausführungsmomentaufnahme anzeigen" /><ReuseReview run={selected} jobs={jobs} onRefresh={onRefresh} /></>}</section></div>}</div>; }
function OverrideDiff({ previous, next, catalog }: { previous: TestingBlockInstance[]; next: TestingBlockInstance[]; catalog: TestingCatalog }) { const before = flattenBlocks(previous, catalog); const after = flattenBlocks(next, catalog); const rows = after.flatMap(entry => { const old = before.find(item => item.path === entry.path); const oldValues = old ? resolvedBlockInputs(old) : {}; const newValues = resolvedBlockInputs(entry); return Object.entries(newValues).filter(([key, value]) => JSON.stringify(oldValues[key]) !== JSON.stringify(value)).map(([key, value]) => ({ path: entry.path, name: entry.definition?.name ?? entry.block.definition.id, key, label: entry.definition?.inputs.find(input => input.key === key)?.label ?? key, before: oldValues[key], after: value })); }); return <div className="t-override-diff">{rows.length ? rows.map(row => <div key={`${row.path}:${row.key}`}><h4>{row.name} · {row.label}</h4><div><del>{JSON.stringify(row.before) ?? 'Nicht gesetzt'}</del><ArrowRight size={14} /><ins>{JSON.stringify(row.after)}</ins></div></div>) : <p>Die Änderung betrifft die Ablaufstruktur. Prüfe die vollständige Ausgabe unten.</p>}</div>; }

function ReuseReview({ run, jobs, onRefresh }: { run: TestingRun; jobs: TestingAgentJob[]; onRefresh: () => Promise<void> }) {
  const reuseSettings = useContext(AgentSettingsContext);
  const reuseModels = useAgentModels();
  const [requestedJob, setRequestedJob] = useState<{ runId: string; job: TestingAgentJob }>();
  const [model, setModel] = useState<TestingModel>(reuseSettings?.defaultModel ?? 'luna');
  useEffect(() => { if (reuseSettings?.defaultModel) setModel(reuseSettings.defaultModel); }, [reuseSettings?.defaultModel]);
  useEffect(() => { if (!reuseModels.some(item => item.id === model)) setModel(reuseModels[0]?.id ?? 'luna'); }, [reuseModels, model]);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const startingRef = useRef(false);
  const technicalJob = jobs.find(item => item.phase === 'technical' && (item.result as { run?: { id?: string } } | undefined)?.run?.id === run.id);
  const previousJobId = (technicalJob?.result as { reuseJobId?: string } | undefined)?.reuseJobId;
  const requested = requestedJob?.runId === run.id ? requestedJob.job : undefined;
  const job = (requested ? jobs.find(item => item.id === requested.id) ?? requested : undefined)
    ?? jobs.find(item => item.phase === 'reuse' && (item.result as { runId?: string } | undefined)?.runId === run.id)
    ?? jobs.find(item => item.id === previousJobId && item.phase === 'reuse');
  const running = job?.status === 'queued' || job?.status === 'running';
  const canRetry = !running && !run.reuseSuggestions?.length;
  async function retry() {
    if (startingRef.current || !canRetry) return;
    startingRef.current = true; setStarting(true); setError('');
    try {
      const next = await testingPost<TestingAgentJob>(`/runs/${encodeURIComponent(run.id)}/reuse`, { model });
      setRequestedJob({ runId: run.id, job: next });
      await onRefresh();
    } catch (cause) { setError(messageOf(cause)); }
    finally { startingRef.current = false; setStarting(false); }
  }
  if (run.status !== 'passed') return null;
  return <section className="t-reuse-review">
    <span className="t-eyebrow">AUS DIESEM TEST LERNEN</span><h2>Welche Teile sollen wiederverwendbar werden?</h2>
    <p>Die KI schlägt Bausteine aus dem erfolgreichen Ablauf vor. Prüfe Namen und veränderbare Eingaben, bevor du einen Vorschlag übernimmst.</p>
    {running ? <Spinner label="Der Wiederverwendungsagent untersucht den erfolgreichen Ablauf" /> : job?.status === 'failed' ? <Notice tone="error">Die Wiederverwendungsanalyse ist fehlgeschlagen. Der erfolgreiche Testlauf bleibt erhalten.</Notice> : job?.status === 'cancelled' ? <Notice>Die Wiederverwendungsanalyse wurde abgebrochen. Du kannst sie erneut starten.</Notice> : null}
    {job?.error && <JsonView value={job.error} label="Fehlerdetails der Wiederverwendungsanalyse anzeigen" />}
    {error && <Notice tone="error">{error}</Notice>}
    {!!run.reuseSuggestions?.length ? run.reuseSuggestions.map(suggestion => <ReuseCard key={suggestion.id} suggestion={suggestion} jobId={job?.id} onRefresh={onRefresh} />) : !running && !job?.error ? <p className="t-caption">Für diesen Lauf liegt noch kein Vorschlag zur Übernahme vor.</p> : null}
    {canRetry && <div className="t-dialog-actions">
      <ModelSelect label="Modell für Wiederverwendung" value={model} disabled={starting} onChange={setModel} />
      <button className="t-button primary small" style={{ alignSelf: 'end' }} disabled={starting} onClick={() => void retry()}>{starting ? <Spinner label="Wird gestartet" /> : <><Sparkles size={14} />Wiederverwendung prüfen</>}</button>
    </div>}
  </section>;
}
function ReuseCard({ suggestion, jobId, onRefresh }: { suggestion: TestingReuseSuggestion; jobId?: string; onRefresh: () => Promise<void> }) {
  const [name, setName] = useState(suggestion.name);
  const [parameters, setParameters] = useState(suggestion.parameters);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const decided = suggestion.status !== 'suggested';
  async function decide(accept: boolean) { if (!jobId) { setError('Der zugehörige Agentenauftrag wurde nicht gefunden. Lade die Ausführungen erneut.'); return; } setBusy(true); setError(''); try { await testingPost(`/reuse/${encodeURIComponent(jobId)}/${accept ? 'accept' : 'dismiss'}`, { proposalIds: [suggestion.id], ...(accept ? { edits: [{ id: suggestion.id, name, parameters }] } : {}) }); await onRefresh(); } catch (cause) { setError(messageOf(cause)); } finally { setBusy(false); } }
  return <div className={`t-reuse-card ${decided ? 'decided' : ''}`}><div className="t-section-heading"><span className="t-kind workflow">Vorgeschlagener Baustein</span><span>{statusLabels[suggestion.status]}</span></div><div className="t-field"><label htmlFor={`reuse-name-${suggestion.id}`}>Name des wiederverwendbaren Blocks</label><input id={`reuse-name-${suggestion.id}`} value={name} onChange={event => setName(event.target.value)} disabled={decided || busy} /></div><p>{suggestion.reason}</p><div className="t-caption">Enthält {suggestion.instanceIds.length} Schritte aus diesem Testfall.</div>{suggestion.parameters.length > 0 && <fieldset className="t-reuse-parameters"><legend>Diese Werte sollen beim Verwenden änderbar sein</legend>{suggestion.parameters.map(parameter => <label key={parameter.key}><input type="checkbox" disabled={decided || busy} checked={parameters.some(item => item.key === parameter.key)} onChange={event => setParameters(current => event.target.checked ? [...current, parameter] : current.filter(item => item.key !== parameter.key))} /><span>{parameter.label}<small>{parameter.instanceId} · {parameter.input}</small></span></label>)}</fieldset>}{error && <Notice tone="error">{error}</Notice>}{suggestion.definitionRef && <div className="t-reference"><strong>Veröffentlicht in der Blockbibliothek</strong><code>{suggestion.definitionRef.id} · Version {suggestion.definitionRef.version}</code></div>}{!decided && <div className="t-dialog-actions"><button className="t-button small" disabled={busy} onClick={() => void decide(false)}>Vorschlag verwerfen</button><button className="t-button primary small" disabled={busy || !name.trim()} onClick={() => void decide(true)}>{busy ? <Spinner label="Wird gespeichert" /> : <><Plus size={14} />Als Baustein übernehmen</>}</button></div>}</div>;
}

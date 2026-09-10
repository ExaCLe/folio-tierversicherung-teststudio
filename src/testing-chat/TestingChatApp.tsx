import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ArrowLeft, Bot, Check, ChevronRight, CircleStop, ExternalLink, Info, LoaderCircle, MessageSquare, Play, Plus, RefreshCw, Save, Send, Sparkles, Workflow, X } from 'lucide-react';
import { currentTestingChildren, type TestingAgentSettings, type TestingBlockInstance, type TestingCatalog, type TestingScenario, type TestingScenarioLayout, type TestingValue } from '../../shared/testing';
import type { TestingChatCommand, TestingChatEntry, TestingChatQuestion, TestingChatSnapshot, TestingChatTask } from '../../shared/testing-chat';
import { AgentSettingsContext, ModelSelect } from '../testing/AgentModels';
import { Inspector } from '../testing/Inspector';
import { TestMatrix } from '../testing/TestMatrix';
import { flattenBlocks, newInstance, updateBlockAtPath } from '../testing/model';
import type { ScratchWorkspaceHandle } from '../testing/ScratchWorkspace';
import { chatApi, messageOf, subscribeConversation, subscribeObservations, type RunnerObservation } from './api';
import '../testing/testing.css';
import '../testing/canvas-workspace.css';
import './testing-chat.css';
import './testing-conversation.css';

const ScratchWorkspace = lazy(() => import('../testing/ScratchWorkspace').then(module => ({ default: module.ScratchWorkspace })));
type Tab = 'chat' | 'flow' | 'browser';
const tabLabels: Record<Tab, string> = { chat: 'Unterhaltung', flow: 'Ablauf', browser: 'Browser' };
const commandLabels: Partial<Record<TestingChatCommand, string>> = { explore: 'Erkunden & entwerfen', resume: 'Mit Antwort fortfahren', apply: 'Vorschlag übernehmen', reject: 'Vorschlag verwerfen', approve: 'Freigeben', prepare: 'Technisch vorbereiten', run: 'Test starten', cancel: 'Auftrag abbrechen' };
const route = () => {
  const parts = location.pathname.split('/').filter(Boolean);
  return { id: parts[2] ? decodeURIComponent(parts[2]) : '', tab: (parts[3] && parts[3] in tabLabels ? parts[3] : 'chat') as Tab };
};
const draftKey = (id: string) => `folio-testing-chat-draft:${id}`;
const layoutKey = (id: string) => `folio-testing-chat-layout:${id}`;

function readLocal<T>(key: string): T | undefined { try { const value = localStorage.getItem(key); return value ? JSON.parse(value) as T : undefined; } catch { return; } }
function navigate(id = '', tab: Tab = 'chat', replace = false) {
  const path = id ? `/testing/chat/${encodeURIComponent(id)}/${tab}` : '/testing/chat';
  history[replace ? 'replaceState' : 'pushState']({}, '', path);
  dispatchEvent(new PopStateEvent('popstate'));
}
function formatTime(value: string) { return new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' }).format(new Date(value)); }

type PublicChatEntry = TestingChatEntry;
type ChatSnapshot = TestingChatSnapshot;
type PublicTask = TestingChatTask;
type PublicQuestion = TestingChatQuestion;
type RichChatSnapshot = ChatSnapshot & { tasks?: PublicTask[]; questions?: PublicQuestion[] };
const deliveryLabels = { routing: 'Nachricht gespeichert', replanning: 'Neuplanung gestartet', applied: 'In Ergebnis übernommen', rejected: 'Nicht übernommen' } as const;
const stageLabels: Record<string, string> = { naming: 'Benennung', knowledge: 'Fachwissen', exploring: 'Erkundung', planning: 'Ablaufplanung', validating: 'Prüfung', revising: 'Überarbeitung', duplicates: 'Dublettensuche', wiring: 'Technische Vorbereitung', running: 'Testlauf', reuse: 'Wiederverwendung' };
const sourceKindLabels = { knowledge: 'Fachwissen', scenario: 'Testfall', definition: 'Baustein', 'portal-evidence': 'Browsernachweis' } as const;
type PublicDetail = { type: 'reasoning'|'message'|'validation'|'result'; label: string; data?: unknown };
const detailTypeLabels: Record<PublicDetail['type'], string> = { reasoning: 'Reasoning-Zusammenfassung', message: 'Agentenausgabe', validation: 'Automatisierte Prüfung', result: 'Ergebnis' };
function sourceHref(source: NonNullable<TestingChatEntry['sources']>[number]) {
  if (source.kind === 'knowledge') return `/testing/knowledge/${encodeURIComponent(source.ref)}`;
  if (source.kind === 'definition') return `/testing/library/${encodeURIComponent(source.ref)}`;
  if (source.kind === 'scenario') return `/testing/editor/${encodeURIComponent(source.ref)}`;
  if (source.kind === 'portal-evidence' && (/^\/api\/testing\/(?:jobs|runs)\/[^/]+\/(?:artifacts|rows)\//.test(source.ref) || /^\/api\/testing\/runs\/[^/]+\/artifacts\//.test(source.ref))) return source.ref;
}
function belongsInConversation(entry: PublicChatEntry) {
  if (entry.kind === 'status' || entry.kind === 'question') return false;
  if (!entry.detail || !entry.jobId || entry.id === `${entry.jobId}:completed`) return true;
  return entry.kind === 'error' || entry.kind === 'user_action';
}

function TimelineEntry({ entry, onDetails }: { entry: PublicChatEntry; onDetails: (entry: PublicChatEntry) => void }) {
  const own = entry.kind === 'user' || entry.kind === 'user_action';
  const action = entry.kind === 'user_action';
  const hasDetails = !!(entry.content || entry.context || entry.sources?.length || entry.delivery?.detail || (entry as PublicChatEntry & { detail?: PublicDetail }).detail);
  const author = own ? 'Du' : entry.context?.taskLabel ?? 'Folio';
  return <article className={`tc-entry ${own ? 'is-user' : ''} ${action ? 'is-user-action' : ''} is-${entry.kind}`} data-entry-id={entry.id}>
    <div className="tc-entry-icon">{action ? <Check size={15}/> : own ? <MessageSquare size={15}/> : entry.kind === 'question' ? <Sparkles size={15}/> : <Bot size={15}/>}</div>
    <div><header><strong>{author}</strong><time>{formatTime(entry.at)}</time></header>{entry.context?.taskLabel && <small className="tc-entry-task">{entry.context.taskLabel}</small>}<p>{entry.content?.summary ?? entry.message}</p>
      <footer className="tc-entry-meta">{hasDetails && <button onClick={() => onDetails(entry)}><Info size={13}/>Details</button>}</footer>
    </div>
  </article>;
}

const taskStatusLabels: Record<PublicTask['status'], string> = { not_started: 'Eingereiht', queued: 'Wartet', running: 'In Arbeit', completed: 'Abgeschlossen', failed: 'Fehlgeschlagen', blocked: 'Blockiert', cancelled: 'Abgebrochen' };
function taskStateLabel(task: PublicTask, awaitsAnswer = false) { return task.activityState === 'waiting' ? awaitsAnswer ? 'Wartet auf Antwort' : 'Wartet auf Unterauftrag' : task.activityState === 'attention' ? 'Eingabe nötig' : taskStatusLabels[task.status]; }
const detailKeyLabels: Record<string, string> = { summary: 'Zusammenfassung', valid: 'Gültig', errors: 'Fehler', correction: 'Korrektur', attempt: 'Versuch', facts: 'Fakten', title: 'Titel', explanation: 'Begründung', status: 'Status', changes: 'Änderungen', result: 'Resultat' };
function DetailValue({ value }: { value: unknown }) {
  if (value == null) return null;
  if (Array.isArray(value)) return <ol className="tc-detail-data">{value.map((item, index) => <li key={index}><DetailValue value={item}/></li>)}</ol>;
  if (typeof value === 'object') return <dl className="tc-detail-data">{Object.entries(value as Record<string, unknown>).map(([key, item]) => <div key={key}><dt>{detailKeyLabels[key] ?? key}</dt><dd><DetailValue value={item}/></dd></div>)}</dl>;
  if (typeof value === 'boolean') return <span>{value ? 'Ja' : 'Nein'}</span>;
  return <span>{String(value)}</span>;
}
function DetailData({ value }: { value: unknown }) {
  if (!value || Array.isArray(value) || typeof value !== 'object') return <DetailValue value={value}/>;
  const entries = Object.entries(value as Record<string, unknown>);
  const readable = entries.filter(([key]) => key in detailKeyLabels);
  const technical = entries.filter(([key]) => !(key in detailKeyLabels));
  return <>{!!readable.length && <dl className="tc-detail-data">{readable.map(([key, item]) => <div key={key}><dt>{detailKeyLabels[key]}</dt><dd><DetailValue value={item}/></dd></div>)}</dl>}{!!technical.length && <details className="tc-technical-data"><summary>Technische Originaldaten</summary><pre>{JSON.stringify(Object.fromEntries(technical), null, 2)}</pre></details>}</>;
}
function DetailReport({ detail, message }: { detail?: PublicDetail; message?: string }) {
  if (!detail) return null;
  const category = detailTypeLabels[detail.type];
  const synonymousReasoningLabel = detail.type === 'reasoning' && /^(?:begründungs|reasoning)[ -]?zusammenfassung$/i.test(detail.label);
  return <section className={`tc-detail-report is-${detail.type}`}><small>{category}</small>{detail.label !== category && !synonymousReasoningLabel && <h4>{detail.label}</h4>}{message && <p>{message}</p>}<DetailData value={detail.data}/></section>;
}
function TaskDetails({ task, onClose }: { task: PublicTask; onClose: () => void }) {
  return <div className="tc-modal-backdrop" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target) onClose(); }}><section className="tc-entry-dialog tc-task-dialog" role="dialog" aria-modal="true" aria-labelledby="tc-task-dialog-title"><header><div><small>AUFGABENDETAILS</small><h2 id="tc-task-dialog-title">{task.purpose}</h2></div><button aria-label="Aufgabendetails schließen" onClick={onClose}><X size={18}/></button></header><div className="tc-dialog-body">
    <dl><div><dt>Agent</dt><dd>{task.agent.name}</dd></div><div><dt>Status</dt><dd>{taskStatusLabels[task.status]}</dd></div>{task.stage && <div><dt>Arbeitsschritt</dt><dd>{stageLabels[task.stage] ?? task.stage}</dd></div>}</dl>
    {!task.publicDetails.some(item => item.detail?.type === 'reasoning') && <p className="tc-reasoning-empty">{task.status === 'running' ? 'Bisher liegt für diesen Auftrag keine Reasoning-Zusammenfassung vor.' : 'Für diesen Auftrag liegt keine Reasoning-Zusammenfassung vor.'}</p>}
    <h3>Öffentliche Meldungen</h3>{task.publicDetails.length ? <ol className="tc-task-events">{task.publicDetails.map(item => { const detail = item.detail as PublicDetail | undefined; return <li key={item.id} className={`is-${item.kind}`}><time>{formatTime(item.at)}</time><div>{detail ? <DetailReport detail={detail} message={item.message}/> : <p>{item.message}</p>}{!!item.sources?.length && <ul className="tc-event-sources">{item.sources.map(source => { const href = sourceHref(source); return <li key={`${source.kind}:${source.ref}`}>{href ? <a href={href} target="_blank" rel="noreferrer">{source.label}</a> : source.label}<small>{sourceKindLabels[source.kind]}</small></li>; })}</ul>}</div></li>; })}</ol> : <p className="tc-muted-copy">Noch keine öffentliche Meldung.</p>}
  </div></section></div>;
}

function TaskCard({ task, awaitsAnswer, dependency, onDetails }: { task: PublicTask; awaitsAnswer: boolean; dependency?: PublicTask; onDetails: (task: PublicTask) => void }) {
  const style = { '--agent-color': task.agent.color } as CSSProperties;
  const stateLabel = taskStateLabel(task, awaitsAnswer);
  const compact = !awaitsAnswer && ['waiting', 'not_started', 'blocked'].includes(task.activityState);
  if (compact) {
    const relation = task.activityState === 'blocked' ? 'Blockiert durch' : task.activityState === 'waiting' ? 'Wartet auf' : 'Eingereiht';
    return <article className="tc-queued-row" style={style} data-task-id={task.id} data-status={task.status} data-activity={task.activityState} aria-label={`${task.purpose}, ${stateLabel}`}>
      <span className="tc-queued-mark" aria-hidden="true"/>
      <button className="tc-queued-task" onClick={() => onDetails(task)}>{task.purpose}</button>
      <span className="tc-queued-relation">{dependency ? <><span>{relation}:</span><button onClick={() => onDetails(dependency)} aria-label={`${dependency.purpose}, vorausgesetzte Aufgabe öffnen`}>{dependency.purpose}</button></> : relation}</span>
    </article>;
  }
  return <button className="tc-task-card" style={style} data-task-id={task.id} data-status={task.status} data-activity={task.activityState} onClick={() => onDetails(task)} aria-label={`${task.purpose}, ${stateLabel}, Details öffnen`}>
    <span className="tc-task-state" aria-hidden="true">{task.status === 'completed' ? <Check size={14}/> : task.activityState === 'working' ? <LoaderCircle size={15}/> : task.status === 'failed' ? <X size={14}/> : <span/>}</span>
    <span className="tc-task-copy"><strong>{task.purpose}</strong><small><i/>{task.agent.name} · {stateLabel}</small></span><ChevronRight size={15}/>
  </button>;
}

function QuestionPanel({ conversationId, questions, tasks, busy, onSubmit }: { conversationId: string; questions: PublicQuestion[]; tasks: PublicTask[]; busy: boolean; onSubmit: (answers: { questionId: string; answer: string }[]) => Promise<boolean> }) {
  const open = questions.filter(question => question.status === 'open' && question.kind === 'clarification');
  const answerKey = `folio-testing-chat-answers:${conversationId}`;
  const [answers, setAnswers] = useState<Record<string, string>>(() => readLocal<Record<string, string>>(answerKey) ?? {});
  useEffect(() => setAnswers(current => Object.fromEntries(open.map(question => [question.id, current[question.id] ?? '']))), [open.map(question => question.id).join('|')]);
  useEffect(() => { if (open.length) localStorage.setItem(answerKey, JSON.stringify(answers)); }, [answerKey, answers, open.length]);
  if (!open.length) return null;
  const complete = open.every(question => answers[question.id]?.trim());
  const save = async (questionsToSave: PublicQuestion[]) => {
    const submitted = questionsToSave.map(question => ({ questionId: question.id, answer: answers[question.id].trim() }));
    if (!await onSubmit(submitted)) return;
    setAnswers(current => { const next = { ...current }; for (const item of submitted) delete next[item.questionId]; if (Object.keys(next).length) localStorage.setItem(answerKey, JSON.stringify(next)); else localStorage.removeItem(answerKey); return next; });
  };
  return <section className="tc-questions" aria-labelledby="tc-question-title"><header><div><small>DEINE ENTSCHEIDUNG</small><h2 id="tc-question-title">{open.length === 1 ? 'Eine Angabe fehlt' : `${open.length} Angaben fehlen`}</h2></div><span>{open.length} offen</span></header><p>Beantworte jede Frage einzeln. Danach setzen die zuständigen Agenten ihre Aufgaben fort.</p>
    <div className="tc-question-list">{open.map((question, index) => { const task = tasks.find(item => item.id === question.jobId || item.parentJobId === question.jobId); const style = { '--agent-color': task?.agent.color ?? '#3867a8' } as CSSProperties; return <div className="tc-question" key={question.id} style={style}><label><span><b>{index + 1}</b><strong>{question.text}</strong></span><small>{question.why}</small><textarea aria-label={`Antwort auf: ${question.text}`} rows={3} value={answers[question.id] ?? ''} onChange={event => setAnswers(current => ({ ...current, [question.id]: event.target.value }))} placeholder="Deine Antwort" disabled={busy}/><em><i/>{task?.agent.name ?? 'Folio'} · wartet auf deine Antwort</em></label><button disabled={busy || !answers[question.id]?.trim()} onClick={() => void save([question])}>Antwort speichern</button></div>; })}</div>
    {open.length > 1 && <footer><button className="tc-primary" disabled={busy || !complete} onClick={() => void save(open)}><Send size={15}/>Alle Antworten senden</button></footer>}
  </section>;
}

function EntryDetails({ entry, onClose }: { entry: PublicChatEntry; onClose: () => void }) {
  const detail = (entry as PublicChatEntry & { detail?: PublicDetail }).detail;
  return <div className="tc-modal-backdrop" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target) onClose(); }}><section className="tc-entry-dialog" role="dialog" aria-modal="true" aria-labelledby="tc-entry-dialog-title"><header><div><small>ÖFFENTLICHER AGENTENBERICHT</small><h2 id="tc-entry-dialog-title">{entry.content?.title ?? entry.context?.taskLabel ?? 'Eintragsdetails'}</h2></div><button aria-label="Details schließen" onClick={onClose}><X size={18}/></button></header><div className="tc-dialog-body">
    {entry.context && <dl><div><dt>Aufgabe</dt><dd>{entry.context.taskLabel}</dd></div><div><dt>Agent</dt><dd>{entry.context.modelLabel ?? entry.context.modelId}{entry.context.provider ? ` · ${entry.context.provider === 'codex' ? 'Codex' : 'Claude'}` : ''}</dd></div>{entry.context.stage && <div><dt>Arbeitsschritt</dt><dd>{stageLabels[entry.context.stage] ?? entry.context.stage}</dd></div>}</dl>}
    {detail ? <DetailReport detail={detail} message={entry.content?.summary ?? entry.message}/> : <p>{entry.content?.summary ?? entry.message}</p>}
    {!!entry.content?.facts?.length && <><h3>Ergebnisse und Annahmen</h3><ul>{entry.content.facts.map(fact => <li key={fact.label}><strong>{fact.label}:</strong> {fact.value}</li>)}</ul></>}
    {!!entry.sources?.length && <><h3>Verwendete Quellen</h3><ul className="tc-source-list">{entry.sources.map(source => { const href = sourceHref(source); return <li key={`${source.kind}:${source.ref}`}>{href ? <a href={href} target="_blank" rel="noreferrer"><strong>{source.label}</strong></a> : <strong>{source.label}</strong>}<span>{sourceKindLabels[source.kind]}</span></li>; })}</ul></>}
    {entry.delivery && <div className={`tc-delivery is-${entry.delivery.state}`}><strong>{deliveryLabels[entry.delivery.state]}</strong>{entry.delivery.detail && <p>{entry.delivery.detail}</p>}</div>}
  </div></section></div>;
}

function Conversation({ snapshot, model, busy, text, onText, onModel, onSend, onAnswers, onCommand, onReviewFlow }: {
  snapshot: RichChatSnapshot; model: string; busy: boolean; text: string;
  onText: (value: string) => void; onModel: (value: string) => void; onSend: () => void; onAnswers: (answers: { questionId: string; answer: string }[]) => Promise<boolean>; onCommand: (command: TestingChatCommand) => void; onReviewFlow: () => void;
}) {
  const end = useRef<HTMLDivElement>(null);
  const [detailId, setDetailId] = useState<string>();
  const [taskDetailId, setTaskDetailId] = useState<string>();
  const [showAlternativeComposer, setShowAlternativeComposer] = useState(false);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [snapshot.timeline.length]);
  const allowed = new Set(snapshot.allowedCommands);
  const tasks = snapshot.tasks ?? [];
  const details = snapshot.timeline.find(entry => entry.id === detailId);
  const taskDetails = tasks.find(task => task.id === taskDetailId);
  const questions = snapshot.questions ?? [];
  const hasOpenQuestions = questions.some(question => question.status === 'open' && question.kind === 'clarification');
  const sendCommand: TestingChatCommand = snapshot.scenario && allowed.has('revise') ? 'revise' : allowed.has('message') ? 'message' : allowed.has('explore') ? 'explore' : 'message';
  const nextActions = (['prepare'] as TestingChatCommand[]).filter(command => allowed.has(command));
  const placeholder = snapshot.scenario ? 'Weitere Änderung beschreiben …' : 'Nachricht an Folio …';
  const visibleTimeline = snapshot.timeline.filter(belongsInConversation);
  const questionJobIds = new Set(questions.filter(question => question.status === 'open').map(question => question.jobId));
  const queuedTasks = tasks.filter(task => !questionJobIds.has(task.id) && ['waiting', 'not_started', 'blocked'].includes(task.activityState));
  const timelineTasks = tasks.filter(task => !queuedTasks.includes(task));
  const feed = [...visibleTimeline.map(entry => ({ type: 'entry' as const, id: entry.id, at: entry.at, entry })), ...timelineTasks.map(task => ({ type: 'task' as const, id: task.id, at: task.executionAt ?? task.finishedAt ?? task.startedAt, task }))].sort((a, b) => a.at.localeCompare(b.at));
  return <section className="tc-chat-pane" aria-label="Unterhaltung">
    <div className="tc-timeline"><div className="tc-reading-column"><div className="tc-feed">{feed.map(item => item.type === 'entry' ? <TimelineEntry key={`entry:${item.id}`} entry={item.entry} onDetails={entry => setDetailId(entry.id)}/> : <TaskCard key={`task:${item.id}`} task={item.task} awaitsAnswer={questionJobIds.has(item.id)} dependency={tasks.find(task => task.id === item.task.waitingForJobId || task.id === item.task.blockedByJobId)} onDetails={task => setTaskDetailId(task.id)}/>)}</div>
      {!!queuedTasks.length && <section className="tc-queue" aria-labelledby="tc-queue-title"><header><strong id="tc-queue-title">Als Nächstes</strong><span>{queuedTasks.length}</span></header>{queuedTasks.map(task => <TaskCard key={`queue:${task.id}`} task={task} awaitsAnswer={false} dependency={tasks.find(item => item.id === task.waitingForJobId || item.id === task.blockedByJobId)} onDetails={item => setTaskDetailId(item.id)}/>)}</section>}
      <QuestionPanel conversationId={snapshot.conversation.id} questions={questions} tasks={tasks} busy={busy} onSubmit={onAnswers}/>
      {snapshot.proposed && <ProposalCard snapshot={snapshot} busy={busy} onCommand={onCommand}/>}<div ref={end}/>
    </div></div>
    {hasOpenQuestions && !showAlternativeComposer ? <footer className="tc-alternative-toggle"><button onClick={() => setShowAlternativeComposer(true)}><Plus size={14}/>Andere Änderung schreiben</button></footer> : <footer className="tc-composer">
      <div className="tc-composer-inner">
      {(allowed.has('approve') || !!nextActions.length) && <div className="tc-command-actions">{allowed.has('approve') && <button className="tc-review-flow" disabled={busy} onClick={onReviewFlow}><Workflow size={15}/>Ablauf prüfen</button>}{nextActions.map(command => <button key={command} className="tc-primary" disabled={busy} onClick={() => onCommand(command)}><Sparkles size={15}/> {commandLabels[command]}</button>)}</div>}
      {hasOpenQuestions && <div className="tc-composer-mode"><p>Separate Änderung</p><button onClick={() => setShowAlternativeComposer(false)}>Schließen</button></div>}
      <textarea aria-label="Separate Nachricht" value={text} onChange={event => onText(event.target.value)} placeholder={placeholder} rows={2} disabled={busy || !allowed.has(sendCommand)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); onSend(); } }}/>
      <div><ModelSelect value={model} onChange={onModel} disabled={busy} label="Modell"/><button className="tc-primary" aria-label="Separate Nachricht senden" disabled={busy || !text.trim() || !allowed.has(sendCommand)} onClick={onSend}><Send size={16}/>{snapshot.scenario ? 'Änderung senden' : 'Senden'}</button></div>
      </div>
    </footer>}
    {details ? <EntryDetails entry={details} onClose={() => setDetailId(undefined)}/> : null}
    {taskDetails ? <TaskDetails task={taskDetails} onClose={() => setTaskDetailId(undefined)}/> : null}
  </section>;
}

function ProposalCard({ snapshot, busy, onCommand }: { snapshot: TestingChatSnapshot; busy: boolean; onCommand: (command: TestingChatCommand) => void }) {
  const proposal = snapshot.proposed!;
  return <article className="tc-proposal"><header><Sparkles size={17}/><div><strong>Änderungsvorschlag</strong><span>{proposal.changes.length} Änderungen für Revision {proposal.expectedRevision}</span></div></header>
    <ul>{proposal.changes.slice(0, 5).map((change, index) => <li key={`${change.path}-${index}`}><span>{change.kind}</span>{change.label}</li>)}</ul>
    <div><button disabled={busy || !snapshot.allowedCommands.includes('reject')} onClick={() => onCommand('reject')}>Verwerfen</button><button className="tc-primary" disabled={busy || !snapshot.allowedCommands.includes('apply')} onClick={() => onCommand('apply')}><Check size={15}/>Übernehmen</button></div>
  </article>;
}

function FlowEditor({ snapshot, catalog, model, busy, onSave, onCommand }: { snapshot: ChatSnapshot; catalog: TestingCatalog; model: string; busy: boolean; onSave: (scenario: TestingScenario) => void; onCommand: (command: TestingChatCommand) => void }) {
  const preview = snapshot.validatedFlowPreview;
  const effectiveCatalog = useMemo(() => preview ? { ...catalog, definitions: [...catalog.definitions, ...(preview.newDefinitions ?? [])], knowledge: [...catalog.knowledge, ...(preview.newKnowledge ?? [])] } : catalog, [catalog, preview]);
  const previewScenario = preview ? { id: `preview-${preview.jobId}`, title: preview.title, intent: preview.expectedOutcome, revision: preview.scenarioRevision ?? 0, blocks: preview.blocks, expectedOutcome: preview.expectedOutcome, knowledgeRefs: preview.knowledgeRefs, createdAt: '', updatedAt: '', source: 'agent' as const } : undefined;
  const source = snapshot.proposed?.scenario ?? previewScenario ?? snapshot.scenario;
  const isPreview = !!preview && !snapshot.proposed;
  const [draft, setDraft] = useState<TestingScenario | undefined>(() => source ? readLocal<TestingScenario>(draftKey(source.id)) ?? structuredClone(source) : undefined);
  const [layout, setLayout] = useState<TestingScenarioLayout | undefined>(() => source ? readLocal(layoutKey(source.id)) : undefined);
  const [selected, setSelected] = useState<string>();
  const [definitionId, setDefinitionId] = useState('');
  const [conflict, setConflict] = useState('');
  const scratch = useRef<ScratchWorkspaceHandle>(null);
  useEffect(() => { if (!source) return; if (snapshot.proposed || isPreview) { setDraft(structuredClone(source)); setConflict(''); setSelected(undefined); return; } const local = readLocal<TestingScenario>(draftKey(source.id)); if (local && JSON.stringify(local.blocks) !== JSON.stringify(source.blocks) && local.revision < source.revision) { setDraft(local); setConflict(`Der gespeicherte Testfall ist inzwischen Revision ${source.revision}. Dein lokaler Entwurf basiert auf Revision ${local.revision} und wurde nicht überschrieben.`); } else { setDraft(local?.revision === source.revision ? local : structuredClone(source)); setConflict(''); } setSelected(undefined); }, [source?.id, source?.revision, snapshot.proposed?.jobId, preview?.jobId]);
  useEffect(() => { if (draft && !snapshot.proposed && !isPreview) localStorage.setItem(draftKey(draft.id), JSON.stringify(draft)); }, [draft, snapshot.proposed, isPreview]);
  const entries = useMemo(() => draft ? flattenBlocks(draft.blocks, effectiveCatalog) : [], [draft, effectiveCatalog]);
  const entry = entries.find(item => item.path === selected);
  const agentOwns = !!snapshot.activeJob && ['queued', 'running'].includes(snapshot.activeJob.status) || !!snapshot.proposed || isPreview;
  const dirty = !!draft && !!snapshot.scenario && (JSON.stringify(draft.blocks) !== JSON.stringify(snapshot.scenario.blocks) || JSON.stringify(draft.matrix) !== JSON.stringify(snapshot.scenario.matrix));
  const patchBlock = (change: (block: typeof entries[number]['block']) => typeof entries[number]['block'] | null) => { if (!draft || !selected) return; setDraft({ ...draft, blocks: updateBlockAtPath(draft.blocks, selected, catalog, change) }); };
  const move = (direction: number) => { if (!draft || !selected || selected.includes('/')) return; const index = draft.blocks.findIndex(block => block.id === selected); const target = index + direction; if (index < 0 || target < 0 || target >= draft.blocks.length) return; const blocks = [...draft.blocks]; [blocks[index], blocks[target]] = [blocks[target], blocks[index]]; setDraft({ ...draft, blocks }); };
  const duplicate = () => { if (!draft || !selected) return; const segments = selected.split('/'); const visit = (blocks: TestingBlockInstance[], depth = 0): TestingBlockInstance[] => blocks.flatMap(block => { if (block.id !== segments[depth]) return [block]; if (depth === segments.length - 1) return [block, { ...structuredClone(block), id: `${block.id}-${crypto.randomUUID().slice(0, 6)}` }]; return [{ ...block, children: visit(currentTestingChildren(block, effectiveCatalog), depth + 1) }]; }); setDraft({ ...draft, blocks: visit(draft.blocks) }); };
  if (!draft) return <div className="tc-empty"><Workflow size={28}/><h2>Noch kein Ablauf</h2><p>Beschreibe den Testfall in der Unterhaltung. Der bestätigte Entwurf erscheint hier.</p></div>;
  return <section className="tc-flow-pane testing-app">
    <header className="tc-pane-head"><div><small>{snapshot.proposed ? 'ÄNDERUNGSVORSCHLAG' : isPreview ? preview?.status === 'ready' ? 'VALIDIERTE VORSCHAU' : 'VORLÄUFIGE VORSCHAU' : 'BESTÄTIGTER ABLAUF'}</small><h2>{draft.title}</h2><p>{conflict || (isPreview ? `${draft.expectedOutcome}${draft.knowledgeRefs.length ? ` · ${draft.knowledgeRefs.length} fachliche Quellen` : ''}` : agentOwns ? snapshot.proposed ? 'Prüfe den Vorschlag in der Unterhaltung.' : 'Der Agent bearbeitet diesen Entwurf. Die Arbeitsfläche ist vorübergehend schreibgeschützt.' : dirty ? 'Ungespeicherte manuelle Änderungen' : `Revision ${draft.revision}`)}</p></div><div>{dirty && !agentOwns && <button className="tc-primary" disabled={busy || !!conflict} onClick={() => onSave(draft)}><Save size={15}/>Revision speichern</button>}{snapshot.allowedCommands.includes('approve') && !dirty && <button className="tc-primary" disabled={busy} onClick={() => onCommand('approve')}><Check size={15}/>Freigeben</button>}</div></header>
    <div className="tc-flow-grid"><div className="tc-scratch-card"><div className="tc-canvas-tools"><select aria-label="Baustein hinzufügen" value={definitionId} disabled={agentOwns} onChange={event => setDefinitionId(event.target.value)}><option value="">Baustein auswählen …</option>{effectiveCatalog.definitions.filter((definition, index, all) => !all.slice(index + 1).some(item => item.id === definition.id)).map(definition => <option key={`${definition.id}@${definition.version}`} value={definition.id}>{definition.name}</option>)}</select><button disabled={agentOwns || !definitionId} onClick={() => { const definition = effectiveCatalog.definitions.filter(item => item.id === definitionId).at(-1); if (!definition) return; setDraft({ ...draft, blocks: [...draft.blocks, newInstance(definition, draft.blocks, effectiveCatalog)] }); setDefinitionId(''); }}><Plus size={14}/>Hinzufügen</button><a href={`/testing/editor/${encodeURIComponent(draft.id)}`}>Erweiterte Bearbeitung <ExternalLink size={13}/></a></div><Suspense fallback={<p className="tc-loading">Arbeitsfläche wird geladen …</p>}><ScratchWorkspace ref={scratch} blocks={draft.blocks} catalog={effectiveCatalog} parameters={draft.parameters} layout={layout} selected={selected} readOnly={agentOwns} onChange={blocks => setDraft(current => current ? { ...current, blocks } : current)} onSelect={setSelected} onLayout={value => setLayout(current => { const next = { id: draft.id, scenarioId: draft.id, collapsed: [], ...current, ...value }; localStorage.setItem(layoutKey(draft.id), JSON.stringify(next)); return next; })}/></Suspense></div>
      {entry && <Inspector entry={entry} entries={entries} catalog={effectiveCatalog} onClose={() => setSelected(undefined)} onChange={patchBlock} onValue={(key, value) => patchBlock(block => ({ ...block, inputs: { ...block.inputs, [key]: value } }))} onDefinition={() => { location.href = `/testing/editor/${encodeURIComponent(draft.id)}`; }} onKnowledge={() => { location.href = `/testing/editor/${encodeURIComponent(draft.id)}`; }} onOverride={text => { navigate(snapshot.conversation.id, 'chat'); sessionStorage.setItem(`folio-testing-chat-prefill:${snapshot.conversation.id}`, text); }} busy={agentOwns} onMove={move} onDuplicate={duplicate} scenarioParameters={draft.parameters}/>}</div>
    <section className="tc-matrix"><header><div><small>VARIANTEN</small><h3>Testmatrix</h3></div><span>{draft.matrix?.rows.length ?? 0} Fälle</span></header><TestMatrix scenario={draft} catalog={effectiveCatalog} disabled={agentOwns} onChange={matrix => setDraft({ ...draft, matrix })}/></section>
  </section>;
}

function BrowserRun({ snapshot, busy, onCommand }: { snapshot: TestingChatSnapshot; busy: boolean; onCommand: (command: TestingChatCommand) => void }) {
  const run = snapshot.latestRun;
  const [observation, setObservation] = useState<RunnerObservation>();
  const [ended, setEnded] = useState(false);
  useEffect(() => { setObservation(undefined); setEnded(false); if (!run || run.isCurrent !== true || !['queued', 'running'].includes(run.status)) return; return subscribeObservations(run.id, { onObservation: setObservation, onEnd: () => setEnded(true) }); }, [run?.id, run?.status, run?.isCurrent]);
  if (!run) return <div className="tc-browser-empty"><div className="tc-browser-window"><span/><span/><span/><div><ExternalLink size={26}/><p>Der Browser öffnet sich erst, wenn du den Test ausdrücklich startest.</p></div></div><button className="tc-primary tc-start" disabled={busy || !snapshot.allowedCommands.includes('run')} onClick={() => onCommand('run')}><Play size={17}/>Test starten</button></div>;
  const proofs = run.matrixRows?.flatMap(row => row.steps ?? []) ?? run.steps;
  return <section className="tc-browser-pane"><header className="tc-pane-head"><div><small>{run.isCurrent !== true ? 'HISTORISCHER NACHWEIS' : ['queued', 'running'].includes(run.status) ? 'LIVE' : 'NACHWEISE'}</small><h2>{run.status === 'running' && run.isCurrent === true ? 'Browser führt den Test aus' : run.status === 'passed' ? 'Test bestanden' : run.status === 'failed' ? 'Test fehlgeschlagen' : 'Test wartet'}</h2><p>{run.isCurrent !== true ? `Dieser Lauf gehört zu Revision ${run.scenarioRevision}.` : observation?.stepLabel ?? run.error ?? `${proofs.filter(step => step.status === 'passed').length} von ${proofs.length} Schritten bestanden`}</p></div>{snapshot.allowedCommands.includes('run') && !['queued', 'running'].includes(run.status) && <button className="tc-primary" disabled={busy} onClick={() => onCommand('run')}><RefreshCw size={15}/>Erneut starten</button>}</header>
    {observation && !ended ? <figure className="tc-live-frame"><img src={observation.frameUrl} width={observation.width} height={observation.height} alt={`Live-Browser: ${observation.stepLabel ?? 'Testschritt'}`}/><figcaption><span className="tc-live-dot"/>Live · {observation.stepLabel ?? `Bild ${observation.sequence}`}</figcaption></figure> : <div className="tc-proof-grid">{proofs.filter(step => step.screenshot).map(step => <figure key={step.id}><img src={step.screenshot} alt={`Nachweis: ${step.label}`}/><figcaption><strong>{step.label}</strong><span>{step.status === 'passed' ? 'Bestanden' : step.status}</span></figcaption></figure>)}{!proofs.some(step => step.screenshot) && <p>Noch keine Browserbilder vorhanden.</p>}</div>}
  </section>;
}

export function TestingChatApp() {
  const [currentRoute, setCurrentRoute] = useState(route);
  const [bootstrap, setBootstrap] = useState<{ catalog: TestingCatalog; scenarios: TestingScenario[] }>();
  const [settings, setSettings] = useState<TestingAgentSettings>();
  const [snapshot, setSnapshot] = useState<ChatSnapshot>();
  const [model, setModel] = useState('luna');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [, setConnected] = useState(false);
  const [error, setError] = useState('');
  const revision = useRef(0);
  const streamSequence = useRef(0);
  const loadToken = useRef(0);
  useEffect(() => { const pop = () => setCurrentRoute(route()); addEventListener('popstate', pop); return () => removeEventListener('popstate', pop); }, []);
  useEffect(() => { const controller = new AbortController(); Promise.all([chatApi.bootstrap(controller.signal), chatApi.settings(controller.signal)]).then(([base, config]) => { setBootstrap(base); setSettings(config); setModel(config.defaultModel); }).catch(cause => { if (!controller.signal.aborted) setError(messageOf(cause)); }); return () => controller.abort(); }, []);
  const load = useCallback(async (id: string, signal?: AbortSignal) => { const token = ++loadToken.current; const next = await chatApi.conversation(id, signal); if (token !== loadToken.current || id !== route().id) return; revision.current = next.conversation.revision; streamSequence.current = Math.max(streamSequence.current, next.conversation.eventSequence); setSnapshot(next); setModel(next.conversation.model); }, []);
  useEffect(() => { if (!currentRoute.id) { setSnapshot(undefined); return; } const controller = new AbortController(); void load(currentRoute.id, controller.signal).catch(cause => { if (!controller.signal.aborted) setError(messageOf(cause)); }); return () => controller.abort(); }, [currentRoute.id, load]);
  useEffect(() => { streamSequence.current = 0; if (!currentRoute.id) return; return subscribeConversation(currentRoute.id, { onConnection: setConnected, onEvent: event => { if (event.sequence <= streamSequence.current) return; streamSequence.current = event.sequence; revision.current = Math.max(revision.current, event.revision); if (event.type === 'snapshot') setSnapshot(event.snapshot); else if (event.type === 'entry') setSnapshot(current => current ? { ...current, conversation: { ...current.conversation, revision: event.revision, eventSequence: event.sequence }, timeline: current.timeline.some(item => item.id === event.entry.id) ? current.timeline.map(item => item.id === event.entry.id ? event.entry : item) : [...current.timeline, event.entry] } : current); else void load(currentRoute.id).catch(() => {}); } }); }, [currentRoute.id, load]);
  useEffect(() => { if (!currentRoute.id || !snapshot?.latestRun || !['queued', 'running'].includes(snapshot.latestRun.status)) return; const timer = window.setInterval(() => void load(currentRoute.id).catch(() => {}), 1200); return () => clearInterval(timer); }, [currentRoute.id, snapshot?.latestRun?.id, snapshot?.latestRun?.status, load]);
  useEffect(() => { if (!snapshot?.scenario) return; setBootstrap(current => current ? { ...current, scenarios: [snapshot.scenario!, ...current.scenarios.filter(item => item.id !== snapshot.scenario!.id)] } : current); }, [snapshot?.scenario?.id, snapshot?.scenario?.revision]);
  async function mutate(command: TestingChatCommand, payload?: Record<string, unknown>) { if (!snapshot || busy) return false; setBusy(true); setError(''); try { const guarded = snapshot.scenarioState ? { ...payload, expectedScenarioRevision: snapshot.scenarioState.revision, fingerprint: snapshot.scenarioState.fingerprint } : payload; const next = await chatApi.command(snapshot.conversation.id, command, snapshot.conversation.revision, guarded); revision.current = next.conversation.revision; setSnapshot(next); return true; } catch (cause) { setError(messageOf(cause)); if ((cause as { status?: number }).status === 409) await load(snapshot.conversation.id); return false; } finally { setBusy(false); } }
  async function send() { const message = text.trim(); if (!message || !snapshot) return; const allowed = new Set(snapshot.allowedCommands); const command: TestingChatCommand = snapshot.scenario && allowed.has('revise') ? 'revise' : allowed.has('message') ? 'message' : 'explore'; setText(''); await mutate(command, { message, text: message, model }); }
  async function answerQuestions(answers: { questionId: string; answer: string }[]) { return mutate('answer', { answers, model }); }
  async function create(scenarioId: string) { setBusy(true); setError(''); try { const next = await chatApi.create({ scenarioId, model, requestId: crypto.randomUUID() }); setSnapshot(next); navigate(next.conversation.id, 'chat'); } catch (cause) { setError(messageOf(cause)); } finally { setBusy(false); } }
  async function createFromMessage() { const message = text.trim(); if (!message || busy) return; setBusy(true); setError(''); try { const next = await chatApi.create({ message, model, requestId: crypto.randomUUID() }); setText(''); setSnapshot(next); navigate(next.conversation.id, 'chat'); } catch (cause) { setError(messageOf(cause)); } finally { setBusy(false); } }
  async function save(scenario: TestingScenario) { if (!snapshot) return; if (await mutate('save', { scenario, expectedRevision: scenario.revision })) localStorage.removeItem(draftKey(scenario.id)); }
  const scenarioId = snapshot?.scenario?.id;
  return <AgentSettingsContext.Provider value={settings}><main className="testing-chat-app"><aside className="tc-sidebar"><a className="tc-brand" href="/testing/chat" onClick={event => { event.preventDefault(); navigate(); }}><span>F</span><strong>Folio Studio</strong></a><button className="tc-new" disabled={busy} onClick={() => navigate()}><Plus size={16}/>Neuer Testfall</button><nav aria-label="Testfälle">{bootstrap?.scenarios.map(scenario => <button key={scenario.id} className={scenario.id === scenarioId ? 'active' : ''} onClick={() => void create(scenario.id)}><span>{scenario.title}</span><small>Revision {scenario.revision}</small><ChevronRight size={14}/></button>)}</nav><a className="tc-classic" href="/testing"><ArrowLeft size={14}/>Klassische Ansicht</a></aside>
    <section className="tc-main">{error && <div className="tc-error" role="alert">{error}<button onClick={() => setError('')}>Schließen</button></div>}{snapshot ? <><header className="tc-topbar"><div><small>TESTFALL</small><strong>{snapshot.scenario?.title ?? 'Neuer Testfall'}</strong></div><nav aria-label="Ansichten">{(Object.keys(tabLabels) as Tab[]).map(tab => <button aria-current={currentRoute.tab === tab ? 'page' : undefined} onClick={() => navigate(snapshot.conversation.id, tab)} key={tab}>{tabLabels[tab]}</button>)}</nav>{snapshot.allowedCommands.includes('cancel') ? <button className="tc-cancel" disabled={busy} onClick={() => void mutate('cancel')}><CircleStop size={15}/>Abbrechen</button> : <span className={`tc-state is-${snapshot.lifecycle?.status ?? 'idle'}`}>{snapshot.lifecycle?.message ?? 'Bereit'}</span>}</header>
      {currentRoute.tab === 'chat' ? <Conversation snapshot={snapshot} model={model} busy={busy} text={text} onText={setText} onModel={setModel} onSend={() => void send()} onAnswers={answerQuestions} onCommand={command => void mutate(command, { model })} onReviewFlow={() => navigate(snapshot.conversation.id, 'flow')}/> : currentRoute.tab === 'flow' && bootstrap ? <FlowEditor snapshot={snapshot} catalog={bootstrap.catalog} model={model} busy={busy} onSave={scenario => void save(scenario)} onCommand={command => void mutate(command, { model })}/> : <BrowserRun snapshot={snapshot} busy={busy} onCommand={command => void mutate(command, { model })}/>}</> : <section className="tc-welcome"><span className="tc-mark">F</span><h1>Tests im Gespräch entwickeln.</h1><p>Beschreibe den gewünschten Ablauf. Erst mit deiner Anforderung startet Folio die Erkundung und erstellt einen Testfall.</p><div className="tc-first-composer"><textarea rows={4} value={text} onChange={event => setText(event.target.value)} placeholder="Zum Beispiel: Erstelle eine Kuhlebensversicherung über 15.000 Euro und prüfe die Direktionsanfrage …" onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void createFromMessage(); } }}/><div><ModelSelect value={model} onChange={setModel} disabled={busy} label="Modell"/><button className="tc-primary" disabled={busy || text.trim().length < 5} onClick={() => void createFromMessage()}><Send size={16}/>Erkundung starten</button></div></div></section>}</section></main></AgentSettingsContext.Provider>;
}

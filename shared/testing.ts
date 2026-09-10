/** Fachlicher Vertrag. Darstellung und technische Ausführung sind eigene Datensätze. */
/** Stable local model-profile key; legacy luna/sol remain valid. */
export type TestingModel = string;
export type TestingProvider = 'codex' | 'claude';
export interface TestingModelProfile { id: string; label: string; provider: TestingProvider; slug: string; extraArgs: string[] }
export interface TestingProviderSettings { executable: string; extraArgs: string[] }
export interface TestingAgentSettings {
  id: 'local'; revision: number; defaultModel: TestingModel; models: TestingModelProfile[];
  providers: Record<TestingProvider, TestingProviderSettings>;
}
export interface TestingAgentConfiguration {
  provider: TestingProvider; modelId: TestingModel; modelLabel: string; modelSlug: string;
  executable: string; args: string[]; settingsRevision: number;
}
export type TestingVersion = string;
export interface TestingVersionRef { id: string; version: TestingVersion }
export type TestingValueType = 'text' | 'number' | 'money' | 'boolean' | 'date' | 'choice' | 'object' | 'list' | 'customer-ref' | 'farm-ref' | 'animal-ref' | 'proposal-ref' | 'referral-ref' | 'contract-ref' | 'policy-ref' | 'document-ref';
export const testingValueTypeLabels: Record<TestingValueType, string> = { text: 'Text', number: 'Zahl', money: 'Geldbetrag', boolean: 'Ja / Nein', date: 'Datum', choice: 'Auswahl', object: 'Wertepaare', list: 'Liste', 'customer-ref': 'Kunde', 'farm-ref': 'Betrieb', 'animal-ref': 'Tier', 'proposal-ref': 'Versicherungsvorschlag', 'referral-ref': 'Direktionsanfrage', 'contract-ref': 'Vertrag', 'policy-ref': 'Police', 'document-ref': 'Dokument' };
/** Optional type constrains untyped containers; a declared scalar reference field uses its schema and the actual source type. */
export interface TestingReference { ref: string; type?: TestingValueType }
export interface TestingParameter { param: string }
export type TestingValue = string | number | boolean | null | TestingReference | TestingParameter | TestingValue[] | { [key: string]: TestingValue };
export interface TestingInput {
  key: string; label: string; type: TestingValueType; required?: boolean; default?: TestingValue;
  description?: string; options?: { value: string; label: string }[]; fields?: TestingInput[];
  minimum?: number; maximum?: number; extensible?: boolean;
  requiredWhen?: { input: string; values: TestingValue[] };
  applicableWhen?: { input: string; values: TestingValue[] };
}
export interface TestingOutput { key: string; label: string; type: TestingValueType }
export type TestingBlockKind = 'action' | 'assertion' | 'workflow' | 'context';
export interface TestingBlockDefinition {
  id: string; version: TestingVersion; name: string; description: string; kind: TestingBlockKind;
  category: string; semanticKey: string; inputs: TestingInput[]; outputs: TestingOutput[];
  knowledgeRefs: string[]; preconditions: string[]; postconditions: string[];
  /** Elementarer fachlicher Vorgang; die Bindung verknüpft ihn separat mit der UI. */
  operation?: string; bindingId?: string; body?: TestingBlockInstance[];
  exports?: Record<string, TestingReference>; status: 'draft' | 'approved'; createdAt: string;
  origin: 'seed' | 'agent' | 'human'; supersedes?: TestingVersionRef;
}
export interface TestingBlockInstance {
  id: string; definition: TestingVersionRef; inputs: Record<string, TestingValue>;
  outputs?: Record<string, string>; label?: string;
  /** Sichtbare lokale Komposition; fehlt sie, gilt die versionierte Definitionskomposition. */
  children?: TestingBlockInstance[];
  /** Instanzlokale Feldwerte; Schlüssel ist der relative Pfad des enthaltenen Blocks. */
  overrides?: Record<string, Record<string, TestingValue>>;
  note?: string;
}
export interface TestingMatrixTarget { blockPath: string; inputPath: string }
export interface TestingMatrixColumn {
  id: string; label: string; target: TestingMatrixTarget;
  /** Fehlende Rolle in gespeicherten Altmatrizen wird aus dem Assertion-Schema abgeleitet. */
  role?: 'input' | 'expectation';
  /** UI metadata. The backend verifies this against the target definition. */
  type: TestingValueType;
}
export interface TestingMatrixRow {
  id: string; label: string; enabled: boolean; values: Record<string, TestingValue>;
}
export interface TestingMatrix { columns: TestingMatrixColumn[]; rows: TestingMatrixRow[] }
export function inferTestingMatrixColumnRole(column: TestingMatrixColumn, definitionKind?: TestingBlockKind, input?: Pick<TestingInput,'key'|'label'>): 'input'|'expectation' {
  if(column.role)return column.role;
  return definitionKind==='assertion'&&!!input&&(/^expected(?:[A-Z_]|$)/.test(input.key)||/^erwartet/i.test(input.label))?'expectation':'input';
}
export interface TestingScenario {
  id: string; title: string; intent: string; revision: number; blocks: TestingBlockInstance[];
  expectedOutcome: string; knowledgeRefs: string[]; createdAt: string; updatedAt: string;
  source: 'human' | 'agent' | 'seed'; model?: TestingModel; parameters?: Record<string, TestingValue>;
  matrix?: TestingMatrix;
  naming?: {title:string;summary:string;tags:string[];titleSource:'user-request'|'agent'|'human';jobId:string};
}
export interface TestingScenarioLayout {
  id: string; scenarioId: string; collapsed: string[]; selectedId?: string;
  positions?: Record<string, { x: number; y: number }>; zoom?: number; parkedBlocks?: TestingBlockInstance[];
  /** Lose Scratch-Stapel behalten ihre internen Verbindungen, ohne ausgeführt zu werden. */
  parkedStacks?: TestingBlockInstance[][];
}
export interface TestingApproval {
  id: string; scenarioId: string; scenarioRevision: number; fingerprint: string;
  actor: string; approvedAt: string; comment?: string;
}
export interface TestingKnowledgeDocument {
  id: string; revision: number; title: string; kind: 'concept' | 'rule' | 'procedure' | 'technical';
  summary: string; content: string; path?: string; definitionRefs: TestingVersionRef[];
  relatedKnowledge: string[]; requiredFields: string[]; preconditions: string[]; postconditions: string[];
  origin: 'seed' | 'agent' | 'human';
}
export interface TestingLocator {
  key: string; method: 'role' | 'label' | 'text' | 'testId'; value: string;
  role?: string; exact?: boolean;
}
export interface TestingUIRecipeAction {
  op: 'goto' | 'fill' | 'select' | 'click' | 'check' | 'expectText' | 'expectVisible' | 'expectEnabled' | 'expectDisabled' | 'captureResponse';
  locatorKey?: string; value?: TestingValue;
  /** Nach einer bestandenen UI-Prüfung erfasste Ergebniswerte, keine erfundene Antwort. */
  proof?: { matched?: string; actual?: string };
  when?: { input: string; equals?: TestingValue; present?: boolean };
  /** Nur am reinen Öffnungsklick ohne capture. Key eines Formularfeld-Locators derselben Bindung; nie an fill, select, check oder Assertions. */
  unlessVisible?: string;
  capture?: { method: string; path: string; status?: number; outputs: Record<string, string>; expect?: Record<string, TestingValue> };
}
export interface TestingTechnicalBinding {
  id: string; revision: number; operation: string; name: string; status: 'missing' | 'draft' | 'ready';
  definitionRefs: TestingVersionRef[]; knowledgeRefs: string[]; module: string; export: string;
  locators: TestingLocator[]; recipe?: TestingUIRecipeAction[];
  /** Jedes fachliche Eingabefeld muss technisch verwendet oder ausdrücklich geprüft werden. */
  inputKeys?: string[]; changeReason: string; createdAt: string; sourceHash?: string;
}
export interface TestingCatalog {
  revision: string; definitions: TestingBlockDefinition[]; bindings: TestingTechnicalBinding[];
  knowledge: TestingKnowledgeDocument[];
}
export interface TestingValidationIssue {
  code: string; message: string; severity: 'error' | 'warning' | 'info'; instanceId?: string; path?: string; field?: string; sourcePath?: string; sourceLabel?: string;
}
export interface TestingCompiledStep {
  id: string; instanceId: string; path: string; ancestors: string[]; definition: TestingVersionRef;
  label: string; kind: 'action' | 'assertion'; operation: string; actor: string;
  inputs: Record<string, TestingValue>; outputs: Record<string, string>;
  binding?: { id: string; revision: number }; knowledgeRefs: string[];
}
export interface TestingCompiledScenario {
  scenarioId: string; scenarioRevision: number; fingerprint: string; compiledAt: string;
  scenario: TestingScenario; definitions: TestingBlockDefinition[]; bindings: TestingTechnicalBinding[];
  knowledge: TestingKnowledgeDocument[]; steps: TestingCompiledStep[]; issues: TestingValidationIssue[];
  valid: boolean; executable: boolean; approval?: TestingApproval;
  matrixOrigin?: { parentFingerprint: string; rowId: string; approval: TestingApproval };
}
export interface TestingDuplicateCandidate {
  definition: TestingVersionRef; name: string; score: number;
  matching: string[]; differences: string[]; decision: 'reuse' | 'extend' | 'distinct'; reason: string;
}
export interface TestingDuplicateReport {
  proposed: TestingVersionRef; checkedAt: string; candidates: TestingDuplicateCandidate[];
  decision: 'reuse' | 'extend' | 'new'; chosen?: TestingVersionRef; reason: string;
}
export interface TestingReuseSuggestion {
  id: string; scenarioId: string; scenarioRevision: number; fingerprint: string;
  name: string; reason: string; instanceIds: string[]; parentPath?: string; parameters: { key: string; label: string; instanceId: string; input: string }[];
  status: 'suggested' | 'accepted' | 'dismissed'; definitionRef?: TestingVersionRef;
}
export interface TestingGraphNode {
  id: string; kind: 'scenario' | 'revision' | 'instance' | 'definition' | 'binding' | 'knowledge' | 'approval' | 'run';
  label: string; data: unknown;
}
export interface TestingGraphEdge { id: string; source: string; target: string; relation: string }
export interface TestingGraph { nodes: TestingGraphNode[]; edges: TestingGraphEdge[] }
export interface TestingImpact {
  bindingId: string; bindingRevision: number;
  definitions: { definition: TestingVersionRef; name: string; direct: boolean; via: string[] }[];
  scenarios: { scenarioId: string; title: string; revision: number; direct: boolean; instancePaths: string[] }[];
  historicalRuns: { runId: string; scenarioId: string; bindingRevision: number; status: string }[];
  suggestedScenarioIds: string[];
}
export type TestingAgentPhase = 'business' | 'naming' | 'exploration' | 'technical' | 'duplicates' | 'reuse';
export type TestingAgentStage = 'naming' | 'knowledge' | 'exploring' | 'planning' | 'validating' | 'revising' | 'duplicates' | 'wiring' | 'running' | 'reuse';
export interface TestingAgentTermination {
  cause:'user_cancelled'|'parent_cancelled'|'time_limit'|'action_limit'|'no_progress'|'server_restart'|'output_limit'|'interrupted';
  message:string; at:string; limitMs?:number;
}
export interface TestingAgentProgress {
  stage:'knowledge'|'exploring'; status:'waiting-model'|'acting'|'observed'|'finished';
  round:number; observationCount:number; actionLimit:number; startedAt:string; deadlineAt:string; summary:string;
  questions?:TestingExplorationQuestion[];
}
export interface TestingExplorationQuestion {
  id:string; text:string; kind?:'requirement'|'research'|'clarification'; why?:string; requestQuote?:string;
  requiresBrowser:boolean; status:'open'|'answered'; answer:string; evidenceIds:string[]; knowledgeIds:string[];
}
export interface TestingAgentWorkStage {
  stage:TestingAgentStage; status:'running'|'completed'|'skipped'|'failed'; startedAt?:string; finishedAt?:string; summary?:string;
  /** Re-entering a stage appends another attempt instead of replacing its history. */
  attempt?:number;
}
export interface TestingScenarioLifecycle {
  scenarioId:string; scenarioRevision:number; fingerprint:string;
  phase:'request'|'exploration'|'review'|'technical'|'result'; status:'idle'|'running'|'attention'|'ready'|'failed'|'cancelled';
  currentJobId?:string; childJobIds:string[]; runId?:string; runStatus?:'queued'|'running'|'passed'|'failed'; analysisRunning?:boolean; analysisAttention?:boolean; stage?:TestingAgentStage;
  nextAction:'plan'|'wait'|'approve'|'review'|'technical'|'run'|'retry-business'|'retry-technical'|'inspect-run'; message:string;
}
export interface TestingAgentEvent {
  id:string;at:string;kind:'status'|'message'|'tool'|'error'|'metrics';message:string;
  /** Ausschließlich für die Oberfläche freigegebener Kontext, keine Prompts oder internen Gedankengänge. */
  context?:{jobId:string;phase:TestingAgentPhase;taskLabel:string;modelId:string;modelLabel?:string;provider?:TestingProvider;stage?:TestingAgentStage};
  sources?:{label:string;kind:'knowledge'|'scenario'|'definition'|'portal-evidence';ref:string}[];
  content?:{type:'validated-summary';title:string;summary:string;facts?:{label:string;value:string}[]};
  /** Public, deliberately selected activity detail. Never contains prompts, raw tool output, or hidden reasoning. */
  publicDetail?:TestingAgentPublicDetail;
  /** Stable provider identity lets partial events be replaced instead of duplicated. */
  stream?:{providerEventId:string;status:'streaming'|'completed'};
  /** One stable record per real CLI invocation. The terminal update replaces its start record. */
  metrics?:Omit<TestingAgentMetrics,'elapsedMs'> & {elapsedMs?:number};
}
export interface TestingAgentPublicDetail {
  type:'reasoning'|'message'|'validation'|'result'; label:string; data?:unknown;
}
export interface TestingAgentMetrics {
  elapsedMs:number; requestCount:number; inputTokens?:number; cachedInputTokens?:number; outputTokens?:number; totalTokens?:number;
}
export interface TestingAgentJob {
  id: string; phase: TestingAgentPhase; model: TestingModel; status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  prompt: string; scenarioId?: string; scenarioRevision?: number; fingerprint?: string;
  startedAt: string; finishedAt?: string; events: TestingAgentEvent[]; error?: string;
  result?: unknown; artifactDirectory?: string; agentConfig?: TestingAgentConfiguration;
  parentJobId?:string; childJobIds?:string[]; stage?:TestingAgentStage; runId?:string;
  termination?:TestingAgentTermination; progress?:TestingAgentProgress; workStages?:TestingAgentWorkStage[]; metrics?:TestingAgentMetrics;
}
export interface TestingStepResult {
  id: string; instanceId: string; path: string; label: string; status: 'running' | 'passed' | 'failed' | 'skipped';
  startedAt: string; finishedAt?: string; durationMs?: number; error?: string; screenshot?: string;
  outputValues?: Record<string, TestingValue>;
}
export interface TestingRun {
  id: string; scenarioId: string; scenarioTitle: string; scenarioRevision: number;
  status: 'queued' | 'running' | 'passed' | 'failed'; startedAt: string; finishedAt?: string;
  compiled: TestingCompiledScenario; steps: TestingStepResult[]; error?: string;
  artifacts?: { trace?: string; source?: string; manifest?: string; directory?: string };
  outputs?: Record<string, TestingValue>; reuseSuggestions?: TestingReuseSuggestion[];
  mode?: 'single' | 'matrix'; matrixRows?: TestingMatrixRowResult[];
  summary?: { total: number; passed: number; failed: number; skipped: number };
}
export interface TestingMatrixRowResult {
  rowId: string; rowLabel: string; index: number; status: 'queued' | 'running' | 'passed' | 'failed' | 'skipped';
  values: Record<string, TestingValue>; startedAt?: string; finishedAt?: string; durationMs?: number;
  compiled?: TestingCompiledScenario; steps?: TestingStepResult[]; error?: string;
  outputs?: Record<string, TestingValue>; artifacts?: TestingRun['artifacts'];
}
export interface TestingBusinessDraft {
  title: string; expectedOutcome: string; blocks: TestingBlockInstance[]; knowledgeRefs: string[];
  newDefinitions: TestingBlockDefinition[]; newKnowledge: TestingKnowledgeDocument[];
  explanation: string; assumptions: string[]; openQuestions: string[];
  matrix?: TestingMatrix;
  matrixMode?: 'keep' | 'replace' | 'remove';
  caseDesign?: { mode: 'single' | 'matrix'; dimensions: string[]; expectedCaseCount: number; expectedResults: string[]; rationale: string };
}
export interface TestingScenarioEditChange {
  kind: 'add' | 'remove' | 'move' | 'values' | 'metadata'; path: string; label: string;
  before?: unknown; after?: unknown;
}
export interface TestingScenarioEditProposal {
  scope: 'scenario'; applied: boolean; reviewStatus: 'pending' | 'applied' | 'dismissed';
  before: TestingScenario; scenario: TestingScenario; draft: TestingBusinessDraft;
  compiled: TestingCompiledScenario; changes: TestingScenarioEditChange[];
  contextHash: string; attempts: number; appliedRevision?: number;
}
export interface TestingTechnicalPlan {
  scenarioId: string; fingerprint: string; bindings: TestingTechnicalBinding[];
  duplicateReports: TestingDuplicateReport[]; explanation: string; unsupported: (string | TestingTechnicalIssue)[];
}
export interface TestingTechnicalIssue {
  kind: 'business-contract' | 'technical-capability' | 'duplicate-review';
  summary: string;
  affectedDefinitionRefs: TestingVersionRef[];
  affectedInputKeys: string[];
  blockPaths: string[];
  suggestedBusinessRevision?: string;
}
export interface TestingPromotionRequest {
  scenarioId: string; expectedRevision: number; instanceIds: string[]; parentPath?: string; name: string; description: string;
  parameters: { key: string; label: string; instanceId: string; input: string }[]; replaceSelection?: boolean;
}
export interface TestingPromotionResult { definition: TestingBlockDefinition; scenario: TestingScenario; duplicateReport: TestingDuplicateReport }

export type TestingDefaultDecision = 'neuen-standard-uebernehmen' | 'bisherigen-wert-beibehalten';
export interface TestingDefinitionChangeRequest {
  definition: TestingBlockDefinition; newKnowledge?: TestingKnowledgeDocument[];
  defaultDecisions?: Record<string, TestingDefaultDecision>;
  valueResolutions?: Record<string, { action: 'wert-setzen'; value: TestingValue } | { action: 'feld-verwerfen' } | { action: 'feld-zuordnen'; targetField: string }>;
}
export interface TestingDefinitionScenarioChange {
  scenarioId: string; title: string; revision: number; direct: boolean;
  instancePaths: string[]; directPaths: string[]; transitivePaths: string[];
  behavior: 'fachlich-unveraendert' | 'testdefinition-aendern' | 'nicht-anwendbar';
  changes: { path: string; field: string; label: string; before?: TestingValue; after?: TestingValue; reason: string; decisionKey?: string; decisionRequired?: boolean; source?: 'standard' | 'ausdruecklich' | 'override' | 'parameter' | 'matrix' }[];
  matrixRows: { rowId: string; rowLabel: string; behavior: 'fachlich-unveraendert' | 'testdefinition-aendern' | 'nicht-anwendbar'; changes?: TestingDefinitionScenarioChange['changes']; diagnostics?: TestingValidationIssue[] }[];
  diagnostics: TestingValidationIssue[];
  affectedCaseCount: number; changedCaseCount: number; blockedCaseCount: number;
}
export interface TestingDefinitionChangePreview {
  id: string; catalogFingerprint: string; source: TestingVersionRef; target: TestingVersionRef;
  definition: TestingBlockDefinition; newKnowledge: TestingKnowledgeDocument[];
  defaultDecisions: Record<string, TestingDefaultDecision>;
  valueResolutions: NonNullable<TestingDefinitionChangeRequest['valueResolutions']>;
  scenarios: TestingDefinitionScenarioChange[]; affectedScenarioCount: number;
  changedScenarioCount: number; unchangedScenarioCount: number; blocked: boolean;
  affectedCaseCount: number; changedCaseCount: number; unchangedCaseCount: number; blockedCaseCount: number;
  technicalPreparation?: { status: 'wiederverwendbar' | 'neu-zu-pruefen'; bindingId?: string; reason: string };
}
export interface TestingDefinitionChangeApplyResult { definition: TestingBlockDefinition; scenarios: TestingScenario[]; preview: TestingDefinitionChangePreview; binding?: TestingTechnicalBinding }

export function testingVersionKey(ref: TestingVersionRef): string { return `${ref.id}@${ref.version}`; }
export function compareTestingVersions(left: string, right: string): number {
  const split = (value: string) => { const [core, ...pre] = value.split('-'); return { core: core.split('.').map(Number), pre: pre.join('-') }; };
  const a = split(left), b = split(right);
  for (let index = 0; index < Math.max(3, a.core.length, b.core.length); index++) {
    const difference = (a.core[index] ?? 0) - (b.core[index] ?? 0); if (difference) return difference;
  }
  if (!a.pre || !b.pre) return a.pre === b.pre ? 0 : a.pre ? -1 : 1;
  const aa = a.pre.split('.'), bb = b.pre.split('.');
  for (let index = 0; index < Math.max(aa.length, bb.length); index++) {
    if (aa[index] === bb[index]) continue;
    if (aa[index] === undefined || bb[index] === undefined) return aa[index] === undefined ? -1 : 1;
    const an = /^\d+$/.test(aa[index]), bn = /^\d+$/.test(bb[index]);
    return an && bn ? Number(aa[index]) - Number(bb[index]) : an !== bn ? an ? -1 : 1 : aa[index].localeCompare(bb[index]);
  }
  return 0;
}
/** Editable flows always use the newest immutable revision of a stable block ID. */
export function currentTestingDefinition(catalog: TestingCatalog, ref: Pick<TestingVersionRef, 'id'> | string): TestingBlockDefinition | undefined {
  const id = typeof ref === 'string' ? ref : ref.id;
  return catalog.definitions.filter(definition => definition.id === id).sort((a, b) => compareTestingVersions(b.version, a.version))[0];
}
export function currentTestingDefinitions(catalog: TestingCatalog): TestingBlockDefinition[] {
  return [...new Set(catalog.definitions.map(definition => definition.id))].map(id => currentTestingDefinition(catalog, id)!).filter(Boolean);
}
const sameTestingValue = (left: unknown, right: unknown): boolean => {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => sameTestingValue(value, right[index]));
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  const a = Object.keys(left as object).filter(key => (left as Record<string, unknown>)[key] !== undefined).sort();
  const b = Object.keys(right as object).filter(key => (right as Record<string, unknown>)[key] !== undefined).sort();
  return a.length === b.length && a.every((key, index) => key === b[index] && sameTestingValue((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]));
};
/** Reconciles previously materialized inherited bodies with the current shared body.
 * Added/removed shared steps follow the current definition; locally added steps and
 * changed values remain local. */
export function currentTestingChildren(block: TestingBlockInstance, catalog: TestingCatalog): TestingBlockInstance[] {
  const current = currentTestingDefinition(catalog, block.definition);
  const body = current?.body ?? [];
  if (!block.children) return body;
  const referenced = catalog.definitions.find(definition => testingVersionKey(definition) === testingVersionKey(block.definition));
  if (!referenced?.body || referenced.version === current?.version || sameTestingValue(referenced.body, body)) return block.children;
  if (sameTestingValue(block.children,referenced.body)) return body;
  const oldById = new Map(referenced.body.map(child => [child.id, child]));
  const localById = new Map(block.children.map(child => [child.id, child]));
  const remoteById = new Map(body.map(child => [child.id, child]));
  const mergeMap = <T>(oldValue: Record<string,T>|undefined, localValue: Record<string,T>|undefined, remoteValue: Record<string,T>|undefined) => {
    const merged = structuredClone(remoteValue ?? {}); let changed = false;
    for (const key of new Set([...Object.keys(oldValue ?? {}), ...Object.keys(localValue ?? {})])) {
      if (sameTestingValue(oldValue?.[key], localValue?.[key])) continue;
      changed = true;
      if (localValue && Object.hasOwn(localValue,key)) merged[key]=structuredClone(localValue[key]); else delete merged[key];
    }
    return changed || Object.keys(merged).length ? merged : undefined;
  };
  const mergeChild = (old: TestingBlockInstance, local: TestingBlockInstance, remote: TestingBlockInstance): TestingBlockInstance => {
    const merged = structuredClone(remote);
    if (!sameTestingValue(old.definition,local.definition)) merged.definition=structuredClone(local.definition);
    merged.inputs=mergeMap(old.inputs,local.inputs,remote.inputs) ?? {};
    for (const field of ['outputs','overrides'] as const) {
      const value=mergeMap(old[field] as Record<string,unknown>|undefined,local[field] as Record<string,unknown>|undefined,remote[field] as Record<string,unknown>|undefined) as never;
      if(value)(merged as any)[field]=value;else delete (merged as any)[field];
    }
    for (const field of ['label','note','children'] as const) if(!sameTestingValue(old[field],local[field])) {
      if(local[field]!==undefined)(merged as any)[field]=structuredClone(local[field]);else delete (merged as any)[field];
    }
    return merged;
  };
  const baseOrder=referenced.body.map(child=>child.id),localOrder=block.children.map(child=>child.id);
  const structureChanged=!sameTestingValue(baseOrder,localOrder);
  if(!structureChanged)return body.flatMap(remote=>{
    const local=localById.get(remote.id),old=oldById.get(remote.id);
    return [local&&old?mergeChild(old,local,remote):structuredClone(remote)];
  });
  // Begin with the user's relative order. Deleted base children remain deleted;
  // locally changed children removed upstream survive as intentional local steps.
  const reconciled = block.children.flatMap(local => {
    const old=oldById.get(local.id),remote=remoteById.get(local.id);
    if(remote)return [old?mergeChild(old,local,remote):structuredClone(local)];
    return !old||!sameTestingValue(old,local)?[structuredClone(local)]:[];
  });
  // Insert new shared children next to their nearest shared neighbour without
  // undoing an intentional local reorder.
  for(const remote of body)if(!localById.has(remote.id)&&!oldById.has(remote.id)) {
    const remoteIndex=body.findIndex(child=>child.id===remote.id);
    const next=body.slice(remoteIndex+1).find(child=>reconciled.some(item=>item.id===child.id));
    const previous=[...body.slice(0,remoteIndex)].reverse().find(child=>reconciled.some(item=>item.id===child.id));
    const index=next?reconciled.findIndex(item=>item.id===next.id):previous?reconciled.findIndex(item=>item.id===previous.id)+1:reconciled.length;
    reconciled.splice(index,0,structuredClone(remote));
  }
  return reconciled;
}
export function isTestingReference(value: unknown): value is TestingReference {
  return !!value && typeof value === 'object' && !Array.isArray(value) && typeof (value as TestingReference).ref === 'string';
}
export function isTestingParameter(value: unknown): value is TestingParameter {
  return !!value && typeof value === 'object' && !Array.isArray(value) && typeof (value as TestingParameter).param === 'string';
}
export function createTestingInstance(definition: TestingBlockDefinition, id = `block-${globalThis.crypto.randomUUID()}`): TestingBlockInstance {
  return { id, definition: { id: definition.id, version: definition.version },
    inputs: {},
    outputs: Object.fromEntries(definition.outputs.map(output => [output.key, `${id}.${output.key}`])),
    ...(definition.kind === 'context' ? { children: [] } : {}) };
}

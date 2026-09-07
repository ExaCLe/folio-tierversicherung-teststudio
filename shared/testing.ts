/** Fachlicher Vertrag. Darstellung und technische Ausführung sind eigene Datensätze. */
export type TestingModel = 'luna' | 'sol';
export type TestingVersion = string;
export interface TestingVersionRef { id: string; version: TestingVersion }
export type TestingValueType = 'text' | 'number' | 'money' | 'boolean' | 'date' | 'choice' | 'object' | 'list' | 'customer-ref' | 'farm-ref' | 'animal-ref' | 'proposal-ref' | 'referral-ref' | 'contract-ref' | 'policy-ref' | 'document-ref';
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
export interface TestingScenario {
  id: string; title: string; intent: string; revision: number; blocks: TestingBlockInstance[];
  expectedOutcome: string; knowledgeRefs: string[]; createdAt: string; updatedAt: string;
  source: 'human' | 'agent' | 'seed'; model?: TestingModel; parameters?: Record<string, TestingValue>;
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
  code: string; message: string; severity: 'error' | 'warning'; instanceId?: string; path?: string; field?: string;
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
export type TestingAgentPhase = 'business' | 'technical' | 'duplicates' | 'reuse';
export interface TestingAgentEvent { id: string; at: string; kind: 'status' | 'message' | 'tool' | 'error'; message: string }
export interface TestingAgentJob {
  id: string; phase: TestingAgentPhase; model: TestingModel; status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  prompt: string; scenarioId?: string; scenarioRevision?: number; fingerprint?: string;
  startedAt: string; finishedAt?: string; events: TestingAgentEvent[]; error?: string;
  result?: unknown; artifactDirectory?: string;
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
}
export interface TestingBusinessDraft {
  title: string; expectedOutcome: string; blocks: TestingBlockInstance[]; knowledgeRefs: string[];
  newDefinitions: TestingBlockDefinition[]; newKnowledge: TestingKnowledgeDocument[];
  explanation: string; assumptions: string[]; openQuestions: string[];
}
export interface TestingTechnicalPlan {
  scenarioId: string; fingerprint: string; bindings: TestingTechnicalBinding[];
  duplicateReports: TestingDuplicateReport[]; explanation: string; unsupported: string[];
}
export interface TestingPromotionRequest {
  scenarioId: string; expectedRevision: number; instanceIds: string[]; parentPath?: string; name: string; description: string;
  parameters: { key: string; label: string; instanceId: string; input: string }[]; replaceSelection?: boolean;
}
export interface TestingPromotionResult { definition: TestingBlockDefinition; scenario: TestingScenario; duplicateReport: TestingDuplicateReport }

export function testingVersionKey(ref: TestingVersionRef): string { return `${ref.id}@${ref.version}`; }
export function isTestingReference(value: unknown): value is TestingReference {
  return !!value && typeof value === 'object' && !Array.isArray(value) && typeof (value as TestingReference).ref === 'string';
}
export function isTestingParameter(value: unknown): value is TestingParameter {
  return !!value && typeof value === 'object' && !Array.isArray(value) && typeof (value as TestingParameter).param === 'string';
}
export function createTestingInstance(definition: TestingBlockDefinition, id = `block-${globalThis.crypto.randomUUID()}`): TestingBlockInstance {
  return { id, definition: { id: definition.id, version: definition.version },
    inputs: Object.fromEntries(definition.inputs.filter(input => input.default !== undefined).map(input => [input.key, structuredClone(input.default!)])),
    outputs: Object.fromEntries(definition.outputs.map(output => [output.key, `${id}.${output.key}`])),
    ...(definition.kind === 'context' ? { children: [] } : {}) };
}

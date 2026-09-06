import type { Customer, PolicyDraftInput, Role } from './insurance';
/** Canonical business records. Editor coordinates never determine execution. */
export type BlockKind = 'action' | 'modifier' | 'free-text' | 'context' | 'workflow' | 'verification';
export type ActorRole = Role;
export type ValueType = 'String' | 'Number' | 'Boolean' | 'Country' | 'Money' | 'Date' | 'Role' | 'LocationName' | 'PolicyTemplateRef' | 'CustomerFixtureRef' | 'DocumentFixtureRef' | 'PolicyRef' | 'LocationRef' | 'QuoteRef' | 'ApprovalRef' | 'AttemptRef' | 'Object';
export interface VersionRef { id: string; version: number }
export interface EntityReference { ref: string; type?: ValueType }
export interface ParameterReference { param: string }
export type BlockValue = string | number | boolean | null | EntityReference | ParameterReference | { [key: string]: BlockValue } | BlockValue[];
export interface InputDefinition { key: string; label: string; type: ValueType; required?: boolean; default?: BlockValue; options?: { value: string; label: string }[]; description?: string }
export interface OutputDefinition { key: string; label: string; type: ValueType }
export interface WorkflowParameter extends InputDefinition { source?: { instanceId: string; input: string } }
export interface BlockDefinition {
  id: string; version: number; kind: BlockKind; label: string; description: string;
  category: string; inputs: InputDefinition[]; outputs: OutputDefinition[];
  knowledgeRefs: string[]; implementationRef?: string; operation?: string;
  contextType?: 'actor' | 'location'; allowedRoles?: ActorRole[];
  acceptsChanges?: boolean; readiness: 'ready' | 'missing'; owner: string;
  body?: BlockInstance[]; exports?: Record<string, EntityReference>;
  completion?: string; createdAt?: string;
}
export interface BlockInstance {
  id: string; definition: VersionRef; inputs: Record<string, BlockValue>;
  outputs?: Record<string, string>; children?: BlockInstance[]; changes?: BlockInstance[];
  resolutionId?: string; label?: string;
}
export interface Scenario {
  id: string; name: string; description: string; revision: number;
  createdAt: string; updatedAt: string; tags: string[]; blocks: BlockInstance[];
  expectedOutcome?: string; parameters?: Record<string, BlockValue>;
}
export interface ScenarioLayout { id: string; scenarioId: string; scenarioRevision: number; collapsed: string[]; positions?: Record<string, { x: number; y: number }>; viewport?: { x: number; y: number; zoom: number }; selectedId?: string }
export interface PolicyConfiguration extends Omit<PolicyDraftInput, 'customerId' | 'source' | 'runId'> {
  customer: Omit<Customer, 'id' | 'createdAt' | 'source' | 'runId'>;
}
export interface PolicyTemplate { id: string; version: number; label: string; description: string; dateRule: string; configuration: PolicyConfiguration; knowledgeRefs: string[] }
export interface ImplementationManifest { id: string; revision: number; operation: string; module: string; export: string; supportedDefinitions: VersionRef[]; status: 'ready' | 'missing' }
export interface KnowledgeDocument { id: string; title: string; kind: 'concept' | 'rule' | 'workflow' | 'application' | 'fixture'; owner: string; appliesTo: string; revision: string; summary: string; content: string; links: { relation: string; target: string }[]; path: string }
export interface StudioCatalog { revision: string; definitions: BlockDefinition[]; templates: PolicyTemplate[]; implementations: ImplementationManifest[]; knowledge: KnowledgeDocument[]; roles: { value: ActorRole; label: string; name: string }[] }
export interface ResolvedChange { field: string; value: BlockValue; previousValue: BlockValue; label: string }
export interface TextResolution {
  id: string; instanceId: string; originalText: string; scope: { entityType: 'insured_location'; location: string };
  template: VersionRef; fingerprint: string; parser: 'local-vocabulary-v1'; knowledgeRevision: string;
  changes: ResolvedChange[]; preserved: { field: string; value: BlockValue; label: string }[];
  status: 'preview' | 'confirmed'; createdAt: string; confirmedAt?: string; decisionId?: string;
  source?: 'seeded-demo' | 'author';
}
export interface ValidationIssue { code: string; message: string; severity: 'error' | 'warning'; instanceId?: string; field?: string }
export interface ResolvedConfiguration { instanceId: string; template: VersionRef; defaults: PolicyConfiguration; configuration: PolicyConfiguration; changes: ResolvedChange[]; referralLocations: string[] }
export interface ValidationResult { valid: boolean; issues: ValidationIssue[]; resolvedConfigurations: ResolvedConfiguration[]; stepCount: number; dependencyCount: number }
export interface CompiledStep {
  id: string; instanceId: string; definition: VersionRef; label: string; kind: 'action' | 'verification'; operation: string;
  actor: ActorRole; inputs: Record<string, BlockValue>; outputs: Record<string, string>; ancestors: string[];
  implementationRef: string;
}
export interface CompiledScenario {
  id: string; scenario: Scenario; scenarioRevision: number; compiledAt: string; fingerprint: string;
  catalogRevision: string; implementationRevision: string; appBuild: string; steps: CompiledStep[];
  blockVersions: VersionRef[]; templateVersions: VersionRef[]; resolutionIds: string[];
  resolvedConfigurations: ResolvedConfiguration[]; generatedSource: string; validation: ValidationResult;
}
export interface RunStepEvent {
  id: string; instanceId: string; label: string; operation: string; actor: ActorRole;
  status: 'running' | 'passed' | 'failed' | 'skipped'; startedAt: string; finishedAt?: string;
  durationMs?: number; error?: string; screenshot?: string; screenshots?: string[];
  objectIds?: Record<string, string>; details?: Record<string, unknown>;
}
export interface RunRecord {
  id: string; scenarioId: string; scenarioName: string; scenarioRevision: number;
  status: 'queued' | 'running' | 'passed' | 'failed'; startedAt: string; finishedAt?: string; durationMs?: number;
  compiled: CompiledScenario; events: RunStepEvent[]; objectIds: Record<string, string>;
  error?: string; artifactDirectory?: string; trace?: string; video?: string; browser?: string;
  implementationEvidence?: { driverSha256: string; source: string; manifest: string };
}
export interface GraphNode { id: string; kind: 'scenario' | 'instance' | 'definition' | 'implementation' | 'knowledge' | 'template' | 'resolution' | 'run'; label: string; description?: string; data: unknown }
export interface GraphEdge { id: string; source: string; target: string; relation: string }
export interface DependencyGraph { nodes: GraphNode[]; edges: GraphEdge[] }
export interface PromotionRequest { scenarioId: string; instanceIds: string[]; name: string; description?: string; parameters: { key: string; label: string; instanceId: string; input: string; type?: ValueType }[]; replaceSelection?: boolean }
export interface PromotionResult { definition: BlockDefinition; scenario: Scenario; dependents: { scenarioId: string; scenarioName: string; revision: number }[] }

export function versionKey(ref: VersionRef): string { return `${ref.id}@${ref.version}`; }
export function isEntityReference(value: unknown): value is EntityReference { return !!value && typeof value === 'object' && !Array.isArray(value) && typeof (value as EntityReference).ref === 'string'; }
export function isParameterReference(value: unknown): value is ParameterReference { return !!value && typeof value === 'object' && !Array.isArray(value) && typeof (value as ParameterReference).param === 'string'; }
export function makeBlockInstance(definition: BlockDefinition, id = `block-${globalThis.crypto.randomUUID()}`): BlockInstance {
  return { id, definition: { id: definition.id, version: definition.version }, inputs: Object.fromEntries(definition.inputs.filter(input => input.default !== undefined).map(input => [input.key, structuredClone(input.default!)])), ...(definition.outputs.length ? { outputs: Object.fromEntries(definition.outputs.map(output => [output.key, `${output.key}_${id.slice(-6)}`])) } : {}), ...(definition.contextType === 'actor' ? { children: [] } : {}), ...(definition.contextType === 'location' || definition.acceptsChanges ? { changes: [] } : {}) };
}

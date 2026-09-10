import type { TestingAgentJob, TestingAgentPublicDetail, TestingAgentStage, TestingBlockDefinition, TestingKnowledgeDocument, TestingModel, TestingRun, TestingScenario, TestingScenarioLifecycle } from './testing';

export type TestingChatCommand = 'message'|'explore'|'resume'|'answer'|'revise'|'save'|'apply'|'reject'|'approve'|'prepare'|'run'|'cancel';
export type TestingChatEntryKind = 'user'|'user_action'|'agent_summary'|'question'|'status'|'change'|'approval'|'evidence'|'error';

export interface TestingChatEntry {
  id:string; at:string; kind:TestingChatEntryKind; message:string;
  jobId?:string; scenarioRevision?:number; runId?:string;
  context?:{jobId:string;phase:TestingAgentJob['phase'];taskLabel:string;modelId:string;modelLabel?:string;provider?:'codex'|'claude';stage?:TestingAgentStage};
  sources?:{label:string;kind:'knowledge'|'scenario'|'definition'|'portal-evidence';ref:string}[];
  content?:{type:'validated-summary';title:string;summary:string;facts?:{label:string;value:string}[]};
  detail?:TestingAgentPublicDetail;
  delivery?:{state:'routing'|'replanning'|'applied'|'rejected';targetLabel?:string;successorJobId?:string;detail?:string};
}
export interface TestingChatConversation {
  id:string; revision:number; eventSequence:number; createdAt:string; updatedAt:string; model:TestingModel;
  scenarioId?:string; activeJobId?:string; entryIds:string[];
  handledRequests?:{id:string;revision:number}[];
  /** Root jobs started by this conversation. Used to keep unrelated historical scenario jobs out. */
  jobIds?:string[];
}
export interface TestingChatQuestion {
  id:string; jobId:string; kind:'clarification'; text:string; why:string; status:'open'|'answered';
  answer?:string; answeredAt?:string;
}
export interface TestingChatTask {
  id:string; parentJobId?:string; waitingForJobId?:string; blockedByJobId?:string; purpose:string;
  agent:{name:string;modelId:string;provider?:'codex'|'claude';color:string};
  status:'not_started'|'queued'|'running'|'completed'|'failed'|'blocked'|'cancelled'; stage?:TestingAgentStage;
  activityState:'not_started'|'working'|'waiting'|'attention'|'done'|'failed'|'blocked'|'cancelled';
  startedAt:string; executionAt?:string; finishedAt?:string;
  /** detail is absent only on snapshots persisted by older versions. */
  publicDetails:{id:string;at:string;kind:'progress'|'result'|'error';message:string;detail?:TestingAgentPublicDetail;sources?:TestingChatEntry['sources'];context?:TestingChatEntry['context']}[];
}
export interface TestingChatProposal {
  jobId:string; fingerprint:string; expectedRevision:number; scenario:TestingScenario;
  changes:{kind:string;path:string;label:string;before?:unknown;after?:unknown}[];
}
export interface TestingChatSnapshot {
  conversation:TestingChatConversation; timeline:TestingChatEntry[];
  tasks:TestingChatTask[]; questions:TestingChatQuestion[];
  scenario?:TestingScenario; proposed?:TestingChatProposal; lifecycle?:TestingScenarioLifecycle;
  activeJob?:Pick<TestingAgentJob,'id'|'phase'|'status'|'stage'|'startedAt'|'finishedAt'|'error'|'progress'|'workStages'|'runId'>;
  latestRun?:Pick<TestingRun,'id'|'status'|'startedAt'|'finishedAt'|'error'|'steps'|'artifacts'|'summary'|'matrixRows'|'scenarioRevision'> & {fingerprint?:string;isCurrent?:boolean};
  allowedCommands:TestingChatCommand[];
  scenarioState?:{revision:number;fingerprint:string};
  technicalReview?:{jobId:string;issues:unknown[];needsBusinessReview:boolean};
  confirmedFlow:{scenarioRevision:number;blocks:TestingScenario['blocks']}|null;
  validatedFlowPreview?:{jobId:string;scenarioRevision:number;title:string;expectedOutcome:string;blocks:TestingScenario['blocks'];knowledgeRefs:string[];newDefinitions?:TestingBlockDefinition[];newKnowledge?:TestingKnowledgeDocument[];status:'ready'|'provisional';readonly:true};
  runningStage?:TestingAgentStage;
}
export interface TestingChatCommandRequest { command:TestingChatCommand; expectedRevision:number; payload?:Record<string,unknown> }
export type TestingChatStreamEvent =
  | {type:'snapshot';sequence:number;revision:number;snapshot:TestingChatSnapshot}
  | {type:'entry';sequence:number;revision:number;entry:TestingChatEntry}
  | {type:'state';sequence:number;revision:number};

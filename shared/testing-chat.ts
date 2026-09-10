import type { TestingAgentJob, TestingAgentStage, TestingModel, TestingRun, TestingScenario, TestingScenarioLifecycle } from './testing';

export type TestingChatCommand = 'message'|'explore'|'resume'|'revise'|'save'|'apply'|'reject'|'approve'|'prepare'|'run'|'cancel';
export type TestingChatEntryKind = 'user'|'agent_summary'|'question'|'status'|'change'|'approval'|'evidence'|'error';

export interface TestingChatEntry {
  id:string; at:string; kind:TestingChatEntryKind; message:string;
  jobId?:string; scenarioRevision?:number; runId?:string;
}
export interface TestingChatConversation {
  id:string; revision:number; eventSequence:number; createdAt:string; updatedAt:string; model:TestingModel;
  scenarioId?:string; activeJobId?:string; entryIds:string[];
  handledRequests?:{id:string;revision:number}[];
}
export interface TestingChatProposal {
  jobId:string; fingerprint:string; expectedRevision:number; scenario:TestingScenario;
  changes:{kind:string;path:string;label:string;before?:unknown;after?:unknown}[];
}
export interface TestingChatSnapshot {
  conversation:TestingChatConversation; timeline:TestingChatEntry[];
  scenario?:TestingScenario; proposed?:TestingChatProposal; lifecycle?:TestingScenarioLifecycle;
  activeJob?:Pick<TestingAgentJob,'id'|'phase'|'status'|'stage'|'startedAt'|'finishedAt'|'error'|'progress'|'workStages'|'runId'>;
  latestRun?:Pick<TestingRun,'id'|'status'|'startedAt'|'finishedAt'|'error'|'steps'|'artifacts'|'summary'|'matrixRows'|'scenarioRevision'> & {fingerprint?:string;isCurrent?:boolean};
  allowedCommands:TestingChatCommand[];
  scenarioState?:{revision:number;fingerprint:string};
  technicalReview?:{jobId:string;issues:unknown[];needsBusinessReview:boolean};
  confirmedFlow:{scenarioRevision:number;blocks:TestingScenario['blocks']}|null;
  runningStage?:TestingAgentStage;
}
export interface TestingChatCommandRequest { command:TestingChatCommand; expectedRevision:number; payload?:Record<string,unknown> }
export type TestingChatStreamEvent =
  | {type:'snapshot';sequence:number;revision:number;snapshot:TestingChatSnapshot}
  | {type:'entry';sequence:number;revision:number;entry:TestingChatEntry}
  | {type:'state';sequence:number;revision:number};

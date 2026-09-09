import type { TestingAgentStage, TestingAgentWorkStage } from './testing';

export function normalizeTestingWorkStages(stages: TestingAgentWorkStage[]): TestingAgentWorkStage[] {
  const attempts = new Map<TestingAgentStage, number>();
  return stages.map(stage => {
    const previous = attempts.get(stage.stage) ?? 0;
    const attempt = stage.attempt && stage.attempt > previous ? stage.attempt : previous + 1;
    attempts.set(stage.stage, attempt);
    return stage.attempt === attempt ? stage : { ...stage, attempt };
  });
}

export function transitionTestingWorkStages(input: {
  stages: TestingAgentWorkStage[];
  currentStage?: TestingAgentStage;
  nextStage?: TestingAgentStage;
  terminalStatus?: 'completed' | 'failed';
  at: string;
}): TestingAgentWorkStage[] {
  let stages = normalizeTestingWorkStages(input.stages);
  if (input.nextStage && input.nextStage !== input.currentStage) {
    stages = finishRunningStages(stages, 'completed', input.at);
    const attempt = stages.reduce((highest, stage) => stage.stage === input.nextStage ? Math.max(highest, stage.attempt ?? 1) : highest, 0) + 1;
    stages = [...stages, { stage: input.nextStage, attempt, status: 'running', startedAt: input.at }];
  }
  if (input.terminalStatus) stages = finishRunningStages(stages, input.terminalStatus, input.at);
  return stages;
}

function finishRunningStages(stages: TestingAgentWorkStage[], status: 'completed' | 'failed', at: string): TestingAgentWorkStage[] {
  return stages.map(stage => stage.status === 'running' ? { ...stage, status, finishedAt: stage.finishedAt ?? at } : stage);
}

import type { TestingAgentTermination } from '../../../shared/testing';

/** AbortSignal only says that work stopped. Its explicit reason records who or
 * what stopped it; an unspecified abort must never be attributed to a person. */
export class AgentTerminationError extends Error {
  readonly termination:TestingAgentTermination;
  constructor(cause:TestingAgentTermination['cause'],message:string,limitMs?:number) {
    super(message);this.name='AgentTerminationError';
    this.termination={cause,message,at:new Date().toISOString(),...(limitMs===undefined?{}:{limitMs})};
  }
}
export function agentAbortError(signal?:AbortSignal,fallback='Der Agentenlauf wurde abgebrochen. Der Auslöser ist nicht bekannt.'):AgentTerminationError {
  if(signal?.reason instanceof AgentTerminationError)return signal.reason;
  if(signal?.reason?.name==='TimeoutError')return new AgentTerminationError('time_limit','Der Agentenlauf hat sein Zeitlimit erreicht.');
  return new AgentTerminationError('interrupted',fallback);
}
export function agentTermination(error:unknown):TestingAgentTermination|undefined {
  return error instanceof AgentTerminationError?error.termination:undefined;
}

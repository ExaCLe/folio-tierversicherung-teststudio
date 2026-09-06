import { createHash, randomUUID } from 'node:crypto';
import { test, expect, type APIRequestContext } from '@playwright/test';
import type { BlockInstance, RunRecord, Scenario, StudioCatalog } from '../shared/blocks';
import type { Policy } from '../shared/insurance';
import { api } from './helpers/api';

async function execute(request: APIRequestContext, scenarioId: string): Promise<RunRecord> {
  const response = await request.post('/api/studio/runs', { data: { scenarioId } });
  expect(response.status()).toBe(202);
  const queued = await response.json() as RunRecord;
  expect(queued.scenarioId).toBe(scenarioId);
  let result = queued;
  await expect.poll(async () => {
    result = await api<RunRecord>(request, 'GET', `/api/studio/runs/${queued.id}`);
    return result.status;
  }, { timeout: 90_000, intervals: [100, 250, 500, 1000] }).toMatch(/^(passed|failed)$/);
  return result;
}

async function passedEvidence(request: APIRequestContext, run: RunRecord) {
  expect(run.status, run.error).toBe('passed');
  expect(run.events).toHaveLength(run.compiled.steps.length);
  expect(run.events.every(event => event.status === 'passed')).toBe(true);
  expect(run.events.every(event => event.screenshot && event.durationMs !== undefined)).toBe(true);
  expect(run.events.map(event => event.instanceId)).toEqual(run.compiled.steps.map(step => step.instanceId));
  expect(run.trace).toBeTruthy();
  const trace = await request.get(run.trace!);
  expect(trace.status()).toBe(200);
  expect((await trace.body()).byteLength).toBeGreaterThan(1000);
  const shot = await request.get(run.events[0].screenshot!);
  expect(shot.status()).toBe(200);
  expect(shot.headers()['content-type']).toContain('image/png');
  const source = await request.get(`/api/studio/runs/${run.id}/source`);
  expect(source.status()).toBe(200);
  expect(await source.text()).toBe(run.compiled.generatedSource);
  expect(run.implementationEvidence?.driverSha256).toMatch(/^[a-f0-9]{64}$/);
  const driver = await request.get(run.implementationEvidence!.source);
  expect(driver.status()).toBe(200);
  expect(createHash('sha256').update(await driver.text()).digest('hex')).toBe(run.implementationEvidence!.driverSha256);
  return run;
}

test('Studio runs the saved Italian referral through Chromium and maps every block to actual policy evidence', async ({ request }) => {
  const run = await passedEvidence(request, await execute(request, 'italy-referral'));
  expect(run.objectIds.policy).toBe(run.objectIds.issuedPolicy);
  expect(run.objectIds.quote).toBe(run.objectIds.approvedQuote);
  const { policy } = await api<{ policy: Policy }>(request, 'GET', `/api/insurance/policies/${run.objectIds.policy}`);
  expect(policy.runId).toBe(run.id);
  expect(policy.status).toBe('Issued');
  expect(policy.documents.some(document => document.type === 'Risk survey' && document.locationId === 'warehouse' && document.suitable)).toBe(true);
  expect(run.compiled.resolutionIds.length).toBeGreaterThan(0);
  expect(run.events.find(event => event.operation === 'createDraft')?.details?.createdDraft).toMatchObject({ id: policy.id, status: 'Draft', quoteId: null });
});

test('the amendment scenario invokes its own versioned workflow and preserves the issued policy reference', async ({ request }) => {
  const run = await passedEvidence(request, await execute(request, 'mid-term-amendment'));
  const { policy } = await api<{ policy: Policy }>(request, 'GET', `/api/insurance/policies/${run.objectIds.amendedPolicy}`);
  expect(policy.runId).toBe(run.id);
  expect(policy.version).toBe(2);
  expect(policy.amendments).toHaveLength(1);
  expect(run.objectIds.amendedPolicy).toBe(run.objectIds.issuedPolicy);
  expect(run.events.some(event => event.operation === 'amendPolicy' && event.actor === 'Senior underwriter')).toBe(true);
  expect(run.compiled.blockVersions).toContainEqual({ id: 'workflow.issue-referred', version: 1 });
});

test('intentional negative approval verifies the real UI guard and unchanged quote', async ({ request }) => {
  const run = await passedEvidence(request, await execute(request, 'broker-approval-denied'));
  const attempt = run.events.find(event => event.operation === 'attemptBrokerApproval')!.details!.attempt as { mechanism: string; denied: boolean; status?: number };
  expect(attempt.denied).toBe(true);
  expect(attempt.mechanism).toBe('disabled-role-control');
  expect(attempt.status).toBeUndefined();
  const { policy } = await api<{ policy: Policy }>(request, 'GET', `/api/insurance/policies/${run.objectIds.policy}`);
  expect(policy.status).toBe('Referred');
});

test('two uses of one workflow create distinct policies with exact references across role switches', async ({ request }) => {
  const catalog = await api<StudioCatalog>(request, 'GET', '/api/studio/catalog');
  const workflow = catalog.definitions.find(definition => definition.id === 'workflow.issue-referred' && definition.version === 1)!;
  const instance = (id: string, country: 'IT' | 'DE', floodLimit: number): BlockInstance => ({ id, definition: { id: workflow.id, version: 1 }, inputs: { country, floodLimit, sumInsured: 1_500_000, survey: 'approved-synthetic-survey@1' }, outputs: Object.fromEntries(workflow.outputs.map(output => [output.key, `${id}.${output.key}`])) });
  const scenario = await api<Scenario>(request, 'POST', '/api/studio/scenarios', { name: `QA two browser policies ${randomUUID().slice(0, 8)}`, blocks: [instance('first', 'IT', 600_000), instance('second', 'DE', 750_000)] });
  const run = await passedEvidence(request, await execute(request, scenario.id));
  expect(run.objectIds['first.issuedPolicy']).not.toBe(run.objectIds['second.issuedPolicy']);
  expect(run.objectIds['first.warehouse']).toBe(`${run.objectIds['first.issuedPolicy']}/warehouse`);
  expect(run.objectIds['second.warehouse']).toBe(`${run.objectIds['second.issuedPolicy']}/warehouse`);
  const first = await api<{ policy: Policy }>(request, 'GET', `/api/insurance/policies/${run.objectIds['first.issuedPolicy']}`);
  const second = await api<{ policy: Policy }>(request, 'GET', `/api/insurance/policies/${run.objectIds['second.issuedPolicy']}`);
  expect(first.policy.locations.find(location => location.id === 'warehouse')!.country).toBe('IT');
  expect(second.policy.locations.find(location => location.id === 'warehouse')!.country).toBe('DE');
  expect(first.policy.quoteId).not.toBe(second.policy.quoteId);
});

test('a real verification failure records its screenshot and skips dependent blocks', async ({ request }) => {
  const scenario = await api<Scenario>(request, 'POST', '/api/studio/scenarios/standard-draft/duplicate', { name: `QA expected failure ${randomUUID().slice(0, 8)}` });
  const children = scenario.blocks[0].children!;
  children[1].inputs.version = 2;
  children.push({ ...structuredClone(children[1]), id: 'must-be-skipped', inputs: { ...children[1].inputs, version: 1 } });
  const saved = await api<Scenario>(request, 'PUT', `/api/studio/scenarios/${scenario.id}`, scenario);
  const run = await execute(request, saved.id);
  expect(run.status).toBe('failed');
  expect(run.events.map(event => event.status)).toEqual(['passed', 'failed', 'skipped']);
  expect(run.events[1].error).toMatch(/Expected|expected/);
  expect(run.events[1].screenshot).toBeTruthy();
  expect(run.events[2].screenshot).toBeUndefined();
  expect(run.objectIds.policy).toBeTruthy();
  expect(run.trace).toBeTruthy();
  expect((await request.get(run.events[1].screenshot!)).status()).toBe(200);
});

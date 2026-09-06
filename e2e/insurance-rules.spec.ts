import { randomUUID } from 'node:crypto';
import { test, expect, type APIRequestContext } from '@playwright/test';
import { createStandardDraft, ITALIAN_WAREHOUSE_ADDRESS, type Policy, type Quote } from '../shared/insurance';
import { api, apiError } from './helpers/api';

async function create(request: APIRequestContext, floodLimit = 0, bothLocations = false) {
  const draft = createStandardDraft();
  draft.source = 'run';
  draft.runId = `api-test-${randomUUID()}`;
  const warehouse = draft.locations.find(location => location.id === 'warehouse')!;
  warehouse.country = 'IT';
  warehouse.address = { ...ITALIAN_WAREHOUSE_ADDRESS };
  for (const location of draft.locations.filter(location => bothLocations || location.id === 'warehouse')) {
    if (floodLimit) location.coverages.push({ type: 'Flood', limit: floodLimit, deductible: 5000 });
  }
  const { policy } = await api<{ policy: Policy }>(request, 'POST', '/api/insurance/policies', draft);
  return policy;
}

const quote = (request: APIRequestContext, id: string) => api<{ policy: Policy; quote: Quote }>(request, 'POST', `/api/insurance/policies/${id}/quote`, {});
const survey = (request: APIRequestContext, id: string, locationId = 'warehouse', suitable = true) => api(request, 'POST', `/api/insurance/policies/${id}/documents`, { type: 'Risk survey', locationId, name: 'Synthetic survey for automated rule check', suitable }, 'Senior underwriter');

test('flood authority is strictly above EUR 500,000 and applies per location', async ({ request }) => {
  const within = await create(request, 500_000, true);
  expect(within.status).toBe('Draft');
  expect(within.quoteId).toBeNull();
  const automatic = await quote(request, within.id);
  expect(automatic.quote.status).toBe('Quoted');
  expect(automatic.quote.referrals).toEqual([]);

  const above = await create(request, 500_001);
  const referred = await quote(request, above.id);
  expect(referred.quote.status).toBe('Referred');
  expect(referred.quote.referrals).toMatchObject([{ locationId: 'warehouse', code: 'FLOOD_AUTHORITY', threshold: 500_000, floodLimit: 500_001 }]);
  expect(referred.policy.locations.find(location => location.id === 'factory')!.country).toBe('DE');
  expect(referred.policy.issuingMarket).toBe('DE');
});

test('referral approval enforces role, suitable location evidence, and the exact quote', async ({ request }) => {
  const policy = await create(request, 1_000_000);
  const { quote: referred } = await quote(request, policy.id);
  const approval = { policyId: policy.id, notes: 'Approval rule acceptance test' };
  await apiError(request, 'POST', `/api/insurance/quotes/${referred.id}/approve`, approval, 403, 'ROLE_REQUIRED');
  await apiError(request, 'POST', `/api/insurance/quotes/${referred.id}/approve`, approval, 409, 'SURVEY_REQUIRED', 'Senior underwriter');
  await survey(request, policy.id, 'factory');
  await survey(request, policy.id, 'warehouse', false);
  await apiError(request, 'POST', `/api/insurance/quotes/${referred.id}/approve`, approval, 409, 'SURVEY_REQUIRED', 'Senior underwriter');
  const other = await create(request, 1_000_000);
  await apiError(request, 'POST', `/api/insurance/quotes/${referred.id}/approve`, { ...approval, policyId: other.id }, 409, 'QUOTE_POLICY_MISMATCH', 'Senior underwriter');
  await survey(request, policy.id);
  const approved = await api<{ policy: Policy; quote: Quote }>(request, 'POST', `/api/insurance/quotes/${referred.id}/approve`, approval, 'Senior underwriter');
  expect(approved.quote.id).toBe(referred.id);
  expect(approved.quote.status).toBe('Approved');
  expect(approved.quote.approvedBy).toBe('Senior underwriter');
});

test('draft edits invalidate previous quote terms and invalid transitions remain blocked', async ({ request }) => {
  const policy = await create(request, 1_000_000);
  const first = await quote(request, policy.id);
  await apiError(request, 'POST', `/api/insurance/policies/${policy.id}/issue`, { quoteId: first.quote.id }, 409, 'QUOTE_NOT_BINDABLE');
  const edited = await api<{ policy: Policy }>(request, 'PATCH', `/api/insurance/policies/${policy.id}`, { billing: { frequency: 'Quarterly', method: 'Invoice' } });
  expect(edited.policy.status).toBe('Draft');
  expect(edited.policy.quoteId).toBeNull();
  expect(edited.policy.premium).toBeNull();
  expect(edited.policy.revision).toBe(policy.revision + 1);
  await apiError(request, 'POST', `/api/insurance/quotes/${first.quote.id}/approve`, { policyId: policy.id, notes: 'Stale quote must fail' }, 409, 'STALE_QUOTE', 'Senior underwriter');
  const historical = await api<{ quote: Quote }>(request, 'GET', `/api/insurance/quotes/${first.quote.id}`);
  expect(historical.quote.status).toBe('Superseded');
  const second = await quote(request, policy.id);
  expect(second.quote.id).not.toBe(first.quote.id);
});

test('issued policy amendments preserve version history and enforce new exposure authority', async ({ request }) => {
  const policy = await create(request, 1_000_000);
  const { quote: referred } = await quote(request, policy.id);
  await survey(request, policy.id);
  await api(request, 'POST', `/api/insurance/quotes/${referred.id}/approve`, { policyId: policy.id, notes: 'Survey accepted' }, 'Senior underwriter');
  const issued = await api<{ policy: Policy }>(request, 'POST', `/api/insurance/policies/${policy.id}/issue`, { quoteId: referred.id });
  await apiError(request, 'PATCH', `/api/insurance/policies/${policy.id}`, { billing: { frequency: 'Quarterly', method: 'Invoice' } }, 409, 'AMENDMENT_REQUIRED');
  await apiError(request, 'POST', `/api/insurance/policies/${policy.id}/quote`, {}, 409, 'ALREADY_ISSUED');
  const locations = structuredClone(issued.policy.locations);
  locations.find(location => location.id === 'warehouse')!.sumInsured = 2_000_000;
  const amendment = { effectiveDate: policy.inceptionDate, reason: 'Updated warehouse declared value', changes: { locations } };
  await apiError(request, 'POST', `/api/insurance/policies/${policy.id}/amendments`, { ...amendment, effectiveDate: '2000-01-01' }, 400, 'EFFECTIVE_DATE_OUTSIDE_TERM', 'Senior underwriter');
  await apiError(request, 'POST', `/api/insurance/policies/${policy.id}/amendments`, amendment, 403, 'ROLE_REQUIRED');
  const amended = await api<{ policy: Policy }>(request, 'POST', `/api/insurance/policies/${policy.id}/amendments`, amendment, 'Senior underwriter');
  expect(amended.policy.version).toBe(2);
  expect(amended.policy.amendments[0].previousValues.locations.find(location => location.id === 'warehouse')!.sumInsured).toBe(1_500_000);
  expect(amended.policy.amendments[0].previousPremium).toEqual(issued.policy.premium);
  expect(amended.policy.premium!.total).toBeGreaterThan(issued.policy.premium!.total);
  expect(amended.policy.quoteId).not.toBe(referred.id);
});

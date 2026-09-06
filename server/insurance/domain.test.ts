import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStandardDraft, ITALIAN_WAREHOUSE_ADDRESS } from '../../shared/insurance';
import type { Customer, Policy, PolicyDraftInput, Quote } from '../../shared/insurance';

const directory = mkdtempSync(join(tmpdir(), 'folio-insurance-unit-'));
const isolatedDataFile = join(directory, 'data.json');
process.env.FOLIO_DATA_FILE = isolatedDataFile;
const { db } = await import('../store');
const {
  amendPolicy, approveQuote, attachDocument, collections, createPolicy, getPolicy, getQuote,
  getSchedule, InsuranceError, issuePolicy, ratePolicy, requestQuote, updatePolicy,
} = await import('./domain');
const { draftSchema, documentSchema, amendmentSchema } = await import('./validation');
const { seedInsurance } = await import('./seed');

const customer: Customer = { id: 'customer-linden', name: 'Linden Manufacturing GmbH', registrationNumber: 'DE-DEMO-104821',
  headquartersCountry: 'DE', address: { line1: 'Lindenplatz 8', city: 'Munich', postcode: '80331' },
  industry: 'Industrial manufacturing', contactName: 'Mara Lindner', email: 'mara@linden.example',
  createdAt: '2026-01-01T10:00:00Z', source: 'manual' };

beforeEach(() => {
  writeFileSync(isolatedDataFile, JSON.stringify({ 'studio.sentinel': [{ id: 'keep-me', value: 42 }] }));
  db.upsert(collections.customers, customer);
});
after(() => rmSync(directory, { recursive: true, force: true }));

function expectCode(action: () => unknown, code: string) {
  assert.throws(action, error => error instanceof InsuranceError && error.code === code);
}

function floodDraft(limit = 1_000_000, bothLocations = false): PolicyDraftInput {
  const draft = createStandardDraft();
  draft.source = 'run';
  draft.runId = 'run-insurance-unit';
  draft.locations[1].country = 'IT';
  draft.locations[1].address = structuredClone(ITALIAN_WAREHOUSE_ADDRESS);
  draft.locations[1].coverages.push({ type: 'Flood', limit, deductible: 5000 });
  if (bothLocations) draft.locations[0].coverages.push({ type: 'Flood', limit, deductible: 5000 });
  return draft;
}

test('validates real dates, unique locations, coverage values and document input', () => {
  const standard = createStandardDraft();
  assert.equal(draftSchema.safeParse(standard).success, true);
  assert.equal(draftSchema.safeParse({ ...standard, inceptionDate: '2026-02-30' }).success, false);
  assert.equal(draftSchema.safeParse({ ...standard, expiryDate: standard.inceptionDate }).success, false);
  assert.equal(draftSchema.safeParse({ ...standard, locations: [standard.locations[0], standard.locations[0]] }).success, false);
  const overinsured = structuredClone(standard);
  overinsured.locations[1].coverages[0].limit = overinsured.locations[1].sumInsured + 1;
  assert.equal(draftSchema.safeParse(overinsured).success, false);
  const invalidDeductible = structuredClone(standard);
  invalidDeductible.locations[1].coverages[0].deductible = invalidDeductible.locations[1].coverages[0].limit;
  assert.equal(draftSchema.safeParse(invalidDeductible).success, false);
  assert.equal(documentSchema.safeParse({ type: 'Policy schedule', locationId: 'warehouse', name: 'Schedule', suitable: true }).success, false);
  assert.equal(documentSchema.safeParse({ type: 'Risk survey', locationId: 'warehouse', name: 'Survey', suitable: 'true' }).success, false);
  assert.equal(amendmentSchema.safeParse({ effectiveDate: standard.inceptionDate, reason: 'No change', changes: {} }).success, false);
});

test('creates a draft without quoting and rates the strict flood boundary per location', () => {
  for (const [limit, status] of [[500_000, 'Quoted'], [500_000.01, 'Referred']] as const) {
    const draft = floodDraft(limit);
    const policy = createPolicy(draft, 'Broker');
    assert.equal(policy.status, 'Draft');
    assert.equal(policy.quoteId, null);
    assert.equal(policy.premium, null);
    assert.equal(policy.version, 1);
    assert.equal(policy.revision, 1);
    const { quote, policy: rated } = requestQuote(policy.id, 'Broker');
    assert.equal(rated.status, status);
    assert.equal(quote.status, status);
    assert.equal(quote.policyId, policy.id);
    assert.equal(quote.policyRevision, 1);
    assert.equal(quote.referrals.length, status === 'Referred' ? 1 : 0);
    if (quote.referrals.length) assert.equal(quote.referrals[0].locationId, 'warehouse');
    assert.ok(quote.premium.total > 0);
    assert.deepEqual(quote.premium, ratePolicy(draft));
  }
  const draft = floodDraft(500_000, true);
  const policy = createPolicy(draft, 'Broker');
  assert.equal(requestQuote(policy.id, 'Broker').quote.referrals.length, 0, 'The threshold is per location, not the sum across the policy');
  assert.deepEqual(db.read('studio.sentinel'), [{ id: 'keep-me', value: 42 }]);
});

test('invalidates quote terms on risk changes and rejects cross-policy quote references', () => {
  const first = createPolicy(createStandardDraft(), 'Broker');
  const second = createPolicy(createStandardDraft(), 'Broker');
  const originalQuote = requestQuote(first.id, 'Broker').quote;
  requestQuote(second.id, 'Broker');
  expectCode(() => issuePolicy(second.id, originalQuote.id, 'Broker'), 'QUOTE_POLICY_MISMATCH');
  const locations = structuredClone(first.locations);
  locations[1].sprinkler = false;
  const edited = updatePolicy(first.id, { locations }, 'Broker');
  assert.equal(edited.status, 'Draft');
  assert.equal(edited.revision, 2);
  assert.equal(edited.quoteId, null);
  assert.equal(edited.premium, null);
  assert.equal(getQuote(originalQuote.id).status, 'Superseded');
  expectCode(() => issuePolicy(first.id, originalQuote.id, 'Broker'), 'STALE_QUOTE');
  const replacement = requestQuote(first.id, 'Broker').quote;
  assert.equal(replacement.policyRevision, 2);
  assert.ok(replacement.premium.total > originalQuote.premium.total);
  const newest = requestQuote(first.id, 'Broker').quote;
  assert.equal(getQuote(replacement.id).status, 'Superseded');
  assert.equal(getPolicy(first.id).quoteId, newest.id);
  assert.deepEqual(getQuote(originalQuote.id).snapshot.locations, first.locations);
});

test('approval requires senior authority and suitable evidence for every referred location on this policy', () => {
  const policy = createPolicy(floodDraft(1_000_000, true), 'Broker');
  const quote = requestQuote(policy.id, 'Broker').quote;
  const unrelated = createPolicy(floodDraft(), 'Broker');
  attachDocument(unrelated.id, { type: 'Risk survey', locationId: 'warehouse', name: 'Other policy survey', suitable: true }, 'Broker');
  expectCode(() => approveQuote(quote.id, policy.id, '', 'Broker'), 'ROLE_REQUIRED');
  expectCode(() => approveQuote(quote.id, unrelated.id, '', 'Senior underwriter'), 'QUOTE_POLICY_MISMATCH');
  expectCode(() => approveQuote(quote.id, policy.id, '', 'Senior underwriter'), 'SURVEY_REQUIRED');
  expectCode(() => attachDocument(policy.id, { type: 'Risk survey', locationId: 'other-location', name: 'Wrong location', suitable: true }, 'Broker'), 'LOCATION_NOT_FOUND');
  attachDocument(policy.id, { type: 'Risk survey', locationId: 'warehouse', name: 'Unsuitable survey', suitable: false }, 'Broker');
  attachDocument(policy.id, { type: 'Risk survey', locationId: 'factory', name: 'Factory survey', suitable: true }, 'Senior underwriter');
  expectCode(() => approveQuote(quote.id, policy.id, '', 'Senior underwriter'), 'SURVEY_REQUIRED');
  attachDocument(policy.id, { type: 'Risk survey', locationId: 'warehouse', name: 'Warehouse survey', suitable: true }, 'Senior underwriter');
  const approved = approveQuote(quote.id, policy.id, 'Both surveys reviewed.', 'Senior underwriter');
  assert.equal(approved.policy.status, 'Approved');
  assert.equal(approved.quote.status, 'Approved');
  assert.equal(getQuote(quote.id).approvedBy, 'Senior underwriter');
  expectCode(() => issuePolicy(policy.id, quote.id, 'Senior underwriter'), 'ROLE_REQUIRED');
  const issued = issuePolicy(policy.id, quote.id, 'Broker');
  assert.equal(issued.policy.status, 'Issued');
  assert.equal(getQuote(quote.id).status, 'Issued');
  assert.equal(issued.schedule.quoteId, quote.id);
  assert.equal(issued.schedule.customer.headquartersCountry, 'DE');
  assert.equal(issued.schedule.issuingMarket, 'DE');
  assert.equal(issued.schedule.locations[1].country, 'IT');
  assert.deepEqual(issued.schedule.locations[1].address, ITALIAN_WAREHOUSE_ADDRESS);
  assert.equal(issued.schedule.locations[1].coverages.find(coverage => coverage.type === 'Flood')?.limit, 1_000_000);
  expectCode(() => issuePolicy(policy.id, quote.id, 'Broker'), 'ALREADY_ISSUED');
  expectCode(() => updatePolicy(policy.id, { billing: { frequency: 'Quarterly', method: 'Invoice' } }, 'Broker'), 'AMENDMENT_REQUIRED');
});

test('expired and superseded referrals cannot be approved even with suitable surveys', () => {
  const policy = createPolicy(floodDraft(), 'Broker');
  const quote = requestQuote(policy.id, 'Broker').quote;
  attachDocument(policy.id, { type: 'Risk survey', locationId: 'warehouse', name: 'Survey', suitable: true }, 'Senior underwriter');
  db.upsert<Quote>(collections.quotes, { ...quote, validUntil: '2000-01-01T00:00:00Z' });
  expectCode(() => approveQuote(quote.id, policy.id, 'Expired', 'Senior underwriter'), 'QUOTE_EXPIRED');
  const current = requestQuote(policy.id, 'Broker').quote;
  expectCode(() => approveQuote(quote.id, policy.id, 'Old quote', 'Senior underwriter'), 'STALE_QUOTE');
  const policyBefore = getPolicy(policy.id);
  assert.equal(policyBefore.quoteId, current.id);
  assert.equal(policyBefore.status, 'Referred');
});

test('amendments retain previous values, create a new issued quote and require underwriting for new exposure', () => {
  const draft = floodDraft(500_000);
  const policy = createPolicy(draft, 'Broker');
  const originalQuote = requestQuote(policy.id, 'Broker').quote;
  const issued = issuePolicy(policy.id, originalQuote.id, 'Broker');
  const first = amendPolicy(policy.id, draft.inceptionDate, 'Quarterly billing requested.', { billing: { frequency: 'Quarterly', method: 'Invoice' } }, 'Broker');
  assert.equal(first.policy.version, 2);
  assert.equal(first.policy.revision, 2);
  assert.equal(first.policy.status, 'Issued');
  assert.equal(first.amendment.previousVersion, 1);
  assert.equal(first.amendment.previousValues.billing.frequency, 'Annual');
  assert.deepEqual(first.amendment.previousPremium, issued.policy.premium);
  assert.ok(first.amendment.premium.total > first.amendment.previousPremium.total);
  assert.equal(first.schedule.policyVersion, 2);
  assert.equal(getQuote(originalQuote.id).status, 'Issued');
  assert.equal(getQuote(first.policy.quoteId!).policyRevision, 2);
  assert.equal(getQuote(first.policy.quoteId!).status, 'Issued');
  assert.equal(getSchedule(policy.id).id, first.schedule.id);

  const locations = structuredClone(first.policy.locations);
  locations[1].coverages.find(coverage => coverage.type === 'Flood')!.limit = 750_000;
  expectCode(() => amendPolicy(policy.id, draft.inceptionDate, 'Higher flood limit.', { locations }, 'Broker'), 'ROLE_REQUIRED');
  expectCode(() => amendPolicy(policy.id, draft.inceptionDate, 'Higher flood limit.', { locations }, 'Senior underwriter'), 'SURVEY_REQUIRED');
  assert.equal(getPolicy(policy.id).version, 2, 'Rejected amendments must not change the policy');
  attachDocument(policy.id, { type: 'Risk survey', locationId: 'warehouse', name: 'Current warehouse survey', suitable: true }, 'Senior underwriter');
  const second = amendPolicy(policy.id, draft.inceptionDate, 'Higher flood limit approved.', { locations }, 'Senior underwriter');
  assert.equal(second.policy.version, 3);
  assert.equal(second.policy.revision, 3);
  assert.equal(second.policy.amendments.length, 2);
  assert.equal(second.amendment.previousValues.locations[1].coverages.find(coverage => coverage.type === 'Flood')?.limit, 500_000);
  assert.equal(second.schedule.locations[1].coverages.find(coverage => coverage.type === 'Flood')?.limit, 750_000);
  assert.equal(getQuote(second.policy.quoteId!).approvedBy, 'Senior underwriter');
  assert.equal(getSchedule(policy.id).policyVersion, 3);
  expectCode(() => amendPolicy(policy.id, '2000-01-01', 'Too early.', { billing: draft.billing }, 'Broker'), 'EFFECTIVE_DATE_OUTSIDE_TERM');
  assert.deepEqual(db.read('studio.sentinel'), [{ id: 'keep-me', value: 42 }]);
});

test('demo seeding fills every workflow state once and preserves other collections', () => {
  writeFileSync(isolatedDataFile, JSON.stringify({ 'studio.sentinel': [{ id: 'keep-me', value: 42 }] }));
  seedInsurance();
  const policies = db.read<Policy>(collections.policies);
  assert.deepEqual(new Set(policies.map(policy => policy.status)), new Set(['Draft', 'Quoted', 'Referred', 'Approved', 'Issued']));
  assert.equal(db.find<Customer>(collections.customers, 'customer-linden')?.headquartersCountry, 'DE');
  seedInsurance();
  assert.equal(db.read<Policy>(collections.policies).length, policies.length);
  assert.deepEqual(db.read('studio.sentinel'), [{ id: 'keep-me', value: 42 }]);
});

import { randomUUID } from 'node:crypto';
import type { Amendment, AuditEntry, Customer, InsuredLocation, Policy, PolicyDocument, PolicyDraftInput, PolicySchedule, Premium, Quote, Referral, Role } from '../../shared/insurance';
import { db } from '../store';
import { parseDraft } from './validation';

export const collections = {
  customers: 'insurance.customers', policies: 'insurance.policies', quotes: 'insurance.quotes',
  schedules: 'insurance.schedules', metadata: 'insurance.metadata',
} as const;

export class InsuranceError extends Error {
  constructor(public status: 400 | 403 | 404 | 409, public code: string, message: string) { super(message); }
}

export const copy = <T>(value: T): T => structuredClone(value);
const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}-${randomUUID()}`;
const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function getCustomer(customerId: string): Customer {
  const customer = db.find<Customer>(collections.customers, customerId);
  if (!customer) throw new InsuranceError(404, 'CUSTOMER_NOT_FOUND', 'The customer could not be found.');
  return copy(customer);
}

export function getPolicy(policyId: string): Policy {
  const policy = db.find<Policy>(collections.policies, policyId);
  if (!policy) throw new InsuranceError(404, 'POLICY_NOT_FOUND', 'The policy could not be found.');
  return copy(policy);
}

export function getQuote(quoteId: string): Quote {
  const quote = db.find<Quote>(collections.quotes, quoteId);
  if (!quote) throw new InsuranceError(404, 'QUOTE_NOT_FOUND', 'The quote could not be found.');
  return copy(quote);
}

export function requireRole(actual: Role, expected: Role): void {
  if (actual !== expected) throw new InsuranceError(403, 'ROLE_REQUIRED', `Switch to ${expected} to perform this action.`);
}

export function draftOf(policy: Policy | PolicyDraftInput): PolicyDraftInput {
  return copy({
    customerId: policy.customerId, productVersion: policy.productVersion, issuingMarket: policy.issuingMarket,
    currency: policy.currency, inceptionDate: policy.inceptionDate, expiryDate: policy.expiryDate,
    locations: policy.locations, lossHistory: policy.lossHistory, billing: policy.billing, declarations: policy.declarations,
    source: policy.source ?? 'manual', ...(policy.runId ? { runId: policy.runId } : {}),
  });
}

function activity(actor: Role, action: string, detail: string): AuditEntry {
  return { id: id('activity'), at: now(), actor, action, detail };
}

export function referralsFor(draft: PolicyDraftInput): Referral[] {
  return draft.locations.flatMap(location => {
    const flood = location.coverages.find(coverage => coverage.type === 'Flood');
    if (!flood || flood.limit <= 500_000) return [];
    return [{ locationId: location.id, locationName: location.name, code: 'FLOOD_AUTHORITY' as const,
      reason: `${location.name} has a flood limit of EUR ${flood.limit.toLocaleString('en-GB')}, above the EUR 500,000 location authority.`,
      floodLimit: flood.limit, threshold: 500000 as const, requiresSurvey: true as const }];
  });
}

/** Deterministic rates for the fictional local demo product. */
export function ratePolicy(draft: PolicyDraftInput): Premium {
  const termDays = (Date.parse(`${draft.expiryDate}T00:00:00Z`) - Date.parse(`${draft.inceptionDate}T00:00:00Z`)) / 86_400_000 + 1;
  const termFactor = termDays / 365;
  const losses = draft.lossHistory.reduce((sum, loss) => sum + loss.amount, 0);
  const lossFactor = 1 + Math.min(0.6, losses / 1_000_000);
  const billingFactor = draft.billing.frequency === 'Quarterly' ? 1.02 : 1;
  let annualBase = 0, annualFlood = 0, annualOther = 0, annualAdjustment = 0;
  const byLocation = draft.locations.map(location => {
    const fire = location.coverages.find(coverage => coverage.type === 'Fire')!;
    const baseRate = { Factory: 0.00125, Warehouse: 0.00095, Office: 0.00065 }[location.type];
    const deductibleFactor = Math.max(0.65, 1 - fire.deductible / 100_000);
    const base = location.sumInsured * baseRate * deductibleFactor;
    let flood = 0, other = 0;
    for (const coverage of location.coverages) {
      if (coverage.type === 'Flood') flood += coverage.limit * { Low: 0.0012, Moderate: 0.0024, High: 0.0048 }[location.floodZone] * Math.max(0.55, 1 - coverage.deductible / 100_000);
      if (coverage.type === 'Business interruption') other += coverage.limit * 0.0018 * Math.max(0.6, 1 - coverage.deductible / 100_000);
      if (coverage.type === 'Theft') other += coverage.limit * 0.0014 * Math.max(0.6, 1 - coverage.deductible / 100_000);
    }
    const physicalFactor = { Masonry: 1, Steel: 1.07, Timber: 1.35 }[location.construction]
      * (location.sprinkler ? 0.9 : 1.12) * (location.yearBuilt < 1980 ? 1.1 : 1)
      * (location.country === 'IT' ? 1.12 : 1) * (draft.declarations.insuranceDeclined ? 1.1 : 1);
    const adjustment = (base + flood + other) * (physicalFactor * lossFactor * billingFactor - 1);
    annualBase += base; annualFlood += flood; annualOther += other; annualAdjustment += adjustment;
    return { locationId: location.id, name: location.name, annual: round((base + flood + other + adjustment) * 1.19) };
  });
  const base = round(annualBase * termFactor), flood = round(annualFlood * termFactor);
  const otherCoverages = round(annualOther * termFactor), riskAdjustment = round(annualAdjustment * termFactor);
  const tax = round((base + flood + otherCoverages + riskAdjustment) * 0.19);
  return { base, flood, otherCoverages, riskAdjustment, tax,
    total: round(base + flood + otherCoverages + riskAdjustment + tax), currency: 'EUR',
    annual: round(byLocation.reduce((sum, location) => sum + location.annual, 0)), byLocation };
}

function supersedeQuote(policy: Policy): void {
  if (!policy.quoteId) return;
  const previous = db.find<Quote>(collections.quotes, policy.quoteId);
  if (previous && previous.status !== 'Issued') db.upsert(collections.quotes, { ...previous, status: 'Superseded' as const });
}

export function createCustomer(input: Omit<Customer, 'id' | 'createdAt' | 'source'> & { source?: Customer['source'] }): Customer {
  const customer: Customer = { ...copy(input), id: id('customer'), createdAt: now(), source: input.source ?? 'manual' };
  return db.upsert(collections.customers, customer);
}

export function createPolicy(input: PolicyDraftInput, role: Role): Policy {
  requireRole(role, 'Broker');
  const draft = parseDraft(input);
  getCustomer(draft.customerId);
  const policyId = id('policy');
  const createdAt = now();
  const policy: Policy = {
    ...draft, source: draft.source ?? 'manual', id: policyId,
    policyNumber: `MCP-${new Date().getUTCFullYear()}-${policyId.slice(-6).toUpperCase()}`,
    product: 'Meridian Commercial Property', status: 'Draft', version: 1, revision: 1,
    quoteId: null, premium: null, documents: [], amendments: [], createdAt, updatedAt: createdAt,
    activity: [activity(role, 'Draft created', `${draft.locations.length} locations added to a new commercial property draft.`)],
  };
  return db.upsert(collections.policies, policy);
}

export function updatePolicy(policyId: string, changes: Partial<PolicyDraftInput>, role: Role): Policy {
  requireRole(role, 'Broker');
  const policy = getPolicy(policyId);
  if (policy.status === 'Issued') throw new InsuranceError(409, 'AMENDMENT_REQUIRED', 'Use an amendment to change an issued policy.');
  const draft = parseDraft({ ...draftOf(policy), ...copy(changes) });
  getCustomer(draft.customerId);
  if (JSON.stringify(draftOf(policy)) === JSON.stringify(draftOf(draft))) return policy;
  supersedeQuote(policy);
  const changedFields = Object.keys(changes).join(', ');
  const updated: Policy = { ...policy, ...draft, source: draft.source ?? 'manual', status: 'Draft', revision: policy.revision + 1,
    quoteId: null, premium: null, updatedAt: now(),
    documents: policy.documents.filter(document => !document.locationId || draft.locations.some(location => location.id === document.locationId)),
    activity: [...policy.activity, activity(role, 'Draft updated', `Updated ${changedFields}. Previous quote terms no longer apply.`)],
  };
  return db.upsert(collections.policies, updated);
}

export function requestQuote(policyId: string, role: Role): { policy: Policy; quote: Quote } {
  requireRole(role, 'Broker');
  const policy = getPolicy(policyId);
  if (policy.status === 'Issued') throw new InsuranceError(409, 'ALREADY_ISSUED', 'An issued policy must be re-rated through an amendment.');
  const snapshot = parseDraft(draftOf(policy));
  if (!snapshot.declarations.informationAccurate) throw new InsuranceError(400, 'DECLARATION_REQUIRED', 'Confirm that the declared information is accurate before requesting a quote.');
  const referrals = referralsFor(snapshot);
  const quote: Quote = { id: id('quote'), policyId, policyRevision: policy.revision,
    status: referrals.length ? 'Referred' : 'Quoted', premium: ratePolicy(snapshot), referrals,
    createdAt: now(), validUntil: new Date(Date.now() + 30 * 86_400_000).toISOString(), snapshot };
  supersedeQuote(policy);
  const updated: Policy = { ...policy, quoteId: quote.id, premium: copy(quote.premium), status: referrals.length ? 'Referred' : 'Quoted', updatedAt: now(),
    activity: [...policy.activity, activity(role, referrals.length ? 'Quote referred' : 'Quote prepared', referrals.length
      ? `${referrals.length} location${referrals.length === 1 ? '' : 's'} require senior underwriting and suitable risk surveys.`
      : `Quote ${quote.id} prepared for policy revision ${policy.revision}.`)] };
  db.upsert(collections.quotes, quote);
  db.upsert(collections.policies, updated);
  return { policy: updated, quote };
}

export function attachDocument(policyId: string, input: Pick<PolicyDocument, 'name' | 'type' | 'locationId' | 'suitable'>, role: Role): { policy: Policy; document: PolicyDocument } {
  const policy = getPolicy(policyId);
  if (input.type !== 'Risk survey') throw new InsuranceError(400, 'DOCUMENT_TYPE_INVALID', 'Only risk surveys can be attached. Policy schedules are generated when issuing.');
  if (!policy.locations.some(location => location.id === input.locationId)) throw new InsuranceError(400, 'LOCATION_NOT_FOUND', 'Select a location that belongs to this policy.');
  const document: PolicyDocument = { id: id('document'), ...copy(input), synthetic: true, uploadedAt: now(), uploadedBy: role };
  const updated: Policy = { ...policy, documents: [...policy.documents, document], updatedAt: now(),
    activity: [...policy.activity, activity(role, 'Risk survey attached', `${document.name} attached to ${policy.locations.find(location => location.id === document.locationId)!.name}${document.suitable ? ' as suitable evidence' : ' for review'}.`)] };
  db.upsert(collections.policies, updated);
  return { policy: updated, document };
}

function assertCurrentQuote(policy: Policy, quote: Quote): void {
  if (quote.policyId !== policy.id) throw new InsuranceError(409, 'QUOTE_POLICY_MISMATCH', 'This quote belongs to a different policy.');
  if (policy.quoteId !== quote.id || quote.policyRevision !== policy.revision || quote.status === 'Superseded'
    || JSON.stringify(draftOf(quote.snapshot)) !== JSON.stringify(draftOf(policy))) {
    throw new InsuranceError(409, 'STALE_QUOTE', 'The quote no longer matches this policy. Request a new quote.');
  }
  if (Date.parse(quote.validUntil) <= Date.now()) throw new InsuranceError(409, 'QUOTE_EXPIRED', 'The quote has expired. Request a new quote.');
}

function requireSurveys(policy: Policy, referrals: Referral[]): void {
  const missing = referrals.filter(referral => !policy.documents.some(document => document.type === 'Risk survey' && document.locationId === referral.locationId && document.suitable === true));
  if (missing.length) throw new InsuranceError(409, 'SURVEY_REQUIRED', `Attach a suitable risk survey for ${missing.map(referral => referral.locationName).join(', ')} before approval.`);
}

export function approveQuote(quoteId: string, policyId: string, notes: string, role: Role): { policy: Policy; quote: Quote } {
  requireRole(role, 'Senior underwriter');
  const quote = getQuote(quoteId), policy = getPolicy(policyId);
  assertCurrentQuote(policy, quote);
  if (policy.status !== 'Referred' || quote.status !== 'Referred') throw new InsuranceError(409, 'NOT_REFERRED', 'Only the current referred quote can be approved.');
  requireSurveys(policy, quote.referrals);
  const approved: Quote = { ...quote, status: 'Approved', approvedAt: now(), approvedBy: role, approvalNotes: notes };
  const updated: Policy = { ...policy, status: 'Approved', updatedAt: now(), activity: [...policy.activity,
    activity(role, 'Referral approved', notes || 'Reviewed suitable location risk surveys and approved the current quote.')] };
  db.upsert(collections.quotes, approved);
  db.upsert(collections.policies, updated);
  return { policy: updated, quote: approved };
}

function buildSchedule(policy: Policy, quote: Quote, effectiveDate?: string): PolicySchedule {
  return { id: `${policy.id}-schedule-v${policy.version}`, policyId: policy.id, policyNumber: policy.policyNumber,
    policyVersion: policy.version, customer: getCustomer(policy.customerId), product: policy.product,
    productVersion: policy.productVersion, issuingMarket: policy.issuingMarket, currency: policy.currency,
    inceptionDate: policy.inceptionDate, expiryDate: policy.expiryDate, locations: copy(policy.locations), premium: copy(quote.premium),
    issuedAt: now(), quoteId: quote.id, ...(effectiveDate ? { effectiveDate } : {}) };
}

function scheduleDocument(policy: Policy, schedule: PolicySchedule, role: Role): PolicyDocument {
  return { id: schedule.id, name: `${policy.policyNumber} schedule, version ${policy.version}`, type: 'Policy schedule',
    synthetic: true, uploadedAt: schedule.issuedAt, uploadedBy: role };
}

export function issuePolicy(policyId: string, quoteId: string, role: Role): { policy: Policy; schedule: PolicySchedule } {
  requireRole(role, 'Broker');
  const policy = getPolicy(policyId), quote = getQuote(quoteId);
  assertCurrentQuote(policy, quote);
  if (policy.status === 'Issued') throw new InsuranceError(409, 'ALREADY_ISSUED', 'This policy has already been issued.');
  if (!['Quoted', 'Approved'].includes(policy.status) || !['Quoted', 'Approved'].includes(quote.status)
    || policy.status !== quote.status) throw new InsuranceError(409, 'QUOTE_NOT_BINDABLE', 'Prepare a quote and resolve its referrals before issuing.');
  if (quote.referrals.length) {
    if (quote.status !== 'Approved' || quote.approvedBy !== 'Senior underwriter') throw new InsuranceError(409, 'REFERRAL_NOT_APPROVED', 'A senior underwriter must approve the referred quote before issuing.');
    requireSurveys(policy, quote.referrals);
  }
  const updated: Policy = { ...policy, status: 'Issued', premium: copy(quote.premium), issuedAt: now(), updatedAt: now(),
    activity: [...policy.activity, activity(role, 'Policy issued', `Version ${policy.version} issued using quote ${quote.id}.`)] };
  const schedule = buildSchedule(updated, quote);
  updated.documents.push(scheduleDocument(updated, schedule, role));
  db.upsert(collections.quotes, { ...quote, status: 'Issued' as const });
  db.upsert(collections.schedules, schedule);
  db.upsert(collections.policies, updated);
  return { policy: updated, schedule };
}

export function getSchedule(policyId: string): PolicySchedule {
  const policy = getPolicy(policyId);
  if (policy.status !== 'Issued') throw new InsuranceError(409, 'NOT_ISSUED', 'A policy schedule is available after issue.');
  const schedule = db.find<PolicySchedule>(collections.schedules, `${policy.id}-schedule-v${policy.version}`);
  if (!schedule) throw new InsuranceError(404, 'SCHEDULE_NOT_FOUND', 'The current policy schedule could not be found.');
  return copy(schedule);
}

function isNewFloodExposure(previous: InsuredLocation | undefined, next: InsuredLocation): boolean {
  if (!previous) return true;
  const before = previous.coverages.find(coverage => coverage.type === 'Flood');
  const after = next.coverages.find(coverage => coverage.type === 'Flood')!;
  if (!before || before.limit <= 500_000 || after.limit > before.limit || after.deductible < before.deductible) return true;
  const physicalRisk = (location: InsuredLocation) => ({ type: location.type, country: location.country, address: location.address,
    construction: location.construction, yearBuilt: location.yearBuilt, areaSqm: location.areaSqm,
    sprinkler: location.sprinkler, floodZone: location.floodZone, sumInsured: location.sumInsured });
  return JSON.stringify(physicalRisk(previous)) !== JSON.stringify(physicalRisk(next));
}

export function amendPolicy(policyId: string, effectiveDate: string, reason: string, changes: Partial<PolicyDraftInput>, role: Role): { policy: Policy; amendment: Amendment; schedule: PolicySchedule } {
  const policy = getPolicy(policyId);
  if (policy.status !== 'Issued' || !policy.premium || !policy.quoteId) throw new InsuranceError(409, 'NOT_ISSUED', 'Only issued policies can be amended.');
  const previousValues = draftOf(policy);
  const draft = parseDraft({ ...previousValues, ...copy(changes) });
  getCustomer(draft.customerId);
  if (effectiveDate < policy.inceptionDate || effectiveDate > policy.expiryDate || effectiveDate < draft.inceptionDate || effectiveDate > draft.expiryDate) {
    throw new InsuranceError(400, 'EFFECTIVE_DATE_OUTSIDE_TERM', 'The amendment effective date must fall inside both the current and amended policy term.');
  }
  const latestEffective = policy.amendments.at(-1)?.effectiveDate;
  if (latestEffective && effectiveDate < latestEffective) throw new InsuranceError(409, 'AMENDMENT_DATE_ORDER', 'The effective date cannot be before the previous amendment.');
  if (JSON.stringify(previousValues) === JSON.stringify(draftOf(draft))) throw new InsuranceError(400, 'NO_CHANGES', 'Change at least one policy value before applying an amendment.');
  if (!draft.declarations.informationAccurate) throw new InsuranceError(400, 'DECLARATION_REQUIRED', 'Confirm that the amended information is accurate.');
  const referrals = referralsFor(draft);
  const changedReferrals = referrals.filter(referral => isNewFloodExposure(policy.locations.find(location => location.id === referral.locationId), draft.locations.find(location => location.id === referral.locationId)!));
  if (changedReferrals.length) {
    requireRole(role, 'Senior underwriter');
    requireSurveys(policy, changedReferrals);
  }
  const premium = ratePolicy(draft);
  const amendment: Amendment = { id: id('amendment'), effectiveDate, reason, previousVersion: policy.version, version: policy.version + 1,
    previousValues, changes: copy(changes), premium: copy(premium), previousPremium: copy(policy.premium), createdAt: now(), actor: role };
  const previousQuote = getQuote(policy.quoteId);
  const quote: Quote = { id: id('quote'), policyId, policyRevision: policy.revision + 1, status: 'Issued', premium: copy(premium), referrals,
    createdAt: now(), validUntil: new Date(Date.now() + 30 * 86_400_000).toISOString(), snapshot: draftOf(draft),
    ...(referrals.length ? { approvedAt: role === 'Senior underwriter' ? now() : previousQuote.approvedAt,
      approvedBy: role === 'Senior underwriter' ? role : previousQuote.approvedBy,
      approvalNotes: changedReferrals.length ? reason : previousQuote.approvalNotes } : {}) };
  const updated: Policy = { ...policy, ...draft, source: draft.source ?? 'manual', version: policy.version + 1, revision: policy.revision + 1,
    quoteId: quote.id, premium: copy(premium), updatedAt: now(), amendments: [...policy.amendments, amendment],
    documents: policy.documents.filter(document => !document.locationId || draft.locations.some(location => location.id === document.locationId)),
    activity: [...policy.activity, activity(role, 'Policy amended', `Version ${policy.version + 1}, effective ${effectiveDate}. ${reason} Re-rated premium EUR ${premium.total.toFixed(2)}.`)] };
  const schedule = buildSchedule(updated, quote, effectiveDate);
  updated.documents.push(scheduleDocument(updated, schedule, role));
  db.upsert(collections.quotes, quote);
  db.upsert(collections.schedules, schedule);
  db.upsert(collections.policies, updated);
  return { policy: updated, amendment, schedule };
}

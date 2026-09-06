import { randomUUID } from 'node:crypto';
import { expect, type Page, type Response } from '@playwright/test';
import type { BlockValue, CompiledStep, PolicyConfiguration } from '../../shared/blocks';
import { isEntityReference } from '../../shared/blocks';
import type { Customer, InsuredLocation, Policy, PolicyDetailResponse, PolicyDraftInput, PolicySchedule, Quote, Role } from '../../shared/insurance';
import { COUNTRY_NAMES } from '../../shared/insurance';

type RuntimeReference =
  | { kind: 'policy'; id: string }
  | { kind: 'quote'; id: string; policyId: string }
  | { kind: 'location'; id: string; policyId: string }
  | { kind: 'customer'; id: string }
  | { kind: 'attempt'; id: string; policyId: string; quoteId: string; denied: boolean; mechanism: string; status?: number; message: string };

export interface ExecutionState {
  runId: string;
  sequence: number;
  refs: Record<string, RuntimeReference>;
  objectIds: Record<string, string>;
}

export interface StepResult {
  objectIds: Record<string, string>;
  details: Record<string, unknown>;
}

/** State belongs to one browser context. No "latest policy" lookup is used. */
export function createExecutionState(_page: Page, options: { runId?: string } = {}): ExecutionState {
  return { runId: options.runId ?? `browser-${randomUUID()}`, sequence: 0, refs: {}, objectIds: {} };
}

async function responseJSON<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => { throw new Error(`The application returned non-JSON data for ${response.url()}.`); });
  if (!response.ok()) throw new Error(`${response.status()} ${body.error ?? response.statusText()}`);
  return body as T;
}

/** Observes the response caused by a UI action; it never performs the request. */
async function observe<T>(page: Page, method: string, pathname: string, action: () => Promise<unknown>): Promise<T> {
  const pending = page.waitForResponse(response => response.request().method() === method && new URL(response.url()).pathname === pathname);
  await action();
  return responseJSON<T>(await pending);
}

function reference(state: ExecutionState, input: BlockValue | undefined, kind: RuntimeReference['kind']): RuntimeReference {
  if (!isEntityReference(input)) throw new Error(`Expected an explicit ${kind} reference.`);
  const value = state.refs[input.ref];
  if (!value) throw new Error(`The ${kind} reference "${input.ref}" has not been created in this run.`);
  if (value.kind !== kind) throw new Error(`"${input.ref}" refers to ${value.kind}, not ${kind}.`);
  return value;
}

function policyReference(state: ExecutionState, input: BlockValue | undefined) {
  return reference(state, input, 'policy') as Extract<RuntimeReference, { kind: 'policy' }>;
}
function quoteReference(state: ExecutionState, input: BlockValue | undefined) {
  return reference(state, input, 'quote') as Extract<RuntimeReference, { kind: 'quote' }>;
}
function locationReference(state: ExecutionState, input: BlockValue | undefined) {
  return reference(state, input, 'location') as Extract<RuntimeReference, { kind: 'location' }>;
}

function bind(state: ExecutionState, outputs: Record<string, string>, values: Record<string, RuntimeReference>) {
  for (const [key, symbol] of Object.entries(outputs)) {
    if (!values[key]) throw new Error(`The ${key} output has no browser result.`);
    if (state.refs[symbol]) throw new Error(`The output symbol "${symbol}" is already bound. Outputs must be distinct.`);
    state.refs[symbol] = values[key];
    state.objectIds[symbol] = values[key].kind === 'location' ? `${values[key].policyId}/${values[key].id}` : values[key].id;
  }
}

async function actAs(page: Page, role: Role) {
  if (role !== 'Broker' && role !== 'Senior underwriter') throw new Error(`Unsupported acting role: ${String(role)}`);
  await page.getByRole('combobox', { name: 'Acting role', exact: true }).selectOption({ label: role });
  await expect(page.getByRole('combobox', { name: 'Acting role', exact: true })).toHaveValue(role);
}

async function openPolicy(page: Page, id: string, role: Role): Promise<PolicyDetailResponse> {
  const detail = await observe<PolicyDetailResponse>(page, 'GET', `/api/insurance/policies/${id}`, () => page.goto(`/insurance/policies/${encodeURIComponent(id)}`));
  await expect(page.getByTestId('policy-id')).toHaveText(id);
  await actAs(page, role);
  return detail;
}

function draftSnapshot(policy: Policy): Omit<PolicyDraftInput, 'source' | 'runId'> {
  return {
    customerId: policy.customerId, productVersion: policy.productVersion, issuingMarket: policy.issuingMarket,
    currency: policy.currency, inceptionDate: policy.inceptionDate, expiryDate: policy.expiryDate,
    locations: policy.locations, lossHistory: policy.lossHistory, billing: policy.billing, declarations: policy.declarations,
  };
}

async function fillRisk(page: Page, location: InsuredLocation) {
  const group = page.getByTestId(`location-${location.id}`);
  await group.getByLabel('Location name', { exact: true }).fill(location.name);
  await group.getByRole('combobox', { name: 'Location type', exact: true }).selectOption(location.type);
  await group.getByRole('combobox', { name: 'Location country', exact: true }).selectOption(location.country);
  await group.getByLabel('Address line', { exact: true }).fill(location.address.line1);
  await group.getByLabel('City', { exact: true }).fill(location.address.city);
  await group.getByLabel('Postcode', { exact: true }).fill(location.address.postcode);
  await group.getByRole('combobox', { name: 'Construction', exact: true }).selectOption(location.construction);
  await group.getByRole('spinbutton', { name: 'Year built', exact: true }).fill(String(location.yearBuilt));
  await group.getByRole('spinbutton', { name: 'Floor area (m²)', exact: true }).fill(String(location.areaSqm));
  await group.getByLabel('Sprinkler installed', { exact: true }).setChecked(location.sprinkler);
  await group.getByRole('combobox', { name: 'Flood zone', exact: true }).selectOption(location.floodZone);
  await group.getByRole('spinbutton', { name: 'Sum insured', exact: true }).fill(String(location.sumInsured));
}

async function fillCoverages(page: Page, location: InsuredLocation) {
  const group = page.getByTestId(`coverage-${location.id}`);
  const fire = location.coverages.find(item => item.type === 'Fire');
  if (!fire) throw new Error('The maintained property form requires fire coverage.');
  await group.getByRole('spinbutton', { name: 'Fire limit', exact: true }).fill(String(fire.limit));
  await group.getByRole('spinbutton', { name: 'Fire deductible', exact: true }).fill(String(fire.deductible));
  for (const type of ['Flood', 'Business interruption', 'Theft'] as const) {
    const coverage = location.coverages.find(item => item.type === type);
    await group.getByLabel(`${type} coverage`, { exact: true }).setChecked(!!coverage);
    if (coverage) {
      await group.getByRole('spinbutton', { name: `${type} limit`, exact: true }).fill(String(coverage.limit));
      await group.getByRole('spinbutton', { name: `${type} deductible`, exact: true }).fill(String(coverage.deductible));
    }
  }
}

async function createDraft(page: Page, step: CompiledStep, state: ExecutionState): Promise<StepResult> {
  const configuration = step.inputs.configuration as unknown as PolicyConfiguration;
  if (!configuration?.customer || !Array.isArray(configuration.locations)) throw new Error('Create draft requires a fully resolved policy configuration.');
  await page.goto(`/insurance/new?runId=${encodeURIComponent(state.runId)}`);
  await actAs(page, step.actor);
  await expect(page.getByRole('heading', { name: 'New commercial property policy', exact: true })).toBeVisible();
  const suffix = `${state.runId.slice(-8)}-${++state.sequence}`;
  const customerInput = { ...structuredClone(configuration.customer), name: `${configuration.customer.name} ${suffix}`, registrationNumber: `${configuration.customer.registrationNumber}-${suffix}`, email: `run-${suffix}@folio.test` };
  await page.getByRole('button', { name: 'New customer', exact: true }).click();
  await page.getByLabel('Customer name', { exact: true }).fill(customerInput.name);
  await page.getByLabel('Registration number', { exact: true }).fill(customerInput.registrationNumber);
  await page.getByRole('combobox', { name: 'Headquarters country', exact: true }).selectOption(customerInput.headquartersCountry);
  await page.getByLabel('Headquarters address', { exact: true }).fill(customerInput.address.line1);
  await page.getByLabel('Headquarters city', { exact: true }).fill(customerInput.address.city);
  await page.getByLabel('Headquarters postcode', { exact: true }).fill(customerInput.address.postcode);
  await page.getByLabel('Industry', { exact: true }).fill(customerInput.industry);
  await page.getByLabel('Contact name', { exact: true }).fill(customerInput.contactName);
  await page.getByLabel('Contact email', { exact: true }).fill(customerInput.email);
  const { customer } = await observe<{ customer: Customer }>(page, 'POST', '/api/insurance/customers', () => page.getByRole('button', { name: 'Save customer', exact: true }).click());
  expect(customer).toMatchObject(customerInput);
  await page.getByRole('combobox', { name: 'Customer', exact: true }).selectOption(customer.id);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Inception date', { exact: true }).fill(configuration.inceptionDate);
  await page.getByLabel('Expiry date', { exact: true }).fill(configuration.expiryDate);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  for (const location of configuration.locations) await fillRisk(page, location);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  for (const location of configuration.locations) await fillCoverages(page, location);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  for (const [index, loss] of configuration.lossHistory.entries()) {
    await page.getByRole('button', { name: 'Add loss', exact: true }).click();
    const group = page.getByRole('group', { name: `Loss ${index + 1}`, exact: true });
    await group.getByLabel('Loss date', { exact: true }).fill(loss.date);
    await group.getByRole('spinbutton', { name: 'Loss amount', exact: true }).fill(String(loss.amount));
    await group.getByLabel('Loss description', { exact: true }).fill(loss.description);
  }
  await page.getByRole('combobox', { name: 'Billing frequency', exact: true }).selectOption(configuration.billing.frequency);
  await page.getByRole('combobox', { name: 'Payment method', exact: true }).selectOption(configuration.billing.method);
  await page.getByLabel('Information is accurate', { exact: true }).setChecked(configuration.declarations.informationAccurate);
  await page.getByLabel('Insurance previously declined', { exact: true }).setChecked(configuration.declarations.insuranceDeclined);
  await page.getByLabel('Additional information', { exact: true }).fill(configuration.declarations.additionalInformation);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  const { policy } = await observe<{ policy: Policy }>(page, 'POST', '/api/insurance/policies', () => page.getByRole('button', { name: 'Save draft', exact: true }).click());
  const { customer: _customer, ...expectedDraft } = configuration;
  // Loss row IDs are generated by the application, while the declared facts stay exact.
  expect(policy.lossHistory).toHaveLength(expectedDraft.lossHistory.length);
  expectedDraft.lossHistory = expectedDraft.lossHistory.map((loss, index) => ({ ...loss, id: policy.lossHistory[index]!.id }));
  expect(draftSnapshot(policy)).toEqual({ ...expectedDraft, customerId: customer.id });
  expect(policy.status).toBe('Draft');
  expect(policy.quoteId).toBeNull();
  expect(policy.premium).toBeNull();
  expect(policy.source).toBe('run');
  expect(policy.runId).toBe(state.runId);
  await expect(page.getByTestId('policy-id')).toHaveText(policy.id);
  await expect(page.getByTestId('policy-status')).toHaveText('Draft');
  const factory = policy.locations.find(location => location.id === 'factory');
  const warehouse = policy.locations.find(location => location.id === 'warehouse');
  if (!factory || !warehouse) throw new Error('The standard draft did not create the named factory and warehouse.');
  bind(state, step.outputs, { policy: { kind: 'policy', id: policy.id }, customer: { kind: 'customer', id: customer.id }, factory: { kind: 'location', id: factory.id, policyId: policy.id }, warehouse: { kind: 'location', id: warehouse.id, policyId: policy.id } });
  return { objectIds: { ...state.objectIds }, details: { createdCustomer: customer, createdDraft: policy, resolvedDraft: { ...expectedDraft, customerId: customer.id }, configurationAppliedBeforeCreation: true } };
}

async function requestQuote(page: Page, step: CompiledStep, state: ExecutionState): Promise<StepResult> {
  const policy = policyReference(state, step.inputs.policy);
  await openPolicy(page, policy.id, step.actor);
  const result = await observe<{ policy: Policy; quote: Quote }>(page, 'POST', `/api/insurance/policies/${policy.id}/quote`, () => page.getByRole('button', { name: 'Request quote', exact: true }).click());
  expect(result.quote.policyId).toBe(policy.id);
  expect(result.policy.quoteId).toBe(result.quote.id);
  await expect(page.getByTestId('quote-id')).toHaveText(result.quote.id);
  await expect(page.getByTestId('policy-status')).toHaveText(result.policy.status);
  bind(state, step.outputs, { quote: { kind: 'quote', id: result.quote.id, policyId: policy.id } });
  return { objectIds: { ...state.objectIds }, details: result };
}

async function expectQuote(page: Page, step: CompiledStep, state: ExecutionState): Promise<StepResult> {
  const reference = quoteReference(state, step.inputs.quote);
  const detail = await openPolicy(page, reference.policyId, step.actor);
  expect(detail.quote?.id).toBe(reference.id);
  expect(detail.quote?.status).toBe(step.inputs.status);
  await expect(page.getByTestId('quote-id')).toHaveText(reference.id);
  await expect(page.getByTestId('policy-status')).toHaveText(String(step.inputs.status));
  if (step.inputs.reason) {
    const reason = String(step.inputs.reason);
    if (reason === 'FLOOD_AUTHORITY' || reason === 'Flood limit exceeds broker authority') {
      expect(detail.quote?.referrals.some(item => item.code === 'FLOOD_AUTHORITY' && item.floodLimit > item.threshold)).toBe(true);
      await expect(page.getByRole('region', { name: 'Underwriting referral', exact: true })).toContainText('500,000');
      await expect(page.getByRole('region', { name: 'Underwriting referral', exact: true })).toContainText('requires approval');
    } else {
      const reasons = detail.quote?.referrals.map(item => item.reason).join(' ') ?? '';
      expect(reasons.toLowerCase()).toContain(reason.toLowerCase());
    }
  }
  return { objectIds: { ...state.objectIds }, details: { quote: detail.quote } };
}

async function attachSurvey(page: Page, step: CompiledStep, state: ExecutionState): Promise<StepResult> {
  const policy = policyReference(state, step.inputs.policy);
  const location = locationReference(state, step.inputs.location);
  expect(location.policyId).toBe(policy.id);
  if (step.inputs.document !== 'approved-synthetic-survey@1') throw new Error(`Unsupported survey fixture: ${String(step.inputs.document)}`);
  await openPolicy(page, policy.id, step.actor);
  await page.getByRole('button', { name: 'Attach risk survey', exact: true }).click();
  await page.getByRole('combobox', { name: 'Survey location', exact: true }).selectOption(location.id);
  await page.getByLabel('Document name', { exact: true }).fill('Approved synthetic survey');
  await page.getByRole('checkbox', { name: /^Suitable risk survey/ }).setChecked(true);
  const result = await observe<{ policy: Policy; document: { id: string; locationId: string; suitable: boolean } }>(page, 'POST', `/api/insurance/policies/${policy.id}/documents`, () => page.getByRole('button', { name: 'Attach survey', exact: true }).click());
  expect(result.document.locationId).toBe(location.id);
  expect(result.document.suitable).toBe(true);
  return { objectIds: { ...state.objectIds, document: result.document.id }, details: result };
}

async function approveQuote(page: Page, step: CompiledStep, state: ExecutionState): Promise<StepResult> {
  const policy = policyReference(state, step.inputs.policy);
  const quote = quoteReference(state, step.inputs.quote);
  expect(quote.policyId).toBe(policy.id);
  const detail = await openPolicy(page, policy.id, step.actor);
  expect(detail.quote?.id).toBe(quote.id);
  await page.getByRole('button', { name: 'Approve referral', exact: true }).click();
  await page.getByLabel('Approval notes', { exact: true }).fill(String(step.inputs.notes ?? 'Survey reviewed for the referenced quote.'));
  const result = await observe<{ policy: Policy; quote: Quote }>(page, 'POST', `/api/insurance/quotes/${quote.id}/approve`, () => page.getByRole('button', { name: 'Confirm approval', exact: true }).click());
  expect(result.quote.id).toBe(quote.id);
  expect(result.quote.policyId).toBe(policy.id);
  expect(result.quote.status).toBe('Approved');
  await expect(page.getByTestId('policy-status')).toHaveText('Approved');
  bind(state, step.outputs, { approvedQuote: { kind: 'quote', id: quote.id, policyId: policy.id } });
  return { objectIds: { ...state.objectIds }, details: result };
}

async function issuePolicy(page: Page, step: CompiledStep, state: ExecutionState): Promise<StepResult> {
  const policy = policyReference(state, step.inputs.policy);
  const quote = quoteReference(state, step.inputs.quote);
  expect(quote.policyId).toBe(policy.id);
  const detail = await openPolicy(page, policy.id, step.actor);
  expect(detail.quote?.id).toBe(quote.id);
  await page.getByRole('button', { name: 'Issue policy', exact: true }).click();
  const result = await observe<{ policy: Policy; schedule: PolicySchedule }>(page, 'POST', `/api/insurance/policies/${policy.id}/issue`, () => page.getByRole('button', { name: 'Confirm issue', exact: true }).click());
  expect(result.policy.id).toBe(policy.id);
  expect(result.schedule.policyId).toBe(policy.id);
  expect(result.schedule.quoteId).toBe(quote.id);
  await expect(page.getByTestId('policy-status')).toHaveText('Issued');
  bind(state, step.outputs, { issuedPolicy: { kind: 'policy', id: policy.id } });
  return { objectIds: { ...state.objectIds }, details: result };
}

async function expectSchedule(page: Page, step: CompiledStep, state: ExecutionState): Promise<StepResult> {
  const policy = policyReference(state, step.inputs.policy);
  await openPolicy(page, policy.id, step.actor);
  const { schedule } = await observe<{ schedule: PolicySchedule }>(page, 'GET', `/api/insurance/policies/${policy.id}/schedule`, () => page.getByRole('button', { name: 'View schedule', exact: true }).click());
  expect(schedule.policyId).toBe(policy.id);
  expect(schedule.policyVersion).toBe(Number(step.inputs.version));
  expect(schedule.customer.headquartersCountry).toBe(step.inputs.headquartersCountry);
  expect(schedule.issuingMarket).toBe(step.inputs.issuingMarket);
  expect(schedule.locations.map(location => location.name)).toEqual(step.inputs.locations);
  const warehouse = schedule.locations.find(location => location.id === 'warehouse');
  expect(warehouse).toBeDefined();
  expect(warehouse!.country).toBe(step.inputs.warehouseCountry);
  expect(warehouse!.sumInsured).toBe(Number(step.inputs.warehouseSumInsured));
  expect(warehouse!.coverages.find(item => item.type === 'Flood')?.limit ?? 0).toBe(Number(step.inputs.warehouseFloodLimit));
  const dialog = page.getByRole('dialog', { name: 'Policy schedule', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('schedule-location-warehouse')).toContainText(COUNTRY_NAMES[warehouse!.country]);
  await expect(dialog.getByTestId('schedule-location-warehouse')).toContainText(Number(step.inputs.warehouseSumInsured).toLocaleString('en-GB'));
  await expect(dialog.getByTestId('schedule-location-factory')).toContainText('Germany');
  await expect(dialog.getByTestId('schedule-version')).toContainText(String(step.inputs.version));
  return { objectIds: { ...state.objectIds }, details: { schedule } };
}

async function amendPolicy(page: Page, step: CompiledStep, state: ExecutionState): Promise<StepResult> {
  const policy = policyReference(state, step.inputs.policy);
  const location = locationReference(state, step.inputs.location);
  expect(location.policyId).toBe(policy.id);
  const before = await openPolicy(page, policy.id, step.actor);
  await page.getByRole('button', { name: 'Amend policy', exact: true }).click();
  await page.getByLabel('Amendment effective date', { exact: true }).fill(String(step.inputs.effectiveDate));
  await page.getByLabel('Amendment reason', { exact: true }).fill(String(step.inputs.reason));
  await page.getByRole('combobox', { name: 'Amendment location', exact: true }).selectOption(location.id);
  await page.getByRole('spinbutton', { name: 'Amended sum insured', exact: true }).fill(String(step.inputs.sumInsured));
  const result = await observe<{ policy: Policy; amendment: { id: string; previousVersion: number; version: number }; schedule: PolicySchedule }>(page, 'POST', `/api/insurance/policies/${policy.id}/amendments`, () => page.getByRole('button', { name: 'Save amendment', exact: true }).click());
  expect(result.policy.id).toBe(policy.id);
  expect(result.policy.version).toBe(before.policy.version + 1);
  expect(result.amendment.previousVersion).toBe(before.policy.version);
  expect(result.policy.locations.find(item => item.id === location.id)?.sumInsured).toBe(Number(step.inputs.sumInsured));
  await expect(page.getByTestId('policy-status')).toHaveText('Issued');
  bind(state, step.outputs, { amendedPolicy: { kind: 'policy', id: policy.id } });
  return { objectIds: { ...state.objectIds, amendment: result.amendment.id }, details: result };
}

async function attemptBrokerApproval(page: Page, step: CompiledStep, state: ExecutionState): Promise<StepResult> {
  const policy = policyReference(state, step.inputs.policy);
  const quote = quoteReference(state, step.inputs.quote);
  expect(quote.policyId).toBe(policy.id);
  expect(step.actor).toBe('Broker');
  const detail = await openPolicy(page, policy.id, step.actor);
  expect(detail.quote?.id).toBe(quote.id);
  expect(detail.quote?.status).toBe('Referred');
  const button = page.getByRole('button', { name: 'Approve referral', exact: true });
  await expect(button).toBeVisible();
  let denial: Extract<RuntimeReference, { kind: 'attempt' }>;
  if (await button.isDisabled()) {
    await expect(button).toBeDisabled();
    await expect(page.getByText('Acting as Broker. Switch to Senior underwriter to review and approve this quote.', { exact: true })).toBeVisible();
    denial = { kind: 'attempt', id: `attempt-${randomUUID()}`, policyId: policy.id, quoteId: quote.id, denied: true, mechanism: 'disabled-role-control', message: 'The application disables referral approval while acting as Broker.' };
  } else {
    await button.click();
    await page.getByLabel('Approval notes', { exact: true }).fill('Intentional broker permission test');
    const pending = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === `/api/insurance/quotes/${quote.id}/approve`);
    await page.getByRole('button', { name: 'Confirm approval', exact: true }).click();
    const response = await pending;
    expect(response.status()).toBe(403);
    const body = await response.json();
    await expect(page.getByRole('alert')).toContainText(body.error);
    denial = { kind: 'attempt', id: `attempt-${randomUUID()}`, policyId: policy.id, quoteId: quote.id, denied: true, mechanism: 'application-response', status: response.status(), message: body.error };
  }
  bind(state, step.outputs, { attempt: denial });
  return { objectIds: { ...state.objectIds }, details: { attempt: denial } };
}

async function expectAccessDenied(page: Page, step: CompiledStep, state: ExecutionState): Promise<StepResult> {
  const attempt = reference(state, step.inputs.attempt, 'attempt') as Extract<RuntimeReference, { kind: 'attempt' }>;
  expect(attempt.denied).toBe(true);
  const detail = await openPolicy(page, attempt.policyId, step.actor);
  expect(detail.quote?.id).toBe(attempt.quoteId);
  expect(detail.quote?.status).toBe('Referred');
  await expect(page.getByTestId('policy-status')).toHaveText('Referred');
  return { objectIds: { ...state.objectIds }, details: { attempt, unchangedQuote: detail.quote } };
}

async function expectPolicy(page: Page, step: CompiledStep, state: ExecutionState): Promise<StepResult> {
  const policy = policyReference(state, step.inputs.policy);
  const detail = await openPolicy(page, policy.id, step.actor);
  expect(detail.policy.status).toBe(step.inputs.status);
  expect(detail.policy.version).toBe(Number(step.inputs.version));
  await expect(page.getByTestId('policy-status')).toHaveText(String(step.inputs.status));
  return { objectIds: { ...state.objectIds }, details: detail as unknown as Record<string, unknown> };
}

/** Business operation bindings are maintained once and shared by Studio and exported specs. */
export const insuranceOperations: Record<string, (page: Page, step: CompiledStep, state: ExecutionState) => Promise<StepResult>> = {
  createDraft, requestQuote, expectQuote, attachSurvey, approveQuote, issuePolicy,
  expectSchedule, amendPolicy, attemptBrokerApproval, expectAccessDenied, expectPolicy,
};

export async function executeCompiledStep(page: Page, step: CompiledStep, state: ExecutionState): Promise<StepResult> {
  const operation = insuranceOperations[step.operation];
  if (!operation) throw new Error(`No browser implementation is registered for "${step.operation}".`);
  return operation(page, step, state);
}

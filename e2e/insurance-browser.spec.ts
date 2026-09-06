import { test, expect } from '@playwright/test';
import { createStandardDraft, ITALIAN_WAREHOUSE_ADDRESS, type Role } from '../shared/insurance';
import type { BlockValue, CompiledStep, PolicyConfiguration } from '../shared/blocks';
import { createExecutionState, executeCompiledStep } from './helpers/insurance-driver';

function configuration(floodLimit: number): PolicyConfiguration {
  const { customerId: _customerId, source: _source, runId: _runId, ...draft } = createStandardDraft();
  const warehouse = draft.locations.find(location => location.id === 'warehouse')!;
  warehouse.country = 'IT';
  warehouse.address = { ...ITALIAN_WAREHOUSE_ADDRESS };
  warehouse.coverages.push({ type: 'Flood', limit: floodLimit, deductible: 5000 });
  return { ...draft, customer: { name: 'Linden Browser Manufacturing GmbH', registrationNumber: 'HRB-TEST-1234', headquartersCountry: 'DE', address: { line1: 'Werkstrasse 18', city: 'Stuttgart', postcode: '70327' }, industry: 'Manufacturing', contactName: 'Elena Weber', email: 'synthetic@folio.test' } };
}

function step(operation: string, inputs: Record<string, BlockValue>, outputs: Record<string, string> = {}, actor: Role = 'Broker'): CompiledStep {
  return { id: operation, instanceId: operation, definition: { id: `property.${operation}`, version: 1 }, label: operation, kind: operation.startsWith('expect') ? 'verification' : 'action', operation, actor, inputs, outputs, ancestors: [], implementationRef: `browser.${operation}@1` };
}
const ref = (name: string) => ({ ref: name });

test('broker creates a customer and multi-location policy through all six wizard steps and issues an automatic quote', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const state = createExecutionState(page);
  const config = configuration(500_000);
  const steps = [
    step('createDraft', { configuration: config as unknown as BlockValue }, { policy: 'policy', warehouse: 'warehouse', factory: 'factory', customer: 'customer' }),
    step('expectPolicy', { policy: ref('policy'), status: 'Draft', version: 1 }),
    step('requestQuote', { policy: ref('policy') }, { quote: 'quote' }),
    step('expectQuote', { quote: ref('quote'), status: 'Quoted' }),
    step('issuePolicy', { policy: ref('policy'), quote: ref('quote') }, { issuedPolicy: 'issued' }),
    step('expectSchedule', { policy: ref('issued'), warehouseCountry: 'IT', warehouseFloodLimit: 500_000, warehouseSumInsured: 1_500_000, version: 1, headquartersCountry: 'DE', issuingMarket: 'DE', locations: ['Factory', 'Warehouse'] }),
  ];
  for (const current of steps) await test.step(current.operation, () => executeCompiledStep(page, current, state));
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('issued-schedule-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 900, height: 1050 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('issued-schedule-small.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Policy schedule', exact: true })).not.toBeVisible();
  await page.getByRole('tab', { name: 'Overview', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Locations', exact: true })).toHaveAttribute('aria-selected', 'true');
});

test('senior underwriter resolves the exact referred quote and independently amends the issued warehouse', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const state = createExecutionState(page);
  const config = configuration(1_000_000);
  const steps = [
    step('createDraft', { configuration: config as unknown as BlockValue }, { policy: 'policy', warehouse: 'warehouse', factory: 'factory', customer: 'customer' }),
    step('requestQuote', { policy: ref('policy') }, { quote: 'quote' }),
    step('expectQuote', { quote: ref('quote'), status: 'Referred', reason: 'FLOOD_AUTHORITY' }),
    step('attemptBrokerApproval', { policy: ref('policy'), quote: ref('quote') }, { attempt: 'denied' }),
    step('expectAccessDenied', { attempt: ref('denied') }),
    step('attachSurvey', { policy: ref('policy'), location: ref('warehouse'), document: 'approved-synthetic-survey@1' }, {}, 'Senior underwriter'),
    step('approveQuote', { policy: ref('policy'), quote: ref('quote'), notes: 'Approved synthetic survey reviewed' }, { approvedQuote: 'approved' }, 'Senior underwriter'),
    step('issuePolicy', { policy: ref('policy'), quote: ref('approved') }, { issuedPolicy: 'issued' }),
    step('expectSchedule', { policy: ref('issued'), warehouseCountry: 'IT', warehouseFloodLimit: 1_000_000, warehouseSumInsured: 1_500_000, version: 1, headquartersCountry: 'DE', issuingMarket: 'DE', locations: ['Factory', 'Warehouse'] }),
    step('amendPolicy', { policy: ref('issued'), location: ref('warehouse'), sumInsured: 2_000_000, effectiveDate: config.inceptionDate, reason: 'Updated declared warehouse value' }, { amendedPolicy: 'amended' }, 'Senior underwriter'),
    step('expectSchedule', { policy: ref('amended'), warehouseCountry: 'IT', warehouseFloodLimit: 1_000_000, warehouseSumInsured: 2_000_000, version: 2, headquartersCountry: 'DE', issuingMarket: 'DE', locations: ['Factory', 'Warehouse'] }),
  ];
  for (const current of steps) await test.step(current.operation, () => executeCompiledStep(page, current, state));
  expect(state.objectIds.issued).toBe(state.objectIds.amended);
  expect(state.objectIds.quote).toBe(state.objectIds.approved);
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('amended-schedule.png'), fullPage: true });
});

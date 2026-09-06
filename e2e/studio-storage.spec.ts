import { randomUUID } from 'node:crypto';
import { test, expect, type APIRequestContext } from '@playwright/test';
import type { BlockDefinition, BlockInstance, CompiledScenario, DependencyGraph, PromotionResult, Scenario, StudioCatalog, TextResolution, ValidationResult } from '../shared/blocks';
import { api } from './helpers/api';

function find(blocks: BlockInstance[], id: string): BlockInstance {
  for (const block of blocks) {
    if (block.id === id) return block;
    const nested = [...(block.children ?? []), ...(block.changes ?? [])];
    try { return find(nested, id); } catch { /* Search the next sibling. */ }
  }
  throw new Error(`Block ${id} was not found.`);
}

const duplicate = (request: APIRequestContext, id: string, name: string) => api<Scenario>(request, 'POST', `/api/studio/scenarios/${id}/duplicate`, { name: `${name} ${randomUUID().slice(0, 8)}` });

async function confirmedItaly(request: APIRequestContext) {
  let scenario = await duplicate(request, 'italy-referral', 'QA scoped interpretation');
  const preview = await api<TextResolution>(request, 'POST', '/api/studio/interpret', { scenario, instanceId: 'warehouse-country-text' });
  expect(preview.status).toBe('preview');
  expect(preview.changes).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'locations.Warehouse.country', value: 'IT' }), expect.objectContaining({ field: 'locations.Warehouse.address', value: { line1: 'Via delle Officine 24', city: 'Milan', postcode: '20126' } })]));
  expect(preview.preserved).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'customer.headquartersCountry', value: 'DE' }), expect.objectContaining({ field: 'issuingMarket', value: 'DE' }), expect.objectContaining({ field: 'locations.Factory.country', value: 'DE' })]));
  const resolution = await api<TextResolution>(request, 'POST', `/api/studio/resolutions/${preview.id}/confirm`, { scenario, instanceId: 'warehouse-country-text' });
  expect(resolution.status).toBe('confirmed');
  expect(resolution.decisionId).toBeTruthy();
  find(scenario.blocks, 'warehouse-country-text').resolutionId = resolution.id;
  scenario = await api<Scenario>(request, 'PUT', `/api/studio/scenarios/${scenario.id}`, scenario);
  return { scenario, resolution };
}

test('canonical saves retain revisions, reject stale writers, and keep layout separate', async ({ request }) => {
  const original = await duplicate(request, 'standard-draft', 'QA versioned save');
  const saved = await api<Scenario>(request, 'PUT', `/api/studio/scenarios/${original.id}`, { ...original, description: 'First saved description' });
  expect(saved.revision).toBe(original.revision + 1);
  const stale = await request.put(`/api/studio/scenarios/${original.id}`, { data: { ...original, description: 'Stale tab must not overwrite' } });
  expect(stale.status()).toBe(409);
  const reloaded = await api<Scenario>(request, 'GET', `/api/studio/scenarios/${original.id}`);
  expect(reloaded.description).toBe('First saved description');
  await api(request, 'PUT', `/api/studio/scenarios/${original.id}/layout`, { id: original.id, scenarioId: original.id, scenarioRevision: saved.revision, collapsed: ['standard-broker'], viewport: { x: 12, y: 40, zoom: 0.8 } });
  const afterLayout = await api<Scenario>(request, 'GET', `/api/studio/scenarios/${original.id}`);
  expect(afterLayout).toEqual(reloaded);
  const history = await api<Scenario[]>(request, 'GET', `/api/studio/scenarios/${original.id}/revisions`);
  expect(history.map(item => item.revision)).toEqual(expect.arrayContaining([original.revision, saved.revision]));
});

test('confirmed text resolves only its location and edits or scope moves invalidate that decision', async ({ request }) => {
  const { scenario, resolution } = await confirmedItaly(request);
  const compiled = await api<CompiledScenario>(request, 'POST', '/api/studio/compile', { scenario });
  const resolved = compiled.resolvedConfigurations[0].configuration;
  expect(resolved.locations.find(location => location.id === 'warehouse')!.country).toBe('IT');
  expect(resolved.customer.headquartersCountry).toBe('DE');
  expect(resolved.issuingMarket).toBe('DE');
  expect(resolved.locations.find(location => location.id === 'factory')!.country).toBe('DE');
  expect(compiled.resolutionIds).toContain(resolution.id);

  const edited = structuredClone(scenario);
  find(edited.blocks, 'warehouse-country-text').inputs.text = 'This location should be in Germany instead of Italy';
  const invalid = await api<ValidationResult>(request, 'POST', '/api/studio/validate', { scenario: edited });
  expect(invalid.valid).toBe(false);
  expect(invalid.issues.some(issue => /interpret|confirm|stale/i.test(issue.message))).toBe(true);
  const moved = structuredClone(scenario);
  find(moved.blocks, 'warehouse-scope').inputs.location = 'Factory';
  const wrongScope = await api<ValidationResult>(request, 'POST', '/api/studio/validate', { scenario: moved });
  expect(wrongScope.valid).toBe(false);
  const staleConfirmation = await request.post(`/api/studio/resolutions/${resolution.id}/confirm`, { data: { scenario: edited, instanceId: 'warehouse-country-text' } });
  expect(staleConfirmation.status()).toBe(409);
});

test('ambiguous language, explicit conflicts, and ordinary broker approval remain invalid authoring', async ({ request }) => {
  const { scenario } = await confirmedItaly(request);
  const ambiguous = structuredClone(scenario);
  find(ambiguous.blocks, 'warehouse-country-text').inputs.text = 'Increase the coverage';
  const interpretation = await request.post('/api/studio/interpret', { data: { scenario: ambiguous, instanceId: 'warehouse-country-text' } });
  expect(interpretation.status()).toBe(422);
  expect((await interpretation.json()).error).toMatch(/precise|supported|limit|coverage/i);
  const conflict = structuredClone(scenario);
  find(conflict.blocks, 'warehouse-scope').changes!.push({ id: 'conflicting-country', definition: { id: 'location.set-country', version: 1 }, inputs: { country: 'DE' } });
  const validation = await api<ValidationResult>(request, 'POST', '/api/studio/validate', { scenario: conflict });
  expect(validation.valid).toBe(false);
  expect(validation.issues.some(issue => /conflict/i.test(issue.message))).toBe(true);
  const wrongRole = structuredClone(scenario);
  find(wrongRole.blocks, 'underwriter').inputs.role = 'Broker';
  const roleValidation = await api<ValidationResult>(request, 'POST', '/api/studio/validate', { scenario: wrongRole });
  expect(roleValidation.valid).toBe(false);
  expect(roleValidation.issues.some(issue => issue.code === 'ROLE_NOT_ALLOWED')).toBe(true);
  const negative = await api<Scenario>(request, 'GET', '/api/studio/scenarios/broker-approval-denied');
  const intentional = await api<ValidationResult>(request, 'POST', '/api/studio/validate', { scenario: negative });
  expect(intentional.valid).toBe(true);
});

test('a workflow used twice has isolated steps and references with independently resolved parameters', async ({ request }) => {
  const catalog = await api<StudioCatalog>(request, 'GET', '/api/studio/catalog');
  const definition = catalog.definitions.find(item => item.id === 'workflow.issue-referred' && item.version === 1)!;
  const workflow = (id: string, country: string, floodLimit: number): BlockInstance => ({
    id, definition: { id: definition.id, version: 1 }, inputs: { country, floodLimit, sumInsured: 1_500_000, survey: 'approved-synthetic-survey@1' },
    outputs: Object.fromEntries(definition.outputs.map(output => [output.key, `${id}.${output.key}`])),
  });
  const scenario = await api<Scenario>(request, 'POST', '/api/studio/scenarios', { name: `QA workflow twice ${randomUUID().slice(0, 8)}`, blocks: [workflow('first', 'IT', 600_000), workflow('second', 'DE', 750_000)] });
  const compiled = await api<CompiledScenario>(request, 'POST', '/api/studio/compile', { scenario });
  expect(new Set(compiled.steps.map(item => item.id)).size).toBe(compiled.steps.length);
  const symbols = compiled.steps.flatMap(item => Object.values(item.outputs));
  expect(new Set(symbols).size).toBe(symbols.length);
  expect(compiled.steps.filter(item => item.operation === 'createDraft')).toHaveLength(2);
  expect(compiled.resolvedConfigurations.map(item => item.configuration.locations.find(location => location.id === 'warehouse')!.country)).toEqual(['IT', 'DE']);
  expect(compiled.resolvedConfigurations.map(item => item.configuration.locations.find(location => location.id === 'warehouse')!.coverages.find(coverage => coverage.type === 'Flood')!.limit)).toEqual([600_000, 750_000]);
  expect(compiled.steps.filter(item => item.id.startsWith('second/')).every(item => !JSON.stringify(item.inputs).includes('first.'))).toBe(true);
  expect(compiled.generatedSource).toContain('test.step');
  expect(compiled.generatedSource).toContain('executeCompiledStep');
  expect(compiled.generatedSource).not.toMatch(/openai|anthropic|prompt/i);
});

test('promoting a sequence creates a shared definition while publishing a new version preserves pinned uses', async ({ request }) => {
  const scenario = await duplicate(request, 'standard-draft', 'QA promotion');
  const promoted = await api<PromotionResult>(request, 'POST', '/api/studio/promote', { scenarioId: scenario.id, instanceIds: ['standard-broker'], name: `QA create a draft ${randomUUID().slice(0, 8)}`, description: 'A reusable draft creation sequence', parameters: [], replaceSelection: true });
  expect(promoted.definition.kind).toBe('workflow');
  expect(promoted.definition.version).toBe(1);
  expect(promoted.scenario.blocks[0].definition).toEqual({ id: promoted.definition.id, version: 1 });
  const before = await api<CompiledScenario>(request, 'POST', '/api/studio/compile', { scenario: promoted.scenario });
  const updated: BlockDefinition = { ...promoted.definition, description: 'A new shared documentation revision' };
  const next = await api<{ definition: BlockDefinition; dependents: unknown[] }>(request, 'POST', `/api/studio/definitions/${encodeURIComponent(promoted.definition.id)}/versions`, { definition: updated });
  expect(next.definition.version).toBe(2);
  const unchanged = await api<Scenario>(request, 'GET', `/api/studio/scenarios/${scenario.id}`);
  expect(unchanged.blocks[0].definition.version).toBe(1);
  const after = await api<CompiledScenario>(request, 'POST', '/api/studio/compile', { scenario: unchanged });
  expect(after.steps).toEqual(before.steps);
  expect(after.blockVersions).toContainEqual({ id: promoted.definition.id, version: 1 });
  const graph = await api<DependencyGraph>(request, 'GET', `/api/studio/graph?scenarioId=${scenario.id}`);
  expect(graph.nodes.some(node => node.kind === 'scenario')).toBe(true);
  expect(graph.nodes.some(node => node.kind === 'instance')).toBe(true);
  expect(graph.nodes.some(node => node.kind === 'definition')).toBe(true);
  expect(graph.nodes.some(node => node.kind === 'implementation')).toBe(true);
  expect(graph.nodes.some(node => node.kind === 'knowledge')).toBe(true);
  const nodes = new Set(graph.nodes.map(node => node.id));
  expect(graph.edges.every(edge => nodes.has(edge.source) && nodes.has(edge.target))).toBe(true);
});

import type { TestingCatalog, TestingLocator, TestingTechnicalBinding, TestingUIRecipeAction, TestingValue } from '../../../shared/testing';
import { validateTestingBinding } from './validation';

const p = (key: string): TestingValue => ({ param: key });
/** These are reviewed starter recipes, not results attributed to an AI call. */
export function createStarterBindings(catalog: TestingCatalog): TestingTechnicalBinding[] {
  const result: TestingTechnicalBinding[] = [];
  const make = (operation: string, configure: (locators: TestingLocator[], recipe: TestingUIRecipeAction[]) => void) => {
    const definitions = catalog.definitions.filter(item => item.operation === operation);
    if (!definitions.length) return;
    const existing = catalog.bindings.filter(item => item.operation === operation);
    const ready = existing.filter(item => item.status === 'ready').sort((a, b) => b.revision - a.revision)[0];
    if (ready && (!ready.changeReason.startsWith('Mitgelieferte deklarative Portalbindung.') || ready.revision >= 3)) return;
    const bindingId = definitions[0].bindingId ?? `ui.${operation}`;
    const locators: TestingLocator[] = [], recipe: TestingUIRecipeAction[] = [];
    configure(locators, recipe);
    const binding: TestingTechnicalBinding = { id: bindingId, revision: Math.max(3, Math.max(0, ...existing.filter(item => item.id === bindingId).map(item => item.revision)) + 1),
      operation, name: `Portal: ${definitions[0].name}`, status: 'ready', definitionRefs: definitions.map(item => ({ id: item.id, version: item.version })),
      knowledgeRefs: ['technik.portal'], module: 'e2e/helpers/agriculture-driver.ts', export: 'executeTestingStep', locators, recipe,
      inputKeys: [...new Set(definitions.flatMap(item => item.inputs.map(input => input.key)))],
      changeReason: 'Mitgelieferte deklarative Portalbindung. Jeder fachliche Wert wird über die UI gesetzt oder gegen eine echte Portalantwort geprüft.', createdAt: new Date().toISOString() };
    result.push(validateTestingBinding(binding, catalog));
  };
  const button = (locators: TestingLocator[], key: string, label: string) => { locators.push({ key, method: 'role', role: 'button', value: label, exact: true }); return key; };
  const field = (locators: TestingLocator[], key: string, label: string) => { locators.push({ key, method: 'label', value: label, exact: true }); return key; };
  const fields = (locators: TestingLocator[], recipe: TestingUIRecipeAction[], items: [string, string, ('fill' | 'select')?][]) => {
    for (const [key, label, op] of items) recipe.push({ op: op ?? 'fill', locatorKey: field(locators, key, label), value: p(key) });
  };
  const click = (locators: TestingLocator[], recipe: TestingUIRecipeAction[], key: string, label: string, capture?: TestingUIRecipeAction['capture']) => recipe.push({ op: 'click', locatorKey: button(locators, key, label), ...(capture ? { capture } : {}) });
  const response = (path: string, entity: string, keys: string[], outputs: Record<string, string>, status = 201): TestingUIRecipeAction['capture'] => ({ method: 'POST', path, status, outputs,
    expect: Object.fromEntries(keys.map(key => [`${entity}.${key}`, p(key)])) });
  const proposalRoute: TestingUIRecipeAction = { op: 'goto', value: '/portal/vorschlaege/{{proposalId}}' };
  const policyRoute: TestingUIRecipeAction = { op: 'goto', value: '/portal/policen/{{policyId}}' };

  make('createCustomer', (l, r) => {
    r.push({ op: 'goto', value: '/portal/neu?runId={{runId}}' }); click(l, r, 'new', 'Neuen Kunden erfassen'); r.at(-1)!.unlessVisible = 'name';
    fields(l, r, [['name', 'Name des Kunden'], ['email', 'E-Mail'], ['phone', 'Telefon'], ['street', 'Kundenstraße'], ['postalCode', 'Kundenpostleitzahl'], ['city', 'Kundenort']]);
    click(l, r, 'save', 'Kunde speichern', response('/api/agriculture/customers', 'customer', ['name', 'email', 'phone', 'street', 'postalCode', 'city'], { customer: 'customer.id' }));
  });
  make('createFarm', (l, r) => {
    r.push({ op: 'goto', value: '/portal/neu?runId={{runId}}' }, { op: 'select', locatorKey: field(l, 'customer', 'Kunde auswählen'), value: p('customerId') });
    click(l, r, 'next', 'Weiter zu Betrieb'); click(l, r, 'new', 'Neuen Betrieb erfassen'); r.at(-1)!.unlessVisible = 'name';
    fields(l, r, [['name', 'Betriebsname'], ['state', 'Bundesland', 'select'], ['street', 'Betriebsstraße'], ['postalCode', 'Betriebspostleitzahl'], ['city', 'Betriebsort'], ['farmType', 'Betriebsart', 'select']]);
    click(l, r, 'save', 'Betrieb speichern', response('/api/agriculture/farms', 'farm', ['customerId', 'name', 'state', 'street', 'postalCode', 'city', 'farmType'], { farm: 'farm.id' }));
  });
  make('createAnimal', (l, r) => {
    click(l, r, 'next', 'Weiter zu Tier / Bestand'); click(l, r, 'new', 'Neues Tier erfassen'); r.at(-1)!.unlessVisible = 'species';
    fields(l, r, [['species', 'Tierart', 'select'], ['name', 'Name des Tiers oder Bestands'], ['sumInsured', 'Versicherungssumme in EUR']]);
    const conditional: [string, string, ('fill' | 'select')?][] = [['earTag', 'Ohrmarke'], ['breed', 'Rasse'], ['birthDate', 'Geburtsdatum'], ['use', 'Nutzung', 'select'], ['chipNumber', 'Chipnummer'], ['health', 'Gesundheitszustand', 'select'], ['healthNotes', 'Gesundheitsangaben'], ['animalCount', 'Anzahl Schweine'], ['housing', 'Haltungsform', 'select'], ['biosecurity', 'Biosicherheit', 'select']];
    for (const [key, label, op] of conditional) r.push({ op: op ?? 'fill', locatorKey: field(l, key, label), value: p(key), when: { input: key, present: true } });
    click(l, r, 'save', 'Tier speichern', response('/api/agriculture/animals', 'animal', ['farmId', 'species', 'name', 'sumInsured'], { animal: 'animal.id' }));
  });
  make('createProposal', (l, r) => {
    click(l, r, 'next', 'Weiter zu Vorschlag'); fields(l, r, [['product', 'Versicherungsprodukt', 'select'], ['startDate', 'Versicherungsbeginn']]);
    click(l, r, 'save', 'Vorschlag speichern', response('/api/agriculture/proposals', 'proposal', ['customerId', 'farmId', 'animalIds', 'product', 'startDate', 'durationMonths'], { proposal: 'proposal.id' }));
  });
  make('calculateOffer', (l, r) => { r.push(proposalRoute); click(l, r, 'calculate', 'Angebot berechnen', response('/api/agriculture/proposals/*/offer', 'proposal', [], {}, 200)); });
  make('submitProposal', (l, r) => { r.push(proposalRoute); click(l, r, 'submit', 'Antrag einreichen', { method: 'POST', path: '/api/agriculture/proposals/*/submit', status: 200, outputs: { referral: 'proposal.referralId' } }); });
  make('decideReferral', (l, r) => { r.push(proposalRoute); fields(l, r, [['decision', 'Entscheidung', 'select'], ['reason', 'Begründung der Entscheidung']]); click(l, r, 'decide', 'Entscheidung speichern', { method: 'POST', path: '/api/agriculture/referrals/*/decision', status: 200, outputs: {}, expect: { 'referral.decision': p('decision'), 'referral.decisionReason': p('reason') } }); });
  make('completeContract', (l, r) => { r.push(proposalRoute); click(l, r, 'complete', 'Vertrag abschließen', { method: 'POST', path: '/api/agriculture/proposals/*/complete', status: 200, outputs: { contract: 'contract.id', policy: 'policy.id', document: 'document.id' }, expect: { 'proposal.id': p('proposalId') } }); });
  make('reissuePolicy', (l, r) => { r.push(policyRoute); fields(l, r, [['reason', 'Grund der erneuten Ausgabe']]); click(l, r, 'reissue', 'Police erneut ausgeben', { method: 'POST', path: '/api/agriculture/policies/*/reissue', status: 200, outputs: { document: 'document.id' }, expect: { 'policy.id': p('policyId'), 'document.reason': p('reason') } }); });
  make('printPolicy', (l, r) => { r.push(policyRoute); fields(l, r, [['documentId', 'Dokumentversion', 'select']]); click(l, r, 'print', 'Police drucken', { method: 'POST', path: '/api/agriculture/policies/*/print', status: 200, outputs: {}, expect: { 'policy.id': p('policyId'), 'document.id': p('documentId'), 'printEvent.documentId': p('documentId'), 'printEvent.role': 'Sachbearbeiter' } }); });
  make('expectProposalStatus', (l, r) => { r.push(proposalRoute); l.push({ key: 'status', method: 'testId', value: 'proposal-status' }); r.push({ op: 'expectText', locatorKey: 'status', value: p('expectedStatus') }); });
  make('expectPrint', (l, r) => { r.push(policyRoute); l.push({ key: 'printed', method: 'testId', value: 'print-confirmation' }); r.push({ op: 'expectVisible', locatorKey: 'printed' }); });
  return result;
}

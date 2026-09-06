import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import express from 'express';
import { bayernFarm, STANDARD_CUSTOMER, standardCow, standardFarm } from '../../shared/agriculture';
import type { AgricultureAnimal, AgricultureAnimalInput, AgriculturePrintEvent, AgricultureProposal, PolicyDocument, ProposalInput } from '../../shared/agriculture';

const directory = mkdtempSync(join(tmpdir(), 'folio-agriculture-unit-'));
const isolatedDataFile = join(directory, 'data.json');
process.env.FOLIO_DATA_FILE = isolatedDataFile;
const { db } = await import('../store');
const {
  AgricultureError, collections, completeProposal, createAnimal, createCustomer, createFarm, createProposal,
  decideReferral, getDocument, getOverview, getPolicy, getPolicyDetail, getProposal, getProposalDetail,
  getReferral, makeOffer, printPolicy, reissuePolicy, submitProposal,
} = await import('./domain');
const { seedAgriculture } = await import('./seed');
const { createAgricultureRouter } = await import('./router');

const sentinel = { 'insurance.policies': [{ id: 'alte-police', premium: 123 }], 'studio.sentinel': [{ id: 'unveraendert', value: 42 }] };
beforeEach(() => writeFileSync(isolatedDataFile, JSON.stringify(sentinel)));
after(() => rmSync(directory, { recursive: true, force: true }));

function expectCode(action: () => unknown, code: string, status?: number): void {
  assert.throws(action, error => error instanceof AgricultureError && error.code === code && (status === undefined || error.status === status));
}
function basics(animalInput?: (farmId: string) => AgricultureAnimalInput) {
  const customer = createCustomer(STANDARD_CUSTOMER, 'Vermittler');
  const farm = createFarm(standardFarm(customer.id), 'Vermittler');
  const animal = createAnimal(animalInput ? animalInput(farm.id) : standardCow(farm.id), 'Vermittler');
  return { customer, farm, animal };
}
function draft(values = basics(), extra: Partial<ProposalInput> = {}) {
  return createProposal({ customerId: values.customer.id, farmId: values.farm.id, animalIds: [values.animal.id],
    product: values.animal.species === 'Schwein' ? 'Bestandsversicherung' : 'Tierlebensversicherung',
    startDate: '2026-10-01', durationMonths: 12, ...extra }, 'Vermittler');
}
function ready(proposal = draft()) {
  makeOffer(proposal.id, 'Vermittler');
  const submitted = submitProposal(proposal.id, 'Vermittler');
  if (submitted.referral) decideReferral(submitted.referral.id, { decision: 'Freigeben', reason: 'Summe und Gesundheitsangaben wurden geprüft.' }, 'Direktion');
  return getProposal(proposal.id);
}
function finish(proposal = draft()) { return completeProposal(ready(proposal).id, 'Vermittler'); }
const highCow = (farmId: string): AgricultureAnimalInput => ({ ...standardCow(farmId), sumInsured: 15_000 });

test('Validierung weist unmögliche Daten, falsche Tierfelder und untergeschobene Zustände zurück', () => {
  const { customer, farm } = basics();
  const cow = standardCow(farm.id);
  for (const values of [
    { ...cow, birthDate: '2026-02-30' }, { ...cow, birthDate: '2199-01-01' }, { ...cow, sumInsured: -1 },
    { ...cow, sumInsured: 3_500.001 }, { ...cow, sumInsured: '3500' }, { ...cow, species: 'Gebäude' },
    { ...cow, animalCount: 100 }, { ...cow, earTag: '' }, { ...cow, id: 'agr-animal-fremd' },
  ]) expectCode(() => createAnimal(values as AgricultureAnimalInput, 'Vermittler'), 'INVALID_INPUT', 400);
  expectCode(() => createCustomer({ ...STANDARD_CUSTOMER, email: 'keine-mail' }, 'Vermittler'), 'INVALID_INPUT');
  expectCode(() => createCustomer({ ...STANDARD_CUSTOMER, postalCode: '2952' }, 'Vermittler'), 'INVALID_INPUT');
  const animal = createAnimal(cow, 'Vermittler');
  const input: ProposalInput = { customerId: customer.id, farmId: farm.id, animalIds: [animal.id], product: 'Tierlebensversicherung', startDate: '2026-10-01', durationMonths: 12 };
  expectCode(() => createProposal({ ...input, status: 'Freigegeben' } as ProposalInput, 'Vermittler'), 'INVALID_INPUT');
  expectCode(() => createProposal({ ...input, annualPremium: 1 } as ProposalInput, 'Vermittler'), 'INVALID_INPUT');
  expectCode(() => createProposal({ ...input, durationMonths: 24 } as unknown as ProposalInput, 'Vermittler'), 'INVALID_INPUT');
  expectCode(() => createProposal({ ...input, startDate: '2022-04-14' }, 'Vermittler'), 'ANIMAL_NOT_BORN');
  assert.equal(db.read(collections.proposals).length, 0);
});

test('Standardkuh wird über Angebot und Antrag mit getrennten Kennungen direkt abgeschlossen', () => {
  const data = basics(), proposal = draft(data);
  assert.equal(data.farm.state, 'Niedersachsen');
  assert.equal(proposal.status, 'Entwurf');
  assert.equal(proposal.annualPremium, null);
  expectCode(() => submitProposal(proposal.id, 'Vermittler'), 'SUBMIT_NOT_ALLOWED');
  expectCode(() => completeProposal(proposal.id, 'Vermittler'), 'COMPLETION_NOT_ALLOWED');
  const offered = makeOffer(proposal.id, 'Vermittler').proposal;
  assert.equal(offered.status, 'Angebot');
  assert.equal(offered.annualPremium, 122.5);
  assert.equal(offered.totalSumInsured, 3_500);
  assert.deepEqual(offered.referralReasons, []);
  const submitted = submitProposal(proposal.id, 'Vermittler');
  assert.equal(submitted.proposal.status, 'Freigegeben');
  assert.equal(submitted.referral, null);
  const completed = completeProposal(proposal.id, 'Vermittler');
  assert.equal(completed.proposal.status, 'Abgeschlossen');
  assert.equal(completed.contract.proposalId, proposal.id);
  assert.equal(completed.contract.farmId, data.farm.id);
  assert.deepEqual(completed.contract.animalIds, [data.animal.id]);
  assert.equal(completed.policy.contractId, completed.contract.id);
  assert.equal(completed.policy.documentId, completed.document.id);
  assert.equal(completed.contract.endDate, '2027-09-30');
  assert.equal(completed.document.createdBy, 'Vermittler');
  const allIds = [data.customer.id, data.farm.id, data.animal.id, proposal.id, completed.contract.id, completed.policy.id, completed.document.id];
  assert.equal(new Set(allIds).size, 7);
  expectCode(() => completeProposal(proposal.id, 'Vermittler'), 'ALREADY_COMPLETED');
  expectCode(() => makeOffer(proposal.id, 'Vermittler'), 'OFFER_NOT_ALLOWED');
  db.upsert<AgricultureProposal>(collections.proposals, { ...completed.proposal, status: 'Freigegeben', contractId: null, policyId: null });
  expectCode(() => completeProposal(proposal.id, 'Vermittler'), 'ALREADY_COMPLETED');
  assert.equal(db.read(collections.contracts).length, 1);
  assert.equal(db.read(collections.policies).length, 1);
});

test('Direktionsgrenzen gelten strikt oberhalb des Grenzwerts für jede einzelne Tierart', () => {
  const inputs: { threshold: number; factory: (farmId: string, sumInsured: number) => AgricultureAnimalInput }[] = [
    { threshold: 10_000, factory: (farmId, sumInsured) => ({ ...standardCow(farmId), sumInsured }) },
    { threshold: 50_000, factory: (farmId, sumInsured) => ({ farmId, species: 'Pferd', name: 'Fiona', chipNumber: '276098100001001', breed: 'Hannoveraner', birthDate: '2020-02-29', use: 'Freizeit', health: 'Unauffällig', healthNotes: '', sumInsured }) },
    { threshold: 10_000, factory: (farmId, sumInsured) => ({ farmId, species: 'Hund', name: 'Balu', chipNumber: '276098100001002', breed: 'Border Collie', birthDate: '2021-05-04', use: 'Hütehund', sumInsured }) },
    { threshold: 500_000, factory: (farmId, sumInsured) => ({ farmId, species: 'Schwein', name: 'Mastbestand', animalCount: 500, housing: 'Stallhaltung', biosecurity: 'Erfüllt', sumInsured }) },
  ];
  for (const input of inputs) for (const extra of [0, 0.01]) {
    const values = basics(farmId => input.factory(farmId, input.threshold + extra));
    const proposal = draft(values);
    makeOffer(proposal.id, 'Vermittler');
    const result = submitProposal(proposal.id, 'Vermittler');
    assert.equal(result.proposal.status, extra ? 'Direktionsprüfung' : 'Freigegeben', `${values.animal.species} mit ${input.threshold + extra}`);
    assert.equal(result.referral?.reasons.length ?? 0, extra ? 1 : 0);
  }
});

test('Summen mehrerer Tiere addieren den Beitrag, lösen aber keine gemeinsame Direktionsgrenze aus', () => {
  const data = basics(farmId => ({ ...standardCow(farmId), sumInsured: 10_000 }));
  const second = createAnimal({ ...standardCow(data.farm.id), name: 'Berta', sumInsured: 10_000 }, 'Vermittler');
  const proposal = draft(data, { animalIds: [data.animal.id, second.id] });
  const offer = makeOffer(proposal.id, 'Vermittler').proposal;
  assert.equal(offer.totalSumInsured, 20_000);
  assert.equal(offer.annualPremium, 700);
  assert.equal(submitProposal(proposal.id, 'Vermittler').proposal.status, 'Freigegeben');
  const tiny = draft(basics(farmId => ({ ...standardCow(farmId), sumInsured: 100 })));
  assert.equal(makeOffer(tiny.id, 'Vermittler').proposal.annualPremium, 60);
  const bavarian = createFarm(bayernFarm(data.customer.id), 'Vermittler');
  const bavarianCow = createAnimal({ ...standardCow(bavarian.id), sumInsured: 10_000 }, 'Vermittler');
  const bavarianProposal = draft({ customer: data.customer, farm: bavarian, animal: bavarianCow });
  makeOffer(bavarianProposal.id, 'Vermittler');
  assert.equal(submitProposal(bavarianProposal.id, 'Vermittler').proposal.status, 'Freigegeben');
});

test('Pferdegesundheit und Schweinebiosicherheit verlangen auch unterhalb der Summengrenze eine Entscheidung', () => {
  const horse = basics(farmId => ({ farmId, species: 'Pferd', name: 'Freya', chipNumber: '276098100001003', breed: 'Hannoveraner', birthDate: '2018-05-12', use: 'Sport', health: 'Vorerkrankung', healthNotes: 'Behandelte Sehnenverletzung.', sumInsured: 20_000 }));
  const horseProposal = draft(horse);
  assert.match(makeOffer(horseProposal.id, 'Vermittler').proposal.referralReasons[0], /Vorerkrankung/);
  assert.equal(submitProposal(horseProposal.id, 'Vermittler').proposal.status, 'Direktionsprüfung');
  expectCode(() => createAnimal({ farmId: horse.farm.id, species: 'Pferd', name: 'Freya', chipNumber: '276098100001003', breed: 'Hannoveraner', birthDate: '2018-05-12', use: 'Sport', health: 'Vorerkrankung', healthNotes: '', sumInsured: 20_000 }, 'Vermittler'), 'INVALID_INPUT');
  const pigs = basics(farmId => ({ farmId, species: 'Schwein', name: 'Bestand Süd', animalCount: 200, housing: 'Freilandhaltung', biosecurity: 'Klärung erforderlich', sumInsured: 40_000 }));
  const pigProposal = draft(pigs);
  assert.match(makeOffer(pigProposal.id, 'Vermittler').proposal.referralReasons[0], /Biosicherheit/);
  assert.equal(submitProposal(pigProposal.id, 'Vermittler').proposal.status, 'Direktionsprüfung');
});

test('Hohe Summe erfordert Direktion und erlaubt anschließend nur dem Vermittler den Abschluss', () => {
  const proposal = draft(basics(highCow));
  makeOffer(proposal.id, 'Vermittler');
  const submitted = submitProposal(proposal.id, 'Vermittler');
  const referral = submitted.referral!;
  assert.equal(referral.proposalId, proposal.id);
  assert.equal(referral.customerId, proposal.customerId);
  assert.equal(referral.status, 'Offen');
  assert.match(referral.reasons[0], /15.000,00/);
  expectCode(() => completeProposal(proposal.id, 'Vermittler'), 'COMPLETION_NOT_ALLOWED');
  expectCode(() => decideReferral(referral.id, { decision: 'Freigeben', reason: 'Freigabe' }, 'Vermittler'), 'ROLE_REQUIRED', 403);
  expectCode(() => decideReferral(referral.id, { decision: 'Freigeben', reason: 'Freigabe' }, 'Sachbearbeiter'), 'ROLE_REQUIRED', 403);
  expectCode(() => decideReferral(referral.id, { decision: 'Freigeben', reason: ' ' }, 'Direktion'), 'INVALID_INPUT');
  assert.equal(getProposal(proposal.id).status, 'Direktionsprüfung');
  const result = decideReferral(referral.id, { decision: 'Freigeben', reason: 'Der Zuchtwert wurde nachvollziehbar belegt.' }, 'Direktion');
  assert.equal(result.referral.decidedBy, 'Direktion');
  assert.equal(result.referral.decisionReason, 'Der Zuchtwert wurde nachvollziehbar belegt.');
  assert.ok(result.referral.decidedAt);
  expectCode(() => decideReferral(referral.id, { decision: 'Ablehnen', reason: 'Spätere Änderung' }, 'Direktion'), 'REFERRAL_NOT_OPEN');
  expectCode(() => completeProposal(proposal.id, 'Direktion'), 'ROLE_REQUIRED', 403);
  const completed = completeProposal(proposal.id, 'Vermittler');
  assert.equal(completed.contract.annualPremium, 525);
  assert.equal(getProposalDetail(proposal.id).audit.filter(event => event.action === 'Antrag durch Direktion freigegeben').length, 1);
});

test('Eine begründete Ablehnung bleibt endgültig und erzeugt weder Vertrag noch Police', () => {
  const proposal = draft(basics(highCow));
  makeOffer(proposal.id, 'Vermittler');
  const referral = submitProposal(proposal.id, 'Vermittler').referral!;
  const rejected = decideReferral(referral.id, { decision: 'Ablehnen', reason: 'Die gewünschte Summe ist nicht ausreichend belegt.' }, 'Direktion');
  assert.equal(rejected.proposal.status, 'Abgelehnt');
  assert.equal(rejected.referral.status, 'Abgelehnt');
  expectCode(() => completeProposal(proposal.id, 'Vermittler'), 'COMPLETION_NOT_ALLOWED');
  expectCode(() => submitProposal(proposal.id, 'Vermittler'), 'SUBMIT_NOT_ALLOWED');
  expectCode(() => makeOffer(proposal.id, 'Vermittler'), 'OFFER_NOT_ALLOWED');
  expectCode(() => decideReferral(referral.id, { decision: 'Freigeben', reason: 'Neuer Versuch' }, 'Direktion'), 'REFERRAL_NOT_OPEN');
  assert.equal(db.read(collections.contracts).length, 0);
  assert.equal(db.read(collections.policies).length, 0);
});

test('Kunde, mehrere Betriebe, Tiere und Produkt werden serverseitig auf Zugehörigkeit geprüft', () => {
  const data = basics(), foreign = basics();
  const secondFarm = createFarm(bayernFarm(data.customer.id), 'Vermittler');
  const secondAnimal = createAnimal(standardCow(secondFarm.id), 'Vermittler');
  assert.equal(getOverview().farms.filter(farm => farm.customerId === data.customer.id).length, 2);
  assert.ok(draft({ customer: data.customer, farm: secondFarm, animal: secondAnimal }));
  expectCode(() => draft(data, { customerId: foreign.customer.id }), 'CUSTOMER_FARM_MISMATCH');
  expectCode(() => draft(data, { animalIds: [foreign.animal.id] }), 'ANIMAL_FARM_MISMATCH');
  expectCode(() => draft(data, { animalIds: [secondAnimal.id] }), 'ANIMAL_FARM_MISMATCH');
  expectCode(() => draft(data, { animalIds: [data.animal.id, data.animal.id] }), 'INVALID_INPUT');
  expectCode(() => draft(data, { product: 'Bestandsversicherung' }), 'PRODUCT_SPECIES_MISMATCH');
  expectCode(() => draft(data, { animalIds: ['agr-animal-unbekannt'] }), 'NOT_FOUND', 404);
  expectCode(() => createFarm(standardFarm('agr-customer-unbekannt'), 'Vermittler'), 'NOT_FOUND');
  expectCode(() => createAnimal(standardCow('agr-farm-unbekannt'), 'Vermittler'), 'NOT_FOUND');
  const pigs = basics(farmId => ({ farmId, species: 'Schwein', name: 'Bestand', sumInsured: 10_000, animalCount: 20, housing: 'Stallhaltung', biosecurity: 'Erfüllt' }));
  expectCode(() => draft(pigs, { product: 'Tierlebensversicherung' }), 'PRODUCT_SPECIES_MISMATCH');
});

test('Gespeicherte Angebotsdaten und Direktionszuordnung lassen sich nicht durch veränderte Werte umgehen', () => {
  const proposal = draft();
  const offered = makeOffer(proposal.id, 'Vermittler').proposal;
  db.upsert(collections.proposals, { ...offered, annualPremium: 1 });
  expectCode(() => submitProposal(proposal.id, 'Vermittler'), 'OFFER_CHANGED');
  assert.equal(db.read(collections.referrals).length, 0);
  db.upsert(collections.proposals, offered);
  submitProposal(proposal.id, 'Vermittler');
  const animal = db.find<AgricultureAnimal>(collections.animals, proposal.animalIds[0])!;
  db.upsert(collections.animals, { ...animal, sumInsured: 50_000 });
  expectCode(() => completeProposal(proposal.id, 'Vermittler'), 'OFFER_CHANGED');
  assert.equal(db.read(collections.contracts).length, 0);

  const first = draft(basics(highCow)), second = draft(basics(highCow));
  makeOffer(first.id, 'Vermittler'); makeOffer(second.id, 'Vermittler');
  const firstReferral = submitProposal(first.id, 'Vermittler').referral!;
  const secondReferral = submitProposal(second.id, 'Vermittler').referral!;
  decideReferral(secondReferral.id, { decision: 'Freigeben', reason: 'Summe geprüft.' }, 'Direktion');
  db.upsert<AgricultureProposal>(collections.proposals, { ...getProposal(first.id), status: 'Freigegeben', referralId: secondReferral.id });
  expectCode(() => completeProposal(first.id, 'Vermittler'), 'REFERRAL_MISMATCH');
  db.upsert<AgricultureProposal>(collections.proposals, { ...getProposal(first.id), referralId: null });
  expectCode(() => completeProposal(first.id, 'Vermittler'), 'DIRECTORATE_APPROVAL_REQUIRED');
  assert.equal(getReferral(firstReferral.id).status, 'Offen');
});

test('Nur Sachbearbeiter können unveränderliche Policenausgaben erstellen und exakte Dokumentversionen zum Druck erfassen', () => {
  const data = basics(farmId => ({ ...standardCow(farmId), name: '<script>alert("Tier")</script>' }));
  const completed = finish(draft(data));
  const initial = structuredClone(completed.document);
  const hash = createHash('sha256').update(initial.html).digest('hex');
  assert.equal(initial.sha256, hash);
  assert.ok(initial.html.includes('&lt;script&gt;'));
  assert.equal(initial.html.includes('<script>'), false);
  assert.ok(initial.html.includes(completed.policy.number));
  assert.ok(initial.html.includes(completed.contract.number));
  assert.ok(initial.html.includes(data.animal.number));
  assert.equal(initial.html.includes('Niedersachsen'), true);
  for (const role of ['Vermittler', 'Direktion'] as const) {
    expectCode(() => reissuePolicy(completed.policy.id, { reason: 'Ersatz für verlorene Ausgabe.' }, role), 'ROLE_REQUIRED');
    expectCode(() => printPolicy(completed.policy.id, initial.id, role), 'ROLE_REQUIRED');
  }
  const reissued = reissuePolicy(completed.policy.id, { reason: 'Ersatz für verlorene Ausgabe.' }, 'Sachbearbeiter');
  assert.equal(reissued.policy.version, 2);
  assert.notEqual(reissued.document.id, initial.id);
  assert.notEqual(reissued.document.sha256, initial.sha256);
  assert.equal(reissued.document.createdBy, 'Sachbearbeiter');
  assert.deepEqual(getDocument(initial.id), initial);
  const oldPrint = printPolicy(completed.policy.id, initial.id, 'Sachbearbeiter');
  const newPrint = printPolicy(completed.policy.id, reissued.document.id, 'Sachbearbeiter');
  assert.equal(oldPrint.printEvent.documentId, initial.id);
  assert.equal(oldPrint.printEvent.documentSha256, initial.sha256);
  assert.equal(newPrint.printEvent.documentSha256, reissued.document.sha256);
  assert.equal(newPrint.printEvent.action, 'Druckauftrag erfasst');
  const detail = getPolicyDetail(completed.policy.id);
  assert.deepEqual(detail.documents.map(document => document.version), [1, 2]);
  assert.equal(detail.printEvents.length, 2);
  const audits = getProposalDetail(completed.proposal.id).audit.filter(event => event.action === 'Druckauftrag erfasst');
  assert.equal(audits.length, 2);
  assert.ok(audits.every(event => event.role === 'Sachbearbeiter' && event.documentId && event.documentSha256));
  const other = finish();
  const printCount = db.read(collections.printEvents).length;
  expectCode(() => printPolicy(completed.policy.id, other.document.id, 'Sachbearbeiter'), 'DOCUMENT_POLICY_MISMATCH');
  assert.equal(db.read(collections.printEvents).length, printCount);
});

test('Veränderter Dokumentinhalt verhindert Ausgabeabruf und Drucknachweis', () => {
  const completed = finish();
  db.upsert(collections.documents, { ...completed.document, html: completed.document.html.replace('122,50', '1,00') });
  expectCode(() => getDocument(completed.document.id), 'DOCUMENT_INTEGRITY');
  expectCode(() => printPolicy(completed.policy.id, completed.document.id, 'Sachbearbeiter'), 'DOCUMENT_INTEGRITY');
  expectCode(() => reissuePolicy(completed.policy.id, { reason: 'Ersatzausgabe' }, 'Sachbearbeiter'), 'DOCUMENT_INTEGRITY');
  assert.equal(getPolicy(completed.policy.id).version, 1);
  assert.equal(db.read(collections.printEvents).length, 0);
});

test('Speicherung überlebt einen neuen Prozess und bewahrt alte Daten und Dokumentfassungen', () => {
  const completed = finish(draft(basics(highCow), { runId: 'lauf-persistenz' }));
  const next = reissuePolicy(completed.policy.id, { reason: 'Erneute Zusendung an die Kundin.' }, 'Sachbearbeiter');
  const printed = printPolicy(next.policy.id, next.document.id, 'Sachbearbeiter');
  const contents = JSON.parse(readFileSync(isolatedDataFile, 'utf8')) as Record<string, unknown[]>;
  assert.deepEqual(contents['insurance.policies'], sentinel['insurance.policies']);
  assert.deepEqual(contents['studio.sentinel'], sentinel['studio.sentinel']);
  assert.equal((contents[collections.documents] as PolicyDocument[]).length, 2);
  assert.equal((contents[collections.printEvents] as AgriculturePrintEvent[])[0].documentSha256, next.document.sha256);
  const processResult = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
    `import { getPolicyDetail } from './server/agriculture/domain.ts'; process.stdout.write(JSON.stringify(getPolicyDetail(${JSON.stringify(completed.policy.id)})));`],
  { cwd: process.cwd(), env: { ...process.env, FOLIO_DATA_FILE: isolatedDataFile }, encoding: 'utf8' });
  assert.equal(processResult.status, 0, processResult.stderr);
  const restored = JSON.parse(processResult.stdout);
  assert.equal(restored.policy.version, 2);
  assert.equal(restored.contract.id, completed.contract.id);
  assert.deepEqual(restored.documents[0], completed.document);
  assert.equal(restored.documents[1].sha256, next.document.sha256);
  assert.equal(restored.printEvents[0].id, printed.printEvent.id);
});

test('Übersicht mit Ablaufkennung gibt nur die verbundenen Objekte dieses Ablaufs zurück', () => {
  const selected = finish(draft(basics(), { runId: 'lauf-standard' }));
  finish(draft(basics(highCow), { runId: 'lauf-hoch' }));
  const overview = getOverview('lauf-standard');
  assert.equal(overview.proposals.length, 1);
  assert.equal(overview.customers.length, 1);
  assert.equal(overview.farms.length, 1);
  assert.equal(overview.animals.length, 1);
  assert.equal(overview.referrals.length, 0);
  assert.equal(overview.contracts[0].id, selected.contract.id);
  assert.equal(overview.policies[0].id, selected.policy.id);
  assert.ok(Object.values(getOverview('kein-treffer')).every(records => records.length === 0));
});

test('Demodaten decken die Zustände, Niedersachsen, Bayern und mehrere Betriebe ohne Überschreiben ab', () => {
  seedAgriculture();
  const overview = getOverview();
  assert.deepEqual(new Set(overview.proposals.map(proposal => proposal.status)), new Set(['Entwurf', 'Angebot', 'Direktionsprüfung', 'Freigegeben', 'Abgelehnt', 'Abgeschlossen']));
  const standard = overview.proposals.find(proposal => proposal.runId === 'demo-tier-standard-entwurf')!;
  const standardDetail = getProposalDetail(standard.id);
  assert.equal(standardDetail.animals[0].name, 'Alma');
  assert.equal(standardDetail.animals[0].sumInsured, 3_500);
  assert.equal(standardDetail.farm.state, 'Niedersachsen');
  assert.equal(overview.farms.filter(farm => farm.customerId === standard.customerId).length, 2);
  assert.ok(overview.farms.some(farm => farm.customerId === standard.customerId && farm.state === 'Bayern'));
  makeOffer(standard.id, 'Vermittler');
  const before = readFileSync(isolatedDataFile, 'utf8');
  seedAgriculture();
  assert.equal(readFileSync(isolatedDataFile, 'utf8'), before, 'Wiederholtes Seeding verändert weder vorhandene Datensätze noch Benutzerfortschritt.');
  assert.deepEqual(db.read('insurance.policies'), sentinel['insurance.policies']);
  assert.deepEqual(db.read('studio.sentinel'), sentinel['studio.sentinel']);
});

test('HTTP-Routen führen den gesamten Ablauf aus und prüfen Rollen, Feldmanipulation und Dokumentzugehörigkeit', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/agriculture', createAgricultureRouter());
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/api/agriculture`;
  async function call(path: string, body?: unknown, role?: string, expected = 200) {
    const response = await fetch(`${base}${path}`, { method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(role ? { 'x-agriculture-role': role } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json();
    assert.equal(response.status, expected, JSON.stringify(result));
    if (expected < 400) assert.ok(response.ok);
    else { assert.equal(typeof result.error, 'string'); assert.equal(typeof result.code, 'string'); }
    return result;
  }
  try {
    const meta = await call('/meta');
    assert.deepEqual(meta.roles, ['Vermittler', 'Direktion', 'Sachbearbeiter']);
    assert.equal((await call('/meta', undefined, 'Administrator', 400)).code, 'INVALID_ROLE');
    assert.equal((await call('/customers', STANDARD_CUSTOMER, 'Sachbearbeiter', 403)).code, 'ROLE_REQUIRED');
    assert.equal((await call('/customers', { ...STANDARD_CUSTOMER, role: 'Direktion' }, 'Vermittler', 400)).code, 'INVALID_INPUT');
    const { customer } = await call('/customers', { ...STANDARD_CUSTOMER, name: 'HTTP Beispielkunde' }, undefined, 201);
    const { farm } = await call('/farms', standardFarm(customer.id), 'Vermittler', 201);
    const { animal } = await call('/animals', highCow(farm.id), 'Vermittler', 201);
    const { proposal } = await call('/proposals', { customerId: customer.id, farmId: farm.id, animalIds: [animal.id], product: 'Tierlebensversicherung', startDate: '2026-10-01', durationMonths: 12, runId: 'http-kernablauf' }, 'Vermittler', 201);
    await call(`/proposals/${proposal.id}/offer`, {}, 'Vermittler');
    assert.equal((await call(`/proposals/${proposal.id}/complete`, {}, 'Vermittler', 409)).code, 'COMPLETION_NOT_ALLOWED');
    const { referral } = await call(`/proposals/${proposal.id}/submit`, {}, 'Vermittler');
    assert.equal((await call(`/referrals/${referral.id}/decision`, { decision: 'Freigeben', reason: 'Prüfung abgeschlossen.' }, 'Vermittler', 403)).code, 'ROLE_REQUIRED');
    await call(`/referrals/${referral.id}/decision`, { decision: 'Freigeben', reason: 'Prüfung abgeschlossen.' }, 'Direktion');
    assert.equal((await call(`/proposals/${proposal.id}/complete`, { annualPremium: 1 }, 'Vermittler', 400)).code, 'INVALID_INPUT');
    const completed = await call(`/proposals/${proposal.id}/complete`, {}, 'Vermittler');
    assert.equal((await call(`/policies/${completed.policy.id}/reissue`, { reason: 'Erneute Zusendung.' }, 'Vermittler', 403)).code, 'ROLE_REQUIRED');
    const reissued = await call(`/policies/${completed.policy.id}/reissue`, { reason: 'Erneute Zusendung.' }, 'Sachbearbeiter');
    assert.equal(reissued.policy.version, 2);
    assert.equal((await call(`/policies/${completed.policy.id}/print`, { documentId: reissued.document.id }, undefined, 403)).code, 'ROLE_REQUIRED');
    const printed = await call(`/policies/${completed.policy.id}/print`, { documentId: reissued.document.id }, 'Sachbearbeiter');
    assert.equal(printed.printEvent.documentSha256, reissued.document.sha256);
    const documentResponse = await fetch(`${base}/documents/${reissued.document.id}/html`);
    assert.ok(documentResponse.ok);
    assert.match(documentResponse.headers.get('content-type')!, /text\/html/);
    assert.equal(createHash('sha256').update(await documentResponse.text()).digest('hex'), reissued.document.sha256);
    const detail = await call(`/proposals/${proposal.id}`);
    assert.equal(detail.proposal.status, 'Abgeschlossen');
    assert.equal(detail.documents.length, 2);
    assert.equal(detail.printEvents.length, 1);
    assert.equal((await call('/overview?runId=http-kernablauf')).proposals.length, 1);
    assert.equal((await call('/unbekannt', undefined, undefined, 404)).code, 'NOT_FOUND');
    assert.deepEqual(db.read('insurance.policies'), sentinel['insurance.policies']);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

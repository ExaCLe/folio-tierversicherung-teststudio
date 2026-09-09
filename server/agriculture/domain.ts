import { randomUUID } from 'node:crypto';
import { AGRICULTURE_RULES, agricultureMoney, referralThreshold } from '../../shared/agriculture';
import type {
  AgricultureAnimal, AgricultureAnimalInput, AgricultureAuditEvent, AgricultureContract, AgricultureCustomer,
  AgricultureCustomerInput, AgricultureOverview, AgriculturePolicy, AgriculturePolicyDetail, AgriculturePrintEvent,
  AgricultureProposal, AgricultureRole, DirectorateReferral, Farm, FarmInput, PolicyDocument, ProposalDetail, ProposalInput,
} from '../../shared/agriculture';
import { db } from '../store';
import { documentHash, makePolicyDocument } from './documents';
import { AgricultureError, requireRole } from './errors';
import { animalSchema, customerSchema, decisionSchema, farmSchema, parseInput, proposalSchema, reissueSchema } from './validation';

export { AgricultureError, requireRole } from './errors';
export const collections = {
  customers: 'agriculture.customers', farms: 'agriculture.farms', animals: 'agriculture.animals',
  proposals: 'agriculture.proposals', offers: 'agriculture.offers', referrals: 'agriculture.referrals',
  contracts: 'agriculture.contracts', policies: 'agriculture.policies', documents: 'agriculture.documents',
  audit: 'agriculture.audit', printEvents: 'agriculture.printEvents',
} as const;

type RiskFacts = { input: ProposalInput; customer: AgricultureCustomer; farm: Farm; animals: AgricultureAnimal[] };
interface OfferSnapshot extends RiskFacts {
  id: string; proposalId: string; createdAt: string; ruleVersion: string;
  annualPremium: number; totalSumInsured: number; referralReasons: string[];
}

const now = () => new Date().toISOString();
const id = (kind: string) => `agr-${kind}-${randomUUID()}`;
const number = (prefix: string, entityId: string) => `${prefix}-${new Date().getUTCFullYear()}-${entityId.slice(-12).toUpperCase()}`;
const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const copy = <T>(value: T): T => structuredClone(value);

function find<T extends { id: string }>(collection: string, entityId: string, label: string): T {
  const entity = db.find<T>(collection, entityId);
  if (!entity) throw new AgricultureError(404, 'NOT_FOUND', `${label} wurde nicht gefunden.`);
  return entity;
}

export const getCustomer = (entityId: string): AgricultureCustomer => find(collections.customers, entityId, 'Der Kunde');
export const getFarm = (entityId: string): Farm => find(collections.farms, entityId, 'Der Betrieb');
export const getAnimal = (entityId: string): AgricultureAnimal => find(collections.animals, entityId, 'Das Tier oder der Bestand');
export const getProposal = (entityId: string): AgricultureProposal => find(collections.proposals, entityId, 'Der Versicherungsvorschlag');
export const getReferral = (entityId: string): DirectorateReferral => find(collections.referrals, entityId, 'Die Direktionsanfrage');
export const getContract = (entityId: string): AgricultureContract => find(collections.contracts, entityId, 'Der Vertrag');
export const getPolicy = (entityId: string): AgriculturePolicy => find(collections.policies, entityId, 'Die Police');

export function getDocument(entityId: string): PolicyDocument {
  const document = find<PolicyDocument>(collections.documents, entityId, 'Das Policendokument');
  if (documentHash(document.html) !== document.sha256) throw new AgricultureError(409, 'DOCUMENT_INTEGRITY', 'Der Dokumentnachweis stimmt nicht mit dem gespeicherten Inhalt überein.');
  return document;
}

export function auditEvent(
  entityType: AgricultureAuditEvent['entityType'], entityId: string, proposalId: string | null,
  action: string, role: AgricultureRole, details: string, document?: PolicyDocument,
): AgricultureAuditEvent {
  return db.upsert(collections.audit, {
    id: id('audit'), entityType, entityId, proposalId, action, role, at: now(), details,
    ...(document ? { documentId: document.id, documentSha256: document.sha256 } : {}),
  });
}

export function createCustomer(input: AgricultureCustomerInput, role: AgricultureRole): AgricultureCustomer {
  requireRole(role, 'Vermittler');
  const values = parseInput(customerSchema, input);
  const customerId = id('customer');
  const customer: AgricultureCustomer = { ...values, id: customerId, number: number('KU', customerId), createdAt: now() };
  db.upsert(collections.customers, customer);
  auditEvent('Kunde', customer.id, null, 'Kunde erfasst', role, `${customer.name} wurde als Kunde erfasst.`);
  return customer;
}

export function createFarm(input: FarmInput, role: AgricultureRole): Farm {
  requireRole(role, 'Vermittler');
  const values = parseInput(farmSchema, input);
  const customer = getCustomer(values.customerId);
  const farmId = id('farm');
  const farm: Farm = { ...values, id: farmId, number: number('BE', farmId), createdAt: now() };
  db.upsert(collections.farms, farm);
  auditEvent('Betrieb', farm.id, null, 'Betrieb erfasst', role, `${farm.name} in ${farm.state} gehört zu ${customer.name}.`);
  return farm;
}

export function createAnimal(input: AgricultureAnimalInput, role: AgricultureRole): AgricultureAnimal {
  requireRole(role, 'Vermittler');
  const values = parseInput(animalSchema, input);
  const farm = getFarm(values.farmId);
  getCustomer(farm.customerId);
  const animalId = id('animal');
  const animal: AgricultureAnimal = { ...values, id: animalId, number: number(values.species === 'Schwein' ? 'BS' : 'TI', animalId), createdAt: now() };
  db.upsert(collections.animals, animal);
  auditEvent('Tier', animal.id, null, values.species === 'Schwein' ? 'Bestand erfasst' : 'Tier erfasst', role, `${animal.name} wurde dem Betrieb ${farm.name} zugeordnet.`);
  return animal;
}

function inputOf(proposal: ProposalInput): ProposalInput {
  return { customerId: proposal.customerId, farmId: proposal.farmId, animalIds: [...proposal.animalIds],
    product: proposal.product, startDate: proposal.startDate, durationMonths: proposal.durationMonths,
    ...(proposal.runId === undefined ? {} : { runId: proposal.runId }) };
}

function riskFacts(input: ProposalInput): RiskFacts {
  const values = parseInput(proposalSchema, inputOf(input));
  const customer = getCustomer(values.customerId), farm = getFarm(values.farmId);
  if (farm.customerId !== customer.id) throw new AgricultureError(400, 'CUSTOMER_FARM_MISMATCH', 'Der gewählte Betrieb gehört nicht zum gewählten Kunden.');
  const animals = values.animalIds.map(getAnimal);
  for (const animal of animals) {
    if (animal.farmId !== farm.id) throw new AgricultureError(400, 'ANIMAL_FARM_MISMATCH', `${animal.name} gehört nicht zum gewählten Betrieb.`);
    if ((animal.species === 'Schwein') !== (values.product === 'Bestandsversicherung')) {
      throw new AgricultureError(400, 'PRODUCT_SPECIES_MISMATCH', 'Bestandsversicherung gilt für Schweinebestände. Rinder, Pferde und Hunde benötigen Tierlebensversicherung.');
    }
    if (animal.species !== 'Schwein' && animal.birthDate > values.startDate) {
      throw new AgricultureError(400, 'ANIMAL_NOT_BORN', 'Der Versicherungsbeginn darf nicht vor dem Geburtsdatum eines versicherten Tiers liegen.');
    }
  }
  return { input: values, customer, farm, animals };
}

export function rateAnimals(animals: AgricultureAnimal[]): number {
  return Math.max(AGRICULTURE_RULES.minimumAnnualPremium, round(animals.reduce((sum, animal) => sum + animal.sumInsured * AGRICULTURE_RULES.annualRates[animal.species], 0)));
}

export function referralReasonsFor(animals: AgricultureAnimal[], farm: Farm): string[] {
  return animals.flatMap(animal => {
    const reasons: string[] = [];
    const threshold = referralThreshold(animal.species, farm.state);
    if (animal.sumInsured > threshold) reasons.push(`${animal.name}: Versicherungssumme ${agricultureMoney(animal.sumInsured)} übersteigt die Direktionsgrenze von ${agricultureMoney(threshold)} je ${animal.species === 'Schwein' ? 'Bestand' : 'Tier'}.`);
    if (animal.species === 'Pferd' && animal.health === 'Vorerkrankung') reasons.push(`${animal.name}: Eine Vorerkrankung erfordert die Prüfung durch die Direktion.`);
    if (animal.species === 'Schwein' && animal.biosecurity === 'Klärung erforderlich') reasons.push(`${animal.name}: Die Biosicherheit muss durch die Direktion geklärt werden.`);
    return reasons;
  });
}

function referralReasonsForRuleVersion(animals: AgricultureAnimal[], farm: Farm, ruleVersion: string): string[] {
  if (ruleVersion === 'TierSchutz 1.0') {
    return animals.flatMap(animal => {
      const reasons: string[] = [];
      const threshold = AGRICULTURE_RULES.referralThresholds[animal.species];
      if (animal.sumInsured > threshold) reasons.push(`${animal.name}: Versicherungssumme ${agricultureMoney(animal.sumInsured)} übersteigt die Direktionsgrenze von ${agricultureMoney(threshold)} je ${animal.species === 'Schwein' ? 'Bestand' : 'Tier'}.`);
      if (animal.species === 'Pferd' && animal.health === 'Vorerkrankung') reasons.push(`${animal.name}: Eine Vorerkrankung erfordert die Prüfung durch die Direktion.`);
      if (animal.species === 'Schwein' && animal.biosecurity === 'Klärung erforderlich') reasons.push(`${animal.name}: Die Biosicherheit muss durch die Direktion geklärt werden.`);
      return reasons;
    });
  }
  if (ruleVersion === AGRICULTURE_RULES.version) return referralReasonsFor(animals, farm);
  throw new AgricultureError(409, 'OFFER_CHANGED', `Die Regelversion ${ruleVersion} wird nicht unterstützt.`);
}

export function createProposal(input: ProposalInput, role: AgricultureRole): AgricultureProposal {
  requireRole(role, 'Vermittler');
  const values = parseInput(proposalSchema, input);
  const facts = riskFacts(values);
  const proposalId = id('proposal'), createdAt = now();
  const proposal: AgricultureProposal = { ...values, id: proposalId, number: number('VS', proposalId), status: 'Entwurf',
    createdAt, updatedAt: createdAt, annualPremium: null, totalSumInsured: round(facts.animals.reduce((sum, animal) => sum + animal.sumInsured, 0)),
    referralReasons: [], referralId: null, contractId: null, policyId: null };
  db.upsert(collections.proposals, proposal);
  auditEvent('Vorschlag', proposal.id, proposal.id, 'Vorschlag erfasst', role, `${proposal.product} für ${facts.farm.name} mit ${facts.animals.length} Tier- oder Bestandspositionen.`);
  return proposal;
}

export function makeOffer(proposalId: string, role: AgricultureRole): { proposal: AgricultureProposal } {
  requireRole(role, 'Vermittler');
  const proposal = getProposal(proposalId);
  if (proposal.status !== 'Entwurf' && proposal.status !== 'Angebot') throw new AgricultureError(409, 'OFFER_NOT_ALLOWED', 'Ein Angebot kann nur für einen Entwurf oder ein noch nicht eingereichtes Angebot berechnet werden.');
  const facts = riskFacts(inputOf(proposal));
  const snapshot: OfferSnapshot = { ...copy(facts), id: id('offer'), proposalId, createdAt: now(), ruleVersion: AGRICULTURE_RULES.version,
    annualPremium: rateAnimals(facts.animals), totalSumInsured: round(facts.animals.reduce((sum, animal) => sum + animal.sumInsured, 0)), referralReasons: referralReasonsFor(facts.animals, facts.farm) };
  const updated: AgricultureProposal = { ...proposal, status: 'Angebot', annualPremium: snapshot.annualPremium,
    totalSumInsured: snapshot.totalSumInsured, referralReasons: [...snapshot.referralReasons], updatedAt: now() };
  db.upsert(collections.offers, snapshot);
  db.upsert(collections.proposals, updated);
  auditEvent('Vorschlag', proposal.id, proposal.id, 'Angebot berechnet', role, `Jahresbeitrag ${agricultureMoney(snapshot.annualPremium)} nach ${snapshot.ruleVersion}.${snapshot.referralReasons.length ? ' Eine Direktionsentscheidung ist nach Einreichung erforderlich.' : ' Die Direktionsgrenzen werden eingehalten.'}`);
  return { proposal: updated };
}

function currentOffer(proposal: AgricultureProposal, preserveCompletedRuleVersion = false): OfferSnapshot {
  const snapshot = db.read<OfferSnapshot>(collections.offers).filter(offer => offer.proposalId === proposal.id).at(-1);
  if (!snapshot) throw new AgricultureError(409, 'OFFER_REQUIRED', 'Berechnen Sie vor dem Einreichen ein Angebot.');
  const expectedRuleVersion = preserveCompletedRuleVersion && proposal.status !== 'Entwurf' && proposal.status !== 'Angebot'
    ? snapshot.ruleVersion
    : AGRICULTURE_RULES.version;
  const facts = riskFacts(inputOf(proposal));
  const savedFacts: RiskFacts = { input: snapshot.input, customer: snapshot.customer, farm: snapshot.farm, animals: snapshot.animals };
  if (JSON.stringify(facts) !== JSON.stringify(savedFacts) || snapshot.ruleVersion !== expectedRuleVersion
    || proposal.annualPremium !== snapshot.annualPremium || proposal.totalSumInsured !== snapshot.totalSumInsured
    || JSON.stringify(proposal.referralReasons) !== JSON.stringify(snapshot.referralReasons)
    || snapshot.annualPremium !== rateAnimals(snapshot.animals)
    || snapshot.totalSumInsured !== round(snapshot.animals.reduce((sum, animal) => sum + animal.sumInsured, 0))
    || JSON.stringify(snapshot.referralReasons) !== JSON.stringify(referralReasonsForRuleVersion(snapshot.animals, snapshot.farm, snapshot.ruleVersion))) {
    throw new AgricultureError(409, 'OFFER_CHANGED', 'Das Angebot stimmt nicht mehr mit den erfassten Angaben überein. Ein Abschluss ist nicht zulässig.');
  }
  return snapshot;
}

export function submitProposal(proposalId: string, role: AgricultureRole): { proposal: AgricultureProposal; referral: DirectorateReferral | null } {
  requireRole(role, 'Vermittler');
  const proposal = getProposal(proposalId);
  if (proposal.status !== 'Angebot') throw new AgricultureError(409, 'SUBMIT_NOT_ALLOWED', 'Nur ein berechnetes Angebot kann als Antrag eingereicht werden.');
  const snapshot = currentOffer(proposal);
  if (proposal.referralId || proposal.contractId || proposal.policyId) throw new AgricultureError(409, 'PROPOSAL_LINKS_INVALID', 'Dieser Vorschlag enthält bereits eine Anfrage oder einen Abschluss.');
  let referral: DirectorateReferral | null = null;
  if (snapshot.referralReasons.length) {
    const referralId = id('referral');
    referral = { id: referralId, number: number('DA', referralId), proposalId, customerId: proposal.customerId, farmId: proposal.farmId,
      status: 'Offen', reasons: [...snapshot.referralReasons], createdAt: now(), decision: null, decisionReason: null, decidedAt: null, decidedBy: null };
    db.upsert(collections.referrals, referral);
    auditEvent('Direktionsanfrage', referral.id, proposal.id, 'Direktionsanfrage angelegt', role, referral.reasons.join(' '));
  }
  const updated: AgricultureProposal = { ...proposal, status: referral ? 'Direktionsprüfung' : 'Freigegeben', referralId: referral?.id ?? null, updatedAt: now() };
  db.upsert(collections.proposals, updated);
  auditEvent('Vorschlag', proposal.id, proposal.id, 'Antrag eingereicht', role, referral ? 'Die Direktion prüft den Antrag. Ein Abschluss ist bis zur Freigabe gesperrt.' : 'Der Antrag erfüllt die fiktiven Annahmeregeln und ist zum Abschluss freigegeben.');
  return { proposal: updated, referral };
}

function assertReferral(proposal: AgricultureProposal, referral: DirectorateReferral): void {
  if (proposal.referralId !== referral.id || referral.proposalId !== proposal.id || referral.customerId !== proposal.customerId
    || referral.farmId !== proposal.farmId || JSON.stringify(referral.reasons) !== JSON.stringify(proposal.referralReasons)) {
    throw new AgricultureError(409, 'REFERRAL_MISMATCH', 'Die Direktionsanfrage gehört nicht zum aktuellen Antrag.');
  }
}

export function decideReferral(referralId: string, input: { decision: 'Freigeben' | 'Ablehnen'; reason: string }, role: AgricultureRole): { proposal: AgricultureProposal; referral: DirectorateReferral } {
  requireRole(role, 'Direktion');
  const values = parseInput(decisionSchema, input);
  const referral = getReferral(referralId), proposal = getProposal(referral.proposalId);
  assertReferral(proposal, referral);
  if (referral.status !== 'Offen' || referral.decision !== null || proposal.status !== 'Direktionsprüfung') throw new AgricultureError(409, 'REFERRAL_NOT_OPEN', 'Nur eine offene Direktionsanfrage kann entschieden werden.');
  currentOffer(proposal, true);
  const decided: DirectorateReferral = { ...referral, status: values.decision === 'Freigeben' ? 'Freigegeben' : 'Abgelehnt',
    decision: values.decision, decisionReason: values.reason, decidedAt: now(), decidedBy: 'Direktion' };
  const updated: AgricultureProposal = { ...proposal, status: decided.status === 'Freigegeben' ? 'Freigegeben' : 'Abgelehnt', updatedAt: now() };
  db.upsert(collections.referrals, decided);
  db.upsert(collections.proposals, updated);
  auditEvent('Direktionsanfrage', referral.id, proposal.id, values.decision === 'Freigeben' ? 'Antrag durch Direktion freigegeben' : 'Antrag durch Direktion abgelehnt', role, values.reason);
  return { proposal: updated, referral: decided };
}

function endDateFor(startDate: string): string {
  const date = new Date(`${startDate}T00:00:00.000Z`);
  date.setUTCFullYear(date.getUTCFullYear() + 1);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function completeProposal(proposalId: string, role: AgricultureRole): { proposal: AgricultureProposal; contract: AgricultureContract; policy: AgriculturePolicy; document: PolicyDocument } {
  requireRole(role, 'Vermittler');
  const proposal = getProposal(proposalId);
  if (proposal.status === 'Abgeschlossen' || proposal.contractId || proposal.policyId
    || db.read<AgricultureContract>(collections.contracts).some(contract => contract.proposalId === proposal.id)
    || db.read<AgriculturePolicy>(collections.policies).some(policy => policy.proposalId === proposal.id)) {
    throw new AgricultureError(409, 'ALREADY_COMPLETED', 'Dieser Vorschlag wurde bereits abgeschlossen. Es wird kein weiterer Vertrag angelegt.');
  }
  if (proposal.status !== 'Freigegeben') throw new AgricultureError(409, 'COMPLETION_NOT_ALLOWED', 'Ein Vertrag kann nur aus einem freigegebenen Antrag abgeschlossen werden.');
  const snapshot = currentOffer(proposal, true);
  if (snapshot.referralReasons.length) {
    if (!proposal.referralId) throw new AgricultureError(409, 'DIRECTORATE_APPROVAL_REQUIRED', 'Die erforderliche Freigabe der Direktion fehlt.');
    const referral = getReferral(proposal.referralId);
    assertReferral(proposal, referral);
    if (referral.status !== 'Freigegeben' || referral.decision !== 'Freigeben' || referral.decidedBy !== 'Direktion'
      || !referral.decidedAt || !referral.decisionReason?.trim()) {
      throw new AgricultureError(409, 'DIRECTORATE_APPROVAL_REQUIRED', 'Die Direktion muss diesen Antrag zuerst freigeben.');
    }
  } else if (proposal.referralId) throw new AgricultureError(409, 'REFERRAL_MISMATCH', 'Der Antrag enthält eine nicht zugehörige Direktionsanfrage.');
  const contractId = id('contract'), policyId = id('policy'), createdAt = now();
  const contract: AgricultureContract = { id: contractId, number: number('VE', contractId), proposalId, customerId: proposal.customerId,
    farmId: proposal.farmId, animalIds: [...proposal.animalIds], product: proposal.product, startDate: proposal.startDate,
    endDate: endDateFor(proposal.startDate), annualPremium: snapshot.annualPremium, totalSumInsured: snapshot.totalSumInsured,
    status: 'Aktiv', policyId, createdAt };
  const policy: AgriculturePolicy = { id: policyId, number: number('PO', policyId), contractId, proposalId, customerId: proposal.customerId,
    version: 1, documentId: '', createdAt, updatedAt: createdAt };
  const document = makePolicyDocument(policy, contract, snapshot.customer, snapshot.farm, snapshot.animals, role, 'Erstausgabe nach Vertragsabschluss');
  policy.documentId = document.id;
  const updated: AgricultureProposal = { ...proposal, status: 'Abgeschlossen', contractId, policyId, updatedAt: createdAt };
  db.upsert(collections.documents, document);
  db.upsert(collections.contracts, contract);
  db.upsert(collections.policies, policy);
  db.upsert(collections.proposals, updated);
  auditEvent('Vertrag', contract.id, proposal.id, 'Vertrag abgeschlossen', role, `${contract.number} wurde mit einem Jahresbeitrag von ${agricultureMoney(contract.annualPremium)} abgeschlossen.`);
  auditEvent('Police', policy.id, proposal.id, 'Police erstellt', role, `${policy.number}, Ausgabe 1 wurde erstellt.`, document);
  return { proposal: updated, contract, policy, document };
}

function policyContext(policyId: string): { policy: AgriculturePolicy; contract: AgricultureContract; proposal: AgricultureProposal; snapshot: OfferSnapshot } {
  const policy = getPolicy(policyId), contract = getContract(policy.contractId), proposal = getProposal(policy.proposalId);
  if (contract.policyId !== policy.id || contract.proposalId !== proposal.id || contract.customerId !== policy.customerId
    || proposal.policyId !== policy.id || proposal.contractId !== contract.id || proposal.status !== 'Abgeschlossen'
    || contract.customerId !== proposal.customerId || contract.farmId !== proposal.farmId
    || contract.product !== proposal.product || contract.startDate !== proposal.startDate
    || contract.endDate !== endDateFor(proposal.startDate) || contract.status !== 'Aktiv'
    || JSON.stringify(contract.animalIds) !== JSON.stringify(proposal.animalIds)
    || contract.annualPremium !== proposal.annualPremium || contract.totalSumInsured !== proposal.totalSumInsured) {
    throw new AgricultureError(409, 'POLICY_LINKS_INVALID', 'Die Police stimmt nicht mit dem abgeschlossenen Vertrag überein.');
  }
  const snapshot = currentOffer(proposal, true);
  const currentDocument = getDocument(policy.documentId);
  if (currentDocument.policyId !== policy.id || currentDocument.contractId !== contract.id || currentDocument.version !== policy.version) {
    throw new AgricultureError(409, 'DOCUMENT_POLICY_MISMATCH', 'Die aktuelle Dokumentausgabe gehört nicht zu dieser Police.');
  }
  return { policy, contract, proposal, snapshot };
}

export function reissuePolicy(policyId: string, input: { reason: string }, role: AgricultureRole): { policy: AgriculturePolicy; document: PolicyDocument } {
  requireRole(role, 'Sachbearbeiter');
  const values = parseInput(reissueSchema, input);
  const { policy, contract, proposal, snapshot } = policyContext(policyId);
  const updated: AgriculturePolicy = { ...policy, version: policy.version + 1, updatedAt: now() };
  const document = makePolicyDocument(updated, contract, snapshot.customer, snapshot.farm, snapshot.animals, role, values.reason);
  updated.documentId = document.id;
  db.upsert(collections.documents, document);
  db.upsert(collections.policies, updated);
  auditEvent('Police', policy.id, proposal.id, 'Police erneut ausgegeben', role, `Ausgabe ${updated.version}: ${values.reason}`, document);
  return { policy: updated, document };
}

export function printPolicy(policyId: string, documentId: string, role: AgricultureRole): { policy: AgriculturePolicy; document: PolicyDocument; printEvent: AgriculturePrintEvent } {
  requireRole(role, 'Sachbearbeiter');
  const { policy, proposal, contract } = policyContext(policyId);
  const document = getDocument(documentId);
  if (document.policyId !== policy.id || document.contractId !== contract.id || document.version < 1 || document.version > policy.version) {
    throw new AgricultureError(409, 'DOCUMENT_POLICY_MISMATCH', 'Das gewählte Dokument gehört nicht zu dieser Police.');
  }
  const printEvent: AgriculturePrintEvent = { id: id('print'), policyId: policy.id, documentId: document.id, documentSha256: document.sha256,
    role: 'Sachbearbeiter', at: now(), action: 'Druckauftrag erfasst' };
  db.upsert(collections.printEvents, printEvent);
  auditEvent('Police', policy.id, proposal.id, 'Druckauftrag erfasst', role, `Ausgabe ${document.version} wurde zum Druck angefordert. Der Auftrag weist keinen physischen Ausdruck nach.`, document);
  return { policy, document, printEvent };
}

export function getPolicyDetail(policyId: string): AgriculturePolicyDetail {
  const { policy, contract, snapshot } = policyContext(policyId);
  const documents = db.read<PolicyDocument>(collections.documents).filter(document => document.policyId === policy.id)
    .sort((left, right) => left.version - right.version).map(document => getDocument(document.id));
  const printEvents = db.read<AgriculturePrintEvent>(collections.printEvents).filter(event => event.policyId === policy.id).reverse();
  return { policy, contract, customer: snapshot.customer, farm: snapshot.farm, animals: snapshot.animals, documents, printEvents };
}

export function getProposalDetail(proposalId: string): ProposalDetail {
  const proposal = getProposal(proposalId);
  const facts = riskFacts(inputOf(proposal));
  const referral = proposal.referralId ? getReferral(proposal.referralId) : null;
  if (referral) assertReferral(proposal, referral);
  const policyDetail = proposal.policyId ? getPolicyDetail(proposal.policyId) : null;
  const relatedIds = new Set([proposal.id, proposal.customerId, proposal.farmId, ...proposal.animalIds]);
  const audit = db.read<AgricultureAuditEvent>(collections.audit).filter(event => event.proposalId === proposal.id || (!event.proposalId && relatedIds.has(event.entityId))).reverse();
  return { proposal, customer: facts.customer, farm: facts.farm, animals: facts.animals, referral,
    contract: policyDetail?.contract ?? null, policy: policyDetail?.policy ?? null, documents: policyDetail?.documents ?? [], printEvents: policyDetail?.printEvents ?? [], audit };
}

export function getOverview(runId?: string): AgricultureOverview {
  const proposals = db.read<AgricultureProposal>(collections.proposals).filter(proposal => runId === undefined || proposal.runId === runId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const related = (key: 'customerId' | 'farmId') => new Set(proposals.map(proposal => proposal[key]));
  const customerIds = related('customerId'), farmIds = related('farmId'), animalIds = new Set(proposals.flatMap(proposal => proposal.animalIds));
  const proposalIds = new Set(proposals.map(proposal => proposal.id));
  return {
    customers: db.read<AgricultureCustomer>(collections.customers).filter(customer => runId === undefined || customerIds.has(customer.id)).sort((a, b) => a.name.localeCompare(b.name, 'de')),
    farms: db.read<Farm>(collections.farms).filter(farm => runId === undefined || farmIds.has(farm.id)).sort((a, b) => a.name.localeCompare(b.name, 'de')),
    animals: db.read<AgricultureAnimal>(collections.animals).filter(animal => runId === undefined || animalIds.has(animal.id)).sort((a, b) => a.name.localeCompare(b.name, 'de')),
    proposals,
    referrals: db.read<DirectorateReferral>(collections.referrals).filter(referral => runId === undefined || proposalIds.has(referral.proposalId)).reverse(),
    contracts: db.read<AgricultureContract>(collections.contracts).filter(contract => runId === undefined || proposalIds.has(contract.proposalId)).reverse(),
    policies: db.read<AgriculturePolicy>(collections.policies).filter(policy => runId === undefined || proposalIds.has(policy.proposalId)).reverse(),
  };
}

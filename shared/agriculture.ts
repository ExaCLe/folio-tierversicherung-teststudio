export const AGRICULTURE_ROLES = ['Vermittler', 'Direktion', 'Sachbearbeiter'] as const;
export type AgricultureRole = typeof AGRICULTURE_ROLES[number];
export const FEDERAL_STATES = ['Baden-Württemberg', 'Bayern', 'Berlin', 'Brandenburg', 'Bremen', 'Hamburg', 'Hessen', 'Mecklenburg-Vorpommern', 'Niedersachsen', 'Nordrhein-Westfalen', 'Rheinland-Pfalz', 'Saarland', 'Sachsen', 'Sachsen-Anhalt', 'Schleswig-Holstein', 'Thüringen'] as const;
export type FederalState = typeof FEDERAL_STATES[number];
export const ANIMAL_SPECIES = ['Rind', 'Pferd', 'Hund', 'Schwein'] as const;
export type AnimalSpecies = typeof ANIMAL_SPECIES[number];
export type AgricultureProduct = 'Tierlebensversicherung' | 'Bestandsversicherung';
export type ProposalStatus = 'Entwurf' | 'Angebot' | 'Direktionsprüfung' | 'Freigegeben' | 'Abgelehnt' | 'Abgeschlossen';

export interface AgricultureCustomerInput { name: string; email: string; phone: string; street: string; postalCode: string; city: string; }
export interface AgricultureCustomer extends AgricultureCustomerInput { id: string; number: string; createdAt: string; }
export interface FarmInput { customerId: string; name: string; state: FederalState; street: string; postalCode: string; city: string; farmType: 'Milchviehbetrieb' | 'Gemischter Betrieb' | 'Pferdehaltung' | 'Schweinehaltung' | 'Tierhaltung'; }
export interface Farm extends FarmInput { id: string; number: string; createdAt: string; }
interface AnimalInputBase { farmId: string; name: string; sumInsured: number; }
export type AgricultureAnimalInput =
  | (AnimalInputBase & { species: 'Rind'; earTag: string; breed: string; birthDate: string; use: 'Milchkuh' | 'Zucht' | 'Mast'; })
  | (AnimalInputBase & { species: 'Pferd'; chipNumber: string; breed: string; birthDate: string; use: 'Freizeit' | 'Zucht' | 'Sport'; health: 'Unauffällig' | 'Vorerkrankung'; healthNotes: string; })
  | (AnimalInputBase & { species: 'Hund'; chipNumber: string; breed: string; birthDate: string; use: 'Hofhund' | 'Hütehund' | 'Privat'; })
  | (AnimalInputBase & { species: 'Schwein'; animalCount: number; housing: 'Stallhaltung' | 'Freilandhaltung'; biosecurity: 'Erfüllt' | 'Klärung erforderlich'; });
export type AgricultureAnimal = AgricultureAnimalInput & { id: string; number: string; createdAt: string; };
export interface ProposalInput { customerId: string; farmId: string; animalIds: string[]; product: AgricultureProduct; startDate: string; durationMonths: 12; runId?: string; }
export interface AgricultureProposal extends ProposalInput {
  id: string; number: string; status: ProposalStatus; createdAt: string; updatedAt: string;
  annualPremium: number | null; totalSumInsured: number; referralReasons: string[];
  referralId: string | null; contractId: string | null; policyId: string | null;
}
export interface DirectorateReferral {
  id: string; number: string; proposalId: string; customerId: string; farmId: string;
  status: 'Offen' | 'Freigegeben' | 'Abgelehnt'; reasons: string[]; createdAt: string;
  decision: 'Freigeben' | 'Ablehnen' | null; decisionReason: string | null; decidedAt: string | null; decidedBy: 'Direktion' | null;
}
export interface AgricultureContract {
  id: string; number: string; proposalId: string; customerId: string; farmId: string; animalIds: string[];
  product: AgricultureProduct; startDate: string; endDate: string; annualPremium: number; totalSumInsured: number;
  status: 'Aktiv'; policyId: string; createdAt: string;
}
export interface AgriculturePolicy { id: string; number: string; contractId: string; proposalId: string; customerId: string; version: number; documentId: string; createdAt: string; updatedAt: string; }
export interface PolicyDocument {
  id: string; policyId: string; contractId: string; version: number; title: string; createdAt: string; createdBy: AgricultureRole;
  reason: string; sha256: string; html: string;
}
export interface AgricultureAuditEvent {
  id: string; entityType: 'Kunde' | 'Betrieb' | 'Tier' | 'Vorschlag' | 'Direktionsanfrage' | 'Vertrag' | 'Police';
  entityId: string; proposalId: string | null; action: string; role: AgricultureRole; at: string; details: string;
  documentId?: string; documentSha256?: string;
}
export interface AgriculturePrintEvent { id: string; policyId: string; documentId: string; documentSha256: string; role: 'Sachbearbeiter'; at: string; action: 'Druckauftrag erfasst'; }
export interface AgricultureOverview {
  customers: AgricultureCustomer[]; farms: Farm[]; animals: AgricultureAnimal[]; proposals: AgricultureProposal[];
  referrals: DirectorateReferral[]; contracts: AgricultureContract[]; policies: AgriculturePolicy[];
}
export interface ProposalDetail {
  proposal: AgricultureProposal; customer: AgricultureCustomer; farm: Farm; animals: AgricultureAnimal[];
  referral: DirectorateReferral | null; contract: AgricultureContract | null; policy: AgriculturePolicy | null;
  documents: PolicyDocument[]; printEvents: AgriculturePrintEvent[]; audit: AgricultureAuditEvent[];
}
export interface AgriculturePolicyDetail { policy: AgriculturePolicy; contract: AgricultureContract; customer: AgricultureCustomer; farm: Farm; animals: AgricultureAnimal[]; documents: PolicyDocument[]; printEvents: AgriculturePrintEvent[]; }
export const AGRICULTURE_RULES = {
  version: 'TierSchutz 1.0', currency: 'EUR', referralThresholds: { Rind: 10_000, Pferd: 50_000, Hund: 10_000, Schwein: 500_000 },
  annualRates: { Rind: 0.035, Pferd: 0.04, Hund: 0.05, Schwein: 0.018 }, minimumAnnualPremium: 60,
} as const;
export function standardCow(farmId = ''): AgricultureAnimalInput {
  return { farmId, species: 'Rind', name: 'Alma', earTag: 'DE 09 123 45678', breed: 'Fleckvieh', birthDate: '2022-04-15', use: 'Milchkuh', sumInsured: 3_500 };
}
export const STANDARD_CUSTOMER: AgricultureCustomerInput = { name: 'Johanna Bauer', email: 'johanna.bauer@example.test', phone: '0581 5550120', street: 'Dorfstraße 12', postalCode: '29525', city: 'Uelzen' };
export function standardFarm(customerId = ''): FarmInput { return { customerId, name: 'Hof Lindenkamp', state: 'Niedersachsen', street: 'Dorfstraße 12', postalCode: '29525', city: 'Uelzen', farmType: 'Milchviehbetrieb' }; }
export function bayernFarm(customerId = ''): FarmInput { return { customerId, name: 'Bauernhof Sonnleitner', state: 'Bayern', street: 'Dorfstraße 12', postalCode: '87437', city: 'Kempten', farmType: 'Milchviehbetrieb' }; }
export const agricultureMoney = (value: number) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(value);

export type Role = 'Broker' | 'Senior underwriter';
export type Country = 'DE' | 'IT';
export type PolicyStatus = 'Draft' | 'Referred' | 'Quoted' | 'Approved' | 'Issued';
export type QuoteStatus = 'Referred' | 'Quoted' | 'Approved' | 'Issued' | 'Superseded';
export type CoverageType = 'Fire' | 'Flood' | 'Business interruption' | 'Theft';
export interface Address { line1: string; city: string; postcode: string }
export interface Customer {
  id: string; name: string; registrationNumber: string; headquartersCountry: Country;
  address: Address; industry: string; contactName: string; email: string;
  createdAt: string; source: 'manual' | 'run'; runId?: string;
}
export interface Coverage { type: CoverageType; limit: number; deductible: number }
export interface InsuredLocation {
  id: string; name: string; type: 'Factory' | 'Warehouse' | 'Office'; country: Country;
  address: Address; construction: 'Masonry' | 'Steel' | 'Timber'; yearBuilt: number;
  areaSqm: number; sprinkler: boolean; floodZone: 'Low' | 'Moderate' | 'High';
  sumInsured: number; coverages: Coverage[];
}
export interface Loss { id: string; date: string; description: string; amount: number }
export interface Billing { frequency: 'Annual' | 'Quarterly'; method: 'Invoice' | 'Direct debit' }
export interface Declarations { informationAccurate: boolean; insuranceDeclined: boolean; additionalInformation: string }
export interface PolicyDraftInput {
  customerId: string; productVersion: 3; issuingMarket: 'DE'; currency: 'EUR';
  inceptionDate: string; expiryDate: string; locations: InsuredLocation[];
  lossHistory: Loss[]; billing: Billing; declarations: Declarations;
  source?: 'manual' | 'run'; runId?: string;
}
export interface PolicyDocument {
  id: string; name: string; type: 'Risk survey' | 'Policy schedule'; locationId?: string;
  suitable?: boolean; synthetic: true; uploadedAt: string; uploadedBy: Role;
}
export interface AuditEntry { id: string; at: string; actor: Role; action: string; detail: string }
export interface Premium {
  base: number; flood: number; otherCoverages: number; riskAdjustment: number;
  tax: number; total: number; currency: 'EUR'; annual: number;
  byLocation: { locationId: string; name: string; annual: number }[];
}
export interface Referral {
  locationId: string; locationName: string; code: 'FLOOD_AUTHORITY'; reason: string;
  floodLimit: number; threshold: 500000; requiresSurvey: true;
}
export interface Quote {
  id: string; policyId: string; policyRevision: number; status: QuoteStatus;
  premium: Premium; referrals: Referral[]; createdAt: string; validUntil: string;
  approvedAt?: string; approvedBy?: Role; approvalNotes?: string; snapshot: PolicyDraftInput;
}
export interface Amendment {
  id: string; effectiveDate: string; reason: string; previousVersion: number; version: number;
  previousValues: PolicyDraftInput; changes: Partial<PolicyDraftInput>; premium: Premium;
  previousPremium: Premium; createdAt: string; actor: Role;
}
export interface Policy extends PolicyDraftInput {
  id: string; policyNumber: string; product: 'Meridian Commercial Property';
  source: 'manual' | 'run'; status: PolicyStatus; version: number; revision: number;
  quoteId: string | null; premium: Premium | null; documents: PolicyDocument[];
  activity: AuditEntry[]; amendments: Amendment[]; createdAt: string; updatedAt: string;
  issuedAt?: string;
}
export interface PolicySchedule {
  id: string; policyId: string; policyNumber: string; policyVersion: number; customer: Customer;
  product: string; productVersion: 3; issuingMarket: 'DE'; currency: 'EUR';
  inceptionDate: string; expiryDate: string; locations: InsuredLocation[];
  premium: Premium; issuedAt: string; quoteId: string; effectiveDate?: string;
}
export interface PolicyDetailResponse { policy: Policy; customer: Customer; quote: Quote | null }
export const COUNTRY_NAMES: Record<Country, string> = { DE: 'Germany', IT: 'Italy' };
export const ROLES: Role[] = ['Broker', 'Senior underwriter'];
export const STANDARD_CUSTOMER_ID = 'customer-linden';
export const ITALIAN_WAREHOUSE_ADDRESS: Address = { line1: 'Via delle Officine 24', city: 'Milan', postcode: '20126' };
export function createStandardDraft(customerId = STANDARD_CUSTOMER_ID): PolicyDraftInput {
  const date = new Date();
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
  const end = new Date(Date.UTC(start.getUTCFullYear() + 1, start.getUTCMonth(), 0));
  return {
    customerId, productVersion: 3, issuingMarket: 'DE', currency: 'EUR',
    inceptionDate: start.toISOString().slice(0, 10), expiryDate: end.toISOString().slice(0, 10),
    locations: [
      { id: 'factory', name: 'Factory', type: 'Factory', country: 'DE', address: { line1: 'Werkstrasse 18', city: 'Stuttgart', postcode: '70327' }, construction: 'Masonry', yearBuilt: 1998, areaSqm: 4200, sprinkler: true, floodZone: 'Low', sumInsured: 3000000, coverages: [{ type: 'Fire', limit: 3000000, deductible: 2500 }, { type: 'Business interruption', limit: 750000, deductible: 5000 }] },
      { id: 'warehouse', name: 'Warehouse', type: 'Warehouse', country: 'DE', address: { line1: 'Hafenstrasse 42', city: 'Hamburg', postcode: '20457' }, construction: 'Steel', yearBuilt: 2012, areaSqm: 1800, sprinkler: true, floodZone: 'Moderate', sumInsured: 1500000, coverages: [{ type: 'Fire', limit: 1500000, deductible: 2500 }] },
    ], lossHistory: [], billing: { frequency: 'Annual', method: 'Invoice' },
    declarations: { informationAccurate: true, insuranceDeclined: false, additionalInformation: '' }, source: 'manual',
  };
}

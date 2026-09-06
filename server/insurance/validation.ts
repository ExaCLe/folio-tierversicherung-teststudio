import { z } from 'zod';
import type { PolicyDraftInput } from '../../shared/insurance';

const text = z.string().trim().min(1).max(240);
const identifier = z.string().trim().min(1).max(120).regex(/^[a-zA-Z0-9_-]+$/, 'Use letters, numbers, hyphens, or underscores for an id');
const money = z.number().finite().min(0).max(1_000_000_000_000);
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').refine(value => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Enter a valid calendar date');

export const addressSchema = z.object({ line1: text, city: text, postcode: text.max(24) }).strict();
export const customerSchema = z.object({
  name: text,
  registrationNumber: text.max(80),
  headquartersCountry: z.enum(['DE', 'IT']),
  address: addressSchema,
  industry: text,
  contactName: text,
  email: z.string().trim().email().max(240),
  source: z.enum(['manual', 'run']).optional(),
  runId: identifier.optional(),
}).strict();

const coverageSchema = z.object({
  type: z.enum(['Fire', 'Flood', 'Business interruption', 'Theft']),
  limit: money.positive(),
  deductible: money,
}).strict().refine(coverage => coverage.deductible < coverage.limit, {
  message: 'A deductible must be below its coverage limit', path: ['deductible'],
});

export const locationSchema = z.object({
  id: identifier,
  name: text,
  type: z.enum(['Factory', 'Warehouse', 'Office']),
  country: z.enum(['DE', 'IT']),
  address: addressSchema,
  construction: z.enum(['Masonry', 'Steel', 'Timber']),
  yearBuilt: z.number().int().min(1700).max(new Date().getUTCFullYear() + 1),
  areaSqm: z.number().finite().positive().max(100_000_000),
  sprinkler: z.boolean(),
  floodZone: z.enum(['Low', 'Moderate', 'High']),
  sumInsured: money.positive(),
  coverages: z.array(coverageSchema).min(1).max(4),
}).strict().superRefine((location, context) => {
  const types = location.coverages.map(coverage => coverage.type);
  if (new Set(types).size !== types.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['coverages'], message: 'A location can have each coverage only once' });
  if (!types.includes('Fire')) context.addIssue({ code: z.ZodIssueCode.custom, path: ['coverages'], message: 'Each location needs Fire coverage' });
  for (const [index, coverage] of location.coverages.entries()) {
    if (coverage.type !== 'Business interruption' && coverage.limit > location.sumInsured) context.addIssue({ code: z.ZodIssueCode.custom, path: ['coverages', index, 'limit'], message: 'Property coverage cannot exceed the location sum insured' });
  }
});

const draftObject = z.object({
  customerId: identifier,
  productVersion: z.literal(3),
  issuingMarket: z.literal('DE'),
  currency: z.literal('EUR'),
  inceptionDate: dateSchema,
  expiryDate: dateSchema,
  locations: z.array(locationSchema).min(1).max(30),
  lossHistory: z.array(z.object({ id: identifier, date: dateSchema, description: text.max(1000), amount: money.positive() }).strict()).max(100),
  billing: z.object({ frequency: z.enum(['Annual', 'Quarterly']), method: z.enum(['Invoice', 'Direct debit']) }).strict(),
  declarations: z.object({ informationAccurate: z.boolean(), insuranceDeclined: z.boolean(), additionalInformation: z.string().trim().max(5000) }).strict(),
  source: z.enum(['manual', 'run']).optional(),
  runId: identifier.optional(),
}).strict();

export const draftSchema = draftObject.superRefine((draft, context) => {
  if (draft.expiryDate <= draft.inceptionDate) context.addIssue({ code: z.ZodIssueCode.custom, path: ['expiryDate'], message: 'Expiry date must be after inception date' });
  const locationIds = draft.locations.map(location => location.id);
  if (new Set(locationIds).size !== locationIds.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['locations'], message: 'Every location must have a different id' });
  const lossIds = draft.lossHistory.map(loss => loss.id);
  if (new Set(lossIds).size !== lossIds.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['lossHistory'], message: 'Every loss must have a different id' });
  draft.lossHistory.forEach((loss, index) => {
    if (loss.date > draft.inceptionDate) context.addIssue({ code: z.ZodIssueCode.custom, path: ['lossHistory', index, 'date'], message: 'Historical losses must be on or before inception' });
  });
});

export const patchSchema = draftObject.partial().refine(value => Object.keys(value).length > 0, 'Provide at least one policy field to change');
export const documentSchema = z.object({
  type: z.literal('Risk survey'), locationId: identifier, name: text,
  suitable: z.boolean(),
}).strict();
export const approvalSchema = z.object({ policyId: identifier, notes: z.string().trim().max(2000).optional().default('') }).strict();
export const issueSchema = z.object({ quoteId: identifier }).strict();
export const amendmentSchema = z.object({ effectiveDate: dateSchema, reason: z.string().trim().min(3).max(2000), changes: patchSchema }).strict();
export const emptyBodySchema = z.object({}).strict();

export function parseDraft(value: unknown): PolicyDraftInput {
  return draftSchema.parse(value);
}

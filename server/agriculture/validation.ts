import { z } from 'zod';
import { FEDERAL_STATES } from '../../shared/agriculture';
import { AgricultureError } from './errors';

const text = z.string().trim().min(1).max(240);
export const identifierSchema = z.string().trim().min(1).max(160).regex(/^[a-zA-Z0-9_-]+$/, 'Die Kennung darf nur Buchstaben, Zahlen, Bindestriche und Unterstriche enthalten.');
const money = z.number().finite().positive().max(1_000_000_000).refine(value => Math.abs(value * 100 - Math.round(value * 100)) < 0.0001, 'Geben Sie die Versicherungssumme mit höchstens zwei Nachkommastellen an.');
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Geben Sie ein Datum im Format JJJJ-MM-TT an.').refine(value => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value && value >= '1900-01-01' && value <= '2199-12-31';
}, 'Geben Sie ein gültiges Kalenderdatum zwischen 1900 und 2199 an.');
const birthDate = dateSchema.refine(value => value <= new Date().toISOString().slice(0, 10), 'Das Geburtsdatum darf nicht in der Zukunft liegen.');
const postalCode = z.string().trim().regex(/^\d{5}$/, 'Eine deutsche Postleitzahl besteht aus fünf Ziffern.');

export const customerSchema = z.object({
  name: text,
  email: z.string().trim().email('Geben Sie eine gültige E-Mail-Adresse an.').max(240),
  phone: text.max(60), street: text, postalCode, city: text,
}).strict();

export const farmSchema = z.object({
  customerId: identifierSchema, name: text, state: z.enum(FEDERAL_STATES),
  street: text, postalCode, city: text,
  farmType: z.enum(['Milchviehbetrieb', 'Gemischter Betrieb', 'Pferdehaltung', 'Schweinehaltung', 'Tierhaltung']),
}).strict();

const animalBase = { farmId: identifierSchema, name: text, sumInsured: money };
export const animalSchema = z.discriminatedUnion('species', [
  z.object({ ...animalBase, species: z.literal('Rind'), earTag: text.max(80), breed: text, birthDate, use: z.enum(['Milchkuh', 'Zucht', 'Mast']) }).strict(),
  z.object({ ...animalBase, species: z.literal('Pferd'), chipNumber: text.max(80), breed: text, birthDate, use: z.enum(['Freizeit', 'Zucht', 'Sport']), health: z.enum(['Unauffällig', 'Vorerkrankung']), healthNotes: z.string().trim().max(2000) }).strict(),
  z.object({ ...animalBase, species: z.literal('Hund'), chipNumber: text.max(80), breed: text, birthDate, use: z.enum(['Hofhund', 'Hütehund', 'Privat']) }).strict(),
  z.object({ ...animalBase, species: z.literal('Schwein'), animalCount: z.number().int().positive().max(100_000), housing: z.enum(['Stallhaltung', 'Freilandhaltung']), biosecurity: z.enum(['Erfüllt', 'Klärung erforderlich']) }).strict(),
]).superRefine((animal, context) => {
  if (animal.species === 'Pferd' && animal.health === 'Vorerkrankung' && animal.healthNotes.length < 3) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['healthNotes'], message: 'Beschreiben Sie die Vorerkrankung mit mindestens drei Zeichen.' });
  }
});

export const proposalSchema = z.object({
  customerId: identifierSchema, farmId: identifierSchema,
  animalIds: z.array(identifierSchema).min(1).max(100),
  product: z.enum(['Tierlebensversicherung', 'Bestandsversicherung']),
  startDate: dateSchema, durationMonths: z.literal(12), runId: identifierSchema.optional(),
}).strict().superRefine((proposal, context) => {
  if (new Set(proposal.animalIds).size !== proposal.animalIds.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['animalIds'], message: 'Jedes Tier oder jeder Bestand darf im Vorschlag nur einmal vorkommen.' });
  }
});

export const emptyBodySchema = z.object({}).strict();
export const decisionSchema = z.object({ decision: z.enum(['Freigeben', 'Ablehnen']), reason: z.string().trim().min(3).max(2000) }).strict();
export const reissueSchema = z.object({ reason: z.string().trim().min(3).max(2000) }).strict();
export const printSchema = z.object({ documentId: identifierSchema }).strict();
export const overviewQuerySchema = z.object({ runId: identifierSchema.optional() }).strict();
export const farmsQuerySchema = z.object({ customerId: identifierSchema.optional() }).strict();
export const animalsQuerySchema = z.object({ farmId: identifierSchema.optional() }).strict();

const labels: Record<string, string> = {
  name: 'Name', email: 'E-Mail', phone: 'Telefon', street: 'Straße', postalCode: 'Postleitzahl', city: 'Ort',
  customerId: 'Kunde', farmId: 'Betrieb', state: 'Bundesland', farmType: 'Betriebsart', species: 'Tierart',
  sumInsured: 'Versicherungssumme', earTag: 'Ohrmarke', breed: 'Rasse', birthDate: 'Geburtsdatum',
  use: 'Nutzung', chipNumber: 'Chipnummer', health: 'Gesundheitszustand', healthNotes: 'Gesundheitsangaben',
  animalCount: 'Anzahl Schweine', housing: 'Haltungsform', biosecurity: 'Biosicherheit', animalIds: 'Tiere und Bestände',
  product: 'Versicherungsprodukt', startDate: 'Versicherungsbeginn', durationMonths: 'Laufzeit',
  runId: 'Ablaufkennung', decision: 'Entscheidung', reason: 'Begründung', documentId: 'Policendokument',
};

const germanErrorMap: z.ZodErrorMap = (issue) => {
  const field = labels[String(issue.path.at(-1))] ?? 'Eingabe';
  if (issue.code === z.ZodIssueCode.unrecognized_keys) return { message: 'Die Anfrage enthält zusätzliche, nicht zulässige Felder.' };
  if (issue.code === z.ZodIssueCode.invalid_type) return { message: `${field}: ${issue.received === 'undefined' ? 'Bitte ergänzen Sie dieses Feld.' : 'Der Wert hat nicht das erforderliche Format.'}` };
  if (issue.code === z.ZodIssueCode.invalid_enum_value || issue.code === z.ZodIssueCode.invalid_union_discriminator || issue.code === z.ZodIssueCode.invalid_literal) return { message: `${field}: Wählen Sie einen zulässigen Wert.` };
  if (issue.code === z.ZodIssueCode.too_small) return { message: `${field}: Der Wert ist zu klein oder die Eingabe ist zu kurz.` };
  if (issue.code === z.ZodIssueCode.too_big) return { message: `${field}: Der Wert ist zu groß oder die Eingabe ist zu lang.` };
  return { message: `${field}: Prüfen Sie den eingegebenen Wert.` };
};

export function parseInput<S extends z.ZodTypeAny>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value, { errorMap: germanErrorMap });
  if (!result.success) throw new AgricultureError(400, 'INVALID_INPUT', result.error.issues[0]?.message ?? 'Prüfen Sie die Eingaben.');
  return result.data;
}

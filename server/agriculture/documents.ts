import { createHash, randomUUID } from 'node:crypto';
import { AGRICULTURE_RULES, agricultureMoney } from '../../shared/agriculture';
import type { AgricultureAnimal, AgricultureContract, AgricultureCustomer, AgriculturePolicy, AgricultureRole, Farm, PolicyDocument } from '../../shared/agriculture';

const escapeHtml = (value: unknown) => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));
const germanDate = (value: string) => new Intl.DateTimeFormat('de-DE', { timeZone: 'UTC' }).format(new Date(value.length === 10 ? `${value}T00:00:00.000Z` : value));
export const documentHash = (html: string): string => createHash('sha256').update(html, 'utf8').digest('hex');
const line = (label: string, value: unknown) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`;

function animalDetails(animal: AgricultureAnimal): string {
  const common = line('Tier / Bestand', animal.name) + line('Tiernummer', animal.number) + line('Tierart', animal.species)
    + line('Versicherungssumme', agricultureMoney(animal.sumInsured));
  if (animal.species === 'Schwein') return common + line('Anzahl Schweine', animal.animalCount) + line('Haltungsform', animal.housing) + line('Biosicherheit', animal.biosecurity);
  const individual = line(animal.species === 'Rind' ? 'Ohrmarke' : 'Chipnummer', animal.species === 'Rind' ? animal.earTag : animal.chipNumber)
    + line('Rasse', animal.breed) + line('Geburtsdatum', germanDate(animal.birthDate)) + line('Nutzung', animal.use);
  return common + individual + (animal.species === 'Pferd' ? line('Gesundheitszustand', animal.health) + line('Gesundheitsangaben', animal.healthNotes || 'Keine weiteren Angaben') : '');
}

export function makePolicyDocument(
  policy: AgriculturePolicy, contract: AgricultureContract, customer: AgricultureCustomer, farm: Farm,
  animals: AgricultureAnimal[], role: AgricultureRole, reason: string,
): PolicyDocument {
  const id = `agr-document-${randomUUID()}`;
  const createdAt = new Date().toISOString();
  const title = `Police ${policy.number}, Ausgabe ${policy.version}`;
  const html = `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>
<style>body{font:15px/1.5 Arial,sans-serif;color:#142b45;margin:0;background:#e8edf3}main{box-sizing:border-box;max-width:900px;margin:28px auto;background:white;padding:42px;border:1px solid #bac9d7}header{border-bottom:3px solid #235785;padding-bottom:16px}h1{font-size:26px;margin:8px 0}h2{font-size:18px;color:#194b75;border-bottom:1px solid #b7c8d7;padding-bottom:7px;margin-top:28px}h3{font-size:16px;margin-bottom:8px}.brand{font-size:20px;font-weight:bold}.note{font-size:13px;color:#465d70}dl{display:grid;grid-template-columns:220px 1fr;gap:5px 18px;margin:12px 0}dt{font-weight:bold}dd{margin:0;overflow-wrap:anywhere}.animal{break-inside:avoid;border-bottom:1px solid #d4dee7;padding-bottom:12px}.total{background:#edf3f8;padding:16px;margin-top:22px}footer{border-top:1px solid #b7c8d7;margin-top:30px;padding-top:14px;font-size:12px;color:#465d70} @media(max-width:600px){main{margin:0;padding:22px}dl{grid-template-columns:1fr;gap:1px}dd{margin-bottom:9px}} @media print{body{background:white}main{margin:0;border:0;padding:10mm;max-width:none}h2{break-after:avoid}footer{break-inside:avoid}}</style></head>
<body><main><header><div class="brand">Land &amp; Tier</div><div>Tierleben und Tierbestände</div><h1>${escapeHtml(title)}</h1><div class="note">Fiktive Versicherung. Dieses Dokument begründet keinen echten Versicherungsschutz.</div></header>
<h2>Vertragsdaten</h2><dl>${line('Policennummer', policy.number)}${line('Vertragsnummer', contract.number)}${line('Versicherungsprodukt', contract.product)}${line('Versicherungsbeginn', germanDate(contract.startDate))}${line('Versicherungsende', `${germanDate(contract.endDate)} einschließlich`)}${line('Laufzeit', '12 Monate')}${line('Vertragsstatus', 'Aktiv')}</dl>
<h2>Versicherungsnehmer</h2><dl>${line('Name', customer.name)}${line('Kundennummer', customer.number)}${line('Anschrift', `${customer.street}, ${customer.postalCode} ${customer.city}`)}${line('E-Mail', customer.email)}${line('Telefon', customer.phone)}</dl>
<h2>Versicherter Betrieb</h2><dl>${line('Betrieb', farm.name)}${line('Betriebsnummer', farm.number)}${line('Anschrift', `${farm.street}, ${farm.postalCode} ${farm.city}`)}${line('Bundesland', farm.state)}${line('Betriebsart', farm.farmType)}</dl>
<h2>Versicherte Tiere und Bestände</h2>${animals.map(animal => `<section class="animal"><h3>${escapeHtml(animal.name)}</h3><dl>${animalDetails(animal)}</dl></section>`).join('')}
<section class="total"><dl>${line('Gesamte Versicherungssumme', agricultureMoney(contract.totalSumInsured))}${line('Jahresbeitrag', agricultureMoney(contract.annualPremium))}</dl><p class="note">Fiktive Berechnung nach ${escapeHtml(AGRICULTURE_RULES.version)}. Rind 3,5 %, Pferd 4 %, Hund 5 %, Schwein 1,8 % der jeweiligen Versicherungssumme. Mindestjahresbeitrag je Vorschlag 60 EUR.</p></section>
<h2>Dokumentausgabe</h2><dl>${line('Ausgabe', policy.version)}${line('Erstellt am', germanDate(createdAt))}${line('Erstellt durch', role)}${line('Ausgabegrund', reason)}${line('Dokumentkennung', id)}</dl>
<footer>Land &amp; Tier · Fiktive Tierversicherung · Diese Ausgabe dokumentiert den abgeschlossenen Vertragsstand. Frühere Ausgaben bleiben erhalten.</footer></main></body></html>`;
  return { id, policyId: policy.id, contractId: contract.id, version: policy.version, title, createdAt, createdBy: role, reason, sha256: documentHash(html), html };
}

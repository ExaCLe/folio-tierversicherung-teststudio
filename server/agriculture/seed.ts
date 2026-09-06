import { bayernFarm, STANDARD_CUSTOMER, standardCow, standardFarm } from '../../shared/agriculture';
import type { AgricultureAnimal, AgricultureCustomer, AgricultureProposal, Farm, ProposalInput, ProposalStatus } from '../../shared/agriculture';
import { db } from '../store';
import { auditEvent, collections, completeProposal, createProposal, decideReferral, makeOffer, submitProposal } from './domain';

const createdAt = '2026-09-01T08:00:00.000Z';
function ensure<T extends { id: string }>(collection: string, entity: T, onCreate: () => void): T {
  const existing = db.find<T>(collection, entity.id);
  if (existing) return existing;
  db.upsert(collection, entity);
  onCreate();
  return entity;
}

export function seedAgriculture(): void {
  const customer = ensure<AgricultureCustomer>(collections.customers, {
    ...STANDARD_CUSTOMER, id: 'agr-customer-demo-bauer', number: 'KU-2026-01001', createdAt,
  }, () => auditEvent('Kunde', 'agr-customer-demo-bauer', null, 'Kunde erfasst', 'Vermittler', 'Johanna Bauer wurde als fiktive Beispielkundin erfasst.'));
  const farm = ensure<Farm>(collections.farms, {
    ...standardFarm(customer.id), id: 'agr-farm-demo-lindenkamp', number: 'BE-2026-02001', createdAt,
  }, () => auditEvent('Betrieb', 'agr-farm-demo-lindenkamp', null, 'Betrieb erfasst', 'Vermittler', 'Hof Lindenkamp in Niedersachsen gehört zu Johanna Bauer.'));
  const bavarianFarm = ensure<Farm>(collections.farms, {
    ...bayernFarm(customer.id), id: 'agr-farm-demo-sonnleitner', number: 'BE-2026-02002', createdAt,
  }, () => auditEvent('Betrieb', 'agr-farm-demo-sonnleitner', null, 'Betrieb erfasst', 'Vermittler', 'Bauernhof Sonnleitner in Bayern wurde als zweiter Betrieb von Johanna Bauer erfasst.'));
  const stockCustomer = ensure<AgricultureCustomer>(collections.customers, {
    id: 'agr-customer-demo-hartmann', number: 'KU-2026-01002', name: 'Lukas Hartmann', email: 'lukas.hartmann@example.test',
    phone: '0251 5550170', street: 'Eichenweg 8', postalCode: '48143', city: 'Münster', createdAt,
  }, () => auditEvent('Kunde', 'agr-customer-demo-hartmann', null, 'Kunde erfasst', 'Vermittler', 'Lukas Hartmann wurde als fiktiver Beispielkunde erfasst.'));
  const stockFarm = ensure<Farm>(collections.farms, {
    id: 'agr-farm-demo-eichenweide', number: 'BE-2026-02003', customerId: stockCustomer.id, name: 'Hof Eichenweide',
    state: 'Nordrhein-Westfalen', street: 'Eichenweg 8', postalCode: '48143', city: 'Münster', farmType: 'Schweinehaltung', createdAt,
  }, () => auditEvent('Betrieb', 'agr-farm-demo-eichenweide', null, 'Betrieb erfasst', 'Vermittler', 'Hof Eichenweide gehört zu Lukas Hartmann.'));

  const animals: AgricultureAnimal[] = [
    { ...standardCow(farm.id), id: 'agr-animal-demo-alma', number: 'TI-2026-03001', createdAt },
    { ...standardCow(farm.id), name: 'Bella', sumInsured: 15_000, earTag: 'DE 03 123 45679', id: 'agr-animal-demo-bella', number: 'TI-2026-03002', createdAt } as AgricultureAnimal,
    { ...standardCow(bavarianFarm.id), name: 'Clara', earTag: 'DE 09 123 45680', id: 'agr-animal-demo-clara', number: 'TI-2026-03003', createdAt } as AgricultureAnimal,
    { id: 'agr-animal-demo-freya', number: 'TI-2026-03004', farmId: farm.id, species: 'Pferd', name: 'Freya', sumInsured: 35_000,
      chipNumber: '276098100123451', breed: 'Hannoveraner', birthDate: '2018-05-12', use: 'Freizeit', health: 'Vorerkrankung', healthNotes: 'Behandelte Sehnenverletzung am Vorderbein.', createdAt },
    { id: 'agr-animal-demo-hektor', number: 'TI-2026-03005', farmId: farm.id, species: 'Hund', name: 'Hektor', sumInsured: 2_000,
      chipNumber: '276098100123452', breed: 'Border Collie', birthDate: '2021-03-08', use: 'Hütehund', createdAt },
    { id: 'agr-animal-demo-schweine', number: 'BS-2026-03006', farmId: stockFarm.id, species: 'Schwein', name: 'Mastbestand Eichenweide',
      sumInsured: 88_000, animalCount: 220, housing: 'Stallhaltung', biosecurity: 'Erfüllt', createdAt },
  ];
  for (const animal of animals) ensure(collections.animals, animal,
    () => auditEvent('Tier', animal.id, null, animal.species === 'Schwein' ? 'Bestand erfasst' : 'Tier erfasst', 'Vermittler', `${animal.name} wurde als fiktives Beispiel erfasst.`));

  const examples: { key: string; animalId: string; farmId: string; customerId: string; status: ProposalStatus; product?: ProposalInput['product'] }[] = [
    { key: 'standard-entwurf', animalId: 'agr-animal-demo-alma', farmId: farm.id, customerId: customer.id, status: 'Entwurf' },
    { key: 'standard-angebot', animalId: 'agr-animal-demo-alma', farmId: farm.id, customerId: customer.id, status: 'Angebot' },
    { key: 'hohe-summe-anfrage', animalId: 'agr-animal-demo-bella', farmId: farm.id, customerId: customer.id, status: 'Direktionsprüfung' },
    { key: 'hohe-summe-freigabe', animalId: 'agr-animal-demo-bella', farmId: farm.id, customerId: customer.id, status: 'Freigegeben' },
    { key: 'pferd-ablehnung', animalId: 'agr-animal-demo-freya', farmId: farm.id, customerId: customer.id, status: 'Abgelehnt' },
    { key: 'bayern-abschluss', animalId: 'agr-animal-demo-clara', farmId: bavarianFarm.id, customerId: customer.id, status: 'Abgeschlossen' },
    { key: 'schweine-angebot', animalId: 'agr-animal-demo-schweine', farmId: stockFarm.id, customerId: stockCustomer.id, status: 'Angebot', product: 'Bestandsversicherung' },
  ];
  for (const example of examples) {
    const runId = `demo-tier-${example.key}`;
    if (db.read<AgricultureProposal>(collections.proposals).some(proposal => proposal.runId === runId)) continue;
    const proposal = createProposal({ customerId: example.customerId, farmId: example.farmId, animalIds: [example.animalId],
      product: example.product ?? 'Tierlebensversicherung', startDate: '2026-10-01', durationMonths: 12, runId }, 'Vermittler');
    if (example.status === 'Entwurf') continue;
    makeOffer(proposal.id, 'Vermittler');
    if (example.status === 'Angebot') continue;
    const submitted = submitProposal(proposal.id, 'Vermittler');
    if (example.status === 'Direktionsprüfung') continue;
    if (submitted.referral) decideReferral(submitted.referral.id, {
      decision: example.status === 'Abgelehnt' ? 'Ablehnen' : 'Freigeben',
      reason: example.status === 'Abgelehnt' ? 'Die Vorerkrankung ist nach den fiktiven Annahmeregeln nicht versicherbar.' : 'Die hohe Versicherungssumme ist nachvollziehbar. Die Direktion gibt den Antrag frei.',
    }, 'Direktion');
    if (example.status === 'Abgeschlossen') completeProposal(proposal.id, 'Vermittler');
  }
}

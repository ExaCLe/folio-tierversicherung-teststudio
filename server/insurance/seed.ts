import { createStandardDraft, ITALIAN_WAREHOUSE_ADDRESS } from '../../shared/insurance';
import type { Customer, Policy, PolicyDraftInput } from '../../shared/insurance';
import { db } from '../store';
import { approveQuote, attachDocument, collections, copy, issuePolicy, requestQuote } from './domain';

export function seedInsurance(): void {
  if (db.find<{ id: string }>(collections.metadata, 'demo-v1')) return;
  const timestamp = new Date().toISOString();
  const customers: Customer[] = [
    { id: 'customer-linden', name: 'Linden Manufacturing GmbH', registrationNumber: 'DE-DEMO-104821', headquartersCountry: 'DE',
      address: { line1: 'Lindenplatz 8', city: 'Munich', postcode: '80331' }, industry: 'Industrial manufacturing',
      contactName: 'Mara Lindner', email: 'mara.lindner@linden.example', createdAt: timestamp, source: 'manual' },
    { id: 'customer-halden', name: 'Halden Foods GmbH', registrationNumber: 'DE-DEMO-208741', headquartersCountry: 'DE',
      address: { line1: 'Kornweg 16', city: 'Bremen', postcode: '28195' }, industry: 'Food production',
      contactName: 'Jonas Weber', email: 'jonas.weber@halden.example', createdAt: timestamp, source: 'manual' },
    { id: 'customer-vela', name: 'Vela Design S.r.l.', registrationNumber: 'IT-DEMO-309172', headquartersCountry: 'IT',
      address: { line1: 'Via del Disegno 12', city: 'Milan', postcode: '20126' }, industry: 'Furniture design and production',
      contactName: 'Elena Rossi', email: 'elena.rossi@vela.example', createdAt: timestamp, source: 'manual' },
    { id: 'customer-aster', name: 'Aster Tools GmbH', registrationNumber: 'DE-DEMO-406523', headquartersCountry: 'DE',
      address: { line1: 'Werkallee 22', city: 'Leipzig', postcode: '04103' }, industry: 'Precision tools',
      contactName: 'Felix Brandt', email: 'felix.brandt@aster.example', createdAt: timestamp, source: 'manual' },
  ];
  const customersAbsent = db.read<Customer>(collections.customers).length === 0;
  const policiesAbsent = db.read<Policy>(collections.policies).length === 0;
  if (customersAbsent) customers.forEach(customer => db.upsert(collections.customers, customer));
  if (policiesAbsent && customers.every(customer => db.find<Customer>(collections.customers, customer.id))) {
    const year = new Date().getUTCFullYear();
    const createSeed = (suffix: string, input: PolicyDraftInput, daysAgo: number) => {
      const createdAt = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
      const policy: Policy = { ...copy(input), source: 'manual', id: `policy-demo-${suffix}`, policyNumber: `MCP-${year}-${suffix}`,
        product: 'Meridian Commercial Property', status: 'Draft', version: 1, revision: 1, quoteId: null, premium: null,
        documents: [], amendments: [], createdAt, updatedAt: createdAt,
        activity: [{ id: `activity-demo-${suffix}`, at: createdAt, actor: 'Broker', action: 'Draft created', detail: 'Prepared in the Meridian demonstration workspace.' }] };
      db.upsert(collections.policies, policy);
      return policy;
    };

    createSeed('1048', createStandardDraft('customer-linden'), 1);
    const halden = createStandardDraft('customer-halden');
    halden.locations[0] = { ...halden.locations[0], name: 'Food production plant', sumInsured: 4_200_000,
      address: { line1: 'Kornweg 18', city: 'Bremen', postcode: '28195' }, coverages: [{ type: 'Fire', limit: 4_200_000, deductible: 5000 }, { type: 'Business interruption', limit: 1_000_000, deductible: 5000 }] };
    halden.locations[1].coverages.push({ type: 'Flood', limit: 500_000, deductible: 5000 });
    const quoted = createSeed('1047', halden, 2);
    requestQuote(quoted.id, 'Broker');

    const lindenReferral = createStandardDraft('customer-linden');
    lindenReferral.locations[1].country = 'IT';
    lindenReferral.locations[1].address = copy(ITALIAN_WAREHOUSE_ADDRESS);
    lindenReferral.locations[1].coverages.push({ type: 'Flood', limit: 1_000_000, deductible: 5000 });
    const referred = createSeed('1046', lindenReferral, 3);
    requestQuote(referred.id, 'Broker');

    const aster = createStandardDraft('customer-aster');
    aster.locations[0].address = { line1: 'Werkallee 24', city: 'Leipzig', postcode: '04103' };
    aster.locations[0].coverages.push({ type: 'Theft', limit: 350_000, deductible: 2500 });
    const issued = createSeed('1042', aster, 6);
    const issuedQuote = requestQuote(issued.id, 'Broker');
    issuePolicy(issued.id, issuedQuote.quote.id, 'Broker');

    const vela = createStandardDraft('customer-vela');
    vela.locations = [{ ...vela.locations[1], name: 'Distribution warehouse', sumInsured: 2_000_000,
      address: { line1: 'Speicherstrasse 11', city: 'Hamburg', postcode: '20457' },
      coverages: [{ type: 'Fire', limit: 2_000_000, deductible: 5000 }, { type: 'Flood', limit: 750_000, deductible: 10_000 }] }];
    const approved = createSeed('1039', vela, 8);
    const approvedQuote = requestQuote(approved.id, 'Broker');
    attachDocument(approved.id, { type: 'Risk survey', locationId: 'warehouse', name: 'Hamburg warehouse, synthetic risk survey', suitable: true }, 'Senior underwriter');
    approveQuote(approvedQuote.quote.id, approved.id, 'Reviewed the location survey. Flood protection and declared limit accepted.', 'Senior underwriter');
  }
  db.upsert(collections.metadata, { id: 'demo-v1', seededAt: timestamp });
}

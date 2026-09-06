import { test, expect, type Page } from '@playwright/test';
import { randomUUID, createHash } from 'node:crypto';
import { bayernFarm, type AgricultureAnimal, type AgricultureCustomer, type AgricultureProposal, type Farm, type ProposalDetail } from '../shared/agriculture';

async function save<T>(page: Page, button: string, endpoint: string): Promise<T> {
  const responsePromise = page.waitForResponse(response => new URL(response.url()).pathname === `/api/agriculture${endpoint}` && response.request().method() === 'POST');
  await page.getByRole('button', { name: button, exact: true }).click();
  const response = await responsePromise;
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json() as Promise<T>;
}

async function startCow(page: Page, options: { amount?: number; bayern?: boolean; species?: 'Pferd' | 'Hund' | 'Schwein'; health?: boolean; biosecurity?: boolean } = {}) {
  const runId = `portal-e2e-${randomUUID()}`;
  await page.goto(`/portal/neu?runId=${runId}`);
  await page.getByLabel('Benutzerrolle', { exact: true }).selectOption('Vermittler');
  await page.getByRole('button', { name: 'Standardkuh laden', exact: true }).click();
  await page.getByLabel('Name des Kunden', { exact: true }).fill(`Prüfkunde ${runId.slice(-8)}`);
  const { customer } = await save<{ customer: AgricultureCustomer }>(page, 'Kunde speichern', '/customers');
  await page.getByRole('button', { name: 'Weiter zu Betrieb', exact: true }).click();
  if (options.bayern) {
    const farm = bayernFarm(customer.id);
    await page.getByLabel('Betriebsname', { exact: true }).fill(farm.name);
    await page.getByLabel('Bundesland', { exact: true }).selectOption(farm.state);
    await page.getByLabel('Betriebsstraße', { exact: true }).fill(farm.street);
    await page.getByLabel('Betriebspostleitzahl', { exact: true }).fill(farm.postalCode);
    await page.getByLabel('Betriebsort', { exact: true }).fill(farm.city);
  }
  const { farm } = await save<{ farm: Farm }>(page, 'Betrieb speichern', '/farms');
  await page.getByRole('button', { name: 'Weiter zu Tier / Bestand', exact: true }).click();
  if (options.species) {
    await page.getByLabel('Tierart', { exact: true }).selectOption(options.species);
    await page.getByLabel('Name des Tiers oder Bestands', { exact: true }).fill(options.species === 'Pferd' ? 'Fiona' : options.species === 'Hund' ? 'Bruno' : 'Mastbestand Nord');
    if (options.species === 'Schwein') {
      await page.getByLabel('Anzahl Schweine', { exact: true }).fill('120');
      await page.getByLabel('Haltungsform', { exact: true }).selectOption('Stallhaltung');
      await page.getByLabel('Biosicherheit', { exact: true }).selectOption(options.biosecurity ? 'Klärung erforderlich' : 'Erfüllt');
    } else {
      await page.getByLabel('Chipnummer', { exact: true }).fill(`276${Date.now()}`);
      await page.getByLabel('Rasse', { exact: true }).fill(options.species === 'Pferd' ? 'Haflinger' : 'Border Collie');
      await page.getByLabel('Geburtsdatum', { exact: true }).fill('2021-03-11');
      await page.getByLabel('Nutzung', { exact: true }).selectOption(options.species === 'Pferd' ? 'Freizeit' : 'Hütehund');
      if (options.species === 'Pferd') {
        await page.getByLabel('Gesundheitszustand', { exact: true }).selectOption(options.health ? 'Vorerkrankung' : 'Unauffällig');
        if (options.health) await page.getByLabel('Gesundheitsangaben', { exact: true }).fill('Frühere Sehnenverletzung, tierärztlich untersucht.');
      }
    }
  } else {
    await page.getByLabel('Ohrmarke', { exact: true }).fill(`DE 09 ${Date.now()}`);
  }
  if (options.amount !== undefined) await page.getByLabel('Versicherungssumme in EUR', { exact: true }).fill(String(options.amount));
  const { animal } = await save<{ animal: AgricultureAnimal }>(page, 'Tier speichern', '/animals');
  await page.getByRole('button', { name: 'Weiter zu Vorschlag', exact: true }).click();
  await expect(page.getByLabel('Versicherungsprodukt', { exact: true })).toHaveValue(options.species === 'Schwein' ? 'Bestandsversicherung' : 'Tierlebensversicherung');
  await page.getByLabel('Versicherungsbeginn', { exact: true }).fill('2027-01-01');
  const { proposal } = await save<{ proposal: AgricultureProposal }>(page, 'Vorschlag speichern', '/proposals');
  await expect(page.getByTestId('proposal-status')).toHaveText('Entwurf');
  expect(new Set([customer.id, farm.id, animal.id, proposal.id]).size).toBe(4);
  expect(proposal.runId).toBe(runId);
  return { customer, farm, animal, proposal, runId };
}

async function offerAndSubmit(page: Page, proposal: AgricultureProposal) {
  await save(page, 'Angebot berechnen', `/proposals/${proposal.id}/offer`);
  await expect(page.getByTestId('proposal-status')).toHaveText('Angebot');
  await save(page, 'Antrag einreichen', `/proposals/${proposal.id}/submit`);
}

test('Standardkuh durchläuft die vollständige deutsche Oberfläche mit eigenen Datensätzen', async ({ page, request }) => {
  const { customer, farm, animal, proposal, runId } = await startCow(page);
  expect(farm.state).toBe('Niedersachsen');
  await offerAndSubmit(page, proposal);
  await expect(page.getByTestId('proposal-status')).toHaveText('Freigegeben');
  await save(page, 'Vertrag abschließen', `/proposals/${proposal.id}/complete`);
  await expect(page.getByTestId('proposal-status')).toHaveText('Abgeschlossen');
  await expect(page.getByTestId('contract-number')).toBeVisible();
  await expect(page.getByTestId('policy-number')).toBeVisible();
  const detail = await (await request.get(`/api/agriculture/proposals/${proposal.id}`)).json() as ProposalDetail;
  expect(detail.customer.id).toBe(customer.id);
  expect(detail.farm.id).toBe(farm.id);
  expect(detail.animals[0].id).toBe(animal.id);
  expect(detail.referral).toBeNull();
  expect(detail.contract?.annualPremium).toBe(122.5);
  expect(new Set([customer.id, farm.id, animal.id, proposal.id, detail.contract!.id, detail.policy!.id, detail.documents[0].id]).size).toBe(7);
  const overview = await (await request.get(`/api/agriculture/overview?runId=${runId}`)).json();
  expect(overview.proposals).toHaveLength(1);
  await page.reload();
  await expect(page.getByTestId('proposal-status')).toHaveText('Abgeschlossen');
  await expect(page.getByRole('navigation', { name: 'Versicherungsbereiche' })).toBeVisible();
  await expect(page.getByText('Scenario studio', { exact: true })).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
});

test('Bayern und hohe Summe erfordern Direktion, Abschluss und dokumentierten Sachbearbeiterdruck', async ({ page, request }) => {
  const { customer, farm, proposal } = await startCow(page, { amount: 15_000, bayern: true });
  expect(customer.city).toBe('Uelzen');
  expect(farm.city).toBe('Kempten');
  expect(farm.state).toBe('Bayern');
  await offerAndSubmit(page, proposal);
  await expect(page.getByTestId('proposal-status')).toHaveText('Direktionsprüfung');
  await expect(page.getByTestId('referral-number')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Entscheidung speichern', exact: true })).toBeDisabled();
  const referred = await (await request.get(`/api/agriculture/proposals/${proposal.id}`)).json() as ProposalDetail;
  const forbidden = await request.post(`/api/agriculture/referrals/${referred.referral!.id}/decision`, { headers: { 'x-agriculture-role': 'Vermittler' }, data: { decision: 'Freigeben', reason: 'Unzulässige Freigabe' } });
  expect(forbidden.status()).toBe(403);
  expect((await request.post(`/api/agriculture/proposals/${proposal.id}/complete`, { headers: { 'x-agriculture-role': 'Vermittler' }, data: {} })).status()).toBe(409);
  await page.getByLabel('Benutzerrolle', { exact: true }).selectOption('Direktion');
  await page.getByLabel('Entscheidung', { exact: true }).selectOption('Freigeben');
  await page.getByLabel('Begründung der Entscheidung', { exact: true }).fill('Wertnachweis geprüft. Versicherungssumme für Zuchtkuh freigegeben.');
  await save(page, 'Entscheidung speichern', `/referrals/${referred.referral!.id}/decision`);
  await expect(page.getByTestId('proposal-status')).toHaveText('Freigegeben');
  await expect(page.getByRole('button', { name: 'Vertrag abschließen', exact: true })).toBeDisabled();
  await page.getByLabel('Benutzerrolle', { exact: true }).selectOption('Vermittler');
  await save(page, 'Vertrag abschließen', `/proposals/${proposal.id}/complete`);
  await expect(page.getByTestId('proposal-status')).toHaveText('Abgeschlossen');
  await expect(page.getByRole('button', { name: 'Police drucken', exact: true })).toBeDisabled();
  const before = await (await request.get(`/api/agriculture/proposals/${proposal.id}`)).json() as ProposalDetail;
  await page.goto(`/portal/policen/${before.policy!.id}`);
  await page.getByLabel('Benutzerrolle', { exact: true }).selectOption('Sachbearbeiter');
  await page.getByLabel('Grund der erneuten Ausgabe', { exact: true }).fill('Ersatzausfertigung auf Kundenwunsch.');
  await save(page, 'Police erneut ausgeben', `/policies/${before.policy!.id}/reissue`);
  await expect(page.getByTestId('document-version')).toHaveText('2');
  await save(page, 'Police drucken', `/policies/${before.policy!.id}/print`);
  await expect(page.getByTestId('print-confirmation')).toContainText('Druckauftrag erfasst');
  const after = await (await request.get(`/api/agriculture/proposals/${proposal.id}`)).json() as ProposalDetail;
  expect(after.documents).toHaveLength(2);
  expect(after.policy!.id).toBe(before.policy!.id);
  expect(after.contract!.id).toBe(before.contract!.id);
  expect(after.documents.find(doc => doc.id === before.documents[0].id)).toEqual(before.documents[0]);
  const current = after.documents.find(doc => doc.id === after.policy!.documentId)!;
  expect(after.printEvents[0].documentId).toBe(current.id);
  expect(after.printEvents[0].documentSha256).toBe(current.sha256);
  expect(createHash('sha256').update(current.html).digest('hex')).toBe(current.sha256);
  const html = await request.get(`/api/agriculture/documents/${current.id}/html`);
  expect(html.ok()).toBeTruthy();
  expect(await html.text()).toContain(after.policy!.number);
  await page.reload();
  await expect(page.getByTestId('print-confirmation')).toContainText('Dokumentversion 2');
});

test('Exakt 10.000 EUR bleiben ohne Direktionsanfrage abschließbar', async ({ page }) => {
  const { proposal } = await startCow(page, { amount: 10_000 });
  await offerAndSubmit(page, proposal);
  await expect(page.getByTestId('proposal-status')).toHaveText('Freigegeben');
  await expect(page.getByTestId('referral-number')).toHaveCount(0);
  await save(page, 'Vertrag abschließen', `/proposals/${proposal.id}/complete`);
  await expect(page.getByTestId('proposal-status')).toHaveText('Abgeschlossen');
});

test('Pferd mit Vorerkrankung kann durch die Direktion abgelehnt werden', async ({ page, request }) => {
  const { proposal } = await startCow(page, { species: 'Pferd', amount: 8_000, health: true });
  await offerAndSubmit(page, proposal);
  await expect(page.getByTestId('proposal-status')).toHaveText('Direktionsprüfung');
  const detail = await (await request.get(`/api/agriculture/proposals/${proposal.id}`)).json() as ProposalDetail;
  await page.getByLabel('Benutzerrolle', { exact: true }).selectOption('Direktion');
  await page.getByLabel('Entscheidung', { exact: true }).selectOption('Ablehnen');
  await page.getByLabel('Begründung der Entscheidung', { exact: true }).fill('Annahme aufgrund der vorliegenden Erkrankung abgelehnt.');
  await save(page, 'Entscheidung speichern', `/referrals/${detail.referral!.id}/decision`);
  await expect(page.getByTestId('proposal-status')).toHaveText('Abgelehnt');
  await page.getByLabel('Benutzerrolle', { exact: true }).selectOption('Vermittler');
  await expect(page.getByRole('button', { name: 'Vertrag abschließen', exact: true })).toHaveCount(0);
  expect((await request.post(`/api/agriculture/proposals/${proposal.id}/complete`, { data: {} })).status()).toBe(409);
});

test('Hütehund mit Chip und Nutzung wird als Einzeltier versichert', async ({ page }) => {
  const { animal, proposal } = await startCow(page, { species: 'Hund', amount: 2_000 });
  expect(animal.species).toBe('Hund');
  await offerAndSubmit(page, proposal);
  await expect(page.getByTestId('proposal-status')).toHaveText('Freigegeben');
  await save(page, 'Vertrag abschließen', `/proposals/${proposal.id}/complete`);
  await expect(page.getByTestId('proposal-status')).toHaveText('Abgeschlossen');
});

test('Schweinebestand mit ungeklärter Biosicherheit geht an die Direktion', async ({ page, request }) => {
  const { animal, proposal } = await startCow(page, { species: 'Schwein', amount: 30_000, biosecurity: true });
  expect(animal.species).toBe('Schwein');
  expect(proposal.product).toBe('Bestandsversicherung');
  await offerAndSubmit(page, proposal);
  await expect(page.getByTestId('proposal-status')).toHaveText('Direktionsprüfung');
  const detail = await (await request.get(`/api/agriculture/proposals/${proposal.id}`)).json() as ProposalDetail;
  expect(detail.referral?.reasons.join(' ')).toContain('Biosicherheit');
});

test('Ein Kunde kann einen zweiten Betrieb mit eigenen Tieren anlegen', async ({ page, request }) => {
  const { customer, farm, animal } = await startCow(page);
  await page.goto('/portal/neu');
  await page.getByLabel('Kunde auswählen', { exact: true }).selectOption(customer.id);
  await page.getByRole('button', { name: 'Weiter zu Betrieb', exact: true }).click();
  await page.getByRole('button', { name: 'Neuen Betrieb erfassen', exact: true }).click();
  const values = bayernFarm(customer.id);
  for (const [label, value] of [['Betriebsname', values.name], ['Betriebsstraße', values.street], ['Betriebspostleitzahl', values.postalCode], ['Betriebsort', values.city]]) await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByLabel('Bundesland', { exact: true }).selectOption('Bayern');
  const second = await save<{ farm: Farm }>(page, 'Betrieb speichern', '/farms');
  expect(second.farm.id).not.toBe(farm.id);
  expect(second.farm.customerId).toBe(customer.id);
  await page.getByRole('button', { name: 'Weiter zu Tier / Bestand', exact: true }).click();
  await expect(page.locator(`[data-animal-id="${animal.id}"]`)).toHaveCount(0);
  const farms = await (await request.get(`/api/agriculture/farms?customerId=${customer.id}`)).json();
  expect(farms.farms.map((item: Farm) => item.id)).toEqual(expect.arrayContaining([farm.id, second.farm.id]));
  const invalid = await request.post('/api/agriculture/proposals', { data: { customerId: customer.id, farmId: second.farm.id, animalIds: [animal.id], product: 'Tierlebensversicherung', startDate: '2027-01-01', durationMonths: 12 } });
  expect(invalid.status()).toBe(400);
});

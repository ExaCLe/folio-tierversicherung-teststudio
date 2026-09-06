import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  AGRICULTURE_RULES,
  ANIMAL_SPECIES,
  FEDERAL_STATES,
  STANDARD_CUSTOMER,
  agricultureMoney,
  standardCow,
  standardFarm,
  type AgricultureAnimal,
  type AgricultureAnimalInput,
  type AgricultureCustomer,
  type AgricultureCustomerInput,
  type AgricultureProduct,
  type AgricultureProposal,
  type AgricultureRole,
  type AnimalSpecies,
  type Farm,
  type FarmInput,
  type ProposalInput,
} from '../../shared/agriculture';
import { agricultureApi } from './api';
import './intake.css';

interface ProposalIntakeProps {
  role: AgricultureRole;
  onNavigate: (path: string) => void;
  onCreated: (id: string) => void;
}

interface AnimalDraft {
  species: AnimalSpecies;
  name: string;
  sumInsured: string;
  earTag: string;
  chipNumber: string;
  breed: string;
  birthDate: string;
  use: string;
  health: 'Unauffällig' | 'Vorerkrankung';
  healthNotes: string;
  animalCount: string;
  housing: 'Stallhaltung' | 'Freilandhaltung';
  biosecurity: 'Erfüllt' | 'Klärung erforderlich';
}

const EMPTY_CUSTOMER: AgricultureCustomerInput = {
  name: '', email: '', phone: '', street: '', postalCode: '', city: '',
};
const EMPTY_FARM: FarmInput = {
  customerId: '', name: '', state: 'Niedersachsen', street: '', postalCode: '', city: '', farmType: 'Milchviehbetrieb',
};
const FARM_TYPES: FarmInput['farmType'][] = ['Milchviehbetrieb', 'Gemischter Betrieb', 'Pferdehaltung', 'Schweinehaltung', 'Tierhaltung'];
const STEPS = ['Kunde', 'Betrieb', 'Tier / Bestand', 'Vorschlag'];
const USES = {
  Rind: ['Milchkuh', 'Zucht', 'Mast'],
  Pferd: ['Freizeit', 'Zucht', 'Sport'],
  Hund: ['Hofhund', 'Hütehund', 'Privat'],
  Schwein: [],
} as const;

function newAnimalDraft(species: AnimalSpecies = 'Rind'): AnimalDraft {
  return {
    species, name: '', sumInsured: '', earTag: '', chipNumber: '', breed: '', birthDate: '',
    use: USES[species][0] ?? '', health: 'Unauffällig', healthNotes: '', animalCount: '',
    housing: 'Stallhaltung', biosecurity: 'Erfüllt',
  };
}

function cowDraft(): AnimalDraft {
  const cow = standardCow();
  if (cow.species !== 'Rind') return newAnimalDraft();
  return { ...newAnimalDraft(), ...cow, sumInsured: String(cow.sumInsured) };
}

function currentDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function animalInput(draft: AnimalDraft, farmId: string): AgricultureAnimalInput {
  const base = { farmId, name: draft.name.trim(), sumInsured: Number(draft.sumInsured) };
  switch (draft.species) {
    case 'Rind':
      return { ...base, species: 'Rind', earTag: draft.earTag.trim(), breed: draft.breed.trim(), birthDate: draft.birthDate, use: draft.use as 'Milchkuh' | 'Zucht' | 'Mast' };
    case 'Pferd':
      return {
        ...base, species: 'Pferd', chipNumber: draft.chipNumber.trim(), breed: draft.breed.trim(), birthDate: draft.birthDate,
        use: draft.use as 'Freizeit' | 'Zucht' | 'Sport', health: draft.health, healthNotes: draft.healthNotes.trim(),
      };
    case 'Hund':
      return { ...base, species: 'Hund', chipNumber: draft.chipNumber.trim(), breed: draft.breed.trim(), birthDate: draft.birthDate, use: draft.use as 'Hofhund' | 'Hütehund' | 'Privat' };
    case 'Schwein':
      return { ...base, species: 'Schwein', animalCount: Number(draft.animalCount), housing: draft.housing, biosecurity: draft.biosecurity };
  }
}

function animalIdentifier(animal: AgricultureAnimal): string {
  if (animal.species === 'Rind') return animal.earTag;
  if (animal.species === 'Schwein') return `${animal.animalCount} Schweine · ${animal.housing}`;
  return animal.chipNumber;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Die Daten konnten nicht gespeichert werden. Bitte versuchen Sie es erneut.';
}

export function ProposalIntake({ role, onNavigate, onCreated }: ProposalIntakeProps) {
  const [step, setStep] = useState(0);
  const [customers, setCustomers] = useState<AgricultureCustomer[]>([]);
  const [farms, setFarms] = useState<Farm[]>([]);
  const [animals, setAnimals] = useState<AgricultureAnimal[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [farmId, setFarmId] = useState('');
  const [animalIds, setAnimalIds] = useState<string[]>([]);
  const [customerDraft, setCustomerDraft] = useState<AgricultureCustomerInput>({ ...EMPTY_CUSTOMER });
  const [farmDraft, setFarmDraft] = useState<FarmInput>({ ...EMPTY_FARM });
  const [draft, setDraft] = useState<AnimalDraft>(newAnimalDraft);
  const [newCustomer, setNewCustomer] = useState(false);
  const [newFarm, setNewFarm] = useState(false);
  const [newAnimal, setNewAnimal] = useState(false);
  const [startDate, setStartDate] = useState(currentDate);
  const [runId] = useState(() => new URLSearchParams(window.location.search).get('runId') || undefined);
  const [loadingCustomers, setLoadingCustomers] = useState(true);
  const [loadingFarms, setLoadingFarms] = useState(false);
  const [loadingAnimals, setLoadingAnimals] = useState(false);
  const [reload, setReload] = useState(0);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const previousStep = useRef(step);
  const canEdit = role === 'Vermittler';
  const customer = customers.find(item => item.id === customerId);
  const farm = farms.find(item => item.id === farmId);
  const selectedAnimals = animals.filter(item => animalIds.includes(item.id));
  const product: AgricultureProduct = selectedAnimals.some(item => item.species === 'Schwein') ? 'Bestandsversicherung' : 'Tierlebensversicherung';
  const totalSum = selectedAnimals.reduce((total, item) => total + item.sumInsured, 0);

  useEffect(() => {
    const controller = new AbortController();
    setLoadingCustomers(true);
    agricultureApi<{ customers: AgricultureCustomer[] }>('/customers', { signal: controller.signal })
      .then(result => {
        if (controller.signal.aborted) return;
        setCustomers(result.customers);
        if (result.customers.length === 0) setNewCustomer(true);
      })
      .catch(cause => { if (!controller.signal.aborted) setLoadError(errorMessage(cause)); })
      .finally(() => { if (!controller.signal.aborted) setLoadingCustomers(false); });
    return () => controller.abort();
  }, [reload]);

  useEffect(() => {
    if (!customerId) { setFarms([]); setLoadingFarms(false); return; }
    const controller = new AbortController();
    setLoadingFarms(true);
    agricultureApi<{ farms: Farm[] }>(`/farms?customerId=${encodeURIComponent(customerId)}`, { signal: controller.signal })
      .then(result => {
        if (controller.signal.aborted) return;
        setFarms(result.farms);
        if (result.farms.length === 0) setNewFarm(true);
      })
      .catch(cause => { if (!controller.signal.aborted) setLoadError(errorMessage(cause)); })
      .finally(() => { if (!controller.signal.aborted) setLoadingFarms(false); });
    return () => controller.abort();
  }, [customerId, reload]);

  useEffect(() => {
    if (!farmId) { setAnimals([]); setLoadingAnimals(false); return; }
    const controller = new AbortController();
    setLoadingAnimals(true);
    agricultureApi<{ animals: AgricultureAnimal[] }>(`/animals?farmId=${encodeURIComponent(farmId)}`, { signal: controller.signal })
      .then(result => {
        if (controller.signal.aborted) return;
        setAnimals(result.animals);
        if (result.animals.length === 0) setNewAnimal(true);
      })
      .catch(cause => { if (!controller.signal.aborted) setLoadError(errorMessage(cause)); })
      .finally(() => { if (!controller.signal.aborted) setLoadingAnimals(false); });
    return () => controller.abort();
  }, [farmId, reload]);

  useEffect(() => {
    if (previousStep.current !== step) headingRef.current?.focus();
    previousStep.current = step;
  }, [step]);

  function selectCustomer(id: string) {
    setCustomerId(id);
    setFarmId('');
    setAnimalIds([]);
    setNewFarm(false);
    setNewAnimal(false);
    setError('');
    setNotice('');
  }

  function selectFarm(id: string) {
    setFarmId(id);
    setAnimalIds([]);
    setNewAnimal(false);
    setError('');
    setNotice('');
  }

  function goToStep(next: number) {
    if (savingRef.current) return;
    if (next >= 1 && !customer) return;
    if (next >= 2 && !farm) return;
    if (next >= 3 && selectedAnimals.length === 0) return;
    setError('');
    setNotice('');
    setStep(next);
  }

  function loadStandardCow() {
    if (savingRef.current) return;
    selectCustomer('');
    setCustomerDraft({ ...STANDARD_CUSTOMER });
    setFarmDraft(standardFarm());
    setDraft(cowDraft());
    setNewCustomer(true);
    setNewFarm(true);
    setNewAnimal(true);
    setStep(0);
    const exampleFarm = standardFarm();
    setNotice(`Beispieldaten geladen: ${STANDARD_CUSTOMER.name}, ${exampleFarm.name} in ${exampleFarm.state} und Kuh Alma. Speichern Sie die Daten in den vier Schritten.`);
  }

  async function mutate(action: () => Promise<void>) {
    if (savingRef.current || !canEdit) return;
    savingRef.current = true;
    setSaving(true);
    setError('');
    setNotice('');
    try { await action(); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { savingRef.current = false; setSaving(false); }
  }

  function saveCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void mutate(async () => {
      const result = await agricultureApi<{ customer: AgricultureCustomer }>('/customers', { method: 'POST', role, body: JSON.stringify(customerDraft) });
      setCustomers(items => [...items.filter(item => item.id !== result.customer.id), result.customer]);
      selectCustomer(result.customer.id);
      setNewCustomer(false);
      setNotice(`Kunde ${result.customer.number} wurde gespeichert.`);
    });
  }

  function saveFarm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!customer) { setError('Bitte wählen oder speichern Sie zuerst einen Kunden.'); return; }
    void mutate(async () => {
      const result = await agricultureApi<{ farm: Farm }>('/farms', { method: 'POST', role, body: JSON.stringify({ ...farmDraft, customerId }) });
      setFarms(items => [...items.filter(item => item.id !== result.farm.id), result.farm]);
      selectFarm(result.farm.id);
      setNewFarm(false);
      setNotice(`Betrieb ${result.farm.number} wurde gespeichert.`);
    });
  }

  function saveAnimal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!farm) { setError('Bitte wählen oder speichern Sie zuerst einen Betrieb.'); return; }
    void mutate(async () => {
      const result = await agricultureApi<{ animal: AgricultureAnimal }>('/animals', { method: 'POST', role, body: JSON.stringify(animalInput(draft, farmId)) });
      setAnimals(items => [...items.filter(item => item.id !== result.animal.id), result.animal]);
      const compatibleIds = selectedAnimals.filter(item => (item.species === 'Schwein') === (result.animal.species === 'Schwein')).map(item => item.id);
      setAnimalIds([...compatibleIds, result.animal.id]);
      setNewAnimal(false);
      setDraft(newAnimalDraft(draft.species));
      setNotice(compatibleIds.length === selectedAnimals.length
        ? `${result.animal.species === 'Schwein' ? 'Bestand' : 'Tier'} ${result.animal.number} wurde gespeichert und ausgewählt.`
        : `${result.animal.number} wurde gespeichert und ausgewählt. Die vorherige Auswahl gehört zu einem anderen Versicherungsprodukt und wurde aufgehoben.`);
    });
  }

  function toggleAnimal(animal: AgricultureAnimal, checked: boolean) {
    setError('');
    if (checked && selectedAnimals.some(item => (item.species === 'Schwein') !== (animal.species === 'Schwein'))) {
      setError('Einzeltiere und Schweinebestände benötigen getrennte Vorschläge. Heben Sie zuerst die bisherige Auswahl auf.');
      return;
    }
    setAnimalIds(ids => checked ? [...ids.filter(id => id !== animal.id), animal.id] : ids.filter(id => id !== animal.id));
  }

  function saveProposal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!customer || !farm || selectedAnimals.length === 0) { setError('Bitte wählen Sie Kunde, Betrieb und mindestens ein Tier oder einen Bestand.'); return; }
    void mutate(async () => {
      const input: ProposalInput = { customerId, farmId, animalIds, product, startDate, durationMonths: 12, ...(runId ? { runId } : {}) };
      const result = await agricultureApi<{ proposal: AgricultureProposal }>('/proposals', { method: 'POST', role, body: JSON.stringify(input) });
      onCreated(result.proposal.id);
    });
  }

  return (
    <div className="agr-intake" aria-busy={saving}>
      <header className="agr-intake-header">
        <div><p className="agr-intake-kicker">Vertragsverwaltung · Neugeschäft</p><h1>Neuer Versicherungsvorschlag</h1></div>
        <div className="agr-intake-header-actions">
          <button type="button" className="agr-button" disabled={saving || !canEdit} onClick={loadStandardCow}>Standardkuh laden</button>
          <button type="button" className="agr-button" disabled={saving} onClick={() => onNavigate('/portal')}>Zur Übersicht</button>
        </div>
      </header>

      <nav className="agr-intake-steps" aria-label="Erfassungsschritte">
        <ol>{STEPS.map((label, index) => <li key={label}><button type="button" aria-current={step === index ? 'step' : undefined}
          disabled={saving || (index >= 1 && !customer) || (index >= 2 && !farm) || (index >= 3 && selectedAnimals.length === 0)}
          onClick={() => goToStep(index)}><span className="agr-intake-step-number">{index + 1}</span>{label}</button></li>)}</ol>
      </nav>

      {!canEdit && <div className="agr-alert" role="status">Neue Vorschläge dürfen nur Vermittler erfassen. Wählen Sie dafür die Benutzerrolle Vermittler.</div>}
      {(error || loadError) && <div className="agr-alert agr-intake-error" role="alert">{error || loadError}{loadError && <button type="button" className="agr-button" disabled={saving} onClick={() => { setLoadError(''); setReload(value => value + 1); }}>Daten erneut laden</button>}</div>}
      <div className="agr-intake-notice" role="status" aria-live="polite">{notice}</div>

      <section className="agr-panel agr-intake-panel">
        <div className="agr-panel-heading"><h2 ref={headingRef} tabIndex={-1}>{STEPS[step]}</h2><span className="agr-muted">Schritt {step + 1} von 4</span></div>

        {step === 0 && <div className="agr-intake-body">
          {!newCustomer && <>
            <div className="agr-intake-selection">
              <label className="agr-field" htmlFor="agr-customer-select">Kunde auswählen<select id="agr-customer-select" aria-label="Kunde auswählen" value={customerId} disabled={loadingCustomers || saving} onChange={event => selectCustomer(event.target.value)}><option value="">{loadingCustomers ? 'Kunden werden geladen …' : 'Bitte Kunden auswählen'}</option>{customers.map(item => <option key={item.id} value={item.id}>{item.name} · {item.number} · {item.city}</option>)}</select></label>
              <button type="button" className="agr-button" disabled={saving || !canEdit} onClick={() => { selectCustomer(''); setNewCustomer(true); }}>Neuen Kunden erfassen</button>
            </div>
            {customer && <section className="agr-summary agr-intake-record" data-customer-id={customer.id} aria-label="Ausgewählter Kunde"><div><strong>{customer.name}</strong><span>{customer.number}</span></div><p>{customer.street}, {customer.postalCode} {customer.city}</p><p>{customer.email} · {customer.phone}</p></section>}
          </>}
          {newCustomer && <form onSubmit={saveCustomer}>
            <fieldset className="agr-intake-fieldset" disabled={saving || !canEdit || loadingCustomers}><legend>Neuer Kunde</legend><p className="agr-muted agr-intake-form-note">Alle Angaben sind erforderlich.</p>
              <div className="agr-form-grid">
                <label className="agr-field" htmlFor="agr-customer-name">Name des Kunden<input id="agr-customer-name" required maxLength={160} autoComplete="name" value={customerDraft.name} onChange={event => setCustomerDraft({ ...customerDraft, name: event.target.value })} /></label>
                <label className="agr-field" htmlFor="agr-customer-email">E-Mail<input id="agr-customer-email" required type="email" maxLength={200} autoComplete="email" value={customerDraft.email} onChange={event => setCustomerDraft({ ...customerDraft, email: event.target.value })} /></label>
                <label className="agr-field" htmlFor="agr-customer-phone">Telefon<input id="agr-customer-phone" required type="tel" maxLength={50} autoComplete="tel" value={customerDraft.phone} onChange={event => setCustomerDraft({ ...customerDraft, phone: event.target.value })} /></label>
                <label className="agr-field" htmlFor="agr-customer-street">Kundenstraße<input id="agr-customer-street" required maxLength={200} autoComplete="street-address" value={customerDraft.street} onChange={event => setCustomerDraft({ ...customerDraft, street: event.target.value })} /></label>
                <label className="agr-field" htmlFor="agr-customer-postal">Kundenpostleitzahl<input id="agr-customer-postal" required inputMode="numeric" pattern="[0-9]{5}" maxLength={5} autoComplete="postal-code" value={customerDraft.postalCode} onChange={event => setCustomerDraft({ ...customerDraft, postalCode: event.target.value })} /></label>
                <label className="agr-field" htmlFor="agr-customer-city">Kundenort<input id="agr-customer-city" required maxLength={120} autoComplete="address-level2" value={customerDraft.city} onChange={event => setCustomerDraft({ ...customerDraft, city: event.target.value })} /></label>
              </div>
              <div className="agr-intake-form-actions"><button className="agr-button agr-primary" type="submit">{saving ? 'Kunde wird gespeichert …' : 'Kunde speichern'}</button><button className="agr-button" type="button" onClick={() => setNewCustomer(false)}>Auswahl anzeigen</button></div>
            </fieldset>
          </form>}
          <div className="agr-intake-footer"><span className="agr-muted">Ein Kunde kann mehrere Betriebe besitzen.</span><button className="agr-button agr-primary" type="button" disabled={!customer || saving} onClick={() => goToStep(1)}>Weiter zu Betrieb</button></div>
        </div>}

        {step === 1 && <div className="agr-intake-body">
          <p className="agr-intake-context">Kunde: <strong>{customer?.name}</strong> · {customer?.number}</p>
          {!newFarm && <>
            <div className="agr-intake-selection"><label className="agr-field" htmlFor="agr-farm-select">Betrieb auswählen<select id="agr-farm-select" aria-label="Betrieb auswählen" value={farmId} disabled={loadingFarms || saving} onChange={event => selectFarm(event.target.value)}><option value="">{loadingFarms ? 'Betriebe werden geladen …' : 'Bitte Betrieb auswählen'}</option>{farms.map(item => <option key={item.id} value={item.id}>{item.name} · {item.number} · {item.state}</option>)}</select></label><button className="agr-button" type="button" disabled={saving || !canEdit || loadingFarms} onClick={() => { selectFarm(''); setNewFarm(true); }}>Neuen Betrieb erfassen</button></div>
            {farm && <section className="agr-summary agr-intake-record" data-farm-id={farm.id} aria-label="Ausgewählter Betrieb"><div><strong>{farm.name}</strong><span>{farm.number}</span></div><p>{farm.street}, {farm.postalCode} {farm.city}</p><p>{farm.state} · {farm.farmType}</p></section>}
          </>}
          {newFarm && <form onSubmit={saveFarm}><fieldset className="agr-intake-fieldset" disabled={saving || !canEdit || loadingFarms}><legend>Neuer Betrieb</legend><p className="agr-muted agr-intake-form-note">Alle Angaben sind erforderlich. Der Betrieb wird dem ausgewählten Kunden zugeordnet.</p><div className="agr-form-grid">
            <label className="agr-field" htmlFor="agr-farm-name">Betriebsname<input id="agr-farm-name" required maxLength={160} value={farmDraft.name} onChange={event => setFarmDraft({ ...farmDraft, name: event.target.value })} /></label>
            <label className="agr-field" htmlFor="agr-farm-state">Bundesland<select id="agr-farm-state" aria-label="Bundesland" value={farmDraft.state} onChange={event => setFarmDraft({ ...farmDraft, state: event.target.value as FarmInput['state'] })}>{FEDERAL_STATES.map(state => <option key={state}>{state}</option>)}</select></label>
            <label className="agr-field" htmlFor="agr-farm-street">Betriebsstraße<input id="agr-farm-street" required maxLength={200} value={farmDraft.street} onChange={event => setFarmDraft({ ...farmDraft, street: event.target.value })} /></label>
            <label className="agr-field" htmlFor="agr-farm-postal">Betriebspostleitzahl<input id="agr-farm-postal" required inputMode="numeric" pattern="[0-9]{5}" maxLength={5} value={farmDraft.postalCode} onChange={event => setFarmDraft({ ...farmDraft, postalCode: event.target.value })} /></label>
            <label className="agr-field" htmlFor="agr-farm-city">Betriebsort<input id="agr-farm-city" required maxLength={120} value={farmDraft.city} onChange={event => setFarmDraft({ ...farmDraft, city: event.target.value })} /></label>
            <label className="agr-field" htmlFor="agr-farm-type">Betriebsart<select id="agr-farm-type" aria-label="Betriebsart" value={farmDraft.farmType} onChange={event => setFarmDraft({ ...farmDraft, farmType: event.target.value as FarmInput['farmType'] })}>{FARM_TYPES.map(type => <option key={type}>{type}</option>)}</select></label>
          </div><div className="agr-intake-form-actions"><button type="submit" className="agr-button agr-primary">{saving ? 'Betrieb wird gespeichert …' : 'Betrieb speichern'}</button><button type="button" className="agr-button" onClick={() => setNewFarm(false)}>Auswahl anzeigen</button></div></fieldset></form>}
          <div className="agr-intake-footer"><button type="button" className="agr-button" disabled={saving} onClick={() => goToStep(0)}>Zurück zu Kunde</button><button type="button" className="agr-button agr-primary" disabled={!farm || saving || loadingFarms} onClick={() => goToStep(2)}>Weiter zu Tier / Bestand</button></div>
        </div>}

        {step === 2 && <div className="agr-intake-body">
          <p className="agr-intake-context">Betrieb: <strong>{farm?.name}</strong> · {farm?.state} · {farm?.number}</p>
          {loadingAnimals && <p role="status">Tiere und Bestände werden geladen …</p>}
          {!loadingAnimals && animals.length > 0 && <div className="agr-intake-table-wrap"><table className="agr-table agr-intake-animal-table"><caption>Tiere und Bestände dieses Betriebs auswählen</caption><thead><tr><th scope="col">Auswahl</th><th scope="col">Tier / Bestand</th><th scope="col">Kennzeichnung</th><th scope="col">Versicherungssumme</th></tr></thead><tbody>{animals.map(animal => <tr key={animal.id} data-animal-id={animal.id}><td><input type="checkbox" aria-label={`Tier auswählen: ${animal.name} (${animal.number})`} checked={animalIds.includes(animal.id)} disabled={saving} onChange={event => toggleAnimal(animal, event.target.checked)} /></td><th scope="row"><strong>{animal.name}</strong><span>{animal.species} · {animal.number}</span></th><td>{animalIdentifier(animal)}</td><td className="agr-intake-money">{agricultureMoney(animal.sumInsured)}</td></tr>)}</tbody></table></div>}
          {!newAnimal && <div className="agr-intake-form-actions"><button type="button" className="agr-button" disabled={saving || !canEdit || loadingAnimals} onClick={() => setNewAnimal(true)}>Neues Tier erfassen</button><span className="agr-muted">{selectedAnimals.length} ausgewählt · {agricultureMoney(totalSum)}</span></div>}
          {newAnimal && <form onSubmit={saveAnimal}><fieldset className="agr-intake-fieldset" disabled={saving || !canEdit || loadingAnimals}><legend>Neues Tier oder neuer Bestand</legend><div className="agr-intake-animal-tools"><p className="agr-muted">Alle Angaben sind erforderlich, Gesundheitsangaben nur bei Vorerkrankungen.</p><button type="button" className="agr-button" onClick={() => setDraft({ ...draft, sumInsured: String(AGRICULTURE_RULES.referralThresholds[draft.species] * 1.5) })}>Hohe Versicherungssumme</button></div>
            <div className="agr-form-grid">
              <label className="agr-field" htmlFor="agr-animal-species">Tierart<select id="agr-animal-species" aria-label="Tierart" value={draft.species} onChange={event => setDraft(newAnimalDraft(event.target.value as AnimalSpecies))}>{ANIMAL_SPECIES.map(species => <option key={species}>{species}</option>)}</select></label>
              <label className="agr-field" htmlFor="agr-animal-name">Name des Tiers oder Bestands<input id="agr-animal-name" required maxLength={160} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
              <label className="agr-field" htmlFor="agr-animal-sum">Versicherungssumme in EUR<input id="agr-animal-sum" required type="number" min="0.01" max="1000000000" step="0.01" inputMode="decimal" value={draft.sumInsured} onChange={event => setDraft({ ...draft, sumInsured: event.target.value })} /></label>
              {draft.species === 'Rind' && <label className="agr-field" htmlFor="agr-animal-tag">Ohrmarke<input id="agr-animal-tag" required maxLength={80} value={draft.earTag} onChange={event => setDraft({ ...draft, earTag: event.target.value })} /></label>}
              {(draft.species === 'Pferd' || draft.species === 'Hund') && <label className="agr-field" htmlFor="agr-animal-chip">Chipnummer<input id="agr-animal-chip" required maxLength={80} value={draft.chipNumber} onChange={event => setDraft({ ...draft, chipNumber: event.target.value })} /></label>}
              {draft.species !== 'Schwein' && <>
                <label className="agr-field" htmlFor="agr-animal-breed">Rasse<input id="agr-animal-breed" required maxLength={120} value={draft.breed} onChange={event => setDraft({ ...draft, breed: event.target.value })} /></label>
                <label className="agr-field" htmlFor="agr-animal-birth">Geburtsdatum<input id="agr-animal-birth" required type="date" min="1900-01-01" max={currentDate()} value={draft.birthDate} onChange={event => setDraft({ ...draft, birthDate: event.target.value })} /></label>
                <label className="agr-field" htmlFor="agr-animal-use">Nutzung<select id="agr-animal-use" aria-label="Nutzung" value={draft.use} onChange={event => setDraft({ ...draft, use: event.target.value })}>{USES[draft.species].map(use => <option key={use}>{use}</option>)}</select></label>
              </>}
              {draft.species === 'Pferd' && <>
                <label className="agr-field" htmlFor="agr-animal-health">Gesundheitszustand<select id="agr-animal-health" aria-label="Gesundheitszustand" value={draft.health} onChange={event => setDraft({ ...draft, health: event.target.value as AnimalDraft['health'] })}><option>Unauffällig</option><option>Vorerkrankung</option></select></label>
                <label className="agr-field agr-intake-wide" htmlFor="agr-animal-health-notes">Gesundheitsangaben<textarea id="agr-animal-health-notes" required={draft.health === 'Vorerkrankung'} minLength={draft.health === 'Vorerkrankung' ? 3 : undefined} rows={3} maxLength={2000} value={draft.healthNotes} onChange={event => setDraft({ ...draft, healthNotes: event.target.value })} /></label>
              </>}
              {draft.species === 'Schwein' && <>
                <label className="agr-field" htmlFor="agr-animal-count">Anzahl Schweine<input id="agr-animal-count" required type="number" min="1" max="100000" step="1" inputMode="numeric" value={draft.animalCount} onChange={event => setDraft({ ...draft, animalCount: event.target.value })} /></label>
                <label className="agr-field" htmlFor="agr-animal-housing">Haltungsform<select id="agr-animal-housing" aria-label="Haltungsform" value={draft.housing} onChange={event => setDraft({ ...draft, housing: event.target.value as AnimalDraft['housing'] })}><option>Stallhaltung</option><option>Freilandhaltung</option></select></label>
                <label className="agr-field" htmlFor="agr-animal-biosecurity">Biosicherheit<select id="agr-animal-biosecurity" aria-label="Biosicherheit" value={draft.biosecurity} onChange={event => setDraft({ ...draft, biosecurity: event.target.value as AnimalDraft['biosecurity'] })}><option>Erfüllt</option><option>Klärung erforderlich</option></select></label>
              </>}
            </div>
            <p className="agr-intake-rule">Ab mehr als {agricultureMoney(AGRICULTURE_RULES.referralThresholds[draft.species])} je {draft.species === 'Schwein' ? 'Bestand' : 'Tier'} ist eine Direktionsanfrage erforderlich.{draft.species === 'Pferd' ? ' Vorerkrankungen erfordern ebenfalls eine Direktionsentscheidung.' : draft.species === 'Schwein' ? ' Dies gilt auch bei ungeklärter Biosicherheit.' : ''}</p>
            <div className="agr-intake-form-actions"><button type="submit" className="agr-button agr-primary">{saving ? 'Tier wird gespeichert …' : 'Tier speichern'}</button><button type="button" className="agr-button" onClick={() => setNewAnimal(false)}>Auswahl anzeigen</button></div>
          </fieldset></form>}
          <div className="agr-intake-footer"><button type="button" className="agr-button" disabled={saving} onClick={() => goToStep(1)}>Zurück zu Betrieb</button><button type="button" className="agr-button agr-primary" disabled={selectedAnimals.length === 0 || saving || loadingAnimals} onClick={() => goToStep(3)}>Weiter zu Vorschlag</button></div>
        </div>}

        {step === 3 && <form onSubmit={saveProposal} className="agr-intake-body">
          <div className="agr-intake-review-records">
            <section className="agr-summary agr-intake-record" data-customer-id={customer?.id} aria-label="Kunde des Vorschlags"><h3>Kunde</h3><strong>{customer?.name}</strong><p>{customer?.number}</p><p>{customer?.street}, {customer?.postalCode} {customer?.city}</p><button type="button" className="agr-button" disabled={saving} onClick={() => goToStep(0)}>Kunde ändern</button></section>
            <section className="agr-summary agr-intake-record" data-farm-id={farm?.id} aria-label="Betrieb des Vorschlags"><h3>Betrieb</h3><strong>{farm?.name}</strong><p>{farm?.number} · {farm?.state}</p><p>{farm?.street}, {farm?.postalCode} {farm?.city} · {farm?.farmType}</p><button type="button" className="agr-button" disabled={saving} onClick={() => goToStep(1)}>Betrieb ändern</button></section>
          </div>
          <div className="agr-intake-table-wrap"><table className="agr-table agr-intake-animal-table"><caption>Ausgewählte Tiere und Bestände</caption><thead><tr><th scope="col">Tier / Bestand</th><th scope="col">Kennzeichnung</th><th scope="col">Versicherungssumme</th></tr></thead><tbody>{selectedAnimals.map(animal => <tr key={animal.id} data-animal-id={animal.id}><th scope="row"><strong>{animal.name}</strong><span>{animal.species} · {animal.number}</span></th><td>{animalIdentifier(animal)}</td><td className="agr-intake-money">{agricultureMoney(animal.sumInsured)}</td></tr>)}</tbody><tfoot><tr><th scope="row" colSpan={2}>Gesamte Versicherungssumme</th><td className="agr-intake-money">{agricultureMoney(totalSum)}</td></tr></tfoot></table></div>
          <fieldset className="agr-intake-fieldset" disabled={saving || !canEdit}><legend>Vertragsdaten</legend><div className="agr-form-grid">
            <label className="agr-field" htmlFor="agr-proposal-product">Versicherungsprodukt<select id="agr-proposal-product" aria-label="Versicherungsprodukt" value={product} onChange={() => {}} aria-describedby="agr-product-help"><option disabled={product !== 'Tierlebensversicherung'}>Tierlebensversicherung</option><option disabled={product !== 'Bestandsversicherung'}>Bestandsversicherung</option></select><span id="agr-product-help" className="agr-muted">Das Produkt ergibt sich aus den ausgewählten Tieren.</span></label>
            <label className="agr-field" htmlFor="agr-proposal-start">Versicherungsbeginn<input id="agr-proposal-start" required type="date" min="1900-01-01" max="2199-12-31" value={startDate} onChange={event => setStartDate(event.target.value)} /></label>
            <div className="agr-field"><span>Laufzeit</span><strong className="agr-intake-fixed-value">12 Monate</strong></div>
          </div></fieldset>
          <p className="agr-intake-rule">Der Vorschlag wird als Entwurf gespeichert. Anschließend können Sie das Angebot berechnen und den Antrag einreichen.</p>
          <div className="agr-intake-footer"><button type="button" className="agr-button" disabled={saving} onClick={() => goToStep(2)}>Zurück zu Tier / Bestand</button><button type="submit" className="agr-button agr-primary" disabled={saving || !canEdit || !customer || !farm || selectedAnimals.length === 0}>{saving ? 'Vorschlag wird gespeichert …' : 'Vorschlag speichern'}</button></div>
        </form>}
      </section>
    </div>
  );
}

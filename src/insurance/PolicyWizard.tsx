import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Building2, Check, CircleAlert, FileText, MapPin, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import {
  COUNTRY_NAMES,
  ITALIAN_WAREHOUSE_ADDRESS,
  createStandardDraft,
  type Country,
  type Coverage,
  type CoverageType,
  type Customer,
  type InsuredLocation,
  type Policy,
  type PolicyDraftInput,
  type Role,
} from '../../shared/insurance';
import { api } from '../lib/api';
import './wizard.css';

interface PolicyWizardProps {
  onCreated: (policy: Policy) => void;
  onCancel: () => void;
  role: Role;
}

type NewCustomer = Omit<Customer, 'id' | 'createdAt' | 'source' | 'runId'>;
const STEPS = ['Customer', 'Product & term', 'Locations & risks', 'Coverages', 'Declarations & billing', 'Review'];
const COVERAGES: CoverageType[] = ['Fire', 'Flood', 'Business interruption', 'Theft'];
const money = (amount: number) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(amount);
const dateLabel = (value: string) => value ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`)) : 'Set a date';
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'The request could not be completed. Please try again.';

function initialDraft(): PolicyDraftInput {
  const draft = createStandardDraft();
  const query = new URLSearchParams(window.location.search);
  const runId = query.get('runId')?.trim();
  if (runId || query.get('source') === 'run') {
    draft.source = 'run';
    if (runId) draft.runId = runId;
  }
  return draft;
}

function blankCustomer(): NewCustomer {
  return {
    name: '', registrationNumber: '', headquartersCountry: 'DE',
    address: { line1: '', city: '', postcode: '' },
    industry: 'Manufacturing', contactName: '', email: '',
  };
}

function defaultCoverage(type: CoverageType, location: InsuredLocation): Coverage {
  return {
    type,
    limit: type === 'Fire' ? location.sumInsured : type === 'Flood' ? Math.min(500000, location.sumInsured) : type === 'Business interruption' ? 750000 : Math.min(100000, location.sumInsured),
    deductible: type === 'Fire' || type === 'Theft' ? 2500 : 5000,
  };
}

function validateStep(step: number, draft: PolicyDraftInput, customer?: Customer): string | null {
  if (step === 0 && !customer) return 'Choose a customer before continuing.';
  if (step === 1) {
    if (!draft.inceptionDate || !draft.expiryDate) return 'Enter the policy inception and expiry dates.';
    if (draft.expiryDate <= draft.inceptionDate) return 'The expiry date must be after the inception date.';
  }
  if (step === 2) {
    if (!draft.locations.length) return 'Add at least one insured location.';
    for (const location of draft.locations) {
      if (![location.name, location.address.line1, location.address.city, location.address.postcode].every(value => value.trim())) return `Complete the name and address for ${location.name || 'each location'}.`;
      if (location.sumInsured <= 0 || location.areaSqm <= 0) return `Enter a positive sum insured and floor area for ${location.name}.`;
      if (!Number.isInteger(location.yearBuilt) || location.yearBuilt < 1700 || location.yearBuilt > new Date().getUTCFullYear() + 1) return `Enter a valid construction year for ${location.name}.`;
    }
  }
  if (step === 3) {
    for (const location of draft.locations) {
      if (!location.coverages.length) return `Select at least one coverage for ${location.name}.`;
      if (!location.coverages.some(coverage => coverage.type === 'Fire')) return `Fire coverage is required for ${location.name}.`;
      for (const coverage of location.coverages) {
        if (coverage.limit <= 0 || coverage.deductible < 0) return `Enter a positive ${coverage.type.toLowerCase()} limit and a non-negative deductible for ${location.name}.`;
        if (coverage.deductible >= coverage.limit) return `The ${coverage.type.toLowerCase()} deductible must be lower than its limit for ${location.name}.`;
        if (coverage.type !== 'Business interruption' && coverage.limit > location.sumInsured) return `The ${coverage.type.toLowerCase()} limit cannot exceed the sum insured for ${location.name}.`;
      }
    }
  }
  if (step === 4) {
    if (!draft.declarations.informationAccurate) return 'Confirm that the information is accurate before saving the draft.';
    for (const loss of draft.lossHistory) {
      if (!loss.date || !loss.description.trim() || loss.amount <= 0) return 'Complete the date, description, and amount for every declared loss.';
      if (loss.date > new Date().toISOString().slice(0, 10)) return 'A declared loss cannot have a future date.';
      if (loss.date > draft.inceptionDate) return 'A declared loss must be on or before the inception date.';
    }
  }
  return null;
}

export function PolicyWizard({ onCreated, onCancel, role }: PolicyWizardProps) {
  const [draft, setDraft] = useState<PolicyDraftInput>(initialDraft);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customersLoading, setCustomersLoading] = useState(true);
  const [customersError, setCustomersError] = useState<string | null>(null);
  const [reloadCustomers, setReloadCustomers] = useState(0);
  const [step, setStep] = useState(0);
  const [furthestStep, setFurthestStep] = useState(0);
  const [addingCustomer, setAddingCustomer] = useState(false);
  const [newCustomer, setNewCustomer] = useState<NewCustomer>(blankCustomer);
  const [newLocationType, setNewLocationType] = useState<InsuredLocation['type']>('Warehouse');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const previousStepRef = useRef(step);
  const customer = customers.find(item => item.id === draft.customerId);
  const totalInsured = draft.locations.reduce((total, location) => total + location.sumInsured, 0);
  const referredLocations = draft.locations.filter(location => location.coverages.some(coverage => coverage.type === 'Flood' && coverage.limit > 500000));

  useEffect(() => {
    const controller = new AbortController();
    setCustomersLoading(true);
    setCustomersError(null);
    api<{ customers: Customer[] }>('/insurance/customers', { signal: controller.signal })
      .then(result => {
        if (controller.signal.aborted) return;
        setCustomers(result.customers);
        setDraft(current => result.customers.some(item => item.id === current.customerId) ? current : { ...current, customerId: result.customers[0]?.id ?? '' });
      })
      .catch(cause => { if (!controller.signal.aborted) setCustomersError(errorMessage(cause)); })
      .finally(() => { if (!controller.signal.aborted) setCustomersLoading(false); });
    return () => controller.abort();
  }, [reloadCustomers]);

  useEffect(() => {
    if (previousStepRef.current !== step) {
      headingRef.current?.focus();
      previousStepRef.current = step;
    }
  }, [step]);

  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  function goToStep(nextStep: number) {
    setError(null);
    setStep(nextStep);
  }

  function updateLocation(id: string, update: Partial<InsuredLocation> | ((location: InsuredLocation) => InsuredLocation)) {
    setDraft(current => ({
      ...current,
      locations: current.locations.map(location => location.id === id ? typeof update === 'function' ? update(location) : { ...location, ...update } : location),
    }));
  }

  function setCountry(location: InsuredLocation, country: Country) {
    const standardLocation = createStandardDraft().locations.find(item => item.type === location.type);
    updateLocation(location.id, {
      country,
      address: country === 'IT' ? { ...ITALIAN_WAREHOUSE_ADDRESS } : { ...(standardLocation?.address ?? { line1: 'Gewerbepark 8', city: 'Berlin', postcode: '12489' }) },
    });
  }

  function addLocation() {
    const standard = createStandardDraft().locations;
    const base = standard.find(location => location.type === newLocationType) ?? {
      ...standard[1], type: 'Office' as const, name: 'Office', areaSqm: 600, sumInsured: 750000,
      address: { line1: 'Gewerbepark 8', city: 'Berlin', postcode: '12489' },
      coverages: [{ type: 'Fire' as const, limit: 750000, deductible: 2500 }],
    };
    const count = draft.locations.filter(location => location.type === newLocationType).length;
    const location: InsuredLocation = {
      ...base,
      id: `${newLocationType.toLowerCase()}-${crypto.randomUUID()}`,
      name: count ? `${newLocationType} ${count + 1}` : newLocationType,
      address: { ...base.address },
      coverages: base.coverages.map(coverage => ({ ...coverage })),
    };
    setDraft(current => ({ ...current, locations: [...current.locations, location] }));
  }

  function toggleCoverage(locationId: string, type: CoverageType, enabled: boolean) {
    updateLocation(locationId, location => ({
      ...location,
      coverages: enabled ? [...location.coverages, defaultCoverage(type, location)] : location.coverages.filter(coverage => coverage.type !== type),
    }));
  }

  function updateCoverage(locationId: string, type: CoverageType, field: 'limit' | 'deductible', value: number) {
    updateLocation(locationId, location => ({ ...location, coverages: location.coverages.map(coverage => coverage.type === type ? { ...coverage, [field]: value } : coverage) }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError(null);
    if (!formRef.current?.reportValidity()) return;
    if (addingCustomer) {
      setBusy(true);
      try {
        const { customer: created } = await api<{ customer: Customer }>('/insurance/customers', {
          method: 'POST', role,
          body: JSON.stringify({ ...newCustomer, source: draft.source ?? 'manual', ...(draft.runId ? { runId: draft.runId } : {}) }),
        });
        setCustomers(current => [...current, created].sort((a, b) => a.name.localeCompare(b.name)));
        setDraft(current => ({ ...current, customerId: created.id }));
        setAddingCustomer(false);
        setNewCustomer(blankCustomer());
      } catch (cause) {
        setError(errorMessage(cause));
      } finally {
        setBusy(false);
      }
      return;
    }
    if (step < STEPS.length - 1) {
      const validationError = validateStep(step, draft, customer);
      if (validationError) { setError(validationError); return; }
      setFurthestStep(current => Math.max(current, step + 1));
      goToStep(step + 1);
      return;
    }
    for (let index = 0; index < STEPS.length - 1; index++) {
      const validationError = validateStep(index, draft, customer);
      if (validationError) { setStep(index); setError(validationError); return; }
    }
    setBusy(true);
    try {
      const { policy } = await api<{ policy: Policy }>('/insurance/policies', { method: 'POST', role, body: JSON.stringify(draft) });
      onCreated(policy);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  function editButton(targetStep: number) {
    return <button type="button" className="button ghost pw-edit" onClick={() => goToStep(targetStep)} aria-label={`Edit ${STEPS[targetStep].toLowerCase()}`}>Edit</button>;
  }

  return (
    <div className="policy-wizard" data-testid="policy-wizard">
      <header className="pw-header">
        <div>
          <p className="pw-eyebrow">Insurance desk / New policy</p>
          <h1>New commercial property policy</h1>
          <p className="muted">Prepare the customer, locations, and coverages for Meridian Commercial Property.</p>
        </div>
        <button type="button" className="button secondary" onClick={onCancel} disabled={busy}>Cancel</button>
      </header>

      <ol className="pw-steps" aria-label="Policy creation steps">
        {STEPS.map((title, index) => (
          <li key={title} className={index === step ? 'is-current' : index < step ? 'is-complete' : ''}>
            <button type="button" disabled={index > furthestStep || busy || addingCustomer} aria-current={index === step ? 'step' : undefined} onClick={() => goToStep(index)}>
              <span className="pw-step-number" aria-hidden="true">{index < step ? <Check size={14} /> : index + 1}</span>
              <span>{title}</span>
            </button>
          </li>
        ))}
      </ol>

      <div className="pw-workspace">
        <form ref={formRef} onSubmit={submit} noValidate className="pw-form" aria-busy={busy}>
          <section className="panel pw-main-panel" aria-labelledby="wizard-step-title">
            <div className="pw-section-heading">
              <div>
                <p className="pw-eyebrow">Step {step + 1} of {STEPS.length}</p>
                <h2 id="wizard-step-title" ref={headingRef} tabIndex={-1}>{STEPS[step]}</h2>
                <p className="muted pw-step-description">{[
                  'Choose the business that will hold this policy.',
                  'Set the policy term and confirm the issuing market.',
                  'Describe each property and its risk characteristics.',
                  'Choose coverages and limits for each insured location.',
                  'Record previous losses, declarations, and payment preferences.',
                  'Check the details before saving this policy as a draft.',
                ][step]}</p>
              </div>
            </div>

            {error && <div className="error-message pw-error" role="alert" tabIndex={-1} ref={errorRef}><CircleAlert size={17} aria-hidden="true" /><span>{error}</span></div>}

            {step === 0 && (
              <div className="pw-step-content">
                {customersLoading && <p role="status" className="muted">Loading customers...</p>}
                {customersError && <div className="error-message" role="alert"><p>{customersError}</p><button type="button" className="button secondary" onClick={() => setReloadCustomers(current => current + 1)}>Retry loading customers</button></div>}
                {!customersLoading && !customersError && !addingCustomer && <>
                  <div className="pw-customer-picker">
                    <label className="field"><span>Customer</span><select name="customerId" value={draft.customerId} required onChange={event => setDraft(current => ({ ...current, customerId: event.target.value }))}>
                      <option value="" disabled>Select a customer</option>
                      {customers.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select></label>
                    <button type="button" className="button secondary" onClick={() => { setAddingCustomer(true); setError(null); }}><Plus size={16} aria-hidden="true" />New customer</button>
                  </div>
                  {customer ? <div className="pw-customer-profile">
                    <div className="pw-business-icon"><Building2 size={22} aria-hidden="true" /></div>
                    <div className="pw-customer-details"><h3>{customer.name}</h3><p className="muted">{customer.industry} · {customer.registrationNumber}</p>
                      <dl className="pw-details-grid"><div><dt>Headquarters</dt><dd>{customer.address.city}, {COUNTRY_NAMES[customer.headquartersCountry]}</dd></div><div><dt>Contact</dt><dd>{customer.contactName}<span>{customer.email}</span></dd></div></dl>
                    </div>
                  </div> : <div className="pw-empty"><Building2 size={26} aria-hidden="true" /><h3>Add your first customer</h3><p className="muted">Create a business record to begin a policy.</p></div>}
                  <p className="pw-help">Headquarters are recorded on the customer. Each insured property has its own location country.</p>
                </>}
                {addingCustomer && <div className="pw-customer-create">
                  <div className="pw-subheading"><h3>New customer</h3><button type="button" className="button ghost" disabled={busy} onClick={() => { setAddingCustomer(false); setError(null); }}>Cancel customer</button></div>
                  <div className="form-grid pw-fields">
                    <label className="field pw-span-two"><span>Customer name</span><input autoFocus value={newCustomer.name} required maxLength={160} onChange={event => setNewCustomer(current => ({ ...current, name: event.target.value }))} placeholder="Business legal name" autoComplete="organization" /></label>
                    <label className="field"><span>Registration number</span><input value={newCustomer.registrationNumber} required maxLength={80} onChange={event => setNewCustomer(current => ({ ...current, registrationNumber: event.target.value }))} placeholder="HRB 123456" /></label>
                    <label className="field"><span>Headquarters country</span><select value={newCustomer.headquartersCountry} onChange={event => setNewCustomer(current => ({ ...current, headquartersCountry: event.target.value as Country }))}><option value="DE">Germany</option><option value="IT">Italy</option></select></label>
                    <label className="field pw-span-two"><span>Headquarters address</span><input value={newCustomer.address.line1} required maxLength={200} onChange={event => setNewCustomer(current => ({ ...current, address: { ...current.address, line1: event.target.value } }))} autoComplete="address-line1" /></label>
                    <label className="field"><span>Headquarters city</span><input value={newCustomer.address.city} required maxLength={100} onChange={event => setNewCustomer(current => ({ ...current, address: { ...current.address, city: event.target.value } }))} autoComplete="address-level2" /></label>
                    <label className="field"><span>Headquarters postcode</span><input value={newCustomer.address.postcode} required maxLength={12} onChange={event => setNewCustomer(current => ({ ...current, address: { ...current.address, postcode: event.target.value } }))} autoComplete="postal-code" /></label>
                    <label className="field pw-span-two"><span>Industry</span><input value={newCustomer.industry} required maxLength={120} onChange={event => setNewCustomer(current => ({ ...current, industry: event.target.value }))} /></label>
                    <label className="field"><span>Contact name</span><input value={newCustomer.contactName} required maxLength={120} onChange={event => setNewCustomer(current => ({ ...current, contactName: event.target.value }))} autoComplete="name" /></label>
                    <label className="field"><span>Contact email</span><input type="email" value={newCustomer.email} required maxLength={200} onChange={event => setNewCustomer(current => ({ ...current, email: event.target.value }))} autoComplete="email" /></label>
                  </div>
                  <div className="pw-inline-actions"><button type="submit" className="button primary" disabled={busy}>{busy ? 'Saving customer...' : 'Save customer'}</button></div>
                </div>}
              </div>
            )}

            {step === 1 && (
              <div className="pw-step-content">
                <div className="pw-product"><span className="pw-product-icon"><ShieldCheck size={24} aria-hidden="true" /></span><div><h3>Meridian Commercial Property</h3><p>Property damage and business interruption</p></div><span className="pw-version">Version 3</span></div>
                <div className="form-grid pw-fields">
                  <label className="field"><span>Issuing market</span><input value="Germany" readOnly /><small>Meridian's German issuing entity</small></label>
                  <label className="field"><span>Currency</span><input value="EUR" readOnly /></label>
                  <label className="field"><span>Inception date</span><input type="date" value={draft.inceptionDate} required onChange={event => {
                    const inceptionDate = event.target.value;
                    setDraft(current => {
                      if (!inceptionDate) return { ...current, inceptionDate };
                      const expiry = new Date(`${inceptionDate}T00:00:00Z`);
                      expiry.setUTCFullYear(expiry.getUTCFullYear() + 1);
                      expiry.setUTCDate(expiry.getUTCDate() - 1);
                      return { ...current, inceptionDate, expiryDate: expiry.toISOString().slice(0, 10) };
                    });
                  }} /></label>
                  <label className="field"><span>Expiry date</span><input type="date" value={draft.expiryDate} min={draft.inceptionDate} required onChange={event => setDraft(current => ({ ...current, expiryDate: event.target.value }))} /></label>
                </div>
                <p className="pw-help">The issuing market stays Germany for this product. Properties may be located in Germany or Italy.</p>
              </div>
            )}

            {step === 2 && (
              <div className="pw-step-content">
                <div className="pw-location-list">
                  {draft.locations.map((location, index) => <fieldset key={location.id} className="pw-location" data-testid={`location-${location.id}`}>
                    <legend>{location.name || `Location ${index + 1}`}</legend>
                    <div className="pw-location-toolbar"><span><MapPin size={14} aria-hidden="true" />Location {String(index + 1).padStart(2, '0')}</span>{draft.locations.length > 1 && <button type="button" className="button ghost pw-remove" aria-label={`Remove ${location.name || `location ${index + 1}`}`} onClick={() => setDraft(current => ({ ...current, locations: current.locations.filter(item => item.id !== location.id) }))}><Trash2 size={14} aria-hidden="true" />Remove</button>}</div>
                    <div className="form-grid pw-fields">
                      <label className="field"><span>Location name</span><input value={location.name} required maxLength={100} onChange={event => updateLocation(location.id, { name: event.target.value })} /></label>
                      <label className="field"><span>Location type</span><select value={location.type} onChange={event => updateLocation(location.id, { type: event.target.value as InsuredLocation['type'] })}><option>Factory</option><option>Warehouse</option><option>Office</option></select></label>
                      <label className="field"><span>Location country</span><select value={location.country} onChange={event => setCountry(location, event.target.value as Country)}><option value="DE">Germany</option><option value="IT">Italy</option></select></label>
                      <label className="field"><span>Address line</span><input value={location.address.line1} required maxLength={200} onChange={event => updateLocation(location.id, { address: { ...location.address, line1: event.target.value } })} /></label>
                      <label className="field"><span>City</span><input value={location.address.city} required maxLength={100} onChange={event => updateLocation(location.id, { address: { ...location.address, city: event.target.value } })} /></label>
                      <label className="field"><span>Postcode</span><input value={location.address.postcode} required maxLength={12} onChange={event => updateLocation(location.id, { address: { ...location.address, postcode: event.target.value } })} /></label>
                      <label className="field"><span>Construction</span><select value={location.construction} onChange={event => updateLocation(location.id, { construction: event.target.value as InsuredLocation['construction'] })}><option>Masonry</option><option>Steel</option><option>Timber</option></select></label>
                      <label className="field"><span>Year built</span><input type="number" value={location.yearBuilt || ''} required min={1700} max={new Date().getUTCFullYear() + 1} step={1} onChange={event => updateLocation(location.id, { yearBuilt: Number(event.target.value) })} /></label>
                      <label className="field"><span>Floor area (m²)</span><input type="number" value={location.areaSqm || ''} required min={1} step={1} onChange={event => updateLocation(location.id, { areaSqm: Number(event.target.value) })} /></label>
                      <label className="field"><span>Flood zone</span><select value={location.floodZone} onChange={event => updateLocation(location.id, { floodZone: event.target.value as InsuredLocation['floodZone'] })}><option>Low</option><option>Moderate</option><option>High</option></select></label>
                      <label className="field"><span>Sum insured</span><div className="pw-money-input"><span aria-hidden="true">€</span><input type="number" value={location.sumInsured || ''} required min={1} step="any" onChange={event => {
                        const sumInsured = Number(event.target.value);
                        updateLocation(location.id, current => ({ ...current, sumInsured, coverages: current.coverages.map(coverage => coverage.type === 'Fire' && coverage.limit === current.sumInsured ? { ...coverage, limit: sumInsured } : coverage) }));
                      }} /></div></label>
                      <label className="pw-checkbox pw-sprinkler"><input type="checkbox" aria-label="Sprinkler installed" checked={location.sprinkler} onChange={event => updateLocation(location.id, { sprinkler: event.target.checked })} /><span>Sprinkler installed<small>Automatic fire protection on site</small></span></label>
                    </div>
                    {location.country === 'IT' && <p className="pw-location-note">Italy location · Synthetic Milan address supplied</p>}
                  </fieldset>)}
                </div>
                <div className="pw-add-location"><label className="field"><span>New location type</span><select value={newLocationType} onChange={event => setNewLocationType(event.target.value as InsuredLocation['type'])}><option>Factory</option><option>Warehouse</option><option>Office</option></select></label><button type="button" className="button secondary" disabled={draft.locations.length >= 30} onClick={addLocation}><Plus size={16} aria-hidden="true" />Add location</button></div>
              </div>
            )}

            {step === 3 && (
              <div className="pw-step-content">
                <div className="pw-location-list">
                  {draft.locations.map(location => <fieldset key={location.id} className="pw-location pw-coverages" data-testid={`coverage-${location.id}`}>
                    <legend>{location.name}</legend>
                    <p className="pw-location-caption">{location.address.city}, {COUNTRY_NAMES[location.country]}<span>{money(location.sumInsured)} sum insured</span></p>
                    <div className="pw-coverage-list">{COVERAGES.map(type => {
                      const coverage = location.coverages.find(item => item.type === type);
                      return <div key={type} className={`pw-coverage-row${coverage ? ' is-selected' : ''}`}>
                        <label className="pw-checkbox pw-coverage-checkbox"><input type="checkbox" aria-label={`${type} coverage`} checked={Boolean(coverage)} disabled={type === 'Fire'} onChange={event => toggleCoverage(location.id, type, event.target.checked)} /><span>{type} coverage{type === 'Fire' && <small>Required for this product</small>}</span></label>
                        {coverage ? <>
                          <label className="field"><span>{type} limit</span><div className="pw-money-input"><span aria-hidden="true">€</span><input type="number" value={coverage.limit || ''} required min={1} max={type === 'Business interruption' ? 1000000000000 : location.sumInsured} step="any" onChange={event => updateCoverage(location.id, type, 'limit', Number(event.target.value))} /></div></label>
                          <label className="field"><span>{type} deductible</span><div className="pw-money-input"><span aria-hidden="true">€</span><input type="number" value={coverage.deductible} required min={0} step="any" onChange={event => updateCoverage(location.id, type, 'deductible', Number(event.target.value))} /></div></label>
                        </> : <span className="pw-not-selected">Not included</span>}
                      </div>;
                    })}</div>
                    {location.coverages.some(coverage => coverage.type === 'Flood' && coverage.limit > 500000) && <div className="pw-notice pw-notice-warm"><CircleAlert size={16} aria-hidden="true" /><p>This flood limit requires senior underwriting approval and a suitable risk survey for {location.name}.</p></div>}
                  </fieldset>)}
                </div>
              </div>
            )}

            {step === 4 && (
              <div className="pw-step-content pw-declarations">
                <section className="pw-form-section"><div className="pw-subheading"><h3>Loss history</h3><button type="button" className="button secondary" onClick={() => setDraft(current => ({ ...current, lossHistory: [...current.lossHistory, { id: crypto.randomUUID(), date: '', description: '', amount: 0 }] }))}><Plus size={15} aria-hidden="true" />Add loss</button></div>
                  {!draft.lossHistory.length && <div className="pw-empty-line"><Check size={17} aria-hidden="true" /><span>No previous losses declared.</span></div>}
                  {draft.lossHistory.map((loss, index) => <fieldset className="pw-location pw-loss" key={loss.id}><legend>Loss {index + 1}</legend>
                    <div className="pw-loss-fields"><label className="field"><span>Loss date</span><input type="date" value={loss.date} required max={new Date().toISOString().slice(0, 10)} onChange={event => setDraft(current => ({ ...current, lossHistory: current.lossHistory.map(item => item.id === loss.id ? { ...item, date: event.target.value } : item) }))} /></label><label className="field"><span>Loss amount</span><div className="pw-money-input"><span aria-hidden="true">€</span><input type="number" value={loss.amount || ''} min={1} step="any" required onChange={event => setDraft(current => ({ ...current, lossHistory: current.lossHistory.map(item => item.id === loss.id ? { ...item, amount: Number(event.target.value) } : item) }))} /></div></label><button type="button" className="button ghost pw-remove" aria-label={`Remove loss ${index + 1}`} onClick={() => setDraft(current => ({ ...current, lossHistory: current.lossHistory.filter(item => item.id !== loss.id) }))}><Trash2 size={15} aria-hidden="true" /></button></div>
                    <label className="field"><span>Loss description</span><input value={loss.description} required maxLength={400} onChange={event => setDraft(current => ({ ...current, lossHistory: current.lossHistory.map(item => item.id === loss.id ? { ...item, description: event.target.value } : item) }))} placeholder="Cause and damage" /></label>
                  </fieldset>)}
                </section>
                <section className="pw-form-section"><h3>Billing</h3><div className="form-grid pw-fields"><label className="field"><span>Billing frequency</span><select value={draft.billing.frequency} onChange={event => setDraft(current => ({ ...current, billing: { ...current.billing, frequency: event.target.value as PolicyDraftInput['billing']['frequency'] } }))}><option>Annual</option><option>Quarterly</option></select></label><label className="field"><span>Payment method</span><select value={draft.billing.method} onChange={event => setDraft(current => ({ ...current, billing: { ...current.billing, method: event.target.value as PolicyDraftInput['billing']['method'] } }))}><option>Invoice</option><option>Direct debit</option></select></label></div></section>
                <section className="pw-form-section"><h3>Declarations</h3><label className="pw-checkbox pw-declaration-check"><input type="checkbox" aria-label="Insurance previously declined" checked={draft.declarations.insuranceDeclined} onChange={event => setDraft(current => ({ ...current, declarations: { ...current.declarations, insuranceDeclined: event.target.checked } }))} /><span>Insurance previously declined<small>Cover has been declined or cancelled by an insurer.</small></span></label>
                  <label className="field"><span>Additional information</span><textarea rows={3} value={draft.declarations.additionalInformation} maxLength={2000} onChange={event => setDraft(current => ({ ...current, declarations: { ...current.declarations, additionalInformation: event.target.value } }))} placeholder="Details the underwriter should know" /></label>
                  <label className="pw-checkbox pw-declaration-check pw-accuracy"><input type="checkbox" aria-label="Information is accurate" checked={draft.declarations.informationAccurate} required onChange={event => setDraft(current => ({ ...current, declarations: { ...current.declarations, informationAccurate: event.target.checked } }))} /><span>Information is accurate<small>I confirm that the customer, risk, and loss information is complete and accurate.</small></span></label>
                </section>
              </div>
            )}

            {step === 5 && (
              <div className="pw-step-content pw-review">
                <div className="pw-notice"><FileText size={17} aria-hidden="true" /><p>Saving creates a draft. Request a quote from the policy page when you are ready.</p></div>
                <section><div className="pw-subheading"><h3>Customer</h3>{editButton(0)}</div><p className="pw-review-main">{customer?.name}</p><p className="muted">{customer?.address.line1}, {customer?.address.postcode} {customer?.address.city}</p><p className="muted">Headquarters in {customer ? COUNTRY_NAMES[customer.headquartersCountry] : ''} · {customer?.registrationNumber}</p></section>
                <section><div className="pw-subheading"><h3>Product & term</h3>{editButton(1)}</div><dl className="pw-review-grid"><div><dt>Product</dt><dd>Meridian Commercial Property v3</dd></div><div><dt>Issuing market / currency</dt><dd>Germany / EUR</dd></div><div><dt>Inception date</dt><dd>{dateLabel(draft.inceptionDate)}</dd></div><div><dt>Expiry date</dt><dd>{dateLabel(draft.expiryDate)}</dd></div></dl></section>
                <section><div className="pw-subheading"><h3>Locations & risks</h3>{editButton(2)}</div>{draft.locations.map(location => <div className="pw-review-location" key={location.id}><div><h4>{location.name}<span>{COUNTRY_NAMES[location.country]}</span></h4><p className="muted">{location.address.line1}, {location.address.postcode} {location.address.city}</p><p className="muted">{location.construction} · Built {location.yearBuilt} · {location.areaSqm.toLocaleString('en-GB')} m² · {location.sprinkler ? 'Sprinkler installed' : 'No sprinkler'} · {location.floodZone.toLowerCase()} flood zone</p></div><strong>{money(location.sumInsured)}</strong></div>)}</section>
                <section><div className="pw-subheading"><h3>Coverages</h3>{editButton(3)}</div><div className="pw-table-wrap"><table className="pw-review-table"><thead><tr><th scope="col">Location / coverage</th><th scope="col">Limit</th><th scope="col">Deductible</th></tr></thead><tbody>{draft.locations.flatMap(location => location.coverages.map(coverage => <tr key={`${location.id}-${coverage.type}`}><td><span>{location.name}</span>{coverage.type}</td><td>{money(coverage.limit)}</td><td>{money(coverage.deductible)}</td></tr>))}</tbody></table></div></section>
                <section><div className="pw-subheading"><h3>Declarations & billing</h3>{editButton(4)}</div><dl className="pw-review-grid"><div><dt>Payment</dt><dd>{draft.billing.frequency} / {draft.billing.method}</dd></div><div><dt>Loss history</dt><dd>{draft.lossHistory.length ? `${draft.lossHistory.length} declared ${draft.lossHistory.length === 1 ? 'loss' : 'losses'}, ${money(draft.lossHistory.reduce((total, loss) => total + loss.amount, 0))}` : 'No previous losses'}</dd></div><div><dt>Insurance previously declined</dt><dd>{draft.declarations.insuranceDeclined ? 'Yes' : 'No'}</dd></div><div><dt>Information confirmed</dt><dd>{draft.declarations.informationAccurate ? 'Yes' : 'No'}</dd></div></dl>{draft.declarations.additionalInformation && <p className="pw-review-additional">{draft.declarations.additionalInformation}</p>}</section>
                {referredLocations.length > 0 && <div className="pw-notice pw-notice-warm"><CircleAlert size={17} aria-hidden="true" /><p>Flood limits for {referredLocations.map(location => location.name).join(', ')} will require senior underwriting approval and a suitable survey for each affected location when you request a quote.</p></div>}
              </div>
            )}
          </section>

          <footer className="pw-footer">
            <div>{step > 0 && <button type="button" className="button secondary" disabled={busy} onClick={() => goToStep(step - 1)}><ArrowLeft size={16} aria-hidden="true" />Back</button>}</div>
            <div className="pw-footer-forward"><span className="muted">{step === STEPS.length - 1 ? 'Draft · Premium pending' : `${step + 1} of ${STEPS.length}`}</span><button type="submit" className="button primary" disabled={busy || addingCustomer || customersLoading || Boolean(customersError)}>{busy ? 'Saving draft...' : step === STEPS.length - 1 ? 'Save draft' : 'Continue'}{!busy && <ArrowRight size={16} aria-hidden="true" />}</button></div>
          </footer>
        </form>

        <aside className="pw-summary" aria-label="Draft summary">
          <div className="panel pw-summary-card"><div className="pw-summary-header"><span className="pw-summary-icon"><FileText size={18} aria-hidden="true" /></span><span>Policy draft</span><span className="pw-draft-dot" aria-hidden="true" /></div><p className="pw-summary-customer">{customer?.name ?? 'Select a customer'}</p><p className="muted">Commercial Property · v3</p><dl><div><dt>Issuing market</dt><dd>Germany</dd></div><div><dt>Locations</dt><dd>{draft.locations.length}</dd></div><div><dt>Total sum insured</dt><dd>{money(totalInsured)}</dd></div><div><dt>Billing</dt><dd>{draft.billing.frequency}</dd></div></dl><div className="pw-premium-pending"><span>Annual premium</span><strong>Pending quote</strong></div><p className="pw-summary-role">Prepared as {role}</p></div>
          <div className="pw-summary-guidance"><ShieldCheck size={18} aria-hidden="true" /><div><h3>Underwriting rule</h3><p>Flood limits above €500,000 per location need senior approval and a suitable risk survey.</p>{referredLocations.length > 0 && <p className="pw-referral-count">{referredLocations.length} {referredLocations.length === 1 ? 'location requires' : 'locations require'} review</p>}</div></div>
        </aside>
      </div>
    </div>
  );
}

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowLeft, ArrowUpRight, BadgeCheck, Building2, CalendarDays, Check, CircleAlert, FileText, History, MapPin, Pencil, ShieldCheck, X } from 'lucide-react';
import { COUNTRY_NAMES, ITALIAN_WAREHOUSE_ADDRESS, createStandardDraft, type Coverage, type CoverageType, type InsuredLocation, type PolicyDetailResponse, type PolicySchedule, type Premium, type Quote, type Role } from '../../shared/insurance';
import { api } from '../lib/api';
import './detail.css';

type DetailTab = 'Overview' | 'Locations' | 'Coverages' | 'Documents' | 'Activity';
type DialogKind = 'survey' | 'approve' | 'issue' | 'schedule' | 'amend' | 'edit';
type Props = { policyId: string; role: Role; onBack: () => void; onNavigate?: (path: string) => void };

const tabs: { label: DetailTab; icon: typeof FileText }[] = [
  { label: 'Overview', icon: ShieldCheck }, { label: 'Locations', icon: MapPin },
  { label: 'Coverages', icon: BadgeCheck }, { label: 'Documents', icon: FileText },
  { label: 'Activity', icon: History },
];
const coverageTypes: CoverageType[] = ['Fire', 'Flood', 'Business interruption', 'Theft'];
const money = (amount: number, decimals = false) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR', minimumFractionDigits: decimals ? 2 : 0, maximumFractionDigits: decimals ? 2 : 0 }).format(amount);
const date = (value: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value.includes('T') ? value : `${value}T12:00:00`));
const dateTime = (value: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.';
const cloneLocations = (locations: InsuredLocation[]) => structuredClone(locations);

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return <div className="policy-fact"><dt>{label}</dt><dd>{children}</dd></div>;
}

function DetailDialog({ title, description, busy, onClose, children, wide = false }: {
  title: string; description?: string; busy: boolean; onClose: () => void; children: ReactNode; wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const element = ref.current;
    const trigger = document.activeElement as HTMLElement | null;
    element?.showModal();
    return () => { element?.close(); if (trigger?.isConnected) trigger.focus(); };
  }, []);
  return <dialog ref={ref} className={`policy-dialog${wide ? ' policy-dialog-wide' : ''}`} aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined}
    onCancel={event => { event.preventDefault(); if (!busy) onCloseRef.current(); }}
    onClick={event => { if (event.target === event.currentTarget && !busy) { const box = event.currentTarget.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onCloseRef.current(); } }}>
    <header className="policy-dialog-header"><div><h2 id={titleId}>{title}</h2>{description && <p id={descriptionId}>{description}</p>}</div><button type="button" className="policy-icon-button" aria-label="Close dialog" disabled={busy} onClick={onClose}><X size={18} /></button></header>
    {children}
  </dialog>;
}

function PremiumSummary({ premium, quote, revision }: { premium: Premium | null; quote: Quote | null; revision: number }) {
  return <aside className="policy-premium panel" aria-label="Premium summary">
    <div className="policy-panel-title"><h2>Policy premium</h2><span className="policy-currency">EUR</span></div>
    {premium ? <>
      <p className="policy-premium-amount" data-testid="policy-premium">{money(premium.total, true)}<span>including tax</span></p>
      <dl className="policy-premium-breakdown">
        <Fact label="Property cover">{money(premium.base, true)}</Fact>
        <Fact label="Flood cover">{money(premium.flood, true)}</Fact>
        <Fact label="Additional coverages">{money(premium.otherCoverages, true)}</Fact>
        <Fact label="Risk adjustment">{money(premium.riskAdjustment, true)}</Fact>
        <Fact label="Insurance tax">{money(premium.tax, true)}</Fact>
        <Fact label="Total premium">{money(premium.total, true)}</Fact>
      </dl>
      <div className="policy-premium-locations"><p className="policy-eyebrow">Annual premium by location</p>{premium.byLocation.map(location => <div key={location.locationId}><span>{location.name}</span><strong>{money(location.annual, true)}</strong></div>)}</div>
    </> : <div className="policy-unquoted"><ShieldCheck size={28} strokeWidth={1.5} /><h3>Ready to calculate</h3><p>Your draft is saved. Request a quote when the risk details and coverages are ready.</p></div>}
    {quote && <div className="policy-quote-reference"><span className="policy-eyebrow">Current quote</span><span className="policy-mono" data-testid="quote-id">{quote.id}</span><span>Risk revision {quote.policyRevision} · Valid until {date(quote.validUntil)}</span>{quote.policyRevision !== revision && <span className="policy-warning-text">The risk has changed. Request a new quote.</span>}</div>}
  </aside>;
}

function ScheduleContent({ schedule }: { schedule: PolicySchedule }) {
  return <div className="policy-schedule" data-testid="policy-schedule">
    <div className="policy-schedule-brand"><div className="policy-schedule-mark"><ShieldCheck size={22} /></div><div><strong>Meridian</strong><span>Commercial property</span></div><span className="policy-synthetic-tag">Synthetic document</span></div>
    <div className="policy-schedule-heading"><div><p className="policy-eyebrow">Policy schedule</p><h3>{schedule.customer.name}</h3><p>{schedule.policyNumber} · Version <span data-testid="schedule-version">{schedule.policyVersion}</span></p></div><span className="policy-status-badge is-issued"><Check size={13} /> Issued</span></div>
    <dl className="policy-facts-grid">
      <Fact label="Policyholder headquarters"><span data-testid="schedule-headquarters-country">{COUNTRY_NAMES[schedule.customer.headquartersCountry]}</span></Fact>
      <Fact label="Issuing market"><span data-testid="schedule-issuing-market">{COUNTRY_NAMES[schedule.issuingMarket]}</span></Fact>
      <Fact label="Period of insurance">{date(schedule.inceptionDate)} to {date(schedule.expiryDate)}</Fact>
      <Fact label="Policy premium">{money(schedule.premium.total, true)}</Fact>
      <Fact label="Product">{schedule.product} v{schedule.productVersion}</Fact>
      <Fact label="Effective date">{date(schedule.effectiveDate || schedule.inceptionDate)}</Fact>
    </dl>
    {schedule.locations.map(location => <section key={location.id} className="policy-schedule-location" aria-label={location.name} data-testid={`schedule-location-${location.id}`}>
      <div className="policy-panel-title"><h4>{location.name}</h4><span>{COUNTRY_NAMES[location.country]}</span></div>
      <p>{location.address.line1}, {location.address.postcode} {location.address.city}, {COUNTRY_NAMES[location.country]}</p>
      <p className="policy-schedule-value">Sum insured <strong>{money(location.sumInsured)}</strong></p>
      <table className="policy-detail-table"><thead><tr><th>Coverage</th><th>Limit</th><th>Deductible</th></tr></thead><tbody>{location.coverages.map(coverage => <tr key={coverage.type}><td>{coverage.type}</td><td>{money(coverage.limit)}</td><td>{money(coverage.deductible)}</td></tr>)}</tbody></table>
    </section>)}
    <footer className="policy-schedule-foot"><span>Policy {schedule.policyId}</span><span>Quote {schedule.quoteId}</span><p>This schedule belongs to the fictional Meridian demo product.</p></footer>
  </div>;
}

export function PolicyDetail({ policyId, role, onBack }: Props) {
  const [data, setData] = useState<PolicyDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [tab, setTab] = useState<DetailTab>('Overview');
  const [pending, setPending] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [schedule, setSchedule] = useState<PolicySchedule | null>(null);
  const [surveyLocation, setSurveyLocation] = useState('');
  const [surveyName, setSurveyName] = useState('Approved synthetic survey');
  const [surveySuitable, setSurveySuitable] = useState(true);
  const [approvalNotes, setApprovalNotes] = useState('Reviewed the location risk survey and proposed flood cover.');
  const [editedLocations, setEditedLocations] = useState<InsuredLocation[]>([]);
  const [amendmentLocation, setAmendmentLocation] = useState('');
  const [amendedSumInsured, setAmendedSumInsured] = useState('');
  const [amendedFloodLimit, setAmendedFloodLimit] = useState('');
  const [amendmentEffectiveDate, setAmendmentEffectiveDate] = useState('');
  const [amendmentReason, setAmendmentReason] = useState('');
  const tabPrefix = useId();
  const busy = pending !== null;

  async function reload() {
    const next = await api<PolicyDetailResponse>(`/insurance/policies/${encodeURIComponent(policyId)}`, { role });
    setData(next);
    return next;
  }

  useEffect(() => {
    let current = true;
    setLoading(true); setLoadError(''); setData(null); setNotice(''); setActionError(''); setDialog(null); setTab('Overview');
    api<PolicyDetailResponse>(`/insurance/policies/${encodeURIComponent(policyId)}`)
      .then(next => { if (current) setData(next); })
      .catch(error => { if (current) setLoadError(errorText(error)); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [policyId]);

  async function mutate(action: string, path: string, body: unknown, success: string, method = 'POST') {
    if (busy) return;
    setPending(action); setActionError(''); setNotice('');
    try {
      await api(path, { method, role, body: JSON.stringify(body) });
      await reload();
      setDialog(null); setNotice(success);
    } catch (error) { setActionError(errorText(error)); }
    finally { setPending(null); }
  }

  async function showSchedule() {
    if (busy) return;
    setPending('schedule'); setActionError('');
    try {
      const result = await api<{ schedule: PolicySchedule }>(`/insurance/policies/${encodeURIComponent(policyId)}/schedule`, { role });
      setSchedule(result.schedule); setDialog('schedule');
    } catch (error) { setActionError(errorText(error)); }
    finally { setPending(null); }
  }

  function closeDialog() { if (!busy) { setDialog(null); setActionError(''); } }

  if (loading) return <section className="policy-detail policy-loading" aria-busy="true"><div className="policy-loading-line" /><div className="policy-loading-line short" /><p>Loading policy…</p></section>;
  if (loadError || !data) return <section className="policy-detail"><button className="button ghost" onClick={onBack}><ArrowLeft size={16} /> Insurance desk</button><div className="policy-load-error panel"><CircleAlert size={28} /><h1>Policy unavailable</h1><p role="alert">{loadError || 'The policy could not be found.'}</p><button className="button secondary" onClick={() => { setLoading(true); setLoadError(''); reload().catch(error => setLoadError(errorText(error))).finally(() => setLoading(false)); }}>Try again</button></div></section>;

  const { policy, customer, quote } = data;
  const isBroker = role === 'Broker';
  const isSenior = role === 'Senior underwriter';
  const isIssued = policy.status === 'Issued';
  const isReferred = policy.status === 'Referred';
  const quoteExpired = Boolean(quote && Date.parse(quote.validUntil) <= Date.now());
  const canIssue = (policy.status === 'Quoted' || policy.status === 'Approved') && !quoteExpired;
  const premium = policy.premium || quote?.premium || null;
  const totalInsured = policy.locations.reduce((total, location) => total + location.sumInsured, 0);
  const referrals = quote?.referrals || [];
  const outstandingSurveys = referrals.filter(referral => !policy.documents.some(document => document.type === 'Risk survey' && document.locationId === referral.locationId && document.suitable));
  const chosenAmendmentLocation = policy.locations.find(location => location.id === amendmentLocation);
  const originalFlood = chosenAmendmentLocation?.coverages.find(coverage => coverage.type === 'Flood');
  const amendmentNeedsReview = Number(amendedFloodLimit) > 500000 && (
    Number(amendedFloodLimit) > (originalFlood?.limit || 0)
    || Number(amendedSumInsured) !== chosenAmendmentLocation?.sumInsured
  );

  function openSurvey() {
    setSurveyLocation(outstandingSurveys[0]?.locationId || policy.locations[0]?.id || '');
    setSurveyName('Approved synthetic survey'); setSurveySuitable(true); setActionError(''); setDialog('survey');
  }

  function selectAmendmentLocation(id: string) {
    const location = policy.locations.find(item => item.id === id);
    setAmendmentLocation(id); setAmendedSumInsured(location ? String(location.sumInsured) : '');
    const flood = location?.coverages.find(coverage => coverage.type === 'Flood');
    setAmendedFloodLimit(flood ? String(flood.limit) : '');
  }

  function openAmendment() {
    selectAmendmentLocation(policy.locations.find(location => location.type === 'Warehouse')?.id || policy.locations[0]?.id || '');
    const today = new Date().toISOString().slice(0, 10);
    const earliest = policy.amendments.at(-1)?.effectiveDate || policy.inceptionDate;
    setAmendmentEffectiveDate(today < earliest ? earliest : today > policy.expiryDate ? policy.expiryDate : today);
    setAmendmentReason(''); setActionError(''); setDialog('amend');
  }

  function updateEditedLocation(id: string, update: Partial<InsuredLocation>) {
    setEditedLocations(locations => locations.map(location => location.id === id ? { ...location, ...update } : location));
  }

  function updateEditedCoverage(id: string, type: CoverageType, update: Partial<Coverage>) {
    setEditedLocations(locations => locations.map(location => location.id === id ? { ...location, coverages: location.coverages.map(coverage => coverage.type === type ? { ...coverage, ...update } : coverage) } : location));
  }

  function toggleCoverage(id: string, type: CoverageType, enabled: boolean) {
    setEditedLocations(locations => locations.map(location => location.id !== id ? location : { ...location, coverages: enabled ? [...location.coverages, { type, limit: type === 'Flood' ? 500000 : type === 'Fire' ? location.sumInsured : 250000, deductible: type === 'Fire' ? 2500 : 5000 }] : location.coverages.filter(coverage => coverage.type !== type) }));
  }

  function saveAmendment(event: FormEvent) {
    event.preventDefault();
    const sum = Number(amendedSumInsured);
    const flood = amendedFloodLimit.trim() === '' ? null : Number(amendedFloodLimit);
    if (!chosenAmendmentLocation || !Number.isFinite(sum) || sum <= 0 || (flood !== null && (!Number.isFinite(flood) || flood <= 0))) { setActionError('Enter a positive sum insured and a positive flood limit, or leave flood cover blank.'); return; }
    const locations = policy.locations.map(location => {
      if (location.id !== amendmentLocation) return location;
      const coverages = location.coverages.flatMap(coverage => coverage.type !== 'Flood'
        ? [coverage] : flood === null ? [] : [{ ...coverage, limit: flood }]);
      if (flood !== null && !originalFlood) coverages.push({ type: 'Flood', limit: flood, deductible: 5000 });
      return { ...location, sumInsured: sum, coverages };
    });
    void mutate('amend', `/insurance/policies/${encodeURIComponent(policyId)}/amendments`, { effectiveDate: amendmentEffectiveDate, reason: amendmentReason.trim(), changes: { locations } }, `Amendment saved. Policy version ${policy.version + 1} and the updated schedule are ready.`);
  }

  const dialogError = actionError && <p className="error-message policy-dialog-error" role="alert">{actionError}</p>;

  return <section className="policy-detail">
    <button type="button" className="policy-back" onClick={onBack}><ArrowLeft size={15} /> Insurance desk</button>
    <header className="policy-header">
      <div className="policy-heading"><div className="policy-heading-meta"><span>{policy.policyNumber}</span><span className={`policy-status-badge is-${policy.status.toLowerCase()}`} data-testid="policy-status">{isIssued && <Check size={13} />}{policy.status}</span><span className="policy-version">Version {policy.version}</span>{policy.source === 'run' && <span className="policy-run-tag">Test run</span>}</div><h1>{customer.name}</h1><p>{policy.product} <span>·</span> Product v{policy.productVersion} <span>·</span> {COUNTRY_NAMES[policy.issuingMarket]} issuing market</p><span className="policy-reference">Policy ID <span className="policy-mono" data-testid="policy-id">{policy.id}</span></span></div>
      <div className="policy-header-actions">
        {(policy.status === 'Draft' || (quoteExpired && !isIssued)) && <>{tab !== 'Locations' && <button type="button" className="button secondary" disabled={busy || !isBroker} onClick={() => { setEditedLocations(cloneLocations(policy.locations)); setActionError(''); setDialog('edit'); }}><Pencil size={15} /> Edit locations</button>}<button type="button" className="button primary" data-testid="request-quote" disabled={busy || !isBroker} onClick={() => void mutate('quote', `/insurance/policies/${encodeURIComponent(policyId)}/quote`, {}, 'Quote requested. The premium and underwriting decision are ready.')}>{pending === 'quote' ? 'Calculating…' : 'Request quote'}<ArrowUpRight size={15} /></button></>}
        {isReferred && !quoteExpired && <><button type="button" className="button secondary" disabled={busy} onClick={openSurvey}><FileText size={15} /> Attach risk survey</button><button type="button" className="button primary" disabled={busy || !isSenior} title={!isSenior ? 'Select Senior underwriter as the acting role to approve.' : undefined} onClick={() => { setActionError(''); setDialog('approve'); }}>Approve referral<ArrowUpRight size={15} /></button></>}
        {canIssue && <button type="button" className="button primary" disabled={busy || !isBroker} onClick={() => { setActionError(''); setDialog('issue'); }}>Issue policy<ArrowUpRight size={15} /></button>}
        {isIssued && <><button type="button" className="button secondary" disabled={busy} onClick={openAmendment}><Pencil size={15} /> Amend policy</button><button type="button" className="button primary" disabled={busy} onClick={() => void showSchedule()}><FileText size={15} />{pending === 'schedule' ? 'Loading schedule…' : 'View schedule'}</button></>}
      </div>
    </header>

    {quoteExpired && !isIssued && <p className="error-message" role="alert">This quote has expired. Request a new quote as Broker before approving or issuing this policy.</p>}
    {notice && <div className="policy-notice" role="status"><Check size={16} /><span>{notice}</span><button type="button" className="policy-icon-button" aria-label="Dismiss notification" onClick={() => setNotice('')}><X size={15} /></button></div>}
    {actionError && !dialog && <p className="error-message" role="alert">{actionError}</p>}
    {isReferred && <section className="policy-referral" aria-label="Underwriting referral"><div className="policy-referral-icon"><CircleAlert size={19} /></div><div className="policy-referral-content"><h2>Senior underwriting review required</h2><p>Flood cover above {money(500000)} exceeds broker authority and requires approval. Each affected location needs a suitable survey and senior underwriting.</p><div className="policy-referral-items">{referrals.map(referral => { const hasSurvey = !outstandingSurveys.some(item => item.locationId === referral.locationId); return <div key={referral.locationId}><span><strong>{referral.locationName}</strong><span>{money(referral.floodLimit)} flood limit</span></span><span className={`policy-evidence-label${hasSurvey ? ' complete' : ''}`}>{hasSurvey ? <Check size={13} /> : <FileText size={13} />}{hasSurvey ? 'Suitable survey attached' : 'Risk survey needed'}</span></div>; })}</div>{!isSenior && <p className="policy-role-hint">Acting as Broker. Switch to Senior underwriter to review and approve this quote.</p>}</div></section>}
    {policy.status === 'Approved' && <div className="policy-approved-banner"><BadgeCheck size={19} /><div><strong>Underwriting approved</strong><span>{quote?.approvedAt ? `Approved ${date(quote.approvedAt)}. ` : ''}{isBroker ? 'The policy is ready to issue.' : 'Switch to Broker to issue this policy.'}</span></div></div>}
    {policy.status === 'Draft' && !isBroker && <p className="policy-role-note">Switch to Broker to edit the draft or request a quote.</p>}
    {policy.status === 'Quoted' && !isBroker && <p className="policy-role-note">This quote is ready. Switch to Broker to issue the policy.</p>}

    <div className="policy-tabs" role="tablist" aria-label="Policy details">{tabs.map(({ label, icon: Icon }, index) => <button key={label} type="button" role="tab" id={`${tabPrefix}-${label}`} aria-selected={tab === label} aria-controls={`${tabPrefix}-panel`} tabIndex={tab === label ? 0 : -1} onClick={() => setTab(label)} onKeyDown={event => { let next = index; if (event.key === 'ArrowRight') next = (index + 1) % tabs.length; else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length; else if (event.key === 'Home') next = 0; else if (event.key === 'End') next = tabs.length - 1; else return; event.preventDefault(); setTab(tabs[next].label); const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]'); buttons?.[next]?.focus(); }}><Icon size={15} />{label}{label === 'Documents' && <span className="policy-tab-count">{policy.documents.length}</span>}</button>)}</div>

    <div role="tabpanel" id={`${tabPrefix}-panel`} aria-labelledby={`${tabPrefix}-${tab}`} tabIndex={0} className="policy-tab-panel">
      {tab === 'Overview' && <div className="policy-overview-grid"><div className="policy-main-column">
        <div className="policy-summary-strip"><div><span>Total sum insured</span><strong>{money(totalInsured)}</strong></div><div><span>Insured locations</span><strong>{policy.locations.length}<small>{Array.from(new Set(policy.locations.map(location => COUNTRY_NAMES[location.country]))).join(' · ')}</small></strong></div><div><span>Period of insurance</span><strong className="policy-term">{date(policy.inceptionDate)}<small>to {date(policy.expiryDate)}</small></strong></div></div>
        <section className="panel policy-information"><div className="policy-panel-title"><h2><Building2 size={17} /> Policyholder</h2><span className="policy-subtle-tag">{customer.industry}</span></div><dl className="policy-facts-grid"><Fact label="Legal name">{customer.name}</Fact><Fact label="Registration number">{customer.registrationNumber}</Fact><Fact label="Headquarters">{COUNTRY_NAMES[customer.headquartersCountry]}</Fact><Fact label="Registered address">{customer.address.line1}, {customer.address.postcode} {customer.address.city}</Fact><Fact label="Primary contact">{customer.contactName}</Fact><Fact label="Email"><a href={`mailto:${customer.email}`}>{customer.email}</a></Fact></dl></section>
        <section className="panel policy-information"><div className="policy-panel-title"><h2><CalendarDays size={17} /> Terms & declarations</h2><span className="policy-subtle-tag">Risk revision {policy.revision}</span></div><dl className="policy-facts-grid"><Fact label="Billing frequency">{policy.billing.frequency}</Fact><Fact label="Payment method">{policy.billing.method}</Fact><Fact label="Information confirmed">{policy.declarations.informationAccurate ? 'Yes' : 'Not confirmed'}</Fact><Fact label="Insurance previously declined">{policy.declarations.insuranceDeclined ? 'Yes' : 'No'}</Fact></dl>{policy.declarations.additionalInformation && <p className="policy-additional-note">{policy.declarations.additionalInformation}</p>}<div className="policy-loss-summary"><div><strong>Loss history</strong><span>{policy.lossHistory.length === 0 ? 'No declared losses in the last five years.' : `${policy.lossHistory.length} declared ${policy.lossHistory.length === 1 ? 'loss' : 'losses'} · ${money(policy.lossHistory.reduce((sum, loss) => sum + loss.amount, 0))} total`}</span></div>{policy.lossHistory.length > 0 && <div className="policy-loss-list">{policy.lossHistory.map(loss => <div key={loss.id}><span>{date(loss.date)} · {loss.description}</span><strong>{money(loss.amount)}</strong></div>)}</div>}</div></section>
        {policy.amendments.length > 0 && <section className="panel policy-information"><div className="policy-panel-title"><h2><Pencil size={16} /> Policy amendments</h2><span>{policy.amendments.length}</span></div><div className="policy-amendment-list">{[...policy.amendments].reverse().map(amendment => <details key={amendment.id}><summary><span className="policy-amendment-version">v{amendment.version}</span><span><strong>{amendment.reason}</strong><small>Effective {date(amendment.effectiveDate)} · {amendment.actor}</small></span><span>{money(amendment.premium.total, true)}</span></summary><dl className="policy-facts-grid"><Fact label="Previous premium">{money(amendment.previousPremium.total, true)}</Fact><Fact label="Updated premium">{money(amendment.premium.total, true)}</Fact>{amendment.changes.locations?.map(location => { const previous = amendment.previousValues.locations.find(item => item.id === location.id); return <Fact key={location.id} label={`${location.name} sum insured`}>{money(previous?.sumInsured || 0)} → {money(location.sumInsured)}</Fact>; })}</dl></details>)}</div></section>}
      </div><PremiumSummary premium={premium} quote={quote} revision={policy.revision} /></div>}

      {tab === 'Locations' && <div className="policy-locations-content"><div className="policy-content-toolbar"><div><h2>Insured locations</h2><p>Location countries describe each insured risk. The issuing market remains {COUNTRY_NAMES[policy.issuingMarket]}.</p></div>{!isIssued && <button type="button" className="button secondary" disabled={busy || !isBroker} onClick={() => { setEditedLocations(cloneLocations(policy.locations)); setActionError(''); setDialog('edit'); }}><Pencil size={15} /> Edit locations</button>}</div><div className="policy-location-grid">{policy.locations.map(location => <section className="panel policy-location" key={location.id} aria-label={location.name}><div className="policy-location-heading"><span className="policy-location-icon"><Building2 size={19} /></span><div><h3>{location.name}</h3><p>{location.type} · {COUNTRY_NAMES[location.country]}</p></div><span className="policy-subtle-tag">{location.country}</span></div><p className="policy-location-address"><MapPin size={14} />{location.address.line1}, {location.address.postcode} {location.address.city}</p><dl className="policy-facts-grid"><Fact label="Sum insured">{money(location.sumInsured)}</Fact><Fact label="Floor area">{new Intl.NumberFormat('en-GB').format(location.areaSqm)} m²</Fact><Fact label="Construction">{location.construction}</Fact><Fact label="Year built">{location.yearBuilt}</Fact><Fact label="Sprinkler installed">{location.sprinkler ? 'Yes' : 'No'}</Fact><Fact label="Flood zone">{location.floodZone}</Fact></dl><div className="policy-location-covers">{location.coverages.map(coverage => <span key={coverage.type}><ShieldCheck size={12} />{coverage.type}</span>)}</div></section>)}</div></div>}

      {tab === 'Coverages' && <div className="policy-coverages-content"><div className="policy-content-toolbar"><div><h2>Coverages & limits</h2><p>Limits and deductibles apply to each insured location.</p></div>{!isIssued && <button type="button" className="button secondary" disabled={busy || !isBroker} onClick={() => { setEditedLocations(cloneLocations(policy.locations)); setActionError(''); setDialog('edit'); }}><Pencil size={15} /> Edit coverages</button>}</div><div className="panel policy-table-wrap"><table className="policy-detail-table"><thead><tr><th>Location</th><th>Coverage</th><th>Limit</th><th>Deductible</th><th>Underwriting</th></tr></thead><tbody>{policy.locations.flatMap(location => location.coverages.map((coverage, index) => <tr key={`${location.id}-${coverage.type}`}><td>{index === 0 ? <><strong>{location.name}</strong><span className="policy-table-subtext">{COUNTRY_NAMES[location.country]}</span></> : <span className="policy-table-continuation" aria-label={location.name}>↳</span>}</td><td>{coverage.type}</td><td>{money(coverage.limit)}</td><td>{money(coverage.deductible)}</td><td>{coverage.type === 'Flood' && coverage.limit > 500000 ? <span className={`policy-evidence-label${policy.status === 'Approved' || isIssued ? ' complete' : ''}`}>{policy.status === 'Approved' || isIssued ? <Check size={13} /> : <CircleAlert size={13} />}{policy.status === 'Approved' || isIssued ? 'Approved' : 'Senior review'}</span> : <span className="policy-standard-label">Standard authority</span>}</td></tr>))}</tbody></table></div><p className="policy-table-caption">For this product, a flood limit above {money(500000)} requires senior underwriting. A limit of exactly {money(500000)} is within standard authority.</p></div>}

      {tab === 'Documents' && <div><div className="policy-content-toolbar"><div><h2>Policy documents</h2><p>Survey evidence is linked to its insured location.</p></div>{!isReferred && <button type="button" className="button secondary" disabled={busy} onClick={openSurvey}><FileText size={15} /> Attach risk survey</button>}</div>{policy.documents.length ? <div className="panel policy-document-list">{policy.documents.map(document => <div className="policy-document-row" key={document.id}><div className="policy-document-icon"><FileText size={20} /></div><div className="policy-document-description"><strong>{document.name}</strong><span>{document.type}{document.locationId ? ` · ${policy.locations.find(location => location.id === document.locationId)?.name || document.locationId}` : ''} · {date(document.uploadedAt)}</span><small>Added by {document.uploadedBy} · Synthetic document</small></div>{document.type === 'Risk survey' ? <span className={`policy-evidence-label${document.suitable ? ' complete' : ''}`}>{document.suitable ? <Check size={13} /> : <CircleAlert size={13} />}{document.suitable ? 'Suitable survey' : 'Not suitable'}</span> : document.id === `${policy.id}-schedule-v${policy.version}` ? <button type="button" className="button ghost" disabled={busy} onClick={() => void showSchedule()}>Open schedule<ArrowUpRight size={14} /></button> : <span className="policy-evidence-label">Earlier version</span>}</div>)}</div> : <div className="policy-empty panel"><FileText size={28} strokeWidth={1.5} /><h3>No documents yet</h3><p>Attach a synthetic risk survey to support the underwriting review. The policy schedule appears after issue.</p></div>}</div>}

      {tab === 'Activity' && <section className="panel policy-activity"><div className="policy-panel-title"><h2>Policy activity</h2><span className="policy-subtle-tag">{policy.activity.length} events</span></div><ol className="policy-timeline">{[...policy.activity].sort((a, b) => b.at.localeCompare(a.at)).map((entry, index) => <li key={entry.id}><span className={`policy-timeline-dot${index === 0 ? ' latest' : ''}`} /><div><strong>{entry.action}</strong><p>{entry.detail}</p><span>{entry.actor} · <time dateTime={entry.at}>{dateTime(entry.at)}</time></span></div></li>)}</ol></section>}
    </div>

    {dialog === 'survey' && <DetailDialog title="Attach risk survey" description="Add a synthetic survey to the location it assesses." busy={busy} onClose={closeDialog}><form onSubmit={event => { event.preventDefault(); void mutate('survey', `/insurance/policies/${encodeURIComponent(policyId)}/documents`, { type: 'Risk survey', locationId: surveyLocation, name: surveyName.trim(), suitable: surveySuitable }, 'Risk survey attached to the selected location.'); }}><div className="policy-dialog-body"><div className="field"><label htmlFor="survey-location">Survey location</label><select id="survey-location" value={surveyLocation} onChange={event => setSurveyLocation(event.target.value)} required>{policy.locations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}</select></div><div className="field"><label htmlFor="survey-name">Document name</label><input id="survey-name" value={surveyName} onChange={event => setSurveyName(event.target.value)} required maxLength={160} /></div><label className="policy-checkbox"><input type="checkbox" aria-label="Suitable risk survey" checked={surveySuitable} onChange={event => setSurveySuitable(event.target.checked)} /><span><strong>Suitable risk survey</strong><small>The survey supports the proposed flood cover at this location.</small></span></label><div className="policy-dialog-note"><FileText size={17} /><p>This demo records a synthetic document. No file upload is needed.</p></div>{dialogError}</div><footer className="policy-dialog-footer"><button type="button" className="button secondary" disabled={busy} onClick={closeDialog}>Cancel</button><button type="submit" className="button primary" disabled={busy}>{pending === 'survey' ? 'Attaching…' : 'Attach survey'}</button></footer></form></DetailDialog>}

    {dialog === 'approve' && <DetailDialog title="Approve referral" description="Review the evidence for this policy's current quote." busy={busy} onClose={closeDialog}><form onSubmit={event => { event.preventDefault(); if (quote) void mutate('approve', `/insurance/quotes/${encodeURIComponent(quote.id)}/approve`, { policyId: policy.id, notes: approvalNotes.trim() }, 'Referral approved. Switch to Broker to issue the policy.'); }}><div className="policy-dialog-body"><dl className="policy-dialog-facts"><Fact label="Policy">{policy.policyNumber}</Fact><Fact label="Quote"><span className="policy-mono">{quote?.id}</span></Fact><Fact label="Acting role">{role}</Fact></dl><div className="policy-approval-evidence">{referrals.map(referral => { const ready = !outstandingSurveys.some(item => item.locationId === referral.locationId); return <div key={referral.locationId}>{ready ? <Check size={17} /> : <CircleAlert size={17} />}<span><strong>{referral.locationName}</strong><small>{ready ? 'Suitable survey attached' : 'A suitable location survey is required'}</small></span><span>{money(referral.floodLimit)}</span></div>; })}</div><div className="field"><label htmlFor="approval-notes">Approval notes</label><textarea id="approval-notes" value={approvalNotes} onChange={event => setApprovalNotes(event.target.value)} rows={3} required maxLength={2000} /></div>{outstandingSurveys.length > 0 && <p className="policy-warning-text">Attach a suitable survey for every affected location before approving.</p>}{!isSenior && <p className="policy-warning-text">Only a Senior underwriter can approve this referral.</p>}{dialogError}</div><footer className="policy-dialog-footer"><button type="button" className="button secondary" disabled={busy} onClick={closeDialog}>Cancel</button><button type="submit" className="button primary" disabled={busy || !isSenior || outstandingSurveys.length > 0 || !quote}>{pending === 'approve' ? 'Approving…' : 'Confirm approval'}</button></footer></form></DetailDialog>}

    {dialog === 'issue' && <DetailDialog title="Issue policy" description="Confirm the terms and issue the policy schedule." busy={busy} onClose={closeDialog}><form onSubmit={event => { event.preventDefault(); if (quote) void mutate('issue', `/insurance/policies/${encodeURIComponent(policyId)}/issue`, { quoteId: quote.id }, 'Policy issued. The policy schedule is ready.'); }}><div className="policy-dialog-body"><div className="policy-issue-summary"><ShieldCheck size={24} /><div><strong>{customer.name}</strong><span>{policy.policyNumber} · {policy.locations.length} locations</span></div></div><dl className="policy-dialog-facts"><Fact label="Period of insurance">{date(policy.inceptionDate)} to {date(policy.expiryDate)}</Fact><Fact label="Total sum insured">{money(totalInsured)}</Fact><Fact label="Policy premium">{money(premium?.total || 0, true)}</Fact><Fact label="Quote"><span className="policy-mono">{quote?.id}</span></Fact></dl><p className="policy-dialog-description">Issuing confirms this quote and creates version {policy.version} of the schedule. Future risk changes are recorded as policy amendments.</p>{!isBroker && <p className="policy-warning-text">Select Broker as the acting role to issue this policy.</p>}{dialogError}</div><footer className="policy-dialog-footer"><button type="button" className="button secondary" disabled={busy} onClick={closeDialog}>Cancel</button><button type="submit" className="button primary" disabled={busy || !isBroker || !quote}>{pending === 'issue' ? 'Issuing…' : 'Confirm issue'}</button></footer></form></DetailDialog>}

    {dialog === 'schedule' && schedule && <DetailDialog title="Policy schedule" busy={busy} onClose={closeDialog} wide><div className="policy-dialog-body"><ScheduleContent schedule={schedule} /></div><footer className="policy-dialog-footer"><button type="button" className="button secondary" onClick={closeDialog}>Close schedule</button></footer></DetailDialog>}

    {dialog === 'amend' && <DetailDialog title="Amend policy" description={`Record a change to the issued policy. Saving creates version ${policy.version + 1}.`} busy={busy} onClose={closeDialog}><form onSubmit={saveAmendment}><div className="policy-dialog-body"><div className="form-grid"><div className="field"><label htmlFor="amendment-location">Amendment location</label><select id="amendment-location" value={amendmentLocation} onChange={event => selectAmendmentLocation(event.target.value)} required>{policy.locations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}</select></div><div className="field"><label htmlFor="amendment-date">Amendment effective date</label><input id="amendment-date" type="date" min={policy.amendments.at(-1)?.effectiveDate || policy.inceptionDate} max={policy.expiryDate} value={amendmentEffectiveDate} onChange={event => setAmendmentEffectiveDate(event.target.value)} required /></div><div className="field"><label htmlFor="amendment-sum">Amended sum insured</label><input id="amendment-sum" type="number" inputMode="decimal" min="1" step="0.01" value={amendedSumInsured} onChange={event => setAmendedSumInsured(event.target.value)} required /><small>Current {money(chosenAmendmentLocation?.sumInsured || 0)}</small></div><div className="field"><label htmlFor="amendment-flood">Amended flood limit</label><input id="amendment-flood" type="number" inputMode="decimal" min="1" step="0.01" value={amendedFloodLimit} onChange={event => setAmendedFloodLimit(event.target.value)} placeholder="No flood cover" /><small>Leave blank for no flood cover.</small></div></div><div className="field"><label htmlFor="amendment-reason">Amendment reason</label><textarea id="amendment-reason" value={amendmentReason} onChange={event => setAmendmentReason(event.target.value)} rows={3} required minLength={3} maxLength={2000} placeholder="Explain the change to the insured risk" /></div>{amendmentNeedsReview && <div className="policy-dialog-note is-warning"><CircleAlert size={17} /><p>Changing an insured risk with flood cover above {money(500000)} requires a Senior underwriter and a suitable survey for this location.</p></div>}<p className="policy-dialog-description">Saving recalculates the premium and updates the schedule. The current values and premium remain in the amendment history.</p>{dialogError}</div><footer className="policy-dialog-footer"><button type="button" className="button secondary" disabled={busy} onClick={closeDialog}>Cancel</button><button type="submit" className="button primary" disabled={busy}>{pending === 'amend' ? 'Saving amendment…' : 'Save amendment'}</button></footer></form></DetailDialog>}

    {dialog === 'edit' && <DetailDialog title="Edit policy locations" description="Update the insured risks and coverages before requesting a quote." busy={busy} onClose={closeDialog} wide><form onSubmit={event => { event.preventDefault(); if (JSON.stringify(editedLocations) === JSON.stringify(policy.locations)) { setDialog(null); setNotice('No risk details changed.'); return; } void mutate('edit', `/insurance/policies/${encodeURIComponent(policyId)}`, { locations: editedLocations }, 'Risk details saved. Request a new quote for these terms.', 'PATCH'); }}><div className="policy-dialog-body">{quote && <div className="policy-dialog-note is-warning"><CircleAlert size={17} /><p>Saving these changes clears the current quote and premium and returns this policy to Draft.</p></div>}{editedLocations.map(location => <fieldset className="policy-edit-location" key={location.id}><legend>{location.name}</legend><div className="form-grid"><div className="field"><label htmlFor={`edit-${location.id}-name`}>Location name</label><input id={`edit-${location.id}-name`} value={location.name} required onChange={event => updateEditedLocation(location.id, { name: event.target.value })} /></div><div className="field"><label htmlFor={`edit-${location.id}-country`}>Location country</label><select id={`edit-${location.id}-country`} value={location.country} onChange={event => { const country = event.target.value as 'DE' | 'IT'; const standard = createStandardDraft().locations.find(item => item.type === location.type); updateEditedLocation(location.id, { country, address: country === 'IT' ? { ...ITALIAN_WAREHOUSE_ADDRESS } : location.country === 'IT' ? { ...(standard?.address || { line1: 'Parkstrasse 12', city: 'Berlin', postcode: '10115' }) } : location.address }); }}><option value="DE">Germany</option><option value="IT">Italy</option></select></div><div className="field policy-span-two"><label htmlFor={`edit-${location.id}-address`}>Address line</label><input id={`edit-${location.id}-address`} value={location.address.line1} required onChange={event => updateEditedLocation(location.id, { address: { ...location.address, line1: event.target.value } })} /></div><div className="field"><label htmlFor={`edit-${location.id}-city`}>City</label><input id={`edit-${location.id}-city`} value={location.address.city} required onChange={event => updateEditedLocation(location.id, { address: { ...location.address, city: event.target.value } })} /></div><div className="field"><label htmlFor={`edit-${location.id}-postcode`}>Postcode</label><input id={`edit-${location.id}-postcode`} value={location.address.postcode} required onChange={event => updateEditedLocation(location.id, { address: { ...location.address, postcode: event.target.value } })} /></div><div className="field"><label htmlFor={`edit-${location.id}-construction`}>Construction</label><select id={`edit-${location.id}-construction`} value={location.construction} onChange={event => updateEditedLocation(location.id, { construction: event.target.value as InsuredLocation['construction'] })}><option>Masonry</option><option>Steel</option><option>Timber</option></select></div><div className="field"><label htmlFor={`edit-${location.id}-year`}>Year built</label><input id={`edit-${location.id}-year`} type="number" min="1700" max={new Date().getFullYear() + 1} value={location.yearBuilt} required onChange={event => updateEditedLocation(location.id, { yearBuilt: Number(event.target.value) })} /></div><div className="field"><label htmlFor={`edit-${location.id}-area`}>Floor area (m²)</label><input id={`edit-${location.id}-area`} type="number" min="1" value={location.areaSqm} required onChange={event => updateEditedLocation(location.id, { areaSqm: Number(event.target.value) })} /></div><div className="field"><label htmlFor={`edit-${location.id}-sum`}>Sum insured</label><input id={`edit-${location.id}-sum`} type="number" min="1" step="0.01" value={location.sumInsured} required onChange={event => updateEditedLocation(location.id, { sumInsured: Number(event.target.value) })} /></div><div className="field"><label htmlFor={`edit-${location.id}-flood-zone`}>Flood zone</label><select id={`edit-${location.id}-flood-zone`} value={location.floodZone} onChange={event => updateEditedLocation(location.id, { floodZone: event.target.value as InsuredLocation['floodZone'] })}><option>Low</option><option>Moderate</option><option>High</option></select></div><label className="policy-checkbox policy-sprinkler"><input type="checkbox" checked={location.sprinkler} onChange={event => updateEditedLocation(location.id, { sprinkler: event.target.checked })} /><span>Sprinkler installed</span></label></div><div className="policy-edit-coverages"><h3>Coverages</h3>{coverageTypes.map(type => { const coverage = location.coverages.find(item => item.type === type); return <div className="policy-edit-coverage" key={type}><label className="policy-checkbox"><input type="checkbox" checked={Boolean(coverage)} disabled={type === 'Fire'} onChange={event => toggleCoverage(location.id, type, event.target.checked)} /><span>{type === 'Fire' ? 'Fire coverage' : `${type} coverage`}</span></label>{coverage && <div className="form-grid"><div className="field"><label htmlFor={`edit-${location.id}-${type.replaceAll(' ', '-')}-limit`}>{type} limit</label><input id={`edit-${location.id}-${type.replaceAll(' ', '-')}-limit`} type="number" min="1" step="0.01" value={coverage.limit} required onChange={event => updateEditedCoverage(location.id, type, { limit: Number(event.target.value) })} /></div><div className="field"><label htmlFor={`edit-${location.id}-${type.replaceAll(' ', '-')}-deductible`}>{type} deductible</label><input id={`edit-${location.id}-${type.replaceAll(' ', '-')}-deductible`} type="number" min="0" step="0.01" value={coverage.deductible} required onChange={event => updateEditedCoverage(location.id, type, { deductible: Number(event.target.value) })} /></div></div>}</div>; })}</div></fieldset>)}{dialogError}</div><footer className="policy-dialog-footer"><button type="button" className="button secondary" disabled={busy} onClick={closeDialog}>Cancel</button><button type="submit" className="button primary" disabled={busy || !isBroker}>{pending === 'edit' ? 'Saving…' : 'Save changes'}</button></footer></form></DetailDialog>}
  </section>;
}

import { useEffect, useState } from 'react';
import { FileText, LogIn, Printer, RefreshCw, Search, ShieldCheck, UserRound } from 'lucide-react';
import { AGRICULTURE_ROLES, agricultureMoney, type AgricultureOverview, type AgricultureRole, type AgricultureProposal, type AgriculturePolicyDetail } from '../../shared/agriculture';
import { agricultureApi } from './api';
import { ProposalIntake } from './ProposalIntake';
import { ProposalDetail } from './ProposalDetail';
import './portal.css';

function initialRole(): AgricultureRole {
  try { const value = localStorage.getItem('agriculture-role'); return AGRICULTURE_ROLES.includes(value as AgricultureRole) ? value as AgricultureRole : 'Vermittler'; } catch { return 'Vermittler'; }
}
const tabs = [{ path: '/portal', label: 'Vorgangsübersicht' }, { path: '/portal/kunden', label: 'Kunden' }, { path: '/portal/betriebe', label: 'Betriebe & Tiere' }, { path: '/portal/direktion', label: 'Direktionsanfragen' }, { path: '/portal/policen', label: 'Verträge & Policen' }];

export function PortalApp() {
  const [path, setPath] = useState(location.pathname);
  const [role, setRole] = useState<AgricultureRole>(initialRole);
  const navigate = (destination: string) => { history.pushState({}, '', destination); setPath(destination.split('?')[0]); window.scrollTo(0, 0); };
  useEffect(() => { const changed = () => setPath(location.pathname); window.addEventListener('popstate', changed); document.title = 'Land & Tier · Versicherungsportal'; return () => window.removeEventListener('popstate', changed); }, []);
  const changeRole = (value: AgricultureRole) => { setRole(value); try { localStorage.setItem('agriculture-role', value); } catch { /* Die Rollenwahl bleibt in dieser Sitzung verfügbar. */ } };
  const proposalId = path.match(/^\/portal\/vorschlaege\/([^/]+)$/)?.[1];
  const policyId = path.match(/^\/portal\/policen\/([^/]+)$/)?.[1];
  return <div className="agriculture-portal">
    <a className="agr-skip-link" href="#portal-inhalt">Zum Inhalt</a>
    <header className="agr-header">
      <a className="agr-brand" href="/portal" onClick={event => { event.preventDefault(); navigate('/portal'); }}><span className="agr-brand-seal"><ShieldCheck size={30} strokeWidth={1.6} /></span><span><strong>LAND & TIER</strong><small>VERSICHERUNG</small></span></a>
      <div className="agr-system-title"><strong>Fachverfahren Tierversicherung</strong><span>Vertragsbearbeitung · Vermittlung · Direktion</span></div>
      <div className="agr-session"><span className="agr-demo-label">FIKTIVES DEMOSYSTEM</span><label><UserRound size={14} /><span>Benutzerrolle</span><select aria-label="Benutzerrolle" value={role} onChange={event => changeRole(event.target.value as AgricultureRole)}>{AGRICULTURE_ROLES.map(item => <option key={item}>{item}</option>)}</select></label></div>
    </header>
    <nav className="agr-navigation" aria-label="Versicherungsbereiche">{tabs.map(tab => <a key={tab.path} href={tab.path} onClick={event => { event.preventDefault(); navigate(tab.path); }} aria-current={path === tab.path || (tab.path === '/portal' && (path === '/portal/neu' || Boolean(proposalId))) || (tab.path === '/portal/policen' && Boolean(policyId)) ? 'page' : undefined}>{tab.label}</a>)}</nav>
    <main id="portal-inhalt" className="agr-main" tabIndex={-1}>
      <div className="agr-breadcrumb"><span>Tierversicherung</span><span aria-hidden="true">›</span><strong>{path === '/portal/neu' ? 'Neuer Versicherungsvorschlag' : proposalId ? 'Vorgang bearbeiten' : policyId ? 'Police bearbeiten' : tabs.find(tab => tab.path === path)?.label ?? 'Vorgangsübersicht'}</strong><span className="agr-breadcrumb-right">Tarifstand TierSchutz 1.0</span></div>
      {path === '/portal/neu' ? <ProposalIntake role={role} onNavigate={navigate} onCreated={id => navigate(`/portal/vorschlaege/${id}`)} /> : proposalId ? <ProposalDetail key={proposalId} proposalId={decodeURIComponent(proposalId)} role={role} onNavigate={navigate} /> : policyId ? <PolicyRoute key={policyId} policyId={decodeURIComponent(policyId)} role={role} onNavigate={navigate} /> : <PortalDesk key={path} section={path} role={role} onNavigate={navigate} />}
    </main>
    <footer className="agr-statusbar"><span><i /> System bereit</span><span>Arbeitsplatz {role === 'Direktion' ? 'Direktion' : role === 'Sachbearbeiter' ? 'Vertragsservice' : 'Vermittlung'}</span><span>Land & Tier · Fiktive Tierversicherung</span></footer>
  </div>;
}

function PolicyRoute({ policyId, role, onNavigate }: { policyId: string; role: AgricultureRole; onNavigate: (path: string) => void }) {
  const [proposalId, setProposalId] = useState<string | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { const controller = new AbortController(); agricultureApi<AgriculturePolicyDetail>(`/policies/${encodeURIComponent(policyId)}`, { role, signal: controller.signal }).then(result => setProposalId(result.policy.proposalId)).catch(error => { if (error.name !== 'AbortError') setError(error.message); }); return () => controller.abort(); }, [policyId, role]);
  if (error) return <div className="agr-alert" role="alert">{error}</div>;
  return proposalId ? <ProposalDetail proposalId={proposalId} role={role} onNavigate={onNavigate} /> : <div className="agr-loading" role="status">Police wird geladen …</div>;
}

function PortalDesk({ section, role, onNavigate }: { section: string; role: AgricultureRole; onNavigate: (path: string) => void }) {
  const [data, setData] = useState<AgricultureOverview | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('Alle Vorgänge');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => { const controller = new AbortController(); setError(''); agricultureApi<AgricultureOverview>('/overview', { role, signal: controller.signal }).then(setData).catch(error => { if (error.name !== 'AbortError') setError(error.message); }); return () => controller.abort(); }, [role, refresh]);
  if (!data) return <div className="agr-panel agr-loading" role={error ? 'alert' : 'status'}>{error || 'Vorgänge werden geladen …'}{error && <button className="agr-button" onClick={() => setRefresh(value => value + 1)}>Erneut versuchen</button>}</div>;
  const customerName = (id: string) => data.customers.find(item => item.id === id)?.name ?? 'Unbekannter Kunde';
  const farmName = (id: string) => data.farms.find(item => item.id === id)?.name ?? 'Unbekannter Betrieb';
  const matches = (...values: (string | undefined)[]) => !query || values.some(value => value?.toLocaleLowerCase('de').includes(query.toLocaleLowerCase('de')));
  const proposals = data.proposals.filter(item => matches(item.number, customerName(item.customerId), farmName(item.farmId)) && (status === 'Alle Vorgänge' || item.status === status)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const openReferrals = data.referrals.filter(item => item.status === 'Offen');
  const title = tabs.find(tab => tab.path === section)?.label ?? 'Vorgangsübersicht';
  const openProposal = (id: string) => onNavigate(`/portal/vorschlaege/${id}`);
  const proposalLink = (proposal: AgricultureProposal) => <a href={`/portal/vorschlaege/${proposal.id}`} onClick={event => { event.preventDefault(); openProposal(proposal.id); }}>{proposal.number}</a>;
  return <>
    <div className="agr-title-row"><div><h1>{title}</h1><p>{section === '/portal' ? 'Versicherungsvorschläge, Anträge und Verträge bearbeiten' : section === '/portal/kunden' ? 'Kundenstamm und zugeordnete Betriebe' : section === '/portal/betriebe' ? 'Betriebsstätten, Einzeltiere und Schweinebestände' : section === '/portal/direktion' ? 'Anfragen prüfen und über Annahme oder Ablehnung entscheiden' : 'Vertragsauskunft, Policenausgabe und Drucknachweise'}</p></div><button className="agr-button agr-primary" disabled={role !== 'Vermittler'} onClick={() => onNavigate('/portal/neu')}><FileText size={15} /> Neuer Versicherungsvorschlag</button></div>
    {role !== 'Vermittler' && <div className="agr-role-note">Sie arbeiten als {role}. Neue Versicherungsvorschläge erfasst die Vermittlung.</div>}
    {error && <div className="agr-alert" role="alert">{error}</div>}
    <div className="agr-summary-strip"><span><b>{data.proposals.length}</b> Vorgänge gesamt</span><span><b>{openReferrals.length}</b> offene Direktionsanfragen</span><span><b>{data.contracts.length}</b> aktive Verträge</span><span><b>{data.customers.length}</b> Kunden</span></div>
    <div className="agr-desk-layout">
      <section className="agr-panel agr-records">
        <div className="agr-panel-heading"><h2>{section === '/portal/kunden' ? 'Kundenverzeichnis' : section === '/portal/betriebe' ? 'Betriebsverzeichnis' : section === '/portal/direktion' ? 'Anfrageverzeichnis' : section === '/portal/policen' ? 'Vertragsverzeichnis' : 'Vorgangsverzeichnis'}</h2><span>{title}</span></div>
        <div className="agr-search-row"><label className="agr-search"><Search size={15} /><input aria-label="Verzeichnis durchsuchen" placeholder="Nummer, Kunde oder Betrieb suchen" value={query} onChange={event => setQuery(event.target.value)} /></label>{section === '/portal' && <select aria-label="Vorgangsstatus filtern" value={status} onChange={event => setStatus(event.target.value)}>{['Alle Vorgänge', 'Entwurf', 'Angebot', 'Direktionsprüfung', 'Freigegeben', 'Abgelehnt', 'Abgeschlossen'].map(item => <option key={item}>{item}</option>)}</select>}<button className="agr-button" aria-label="Verzeichnis aktualisieren" onClick={() => setRefresh(value => value + 1)}><RefreshCw size={14} /> Aktualisieren</button></div>
        <div className="agr-table-scroll">
          {section === '/portal/kunden' ? <table className="agr-table"><thead><tr><th>Kundennummer</th><th>Name / Anschrift</th><th>Kontakt</th><th>Betriebe</th></tr></thead><tbody>{data.customers.filter(item => matches(item.number, item.name, item.city)).map(item => <tr key={item.id} data-customer-id={item.id}><td>{item.number}</td><td><strong>{item.name}</strong><small>{item.street}, {item.postalCode} {item.city}</small></td><td>{item.email}<small>{item.phone}</small></td><td>{data.farms.filter(farm => farm.customerId === item.id).map(farm => <span key={farm.id} className="agr-inline-record">{farm.name}<small>{farm.state}</small></span>)}</td></tr>)}</tbody></table>
          : section === '/portal/betriebe' ? <table className="agr-table"><thead><tr><th>Betriebsnummer</th><th>Betrieb / Kunde</th><th>Anschrift</th><th>Art</th><th>Tiere / Bestände</th></tr></thead><tbody>{data.farms.filter(item => matches(item.number, item.name, item.state, customerName(item.customerId))).map(item => <tr key={item.id} data-farm-id={item.id}><td>{item.number}</td><td><strong>{item.name}</strong><small>{customerName(item.customerId)}</small></td><td>{item.street}<small>{item.postalCode} {item.city} · {item.state}</small></td><td>{item.farmType}</td><td>{data.animals.filter(animal => animal.farmId === item.id).map(animal => <span key={animal.id} className="agr-inline-record" data-animal-id={animal.id}>{animal.name} · {animal.species === 'Schwein' ? `${animal.animalCount} Schweine` : animal.species}<small>{agricultureMoney(animal.sumInsured)}</small></span>)}</td></tr>)}</tbody></table>
          : section === '/portal/direktion' ? <table className="agr-table"><thead><tr><th>Anfrage</th><th>Kunde / Betrieb</th><th>Grund</th><th>Status</th><th>Vorgang</th></tr></thead><tbody>{data.referrals.filter(item => matches(item.number, customerName(item.customerId), farmName(item.farmId))).map(item => <tr key={item.id} data-referral-id={item.id}><td>{item.number}</td><td><strong>{customerName(item.customerId)}</strong><small>{farmName(item.farmId)}</small></td><td>{item.reasons.join(' ')}</td><td><span className={`agr-state ${item.status === 'Offen' ? 'agr-state-review' : ''}`}>{item.status}</span></td><td><button className="agr-text-button" onClick={() => openProposal(item.proposalId)}>Anfrage öffnen</button></td></tr>)}</tbody></table>
          : section === '/portal/policen' ? <table className="agr-table"><thead><tr><th>Vertragsnummer</th><th>Kunde / Produkt</th><th>Betrieb</th><th>Jahresbeitrag</th><th>Police</th></tr></thead><tbody>{data.contracts.filter(item => matches(item.number, customerName(item.customerId), farmName(item.farmId))).map(item => <tr key={item.id} data-contract-id={item.id}><td>{item.number}</td><td><strong>{customerName(item.customerId)}</strong><small>{item.product}</small></td><td>{farmName(item.farmId)}</td><td className="agr-numeric">{agricultureMoney(item.annualPremium)}</td><td><button className="agr-text-button" onClick={() => onNavigate(`/portal/policen/${item.policyId}`)}><Printer size={13} /> Police öffnen</button></td></tr>)}</tbody></table>
          : <table className="agr-table"><thead><tr><th>Vorschlagsnummer</th><th>Kunde / Betrieb</th><th>Versichertes Risiko</th><th>Status</th><th className="agr-numeric">Summe</th><th className="agr-numeric">Jahresbeitrag</th></tr></thead><tbody>{proposals.map(item => <tr key={item.id} data-proposal-id={item.id}><td>{proposalLink(item)}<small>{formatDate(item.createdAt)}</small></td><td><strong>{customerName(item.customerId)}</strong><small>{farmName(item.farmId)}</small></td><td>{data.animals.filter(animal => item.animalIds.includes(animal.id)).map(animal => animal.name).join(', ')}<small>{item.product}</small></td><td><span className={`agr-state ${item.status === 'Direktionsprüfung' ? 'agr-state-review' : item.status === 'Abgeschlossen' || item.status === 'Freigegeben' ? 'agr-state-approved' : ''}`}>{item.status}</span></td><td className="agr-numeric">{agricultureMoney(item.totalSumInsured)}</td><td className="agr-numeric">{item.annualPremium === null ? 'Noch offen' : agricultureMoney(item.annualPremium)}</td></tr>)}</tbody></table>}
        </div>
        {section === '/portal' && proposals.length === 0 && <div className="agr-empty">Keine Vorgänge für diese Suche gefunden.</div>}
        <div className="agr-table-footer">Die Auswahl eines Vorgangs öffnet seine Bearbeitung und Nachweise.</div>
      </section>
      <aside className="agr-desk-aside">
        <section className="agr-panel"><div className="agr-panel-heading"><h2>Arbeitsvorrat</h2><span>{openReferrals.length} offen</span></div>{openReferrals.length ? openReferrals.slice(0, 3).map(referral => <button key={referral.id} className="agr-work-item" onClick={() => openProposal(referral.proposalId)}><b>{referral.number}</b><span>{customerName(referral.customerId)}</span><small>{referral.reasons[0]}</small><em>Vorgang öffnen ›</em></button>) : <p className="agr-panel-copy">Keine offenen Direktionsanfragen.</p>}</section>
        <section className="agr-panel"><div className="agr-panel-heading"><h2>Tarifhinweise</h2><span>TierSchutz 1.0</span></div><div className="agr-panel-copy"><strong>Annahmegrenzen</strong><dl className="agr-rate-list"><dt>Kuh / Rind</dt><dd>10.000 EUR</dd><dt>Pferd</dt><dd>50.000 EUR</dd><dt>Hund</dt><dd>10.000 EUR</dd><dt>Schweinebestand</dt><dd>500.000 EUR</dd></dl><p>Oberhalb dieser Summen entscheidet die Direktion. Vorerkrankungen bei Pferden und ungeklärte Biosicherheit bei Schweinen sind ebenfalls vorzulegen.</p><small>Fiktive Regeln für die Tierversicherung. Der Standort Bayern ändert die Annahmegrenze nicht.</small></div></section>
        <div className="agr-aside-note"><LogIn size={15} /><span>Für Policenausgabe und Druck wechseln Sie zur Rolle Sachbearbeiter.</span></div>
      </aside>
    </div>
  </>;
}
function formatDate(value: string) { return new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(value)); }

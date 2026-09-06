import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowRight, ArrowUpRight, Building2, Check, CircleHelp, FileCheck2, FileText, MapPin, Plus, Search, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import type { Customer, Policy, Role } from '../../shared/insurance';
import { api } from '../lib/api';

const money = (amount: number) => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(amount);
const compactMoney = (amount: number) => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 1, notation: 'compact' }).format(amount);
const date = (value: string) => new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export function InsuranceDesk({ role, onNavigate }: { role: Role; onNavigate: (path: string) => void }) {
  const [data, setData] = useState<{ policies: Policy[]; customers: Customer[] } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'policies' | 'referrals'>('policies');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('All statuses');
  const [source, setSource] = useState('All records');
  const load = () => {
    setLoading(true); setError('');
    api<{ policies: Policy[]; customers: Customer[] }>('/insurance/policies')
      .then(setData).catch(error => setError(error.message)).finally(() => setLoading(false));
  };
  useEffect(load, []);
  const customers = useMemo(() => new Map(data?.customers.map(customer => [customer.id, customer]) || []), [data]);
  const allPolicies = data?.policies || [];
  const referrals = allPolicies.filter(policy => policy.status === 'Referred');
  const issued = allPolicies.filter(policy => policy.status === 'Issued');
  const annualPremium = issued.reduce((total, policy) => total + (policy.premium?.annual || 0), 0);
  const filtered = allPolicies.filter(policy => {
    const customer = customers.get(policy.customerId);
    const match = `${customer?.name || ''} ${policy.policyNumber} ${policy.id} ${policy.runId || ''}`.toLowerCase().includes(search.toLowerCase());
    return match && (tab !== 'referrals' || policy.status === 'Referred') && (status === 'All statuses' || policy.status === status) && (source === 'All records' || (source === 'Scenario runs' ? policy.source === 'run' : policy.source !== 'run'));
  }).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

  return <div className="insurance-desk">
    <header className="desk-heading"><div><div className="eyebrow">MERIDIAN COMMERCIAL PROPERTY</div><h1>Insurance desk</h1><p>From first draft to an issued policy. Every decision in one place.</p></div><button className="button primary" disabled={role !== 'Broker'} title={role !== 'Broker' ? 'Switch to Broker to create a policy' : undefined} onClick={() => onNavigate('/insurance/new')}><Plus size={16} />New policy</button></header>
    <div className="desk-metrics" aria-label="Portfolio summary">
      <div className="desk-metric"><div className="metric-label"><FileText size={15} /><span>Total policies</span></div><strong>{loading && !data ? '—' : allPolicies.length.toString().padStart(2, '0')}</strong><span>Across your workspace</span></div>
      <div className="desk-metric"><div className="metric-label"><FileCheck2 size={15} /><span>In force</span></div><strong>{loading && !data ? '—' : issued.length.toString().padStart(2, '0')}</strong><span className="metric-green"><Check size={12} />Issued and protected</span></div>
      <div className="desk-metric"><div className="metric-label"><ShieldCheck size={15} /><span>Awaiting review</span></div><strong>{loading && !data ? '—' : referrals.length.toString().padStart(2, '0')}{referrals.length > 0 && <span className="metric-attention">Needs attention</span>}</strong><span>Senior underwriting referrals</span></div>
      <div className="desk-metric"><div className="metric-label"><ArrowUpRight size={15} /><span>Annual premium</span></div><strong>{loading && !data ? '—' : money(annualPremium)}</strong><span>Current issued business</span></div>
    </div>
    <div className="desk-tabs"><button className={tab === 'policies' ? 'selected' : ''} onClick={() => setTab('policies')}>Policies <span>{allPolicies.length}</span></button><button className={tab === 'referrals' ? 'selected' : ''} onClick={() => { setTab('referrals'); setStatus('All statuses'); }}>Underwriting queue <span className={referrals.length ? 'attention-count' : ''}>{referrals.length}</span></button></div>
    {tab === 'referrals' && <div className="queue-explanation"><ShieldCheck size={19} /><div><strong>{role === 'Senior underwriter' ? 'Ready for your review' : 'Senior underwriting review'}</strong><p>Flood limits above €500,000 per location need a suitable risk survey and senior approval.</p></div></div>}
    <div className="desk-table-panel">
      <div className="desk-table-toolbar"><div className="desk-search"><Search size={16} /><input aria-label="Search policies" placeholder="Search customer, policy or run…" value={search} onChange={event => setSearch(event.target.value)} /></div><div className="desk-filters"><SlidersHorizontal size={14} /><select aria-label="Filter policy status" value={status} onChange={event => setStatus(event.target.value)} disabled={tab === 'referrals'}>{['All statuses', 'Draft', 'Quoted', 'Referred', 'Approved', 'Issued'].map(value => <option key={value}>{value}</option>)}</select><select aria-label="Filter policy source" value={source} onChange={event => setSource(event.target.value)}>{['All records', 'Manual business', 'Scenario runs'].map(value => <option key={value}>{value}</option>)}</select></div></div>
      {error ? <div className="desk-empty"><div className="error-message" role="alert">{error}</div><button className="button secondary" onClick={load}>Try again</button></div>
        : loading && !data ? <div className="desk-empty" role="status"><div className="loading-dot" /><p>Loading your policies…</p></div>
          : filtered.length === 0 ? <div className="desk-empty"><FileText size={30} strokeWidth={1.2} /><h2>{search || status !== 'All statuses' || source !== 'All records' ? 'No matching policies' : tab === 'referrals' ? 'The review queue is clear' : 'Your first policy starts here'}</h2><p>{search || status !== 'All statuses' || source !== 'All records' ? 'Try a different customer, status or source.' : tab === 'referrals' ? 'New referrals will appear here for a senior underwriter.' : 'Set up a customer and build their commercial property cover.'}</p>{tab === 'policies' && !search && <button className="button secondary" onClick={() => onNavigate('/insurance/new')}>New policy</button>}</div>
            : <div className="desk-table-scroll"><table className="policy-table"><thead><tr><th scope="col">Customer & policy <ArrowDown size={12} /></th><th scope="col">Locations</th><th scope="col" className="number-column">Sum insured</th><th scope="col" className="number-column">Annual premium</th><th scope="col">Status</th><th scope="col" aria-label="Open policy" /></tr></thead><tbody>{filtered.map(policy => {
              const customer = customers.get(policy.customerId);
              return <tr key={policy.id} data-testid={`policy-row-${policy.id}`}>
                <td><a href={`/insurance/policies/${policy.id}`} className="policy-customer-link" onClick={event => { event.preventDefault(); onNavigate(`/insurance/policies/${policy.id}`); }}><span className={`customer-monogram ${policy.source === 'run' ? 'run-monogram' : ''}`}>{(customer?.name || 'Unknown').split(' ').slice(0, 2).map(part => part[0]).join('')}</span><span><strong>{customer?.name || policy.customerId}</strong><small>{policy.policyNumber}<span className="cell-dot">·</span>{policy.source === 'run' ? <span className="source-label">Scenario run</span> : 'Commercial property'}</small></span></a></td>
                <td><div className="location-count"><MapPin size={13} /><span>{policy.locations.length} locations</span></div><small className="table-secondary">{[...new Set(policy.locations.map(location => location.country === 'DE' ? 'Germany' : 'Italy'))].join(', ')}</small></td>
                <td className="number-column"><strong className="table-value">{compactMoney(policy.locations.reduce((total, location) => total + location.sumInsured, 0))}</strong><small className="table-secondary">EUR · v{policy.version}</small></td>
                <td className="number-column"><strong className="table-value">{policy.premium ? money(policy.premium.annual) : '—'}</strong><small className="table-secondary">{policy.premium ? 'per year' : 'Not yet quoted'}</small></td>
                <td><span className={`policy-badge status-${policy.status.toLowerCase()}`}><i />{policy.status}</span><small className="table-secondary">{date(policy.updatedAt)}</small></td>
                <td><button className="icon-button" aria-label={`Open ${policy.policyNumber}`} onClick={() => onNavigate(`/insurance/policies/${policy.id}`)}><ArrowRight size={16} /></button></td>
              </tr>;
            })}</tbody></table></div>}
      <div className="table-footer"><span>{filtered.length} {filtered.length === 1 ? 'policy' : 'policies'}{filtered.length !== allPolicies.length ? ` of ${allPolicies.length}` : ''}</span><span><span className="status-dot" />Saved locally</span></div>
    </div>
    <footer className="insurance-disclaimer"><Building2 size={14} /><span>Meridian Commercial Property · Demo product v3</span><span className="desk-help"><CircleHelp size={13} />All customers and product rules are fictional.</span></footer>
  </div>;
}

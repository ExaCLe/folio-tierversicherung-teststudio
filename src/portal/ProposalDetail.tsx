import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { agricultureMoney, AGRICULTURE_RULES, type AgricultureAnimal, type AgricultureRole, type PolicyDocument, type ProposalDetail as ProposalDetailData } from '../../shared/agriculture';
import { AgricultureApiError, agricultureApi } from './api';
import './detail.css';

type Props = { proposalId: string; role: AgricultureRole; onNavigate: (path: string) => void };
type DetailTab = 'daten' | 'dokument' | 'verlauf';
const tabs: { id: DetailTab; label: string }[] = [
  { id: 'daten', label: 'Vertragsdaten und Tiere' },
  { id: 'dokument', label: 'Policendokument' },
  { id: 'verlauf', label: 'Bearbeitungsverlauf' },
];
const date = (value: string) => new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(value.includes('T') ? value : `${value}T12:00:00`));
const dateTime = (value: string) => new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(value));
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Die Anfrage konnte nicht verarbeitet werden. Bitte erneut versuchen.';

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return <div className="agr-detail-fact"><dt>{label}</dt><dd>{children}</dd></div>;
}

function Reference({ label, id }: { label: string; id: string }) {
  return <div className="agr-detail-reference"><span>{label}</span><code>{id}</code></div>;
}

function Proof({ label, children }: { label: string; children: ReactNode }) {
  return <details className="agr-detail-proof"><summary>{label}</summary><div>{children}</div></details>;
}

function AnimalData({ animal }: { animal: AgricultureAnimal }) {
  return <article className="agr-detail-animal" data-animal-id={animal.id}>
    <header><h3>{animal.name}</h3><span>{animal.species === 'Schwein' ? 'Schweinebestand' : animal.species} · {animal.number}</span></header>
    <dl className="agr-detail-facts">
      <Fact label="Versicherungssumme">{agricultureMoney(animal.sumInsured)}</Fact>
      {animal.species === 'Schwein' ? <>
        <Fact label="Anzahl Schweine">{animal.animalCount}</Fact>
        <Fact label="Haltungsform">{animal.housing}</Fact>
        <Fact label="Biosicherheit">{animal.biosecurity}</Fact>
      </> : <>
        <Fact label={animal.species === 'Rind' ? 'Ohrmarke' : 'Chipnummer'}>{animal.species === 'Rind' ? animal.earTag : animal.chipNumber}</Fact>
        <Fact label="Rasse">{animal.breed}</Fact>
        <Fact label="Geburtsdatum">{date(animal.birthDate)}</Fact>
        <Fact label="Nutzung">{animal.use}</Fact>
        {animal.species === 'Pferd' && <>
          <Fact label="Gesundheitszustand">{animal.health}</Fact>
          <Fact label="Gesundheitsangaben">{animal.healthNotes || 'Keine weiteren Angaben'}</Fact>
        </>}
      </>}
    </dl>
    <Proof label={animal.species === 'Schwein' ? 'Bestandsnachweis' : 'Tiernachweis'}><Reference label={animal.species === 'Schwein' ? 'Bestands-ID' : 'Tier-ID'} id={animal.id} /></Proof>
  </article>;
}

export function ProposalDetail({ proposalId, role, onNavigate }: Props) {
  const [data, setData] = useState<ProposalDetailData | null>(null);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [refreshRequired, setRefreshRequired] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [tab, setTab] = useState<DetailTab>('daten');
  const [decision, setDecision] = useState<'Freigeben' | 'Ablehnen'>('Freigeben');
  const [decisionReason, setDecisionReason] = useState('');
  const [reissueReason, setReissueReason] = useState('');
  const [selectedDocumentId, setSelectedDocumentId] = useState('');
  const [loadedDocumentId, setLoadedDocumentId] = useState('');
  const tabPrefix = useId();
  const frame = useRef<HTMLIFrameElement>(null);
  const activeProposal = useRef(proposalId);
  const mutationLock = useRef(false);
  const mounted = useRef(true);
  activeProposal.current = proposalId;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setLoadError('');
    setActionError('');
    setNotice('');
    setRefreshRequired(false);
    setTab('daten');
    setDecision('Freigeben');
    setDecisionReason('');
    setReissueReason('');
    setSelectedDocumentId('');
    setLoadedDocumentId('');
    agricultureApi<ProposalDetailData>(`/proposals/${encodeURIComponent(proposalId)}`, { signal: controller.signal })
      .then(next => {
        if (controller.signal.aborted) return;
        setData(next);
        if (next.policy) setTab('dokument');
      })
      .catch(error => { if (!controller.signal.aborted) setLoadError(errorText(error)); });
    return () => controller.abort();
  }, [proposalId, reloadKey]);

  const busy = pending !== null || refreshRequired;
  const documents = data ? [...data.documents].sort((a, b) => b.version - a.version) : [];
  const selectedDocument = documents.find(item => item.id === selectedDocumentId)
    ?? documents.find(item => item.id === data?.policy?.documentId)
    ?? documents[0];
  const printEvents = data ? [...data.printEvents].sort((a, b) => b.at.localeCompare(a.at)) : [];
  const latestPrint = printEvents[0];
  const selectedDocumentHasPrint = printEvents.some(event => event.documentId === selectedDocument?.id && event.documentSha256 === selectedDocument.sha256);

  async function mutate(path: string, body: object, pendingText: string, successText: string, after?: (next: ProposalDetailData) => void) {
    if (mutationLock.current || refreshRequired) return;
    mutationLock.current = true;
    const requestProposal = proposalId;
    setPending(pendingText);
    setActionError('');
    setNotice('');
    let saved = false;
    try {
      await agricultureApi(path, { role, method: 'POST', body: JSON.stringify(body) });
      saved = true;
      const next = await agricultureApi<ProposalDetailData>(`/proposals/${encodeURIComponent(requestProposal)}`, { role });
      if (!mounted.current || activeProposal.current !== requestProposal) return;
      setData(next);
      setNotice(successText);
      after?.(next);
    } catch (error) {
      if (mounted.current && activeProposal.current === requestProposal) {
        const uncertain = error instanceof AgricultureApiError && error.status === 0;
        setRefreshRequired(saved || uncertain);
        setActionError(saved
          ? 'Die Aktion wurde gespeichert. Die aktualisierte Ansicht konnte nicht geladen werden. Bitte den Vorgang neu laden, bevor Sie die Aktion erneut ausführen.'
          : uncertain ? 'Die Verbindung wurde unterbrochen. Ob die Aktion gespeichert wurde, ist noch unklar. Bitte laden Sie den Vorgang neu.' : errorText(error));
      }
    } finally {
      mutationLock.current = false;
      if (mounted.current) setPending(null);
    }
  }

  function submitDecision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data?.referral || role !== 'Direktion' || !decisionReason.trim()) return;
    void mutate(`/referrals/${encodeURIComponent(data.referral.id)}/decision`, { decision, reason: decisionReason.trim() }, 'Entscheidung wird gespeichert …', decision === 'Freigeben' ? 'Die Direktion hat den Antrag freigegeben.' : 'Die Direktion hat den Antrag abgelehnt.', () => setDecisionReason(''));
  }

  function reissue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data?.policy || role !== 'Sachbearbeiter' || !reissueReason.trim()) return;
    void mutate(`/policies/${encodeURIComponent(data.policy.id)}/reissue`, { reason: reissueReason.trim() }, 'Police wird erneut ausgegeben …', 'Die Police wurde als neue Dokumentversion ausgegeben. Die vorherigen Fassungen bleiben erhalten.', next => {
      setReissueReason('');
      setSelectedDocumentId(next.policy?.documentId ?? '');
      setLoadedDocumentId('');
      setTab('dokument');
    });
  }

  function printPolicy() {
    if (!data?.policy || !selectedDocument || role !== 'Sachbearbeiter') return;
    void mutate(`/policies/${encodeURIComponent(data.policy.id)}/print`, { documentId: selectedDocument.id }, 'Druckauftrag wird erfasst …', `Der Druckauftrag für Dokumentversion ${selectedDocument.version} wurde erfasst.`, () => setTab('dokument'));
  }

  function openBrowserPrint() {
    const target = frame.current?.contentWindow;
    if (!target || role !== 'Sachbearbeiter' || !selectedDocumentHasPrint || loadedDocumentId !== selectedDocument?.id) return;
    try {
      target.focus();
      target.print();
    } catch {
      setActionError('Der Browserdruck konnte nicht geöffnet werden. Öffnen Sie das Dokument und nutzen Sie die Druckfunktion Ihres Browsers.');
    }
  }

  function moveTab(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const available = tabs.filter(item => item.id !== 'dokument' || data?.policy);
    let nextIndex: number;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % available.length;
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + available.length) % available.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = available.length - 1;
    else return;
    event.preventDefault();
    setTab(available[nextIndex].id);
    document.getElementById(`${tabPrefix}-${available[nextIndex].id}-tab`)?.focus();
  }

  if (!data) return <div className="agr-detail">
    <button className="agr-button" type="button" onClick={() => onNavigate('/portal')}>Zur Vorgangsübersicht</button>
    {loadError ? <div className="agr-alert agr-detail-load-error" role="alert"><p>{loadError}</p><button className="agr-button" type="button" onClick={() => setReloadKey(value => value + 1)}>Erneut laden</button></div>
      : <div className="agr-panel agr-detail-loading" role="status">Versicherungsvorschlag wird geladen …</div>}
  </div>;

  const { proposal, customer, farm, animals, referral, contract, policy } = data;
  const canMediate = role === 'Vermittler';
  const canDecide = role === 'Direktion';
  const canManage = role === 'Sachbearbeiter';
  const isReferred = proposal.status === 'Direktionsprüfung';
  const availableTabs = tabs.filter(item => item.id !== 'dokument' || policy);

  return <div className="agr-detail" data-proposal-id={proposal.id}>
    <div className="agr-detail-toolbar">
      <button className="agr-button" type="button" onClick={() => onNavigate('/portal')}>‹ Vorgangsübersicht</button>
      <span className="agr-muted">Erfasst am {dateTime(proposal.createdAt)}</span>
    </div>
    <header className="agr-detail-heading">
      <div><p className="agr-detail-caption">{proposal.product}</p><h1>Versicherungsvorschlag <span data-testid="proposal-number">{proposal.number}</span></h1></div>
      <span className="agr-detail-status" data-status={proposal.status} data-testid="proposal-status">{proposal.status}</span>
    </header>
    <Proof label="Vorschlagsnachweis"><Reference label="Vorschlags-ID" id={proposal.id} /></Proof>

    <div className="agr-detail-parties">
      <section className="agr-panel" aria-label="Kunde des Vorschlags" data-customer-id={customer.id}>
        <h2 className="agr-panel-heading">Kunde <span>{customer.number}</span></h2>
        <div className="agr-detail-panel-body"><strong>{customer.name}</strong><p>{customer.street}<br />{customer.postalCode} {customer.city}</p><p>{customer.email}<br />{customer.phone}</p><Proof label="Kundennachweis"><Reference label="Kunden-ID" id={customer.id} /></Proof></div>
      </section>
      <section className="agr-panel" aria-label="Versicherter Betrieb" data-farm-id={farm.id}>
        <h2 className="agr-panel-heading">Betrieb <span>{farm.number}</span></h2>
        <div className="agr-detail-panel-body"><strong>{farm.name}</strong><p>{farm.street}<br />{farm.postalCode} {farm.city}, {farm.state}</p><p>{farm.farmType}</p><Proof label="Betriebsnachweis"><Reference label="Betriebs-ID" id={farm.id} /></Proof></div>
      </section>
      <section className="agr-panel" aria-label="Angebot und Beitrag">
        <h2 className="agr-panel-heading">Angebot und Beitrag</h2>
        <div className="agr-detail-panel-body">
          <dl className="agr-detail-financial">
            <Fact label="Versicherungssumme gesamt">{agricultureMoney(proposal.totalSumInsured)}</Fact>
            <Fact label="Jahresbeitrag">{proposal.annualPremium === null ? 'Noch nicht berechnet' : agricultureMoney(proposal.annualPremium)}</Fact>
            <Fact label="Versicherungsbeginn">{date(proposal.startDate)}</Fact>
            <Fact label="Laufzeit">{proposal.durationMonths} Monate</Fact>
          </dl>
        </div>
      </section>
    </div>

    <div className="agr-detail-feedback" aria-live="polite" aria-atomic="true">
      {pending && <p className="agr-detail-message">{pending}</p>}
      {notice && <p className="agr-detail-message agr-detail-success">{notice}</p>}
    </div>
    {actionError && <div className="agr-alert agr-detail-load-error" role="alert"><p>{actionError}</p><button className="agr-button" type="button" disabled={pending !== null} onClick={() => setReloadKey(value => value + 1)}>Vorgang neu laden</button></div>}

    {referral && <section className="agr-panel agr-detail-referral" aria-label="Direktionsanfrage" data-referral-id={referral.id}>
      <h2 className="agr-panel-heading">Direktionsanfrage <span data-testid="referral-number">{referral.number}</span><span>{referral.status}</span></h2>
      <div className="agr-detail-panel-body">
        <ul className="agr-detail-reasons">{referral.reasons.map((reason, index) => <li key={`${index}-${reason}`}>{reason}</li>)}</ul>
        <Proof label="Anfragenachweis"><Reference label="Anfrage-ID" id={referral.id} /></Proof>
        {referral.decision && <p className="agr-detail-decision"><strong>Entscheidung: {referral.decision === 'Freigeben' ? 'Freigegeben' : 'Abgelehnt'}</strong><br />{referral.decisionReason}<br /><span className="agr-muted">{referral.decidedBy}{referral.decidedAt ? ` am ${dateTime(referral.decidedAt)}` : ''}</span></p>}
      </div>
    </section>}

    {proposal.status !== 'Abgeschlossen' && <section className="agr-panel agr-detail-action-panel" aria-label="Vorgang bearbeiten" aria-busy={pending !== null}>
      <h2 className="agr-panel-heading">Nächster Bearbeitungsschritt</h2>
      <div className="agr-detail-panel-body">
        {proposal.status === 'Entwurf' && <div className="agr-detail-action-row"><div><strong>Angebot erstellen</strong><p>Berechnen Sie den Jahresbeitrag auf Grundlage der erfassten Tiere und Versicherungssummen.</p>{!canMediate && <p className="agr-detail-role-hint">Für diesen Schritt ist die Benutzerrolle Vermittler erforderlich.</p>}</div><button className="agr-button agr-primary" type="button" disabled={busy || !canMediate} onClick={() => void mutate(`/proposals/${encodeURIComponent(proposal.id)}/offer`, {}, 'Angebot wird berechnet …', 'Das Angebot wurde berechnet.')}>Angebot berechnen</button></div>}
        {proposal.status === 'Angebot' && <>
          {proposal.referralReasons.length > 0 && <div className="agr-alert agr-detail-referral-notice"><strong>Eine Entscheidung der Direktion ist erforderlich.</strong><ul>{proposal.referralReasons.map((reason, index) => <li key={`${index}-${reason}`}>{reason}</li>)}</ul></div>}
          <div className="agr-detail-action-row"><div><strong>Antrag zur Prüfung einreichen</strong><p>{proposal.referralReasons.length ? 'Beim Einreichen wird die Direktionsanfrage angelegt.' : 'Der Antrag erfüllt die Annahmeregeln und kann nach dem Einreichen abgeschlossen werden.'}</p>{!canMediate && <p className="agr-detail-role-hint">Für diesen Schritt ist die Benutzerrolle Vermittler erforderlich.</p>}</div><button className="agr-button agr-primary" type="button" disabled={busy || !canMediate} onClick={() => void mutate(`/proposals/${encodeURIComponent(proposal.id)}/submit`, {}, 'Antrag wird eingereicht …', 'Der Antrag wurde eingereicht.')}>Antrag einreichen</button></div>
        </>}
        {isReferred && <form className="agr-detail-decision-form" onSubmit={submitDecision}>
          <p>Die Direktion prüft die Anfrage und begründet ihre Entscheidung. Bis zur Freigabe ist kein Vertragsabschluss möglich.</p>
          {!canDecide && <p className="agr-detail-role-hint">Für die Entscheidung ist die Benutzerrolle Direktion erforderlich.</p>}
          <div className="agr-form-grid agr-detail-decision-fields">
            <label className="agr-field">Entscheidung<select aria-label="Entscheidung" value={decision} onChange={event => setDecision(event.target.value as 'Freigeben' | 'Ablehnen')} disabled={busy || !canDecide}><option value="Freigeben">Freigeben</option><option value="Ablehnen">Ablehnen</option></select></label>
            <label className="agr-field">Begründung der Entscheidung<textarea aria-label="Begründung der Entscheidung" required maxLength={2000} rows={3} value={decisionReason} onChange={event => setDecisionReason(event.target.value)} disabled={busy || !canDecide} /></label>
          </div>
          <button className="agr-button agr-primary" type="submit" disabled={busy || !canDecide || !decisionReason.trim()}>Entscheidung speichern</button>
        </form>}
        {proposal.status === 'Freigegeben' && <div className="agr-detail-action-row"><div><strong>Der Antrag ist freigegeben.</strong><p>Beim Abschluss werden der Vertrag und die erste Policenversion erstellt.</p>{!canMediate && <p className="agr-detail-role-hint">Für den Abschluss ist die Benutzerrolle Vermittler erforderlich.</p>}</div><button className="agr-button agr-primary" type="button" disabled={busy || !canMediate} onClick={() => void mutate(`/proposals/${encodeURIComponent(proposal.id)}/complete`, {}, 'Vertrag wird abgeschlossen …', 'Der Vertrag wurde abgeschlossen. Die erste Policenversion ist verfügbar.', next => { setSelectedDocumentId(next.policy?.documentId ?? ''); setTab('dokument'); })}>Vertrag abschließen</button></div>}
        {proposal.status === 'Abgelehnt' && <div><strong>Der Antrag wurde abgelehnt.</strong><p>Für diesen Vorschlag kann kein Vertrag abgeschlossen werden. Die Begründung steht in der Direktionsanfrage.</p></div>}
      </div>
    </section>}

    {contract && <section className="agr-panel agr-detail-contract" aria-label="Abgeschlossener Vertrag" data-contract-id={contract.id}>
      <h2 className="agr-panel-heading">Vertrag <span data-testid="contract-number">{contract.number}</span><span>{contract.status}</span></h2>
      <div className="agr-detail-panel-body">
        <dl className="agr-detail-facts"><Fact label="Versicherungszeitraum">{date(contract.startDate)} bis {date(contract.endDate)}</Fact><Fact label="Jahresbeitrag">{agricultureMoney(contract.annualPremium)}</Fact><Fact label="Vertragsabschluss">{dateTime(contract.createdAt)}</Fact></dl>
        <Proof label="Vertragsnachweis"><Reference label="Vertrags-ID" id={contract.id} /></Proof>
      </div>
    </section>}

    {policy && <section className="agr-panel agr-detail-policy" aria-label="Police und Druckaufträge" data-policy-id={policy.id} aria-busy={pending !== null}>
      <h2 className="agr-panel-heading">Police <span data-testid="policy-number">{policy.number}</span><span>Aktuelle Ausgabe {policy.version}</span></h2>
      <div className="agr-detail-panel-body">
        <Proof label="Policennachweis"><Reference label="Policen-ID" id={policy.id} /></Proof>
        {!canManage && <p className="agr-detail-role-hint">Erneute Ausgabe und Druckauftrag erfordern die Benutzerrolle Sachbearbeiter.</p>}
        <div className="agr-detail-policy-actions">
          <form onSubmit={reissue} className="agr-detail-reissue-form">
            <label className="agr-field">Grund der erneuten Ausgabe<textarea aria-label="Grund der erneuten Ausgabe" required maxLength={2000} rows={2} value={reissueReason} onChange={event => setReissueReason(event.target.value)} disabled={busy || !canManage} /></label>
            <button className="agr-button" type="submit" disabled={busy || !canManage || !reissueReason.trim()}>Police erneut ausgeben</button>
          </form>
          <div className="agr-detail-print-action">
            <label className="agr-field">Dokumentversion<select aria-label="Dokumentversion" value={selectedDocument?.id ?? ''} onChange={event => { setSelectedDocumentId(event.target.value); setLoadedDocumentId(''); }} disabled={busy || !documents.length}>{documents.map(item => <option key={item.id} value={item.id}>Version {item.version} · {dateTime(item.createdAt)}{item.id === policy.documentId ? ' · Aktuelle Ausgabe' : ''}</option>)}</select></label>
            <p>Der Druckauftrag wird für die ausgewählte Dokumentversion gespeichert. Ein physischer Ausdruck wird damit nicht bestätigt.</p>
            <button className="agr-button agr-primary" type="button" disabled={busy || !canManage || !selectedDocument} onClick={printPolicy}>Police drucken</button>
          </div>
        </div>
        {selectedDocument && <div className="agr-detail-document-record" data-document-id={selectedDocument.id}>
          <div className="agr-detail-document-record-title"><strong>Ausgewähltes Policendokument</strong><span>Version <span data-testid="document-version">{selectedDocument.version}</span></span></div>
          <p className="agr-muted">Ausgegeben von {selectedDocument.createdBy} am {dateTime(selectedDocument.createdAt)} · Grund: {selectedDocument.reason}</p>
          <Proof label="Dokumentnachweis und Prüfsumme"><Reference label="Dokument-ID" id={selectedDocument.id} /><Reference label="Prüfsumme SHA-256" id={selectedDocument.sha256} /></Proof>
        </div>}
        {latestPrint && <div className="agr-detail-print-confirmation" data-testid="print-confirmation" role="status">
          <strong>Druckauftrag erfasst</strong><p>{dateTime(latestPrint.at)} · {latestPrint.role} · Dokumentversion {documents.find(item => item.id === latestPrint.documentId)?.version ?? 'unbekannt'}</p>
          <Proof label="Drucknachweis und Dokumentzuordnung"><Reference label="Druckauftrags-ID" id={latestPrint.id} /><Reference label="Dokument-ID" id={latestPrint.documentId} /><Reference label="Prüfsumme SHA-256" id={latestPrint.documentSha256} /></Proof>
        </div>}
      </div>
    </section>}

    <div className="agr-detail-tabs" role="tablist" aria-label="Vorgangsdetails">{availableTabs.map((item, index) => <button type="button" role="tab" key={item.id} id={`${tabPrefix}-${item.id}-tab`} aria-controls={`${tabPrefix}-${item.id}-panel`} aria-selected={tab === item.id} tabIndex={tab === item.id ? 0 : -1} onClick={() => setTab(item.id)} onKeyDown={event => moveTab(event, index)}>{item.label}</button>)}</div>

    {tab === 'daten' && <section className="agr-panel agr-detail-tab-panel" role="tabpanel" tabIndex={0} id={`${tabPrefix}-daten-panel`} aria-labelledby={`${tabPrefix}-daten-tab`}>
      <h2 className="agr-panel-heading">Versicherte Tiere und Bestände <span>{animals.length} {animals.length === 1 ? 'Eintrag' : 'Einträge'}</span></h2>
      <div className="agr-detail-panel-body agr-detail-animals">{animals.map(animal => <AnimalData key={animal.id} animal={animal} />)}</div>
      <div className="agr-detail-rule-note"><strong>Beitragsgrundlage {AGRICULTURE_RULES.version}</strong><p>Rind 3,5 %, Pferd 4 %, Hund 5 %, Schweinebestand 1,8 % der Versicherungssumme pro Jahr. Mindestbeitrag je Vorschlag 60 EUR. Alle Regeln und Beträge sind fiktiv.</p></div>
    </section>}

    {tab === 'dokument' && selectedDocument && <section className="agr-panel agr-detail-tab-panel" role="tabpanel" tabIndex={0} id={`${tabPrefix}-dokument-panel`} aria-labelledby={`${tabPrefix}-dokument-tab`}>
      <h2 className="agr-panel-heading">Dokumentvorschau <span>Version {selectedDocument.version}</span></h2>
      <div className="agr-detail-preview-tools"><div className="agr-detail-preview-title"><p>{selectedDocument.title}</p>{!selectedDocumentHasPrint && <p className="agr-muted">Zuerst „Police drucken“, um den Druckauftrag zu erfassen.</p>}</div><div><a className="agr-button" href={`/api/agriculture/documents/${encodeURIComponent(selectedDocument.id)}/html`} target="_blank" rel="noreferrer">Dokument öffnen</a><button className="agr-button" type="button" disabled={busy || !canManage || !selectedDocumentHasPrint || loadedDocumentId !== selectedDocument.id} onClick={openBrowserPrint}>Browserdruck öffnen</button></div></div>
      <iframe ref={frame} key={selectedDocument.id} title={`Policenvorschau ${policy?.number ?? ''}, Version ${selectedDocument.version}`} className="agr-detail-document-frame" src={`/api/agriculture/documents/${encodeURIComponent(selectedDocument.id)}/html`} onLoad={() => setLoadedDocumentId(selectedDocument.id)} />
    </section>}

    {tab === 'verlauf' && <section className="agr-panel agr-detail-tab-panel" role="tabpanel" tabIndex={0} id={`${tabPrefix}-verlauf-panel`} aria-labelledby={`${tabPrefix}-verlauf-tab`}>
      <h2 className="agr-panel-heading">Bearbeitungsverlauf</h2>
      <div className="agr-detail-table-scroll"><table className="agr-table agr-detail-audit-table"><caption className="agr-detail-sr-only">Gespeicherte Bearbeitungsschritte dieses Vorschlags</caption><thead><tr><th>Zeitpunkt</th><th>Rolle</th><th>Vorgang</th><th>Nachweis</th></tr></thead><tbody>{[...data.audit].sort((a, b) => b.at.localeCompare(a.at)).map(event => <tr key={event.id}><td>{dateTime(event.at)}</td><td>{event.role}</td><td><strong>{event.action}</strong><p>{event.details}</p></td><td><Reference label={event.entityType} id={event.entityId} />{event.documentId && <Reference label="Dokument-ID" id={event.documentId} />}{event.documentSha256 && <Reference label="SHA-256" id={event.documentSha256} />}</td></tr>)}</tbody></table>{data.audit.length === 0 && <p className="agr-detail-empty">Es liegen noch keine Bearbeitungseinträge vor.</p>}</div>
      {documents.length > 0 && <DocumentHistory documents={documents} selectedId={selectedDocument?.id ?? ''} onSelect={id => { setSelectedDocumentId(id); setLoadedDocumentId(''); setTab('dokument'); }} />}
      {printEvents.length > 0 && <><h3 className="agr-detail-history-title">Drucknachweise</h3><div className="agr-detail-table-scroll"><table className="agr-table agr-detail-audit-table"><caption className="agr-detail-sr-only">Erfasste Druckaufträge mit Dokumentprüfsumme</caption><thead><tr><th>Zeitpunkt</th><th>Rolle</th><th>Dokumentversion</th><th>Nachweis</th></tr></thead><tbody>{printEvents.map(event => <tr key={event.id}><td>{dateTime(event.at)}</td><td>{event.role}</td><td>Version {documents.find(item => item.id === event.documentId)?.version ?? 'unbekannt'}</td><td><Reference label="Druckauftrags-ID" id={event.id} /><Reference label="Dokument-ID" id={event.documentId} /><Reference label="SHA-256" id={event.documentSha256} /></td></tr>)}</tbody></table></div></>}
    </section>}
  </div>;
}

function DocumentHistory({ documents, selectedId, onSelect }: { documents: PolicyDocument[]; selectedId: string; onSelect: (id: string) => void }) {
  return <><h3 className="agr-detail-history-title">Dokumentfassungen</h3><div className="agr-detail-table-scroll"><table className="agr-table agr-detail-audit-table"><caption className="agr-detail-sr-only">Alle ausgegebenen Policendokumente</caption><thead><tr><th>Version</th><th>Ausgabe</th><th>Grund</th><th>Dokumentnachweis</th><th>Ansicht</th></tr></thead><tbody>{documents.map(item => <tr key={item.id}><td>{item.version}{item.id === selectedId ? ' · Ausgewählt' : ''}</td><td>{dateTime(item.createdAt)}<br />{item.createdBy}</td><td>{item.reason}</td><td><Reference label="Dokument-ID" id={item.id} /><Reference label="SHA-256" id={item.sha256} /></td><td><button className="agr-button" type="button" onClick={() => onSelect(item.id)} aria-label={`Dokumentversion ${item.version} anzeigen`}>Anzeigen</button></td></tr>)}</tbody></table></div></>;
}

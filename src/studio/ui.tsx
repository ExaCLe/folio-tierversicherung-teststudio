import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Check, Copy, LoaderCircle, X } from 'lucide-react';

export function Modal({ title, subtitle, children, onClose, wide = false }: {
  title: string; subtitle?: string; children: ReactNode; onClose: () => void; wide?: boolean;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const first = dialog?.querySelector<HTMLElement>('input, textarea, select') || dialog?.querySelector<HTMLElement>('button, [tabindex="0"]');
    first?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab' || !dialog) return;
      const items = [...dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]')].filter(item => item.offsetParent !== null);
      if (!items.length) return;
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0]?.focus(); }
    }
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); previous?.focus(); };
  }, [onClose]);
  return <div className="st-modal-overlay" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={dialogRef} className={`st-modal ${wide ? 'st-modal-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <header className="st-modal-header"><div><h2 id={titleId}>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="st-icon-button" aria-label="Close dialog" onClick={onClose}><X size={18}/></button></header>
      {children}
    </div>
  </div>;
}

export function EmptyState({ icon, title, children, action }: { icon: ReactNode; title: string; children: ReactNode; action?: ReactNode }) {
  return <div className="st-empty"><span className="st-empty-icon">{icon}</span><h3>{title}</h3><p>{children}</p>{action}</div>;
}

export function Loading({ label = 'Loading your workspace' }: { label?: string }) {
  return <div className="st-loading" role="status"><LoaderCircle className="st-spin" size={20}/><span>{label}</span></div>;
}

export function JsonView({ value, label = 'Canonical JSON' }: { value: unknown; label?: string }) {
  const copied = useRef<HTMLButtonElement>(null);
  async function copy() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(value, null, 2));
      if (copied.current) copied.current.dataset.copied = 'true';
      window.setTimeout(() => { if (copied.current) delete copied.current.dataset.copied; }, 1800);
    } catch { /* The selectable JSON remains available if clipboard permission is unavailable. */ }
  }
  return <div className="st-json-wrap"><div className="st-code-heading"><span>{label}</span><button className="st-copy" ref={copied} onClick={copy} aria-label={`Copy ${label}`}><Copy className="st-copy-idle" size={13}/><Check className="st-copy-done" size={13}/><span className="st-copy-idle">Copy</span><span className="st-copy-done">Copied</span></button></div><pre className="st-json" tabIndex={0}>{JSON.stringify(value, null, 2)}</pre></div>;
}

export function Field({ label, children, hint, className = '' }: { label: string; children: ReactNode; hint?: string; className?: string }) {
  return <label className={`st-field ${className}`}><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

export function Status({ status }: { status: string }) {
  const value = status.toLowerCase();
  return <span className={`st-status st-status-${value.replaceAll('_', '-')}`}><i/>{status.replaceAll('_', ' ')}</span>;
}

export function formatDate(value: string | number | undefined) {
  if (!value) return 'Just now';
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

export function formatAmount(value: unknown) {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(Number(value) || 0);
}

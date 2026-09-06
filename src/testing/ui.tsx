import { useEffect, useRef, type ReactNode } from 'react';
import { AlertCircle, Check, LoaderCircle, X } from 'lucide-react';

export function Spinner({ label = 'Wird geladen' }: { label?: string }) {
  return <span className="t-spinner" role="status"><LoaderCircle size={17} /><span>{label}</span></span>;
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className="t-empty"><span className="t-empty-mark" aria-hidden="true">▧</span><h3>{title}</h3><div>{children}</div>{action}</div>;
}

export function Notice({ children, tone = 'info', onClose }: { children: ReactNode; tone?: 'info' | 'error' | 'success'; onClose?: () => void }) {
  return <div className={`t-notice ${tone}`} role={tone === 'error' ? 'alert' : 'status'}>{tone === 'success' ? <Check size={17} /> : <AlertCircle size={17} />}<div>{children}</div>{onClose && <button className="t-icon" aria-label="Hinweis schließen" onClick={onClose}><X size={16} /></button>}</div>;
}

export function Modal({ title, subtitle, children, onClose, wide = false }: { title: string; subtitle?: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    dialog?.showModal();
    const onCancel = (event: Event) => { event.preventDefault(); closeRef.current(); };
    dialog?.addEventListener('cancel', onCancel);
    return () => { dialog?.removeEventListener('cancel', onCancel); dialog?.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  return <dialog ref={ref} className={`t-modal ${wide ? 'wide' : ''}`} aria-label={title} onClick={event => { if (event.target === ref.current) onClose(); }}><div className="t-modal-inner"><header><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="t-icon" aria-label="Dialog schließen" onClick={onClose}><X size={20} /></button></header><div className="t-modal-body">{children}</div></div></dialog>;
}

export function JsonView({ value, label = 'Gespeicherte Daten anzeigen' }: { value: unknown; label?: string }) {
  return <details className="t-json"><summary>{label}</summary><pre>{JSON.stringify(value, null, 2)}</pre></details>;
}

export function formatDate(value?: string) {
  return value ? new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : 'Noch nicht gespeichert';
}

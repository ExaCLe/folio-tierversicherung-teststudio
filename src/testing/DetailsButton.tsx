import { useState, type ReactNode } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { Modal } from './ui';
export function DetailsButton({ label, title = label, children, className = 't-button small', wide = true }: { label: string; title?: string; children: ReactNode; className?: string; wide?: boolean }) {
  const [open, setOpen] = useState(false);
  return <><button type="button" className={className} onClick={() => setOpen(true)}>{label}<ArrowUpRight size={13}/></button>{open && <Modal title={title} onClose={() => setOpen(false)} wide={wide}>{children}</Modal>}</>;
}

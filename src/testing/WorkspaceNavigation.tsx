import { useRef } from 'react';
import { BookOpen, ChevronDown, Layers3, Menu, Plus, Settings2, X } from 'lucide-react';
export type WorkspaceView = 'scenarios' | 'start' | 'editor' | 'library' | 'knowledge' | 'graph' | 'runs' | 'method' | 'settings';
export function workspacePath(view: WorkspaceView) { return `/testing/${view === 'start' ? 'new' : view}`; }
export function WorkspaceNavigation({ view, open, onToggle, onNavigate, onResume, scenarioId }: { view: WorkspaceView; open: boolean; onToggle: () => void; onNavigate: (view: WorkspaceView) => void; onResume: () => void; scenarioId?: string }) {
  const menu = useRef<HTMLDetailsElement>(null);
  const go = (next: WorkspaceView) => { if (menu.current) menu.current.open = false; onNavigate(next); };
  const secondary = ['library', 'knowledge', 'graph', 'runs', 'method'].includes(view);
  const link = (id: WorkspaceView, label: string, Icon: typeof Plus) => <a key={id} href={workspacePath(id)} aria-current={view === id ? 'page' : undefined} onClick={event => { event.preventDefault(); go(id); }}><Icon size={16}/>{label}</a>;
  return <header className="t-topbar t-workspace-topbar">
    <a className="t-brand" href="/testing/new" onClick={event => { event.preventDefault(); go('start'); }}><span className="t-brand-mark"><i/><i/><i/></span><strong>folio</strong><span>TESTSTUDIO</span></a>
    <nav aria-label="Teststudio-Navigation">
      <a href={scenarioId ? `/testing/editor/${encodeURIComponent(scenarioId)}` : '/testing/new'} aria-current={view === 'start' || view === 'editor' ? 'page' : undefined} onClick={event => { event.preventDefault(); if (menu.current) menu.current.open = false; scenarioId ? onResume() : onNavigate('start'); }}><Plus size={16}/>Testfall erstellen</a>
      {link('scenarios', 'Alle Testfälle', Layers3)}
      <details ref={menu} className="t-resource-menu"><summary aria-current={secondary ? 'page' : undefined}><BookOpen size={16}/>Bibliothek & Wissen<ChevronDown size={13}/></summary><div>{link('library', 'Blockbibliothek', Layers3)}{link('knowledge', 'Wissensbasis', BookOpen)}{link('graph', 'Abhängigkeiten', Layers3)}{link('runs', 'Alle Ausführungen', Layers3)}{link('method', 'So funktioniert es', BookOpen)}</div></details>
      {link('settings', 'Einstellungen', Settings2)}
    </nav>
    <span className="t-local-indicator"><i/>Lokale Anwendung</span>
    <button className="t-icon t-mobile-menu" aria-label={open ? 'Navigation schließen' : 'Navigation öffnen'} aria-expanded={open} onClick={onToggle}>{open ? <X size={20}/> : <Menu size={20}/>}</button>
  </header>;
}

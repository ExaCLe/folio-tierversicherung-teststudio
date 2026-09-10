import { Component, Suspense, lazy, useEffect, useState, type ReactNode } from 'react';

const PortalApp = lazy(() => import('./portal/PortalApp').then(module => ({ default: module.PortalApp })));
const TestingApp = lazy(() => import('./testing/TestingApp').then(module => ({ default: module.TestingApp })));
const TestingChatApp = lazy(() => import('./testing-chat/TestingChatApp').then(module => ({ default: module.TestingChatApp })));

class AppBoundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  render() {
    if (this.state.error) return <main className="app-fallback"><h1>Die Anwendung konnte nicht geöffnet werden.</h1><p>Ihre gespeicherten Vorgänge bleiben erhalten. Laden Sie die Seite erneut.</p><button onClick={() => location.reload()}>Seite neu laden</button></main>;
    return this.props.children;
  }
}

export function App() {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const changed = () => setPath(location.pathname);
    window.addEventListener('popstate', changed);
    if (!location.pathname.startsWith('/portal') && !location.pathname.startsWith('/testing')) {
      const destination = location.pathname.startsWith('/insurance') ? '/portal' : '/testing';
      history.replaceState({}, '', destination); setPath(destination);
    }
    return () => window.removeEventListener('popstate', changed);
  }, []);
  const portal = path === '/portal' || path.startsWith('/portal/');
  const testingChat = path === '/testing/chat' || path.startsWith('/testing/chat/');
  return <AppBoundary key={portal ? 'portal' : testingChat ? 'testing-chat' : 'testing'}><Suspense fallback={<main className="app-fallback" role="status"><p>Anwendung wird geöffnet …</p></main>}>{portal ? <PortalApp /> : testingChat ? <TestingChatApp /> : <TestingApp />}</Suspense></AppBoundary>;
}

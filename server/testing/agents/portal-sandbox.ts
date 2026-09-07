import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface PortalSandbox { origin: string; directory: string; close(): Promise<void> }

/** A separate process is essential: the application's store captures its path
 * at module load. No imported domain code in the parent can touch this DB. */
export async function startPortalSandbox(signal?: AbortSignal): Promise<PortalSandbox> {
  if (signal?.aborted) throw new Error('Anwendungserkundung wurde abgebrochen.');
  const directory = await mkdtemp(join(tmpdir(), 'folio-exploration-'));
  let child: ChildProcess | undefined;
  let closing: Promise<void> | undefined;
  const close = () => closing ??= (async () => {
    signal?.removeEventListener('abort', abort);
    if (child?.pid && child.exitCode === null && child.signalCode === null) await new Promise<void>(done => {
      const process = child!;
      const kill = setTimeout(() => process.kill('SIGKILL'), 2_000);
      process.once('exit', () => { clearTimeout(kill); done(); });
      process.kill('SIGTERM');
    });
    await rm(directory, { recursive: true, force: true });
  })();
  const abort = () => { void close(); };
  try {
    if (signal?.aborted) throw new Error('Anwendungserkundung wurde abgebrochen.');
    child = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), fileURLToPath(import.meta.url)], {
      cwd: fileURLToPath(new URL('../../../', import.meta.url)),
      env: { PATH: process.env.PATH, TMPDIR: tmpdir(), NODE_ENV: 'development', FOLIO_EXPLORATION_SANDBOX_DIR: directory },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    signal?.addEventListener('abort', abort, { once: true });
    const origin = await new Promise<string>((done, reject) => {
      const timer = setTimeout(() => reject(new Error('Die isolierte Anwendung konnte nicht rechtzeitig gestartet werden.')), 30_000);
      const fail = () => { clearTimeout(timer); reject(new Error('Die isolierte Anwendung wurde beendet oder abgebrochen.')); };
      child!.once('error', fail); child!.once('exit', fail);
      child!.on('message', value => {
        if (typeof (value as { error?: unknown })?.error === 'string') {
          clearTimeout(timer); reject(new Error(`Die isolierte Anwendung konnte nicht gestartet werden: ${(value as { error: string }).error}`)); return;
        }
        const port = (value as { port?: number })?.port;
        if (!Number.isInteger(port) || port! < 1 || port! > 65535) return;
        clearTimeout(timer); child!.removeListener('error', fail); child!.removeListener('exit', fail);
        done(`http://127.0.0.1:${port}`);
      });
      // Drain output, but never expose source paths or ambient process data.
      child!.stdout?.resume(); child!.stderr?.resume();
    });
    if (signal?.aborted) throw new Error('Anwendungserkundung wurde abgebrochen.');
    return { origin, directory, close };
  } catch (error) { await close(); throw error; }
}

async function serveSandbox() {
  const directory = process.env.FOLIO_EXPLORATION_SANDBOX_DIR;
  if (!directory || !process.send) throw new Error('Die Erkundungsanwendung benötigt einen isolierten Elternprozess.');
  process.env.FOLIO_DATA_FILE = join(directory, 'synthetic-data.json');
  const [{ default: express }, { createServer }, { default: react }, { createAgricultureRouter }] = await Promise.all([
    import('express'), import('vite'), import('@vitejs/plugin-react'), import('../../agriculture/router'),
  ]);
  const app = express(); app.disable('x-powered-by'); app.use(express.json({ limit: '1mb' }));
  app.use('/api/agriculture', createAgricultureRouter());
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Nur die isolierte Tierversicherung ist verfügbar.' }));
  const vite = await createServer({ configFile: false, envFile: false, root: fileURLToPath(new URL('../../../', import.meta.url)),
    plugins: [react()], appType: 'custom', server: { middlewareMode: true, hmr: false, watch: null, proxy: {} },
    cacheDir: join(directory, 'vite-cache'), logLevel: 'silent',
  });
  app.use(vite.middlewares);
  app.get('/portal*', async (req, res, next) => {
    try { res.type('html').send(await vite.transformIndexHtml(req.originalUrl, '<!doctype html><html lang="de"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>')); }
    catch (error) { next(error); }
  });
  app.use((_req, res) => res.status(404).end());
  const server = app.listen(0, '127.0.0.1', () => { const address = server.address(); if (address && typeof address !== 'string') process.send?.({ port: address.port }); });
  let stopping = false;
  const stop = async () => { if (stopping) return; stopping = true; server.closeAllConnections(); server.close(); await vite.close(); process.exit(0); };
  server.on('error', error => { process.send?.({ error: `Lokaler Serverstart fehlgeschlagen (${String((error as NodeJS.ErrnoException).code ?? 'SERVER_ERROR')}).` }); void stop(); });
  process.on('SIGTERM', () => void stop()); process.on('SIGINT', () => void stop()); process.on('disconnect', () => void stop());
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await serveSandbox(); }
  catch { if (process.send) process.send({ error: 'Die isolierte Portaloberfläche konnte nicht geladen werden.' }, () => process.exit(1)); else process.exit(1); }
}

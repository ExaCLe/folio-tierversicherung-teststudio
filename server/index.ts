import express from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInsuranceRouter } from './insurance/router';
import { createStudioRouter } from './studio/router';
import { createAgricultureRouter } from './agriculture/router';
import { createTestingRouter } from './testing/router';
import { startupLines } from './startup';

export async function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));
  app.get('/api/health', (_request, response) => response.json({ status: 'ok', app: 'Folio', environment: 'local' }));

  app.use('/api/insurance', createInsuranceRouter());
  app.use('/api/studio', createStudioRouter());
  app.use('/api/agriculture', createAgricultureRouter());
  app.use('/api/testing', createTestingRouter());
  app.use('/api', (_request, response) => response.status(404).json({ error: 'Dieser API-Pfad wurde nicht gefunden.', code: 'NOT_FOUND' }));
  const dist = resolve('dist');
  if (existsSync(dist)) {
    app.use(express.static(dist));
    app.get('*', (_request, response) => response.sendFile(resolve(dist, 'index.html')));
  }
  app.use((error: Error & { status?: number }, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    const status = error.status && error.status >= 400 && error.status < 600 ? error.status : 500;
    if (status >= 500) console.error(error);
    response.status(status).json({ error: status === 500 ? 'Die Anfrage konnte nicht verarbeitet werden.' : status === 400 ? 'Die gesendeten Daten konnten nicht gelesen werden.' : status === 413 ? 'Die gesendeten Daten sind zu groß.' : error.message, code: status === 400 ? 'INVALID_JSON' : 'SERVER_ERROR' });
  });
  return app;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  const app = await createApp();
  const port = Number(process.env.PORT || 3001);
  app.listen(port, '127.0.0.1', () => {
    for(const line of startupLines(port))console.log(line);
  });
}

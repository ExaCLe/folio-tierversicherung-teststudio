import type { Router } from 'express';
import type { Page } from '@playwright/test';

export type TestingObservation = {
  runId: string;
  parentRunId?: string;
  rowId?: string;
  stepId: string;
  stepPath: string;
  stepLabel: string;
  capturedAt: string;
  sequence: number;
  width: number;
  height: number;
  frameUrl: string;
};

type Frame = { metadata: TestingObservation; jpeg: Buffer };
type Listener = (event: 'observation' | 'end', value?: TestingObservation) => void;
const frames = new Map<string, Frame>();
const listeners = new Map<string, Set<Listener>>();
const sequences = new Map<string, number>();

function broadcast(channelId: string, event: 'observation' | 'end', value?: TestingObservation) {
  for (const listener of listeners.get(channelId) ?? []) {
    try { listener(event, value); } catch { /* A disconnected observer cannot affect execution. */ }
  }
}

/** Register the transient observation endpoints on the existing /api/testing router. */
export function registerTestingObservationRoutes(router: Router) {
  router.get('/observations/events', (req, res) => {
    const runId = typeof req.query.runId === 'string' ? req.query.runId : '';
    if (!/^[a-zA-Z0-9_-]+$/.test(runId)) return res.status(400).json({ error: 'Ungültige Testlauf-ID.' });
    res.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    const send = (event: string, value: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`);
    };
    const current = frames.get(runId)?.metadata;
    send('snapshot', current ?? null);
    let closed = false;
    const close = () => {
      if (closed) return; closed = true; clearInterval(keepalive); channelListeners.delete(listener);
      if (!channelListeners.size) listeners.delete(runId);
    };
    const listener: Listener = (event, value) => {
      if (closed || res.writableEnded || res.destroyed) return;
      if (res.writableLength > 512 * 1024) { close(); res.end(); return; }
      send(event, value ?? null);
      if (event === 'end') { close(); res.end(); }
    };
    const channelListeners = listeners.get(runId) ?? new Set<Listener>();
    channelListeners.add(listener); listeners.set(runId, channelListeners);
    const keepalive = setInterval(() => res.write(': keepalive\n\n'), 15_000);
    req.on('close', close);
  });
  router.get('/observations/:runId/frame', (req, res) => {
    const frame = frames.get(req.params.runId);
    if (!frame) return res.status(404).json({ error: 'Aktuell ist kein Live-Bild verfügbar.' });
    res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store, max-age=0', 'Content-Length': String(frame.jpeg.byteLength) });
    res.send(frame.jpeg);
  });
}

export function endTestingObservation(channelId: string) {
  frames.delete(channelId);
  sequences.delete(channelId);
  broadcast(channelId, 'end');
}

export function testingObservationStats() {
  return { frames: frames.size, listeners: [...listeners.values()].reduce((sum, set) => sum + set.size, 0) };
}

export function testingObservationSnapshot(channelId: string) {
  return frames.get(channelId)?.metadata;
}

/**
 * Capture at most one actual Playwright screenshot per interval. Stopping awaits
 * the in-flight capture, so a late callback cannot restore an ended frame.
 */
export function observeTestingPage(page: Page, scope: {
  runId: string; channelId?: string; parentRunId?: string; rowId?: string;
  stepId: string; stepPath: string; stepLabel: string;
}, intervalMs = 1_000) {
  const channelId = scope.channelId ?? scope.runId;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let pending: Promise<void> = Promise.resolve();
  const capture = async () => {
    if (stopped) return;
    try {
      const jpeg = await page.screenshot({ type: 'jpeg', quality: 58, timeout: Math.min(900, intervalMs) });
      if (stopped) return;
      const previous = frames.get(channelId);
      if (previous?.metadata.stepId === scope.stepId && previous.jpeg.equals(jpeg)) return;
      const sequence = (sequences.get(channelId) ?? 0) + 1;
      sequences.set(channelId, sequence);
      const viewport = page.viewportSize() ?? { width: 0, height: 0 };
      const metadata: TestingObservation = {
        runId: scope.runId, ...(scope.parentRunId ? { parentRunId: scope.parentRunId } : {}), ...(scope.rowId ? { rowId: scope.rowId } : {}),
        stepId: scope.stepId, stepPath: scope.stepPath, stepLabel: scope.stepLabel,
        capturedAt: new Date().toISOString(), sequence, width: viewport.width, height: viewport.height,
        frameUrl: `/api/testing/observations/${encodeURIComponent(channelId)}/frame?v=${sequence}`,
      };
      frames.set(channelId, { metadata, jpeg }); broadcast(channelId, 'observation', metadata);
    } catch { /* Observation is diagnostic and must never change the test result. */ }
  };
  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(() => { pending = capture().finally(schedule); }, intervalMs);
  };
  pending = capture().finally(schedule);
  const captureNow = async () => {
    await pending.catch(() => undefined);
    if (stopped) return;
    pending = capture(); await pending.catch(() => undefined);
  };
  const stop = async () => {
    stopped = true; if (timer) clearTimeout(timer); await pending.catch(() => undefined);
  };
  return { captureNow, stop };
}

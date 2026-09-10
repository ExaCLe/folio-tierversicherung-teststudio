import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Router } from 'express';
import type { Page } from '@playwright/test';
import { endTestingObservation, observeTestingPage, registerTestingObservationRoutes, testingObservationSnapshot, testingObservationStats } from './observation';

const delay = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

test('live observation retains one latest frame and maps a matrix child to its parent row', async () => {
  let captures = 0;
  const page = {
    screenshot: async () => { captures += 1; return Buffer.from(`frame-${captures}`); },
    viewportSize: () => ({ width: 1440, height: 1050 }),
  } as unknown as Page;
  const observation = observeTestingPage(page, {
    runId: 'matrix-zeile-002', channelId: 'matrix', parentRunId: 'matrix', rowId: 'hessen',
    stepId: 'step-1', stepPath: 'antrag/pruefen', stepLabel: 'Antrag prüfen',
  }, 15);
  await delay(42); await observation.stop();
  const snapshot = testingObservationSnapshot('matrix');
  assert.ok(captures >= 2);
  assert.equal(testingObservationStats().frames, 1);
  assert.equal(snapshot?.runId, 'matrix-zeile-002');
  assert.equal(snapshot?.parentRunId, 'matrix');
  assert.equal(snapshot?.rowId, 'hessen');
  assert.equal(snapshot?.stepPath, 'antrag/pruefen');
  assert.match(snapshot?.frameUrl ?? '', /^\/api\/testing\/observations\/matrix\/frame\?v=\d+$/);
  endTestingObservation('matrix');
  assert.equal(testingObservationSnapshot('matrix'), undefined);
});

test('stopping an in-flight capture prevents a late frame from reappearing after cleanup', async () => {
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const page = {
    screenshot: async () => { await blocked; return Buffer.from('late-frame'); },
    viewportSize: () => ({ width: 800, height: 600 }),
  } as unknown as Page;
  const observation = observeTestingPage(page, { runId: 'cancelled', stepId: 'step', stepPath: 'step', stepLabel: 'Step' }, 20);
  const stopping = observation.stop(); release(); await stopping;
  endTestingObservation('cancelled');
  await delay(30);
  assert.equal(testingObservationSnapshot('cancelled'), undefined);
  assert.equal(testingObservationStats().frames, 0);
});

test('SSE exposes only metadata, serves the transient JPEG separately, and releases subscribers', async () => {
  const router = Router(); registerTestingObservationRoutes(router);
  type Layer = { route?: { path: string; stack: { handle: (req: any, res: any) => unknown }[] } };
  const handler = (path: string) => (router as unknown as { stack: Layer[] }).stack.find(layer => layer.route?.path === path)!.route!.stack[0].handle;
  const page = { screenshot: async () => Buffer.from('actual-jpeg-fixture'), viewportSize: () => ({ width: 640, height: 480 }) } as unknown as Page;
  const observation = observeTestingPage(page, { runId: 'api-run', stepId: 'one', stepPath: 'one', stepLabel: 'Eins' }, 5_000);
  await delay(5);
  const request = Object.assign(new EventEmitter(), { query: { runId: 'api-run' } });
  const writes: string[] = [], headers: Record<string, string> = {};
  const response = { status: () => response, set: (value: Record<string,string>) => { Object.assign(headers,value); return response; }, flushHeaders: () => undefined,
    write: (value: string) => { writes.push(value); return true; }, end: () => undefined, writableEnded: false, destroyed: false, writableLength: 0 };
  handler('/observations/events')(request, response);
  const text = writes.join('');
  assert.match(headers['Content-Type'], /text\/event-stream/);
  assert.match(text, /event: snapshot/); assert.match(text, /"frameUrl"/); assert.doesNotMatch(text, /actual-jpeg-fixture/);
  const frameHeaders: Record<string,string> = {}; let jpeg: Buffer | undefined;
  const frameResponse = { set: (value:Record<string,string>) => { Object.assign(frameHeaders,value); return frameResponse; }, send: (value:Buffer) => { jpeg=value; }, status: () => frameResponse, json: () => undefined };
  handler('/observations/:runId/frame')({ params: { runId: 'api-run' } }, frameResponse);
  assert.equal(frameHeaders['Cache-Control'], 'no-store, max-age=0'); assert.equal(jpeg?.toString(), 'actual-jpeg-fixture');
  request.emit('close'); await delay(1);
  assert.equal(testingObservationStats().listeners, 0);
  await observation.stop(); endTestingObservation('api-run');
});

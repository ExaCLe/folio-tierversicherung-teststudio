import test from 'node:test';
import assert from 'node:assert/strict';
import { startupLines, terminalUrl } from './startup';

test('Startausgabe nutzt die vollständige konfigurierte App-Adresse als sichtbaren Linktext',()=>{
  const lines=startupLines(3001,{FOLIO_APP_URL:'https://folio.example.test/base/',FORCE_HYPERLINK:'1'});
  assert(lines.some(line=>line.includes('\u001B]8;;https://folio.example.test/base/testing/chat\u0007https://folio.example.test/base/testing/chat\u001B]8;;\u0007')));
});

test('Startausgabe bleibt ohne Hyperlink-Unterstützung eine vollständige kopierbare URL',()=>{
  assert.equal(terminalUrl('http://127.0.0.1:5173/testing/chat',{TERM:'dumb'}),'http://127.0.0.1:5173/testing/chat');
});

test('Hyperlinks lassen sich für gepipete Starts unabhängig von isTTY ausdrücklich aktivieren',()=>{
  assert.match(terminalUrl('http://127.0.0.1:5173/testing/chat',{FORCE_HYPERLINK:'1'}),/^\u001b\]8;;/i);
});

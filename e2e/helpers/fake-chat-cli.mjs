#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const schema = JSON.parse(readFileSync(args[args.indexOf('--output-schema') + 1], 'utf8'));
let output = { status: 'bereit' };
if (schema.properties?.reuseBindings) {
  const compiled = JSON.parse(readFileSync('freigegeben.json', 'utf8'));
  output = { explanation: 'Deterministische technische E2E-Prüfung.', reuseBindings: compiled.bindings.filter(binding => binding.status === 'ready').map(binding => ({ id: binding.id, revision: binding.revision })), newBindings: [], unsupported: [] };
}
if (schema.properties?.decisions) output = { explanation: 'Deterministische Dublettenprüfung ohne Modellaufruf.', decisions: [], unresolved: [] };
if (schema.properties?.suggestions) output = { explanation: 'Keine Wiederverwendung im Browservertrag.', suggestions: [] };
process.stdout.write(`${JSON.stringify({ type: 'thread.started' })}\n`);
writeFileSync(args[args.indexOf('-o') + 1], JSON.stringify(output));

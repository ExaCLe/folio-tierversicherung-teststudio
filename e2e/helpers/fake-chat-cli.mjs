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
process.stdout.write(`${JSON.stringify({ type: 'item.updated', item: { id: 'reason_1', type: 'reasoning', text: 'Ich prüfe den geforderten Ablauf gegen die vorhandenen Bausteine und fachlichen Quellen.' } })}\n`);
if (schema.properties?.reuseBindings) await new Promise(resolve => setTimeout(resolve, 3000));
process.stdout.write(`${JSON.stringify({ type: 'item.completed', item: { id: 'reason_1', type: 'reasoning', text: 'Der Ablauf verbindet die fachliche Anforderung mit den vorhandenen Bausteinen; offene Annahmen bleiben im Ergebnis sichtbar.' } })}\n`);
process.stdout.write(`${JSON.stringify({ type: 'item.completed', item: { id: 'message_1', type: 'agent_message', text: 'Die strukturierte Fassung ist erstellt und kann im Ablauf geprüft werden.' } })}\n`);
writeFileSync(args[args.indexOf('-o') + 1], JSON.stringify(output));

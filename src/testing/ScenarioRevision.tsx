import { useState, type ReactNode } from 'react';
import { ArrowRight, Sparkles } from 'lucide-react';
import type { TestingCatalog, TestingScenario } from '../../shared/testing';
import { flattenBlocks, resolvedBlockInputs } from './model';
import { buildReferenceIndex, describeReference, entryStep } from './references';
import { isTestingReference } from '../../shared/testing';

export function ScenarioInstruction({ scenarioId, dirty, busy, onSubmit, controls, title = 'Ablauf mit KI überarbeiten', description = 'Beschreibe eine Änderung am gesamten Testfall. Du prüfst den Vorschlag, bevor du ihn übernimmst.', submitLabel = 'Änderungsvorschlag erstellen' }: { controls?: ReactNode; scenarioId: string; dirty: boolean; busy: boolean; onSubmit: (text: string) => Promise<void>; title?: string; description?: string; submitLabel?: string }) {
  const key = `folio-testing-instruction:${scenarioId}`;
  const [text, setText] = useState(() => { try { return sessionStorage.getItem(key) ?? ''; } catch { return ''; } });
  return <section className="t-scenario-instruction" aria-label="Gesamten Ablauf mit KI überarbeiten"><div><Sparkles size={18} /><h2>{title}</h2></div><p>{description}</p><form onSubmit={event => { event.preventDefault(); if (text.trim() && !busy) void onSubmit(text); }}><label className="t-field">Anweisung für den gesamten Ablauf<textarea aria-label="Anweisung für den gesamten Ablauf" rows={2} value={text} onChange={event => { setText(event.target.value); try { sessionStorage.setItem(key, event.target.value); } catch { /* In-memory input remains usable. */ } }} placeholder="Füge nach der Antragseinreichung eine Prüfung der Direktionsberechtigung ein." /></label><div className="t-instruction-actions">{controls}<small>{dirty ? 'Deine lokalen Änderungen werden zuerst als neue Revision gespeichert.' : 'Der aktuelle gespeicherte Fachstand ist die Grundlage.'}</small><button className="t-button primary" disabled={busy || !text.trim()} type="submit"><Sparkles size={14} />{dirty ? 'Speichern und Vorschlag erstellen' : submitLabel}</button></div></form></section>;
}

export function ScenarioRevisionDiff({ previous, next, catalog }: { previous: TestingScenario; next: TestingScenario; catalog: TestingCatalog }) {
  const before = flattenBlocks(previous.blocks, catalog), after = flattenBlocks(next.blocks, catalog);
  const beforeReferences = buildReferenceIndex(before, previous.parameters), afterReferences = buildReferenceIndex(after, next.parameters);
  const changes: { key: string; name: string; path?: string; before?: unknown; after?: unknown }[] = [];
  for (const key of ['title', 'intent', 'expectedOutcome', 'parameters', 'knowledgeRefs'] as const) if (JSON.stringify(previous[key]) !== JSON.stringify(next[key])) changes.push({ key, name: ({ title: 'Titel', intent: 'Anforderung', expectedOutcome: 'Erwartetes Ergebnis', parameters: 'Ablaufparameter', knowledgeRefs: 'Fachwissen' })[key], before: previous[key], after: next[key] });
  for (const old of before) if (!after.some(item => item.path === old.path)) changes.push({ key: `remove:${old.path}`, name: 'Block entfernt', before: `Schritt ${entryStep(old, before)} · ${old.block.label || old.definition?.name || old.block.definition.id}` });
  for (const item of after) {
    const old = before.find(entry => entry.path === item.path);
    const title = item.block.label || item.definition?.name || item.block.definition.id;
    const position = entryStep(item, after);
    if (!old) { changes.push({ key: `add:${item.path}`, name: 'Block hinzugefügt', after: `Schritt ${position} · ${title}` });
      for (const [key, value] of Object.entries(resolvedBlockInputs(item))) changes.push({ key: `add:${item.path}:${key}`, path: item.path, name: `${title} · ${item.definition?.inputs.find(input => input.key === key)?.label ?? key}`, after: value });
      continue; }
    const oldPosition = entryStep(old, before);
    if (oldPosition !== position) changes.push({ key: `move:${item.path}`, name: `${title} · Position`, before: `Schritt ${oldPosition}`, after: `Schritt ${position}` });
    if (JSON.stringify(old.block.definition) !== JSON.stringify(item.block.definition)) changes.push({ key: `definition:${item.path}`, name: `${title} · Definition`, before: old.block.definition, after: item.block.definition });
    const oldValues = resolvedBlockInputs(old), newValues = resolvedBlockInputs(item);
    for (const key of new Set([...Object.keys(oldValues), ...Object.keys(newValues)])) if (JSON.stringify(oldValues[key]) !== JSON.stringify(newValues[key])) changes.push({ key: `${item.path}:${key}`, path: item.path, name: `Schritt ${position} · ${title} · ${item.definition?.inputs.find(input => input.key === key)?.label ?? key}`, before: oldValues[key], after: newValues[key] });
  }
  const format = (value: unknown, path: string | undefined, side: 'before' | 'after') => value === undefined ? '—' : isTestingReference(value) && path ? describeReference(side === 'before' ? beforeReferences : afterReferences, path, value).label : typeof value === 'string' ? value : JSON.stringify(value);
  return <div className="t-override-diff" aria-label="Änderungen am gesamten Ablauf">{changes.length ? changes.map(change => <div key={change.key}><h4>{change.name}</h4><div><del>{format(change.before, change.path, 'before')}</del><ArrowRight size={14} /><ins>{format(change.after, change.path, 'after')}</ins></div></div>) : <p>Keine Änderung am Ablauf vorgeschlagen.</p>}</div>;
}

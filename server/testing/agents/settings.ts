import { AsyncLocalStorage } from 'node:async_hooks';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import type { TestingAgentConfiguration, TestingAgentSettings, TestingModel, TestingProvider } from '../../../shared/testing';
import { db } from '../../store';
import { TestingModelError } from '../repository';

const collection = 'testingAgentSettings';
const context = new AsyncLocalStorage<TestingAgentConfiguration>();
export const DEFAULT_CODEX_MODELS = { luna: 'gpt-5.6-luna', sol: 'gpt-5.6-sol' };
export function defaultAgentSettings(): TestingAgentSettings {
  return { id: 'local', revision: 0, defaultModel: 'luna', models: [
    { id: 'luna', label: 'Luna', provider: 'codex', slug: DEFAULT_CODEX_MODELS.luna, extraArgs: [] },
    { id: 'sol', label: 'Sol', provider: 'codex', slug: DEFAULT_CODEX_MODELS.sol, extraArgs: [] },
  ], providers: { codex: { executable: '', extraArgs: [] }, claude: { executable: '', extraArgs: [] } } };
}
export function getTestingAgentSettings(): TestingAgentSettings { return structuredClone(db.find<TestingAgentSettings>(collection, 'local') ?? defaultAgentSettings()); }
export function providerExecutable(provider: TestingProvider): string {
  const command = provider === 'codex' ? process.env.FOLIO_CODEX_EXECUTABLE : process.env.FOLIO_CLAUDE_EXECUTABLE;
  return command || (existsSync(`/opt/homebrew/bin/${provider}`) ? `/opt/homebrew/bin/${provider}` : provider);
}

/** Tokenize quotes and escapes only. No shell, variable or command expansion. */
export function parseExtraArgs(raw: unknown): string[] {
  if (Array.isArray(raw)) return z.array(z.string().max(2000).refine(value => !/[\0\r\n]/.test(value), 'Ein CLI-Argument darf keinen Zeilenumbruch enthalten.')).max(40).parse(raw);
  if (typeof raw !== 'string') throw new TestingModelError('Zusätzliche CLI-Argumente müssen Text oder eine Argumentliste sein.');
  if (raw.length > 8000 || raw.includes('\0')) throw new TestingModelError('Die CLI-Argumente sind zu lang oder enthalten ungültige Zeichen.');
  const args: string[] = []; let token = '', quote = '', escaped = false, started = false;
  for (const char of raw) {
    if (escaped) { token += char; escaped = false; started = true; continue; }
    if (char === '\\' && quote !== "'") { escaped = true; started = true; continue; }
    if (quote) { if (char === quote) quote = ''; else token += char; started = true; continue; }
    if (char === '"' || char === "'") { quote = char; started = true; continue; }
    if (/\s/.test(char)) { if (started) { args.push(token); token = ''; started = false; } }
    else { token += char; started = true; }
  }
  if (quote || escaped) throw new TestingModelError('Die CLI-Argumente enthalten ein nicht geschlossenes Anführungszeichen oder Escapezeichen.');
  if (started) args.push(token);
  return parseExtraArgs(args);
}
export function validateExtraArgs(provider: TestingProvider, raw: unknown): string[] {
  const parsed = parseExtraArgs(raw); const args: string[] = [];
  for (let index = 0; index < parsed.length; index++) {
    const token = parsed[index];
    const equals = token.indexOf('='); const flag = equals >= 0 ? token.slice(0, equals) : token;
    const value = () => { const next = equals >= 0 ? token.slice(equals + 1) : parsed[++index]; if (!next || next.startsWith('-')) throw new TestingModelError(`Für ${flag} fehlt ein gültiger Wert.`); return next; };
    if (provider === 'claude' && flag === '--effort') { const level = value(); if (!['low', 'medium', 'high', 'xhigh', 'max'].includes(level)) throw new TestingModelError('--effort erlaubt low, medium, high, xhigh oder max.'); args.push(flag, level); }
    else if (provider === 'claude' && flag === '--max-budget-usd') { const amount = value(); if (!/^\d+(?:\.\d+)?$/.test(amount) || Number(amount) <= 0) throw new TestingModelError('--max-budget-usd braucht einen positiven Betrag.'); args.push(flag, amount); }
    else if (provider === 'codex' && ['-c', '--config'].includes(flag)) {
      const setting = value(); const match = /^(model_reasoning_effort|model_verbosity)=(?:"([a-z]+)"|'([a-z]+)'|([a-z]+))$/.exec(setting);
      const level = match?.[2] ?? match?.[3] ?? match?.[4];
      const allowed = match?.[1] === 'model_reasoning_effort' ? ['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'] : ['low', 'medium', 'high'];
      if (!match || !level || !allowed.includes(level)) throw new TestingModelError('Zusätzliches Codex -c erlaubt nur model_reasoning_effort oder model_verbosity mit einem unterstützten Wert.');
      args.push('-c', `${match[1]}=${JSON.stringify(level)}`);
    } else throw new TestingModelError(`Das zusätzliche Argument ${flag || '(leer)'} ist für ${provider === 'claude' ? 'Claude Code' : 'Codex'} nicht freigegeben. Modell, Ausgabeformat, Werkzeuge, Verzeichnis und Berechtigungen legt das Teststudio fest.`);
  }
  return mergeValidatedArgs(args);
}
function mergeValidatedArgs(...groups: string[][]): string[] {
  const values = new Map<string, [string, string]>();
  for (const group of groups) for (let index = 0; index < group.length; index += 2) {
    const flag = group[index], value = group[index + 1];
    values.set(flag === '-c' ? `config:${value.split('=')[0]}` : flag, [flag, value]);
  }
  return [...values.values()].flat();
}
const key = z.string().min(1).max(100).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/);
const providerZ = z.enum(['codex', 'claude']);
const argsZ = z.union([z.string(), z.array(z.string())]);
const providerSettingsZ = z.object({ executable: z.string().max(1000).refine(value => !/[\0\r\n]/.test(value) && !value.startsWith('-'), 'Ungültiger CLI-Programmpfad.'), extraArgs: argsZ }).strict();
const settingsZ = z.object({ id: z.literal('local').optional(), revision: z.number().int().min(0), defaultModel: key,
  models: z.array(z.object({ id: key, label: z.string().trim().min(1).max(100), provider: providerZ, slug: z.string().trim().min(1).max(200).refine(value => !/\s|\0/.test(value) && !value.startsWith('-'), 'Der Modellname darf kein CLI-Argument sein.'), extraArgs: argsZ }).strict()).min(1).max(30),
  providers: z.object({ codex: providerSettingsZ, claude: providerSettingsZ }).strict(),
}).strict();
export function saveTestingAgentSettings(raw: unknown): TestingAgentSettings {
  const value = settingsZ.parse(raw); const current = getTestingAgentSettings();
  if (value.revision !== current.revision) throw new TestingModelError('Die Einstellungen wurden inzwischen geändert. Bitte neu laden.', 409, 'SETTINGS_STALE');
  if (new Set(value.models.map(model => model.id)).size !== value.models.length) throw new TestingModelError('Jedes Modell braucht einen eindeutigen Einstellungsschlüssel.');
  if (!value.models.some(model => model.id === value.defaultModel)) throw new TestingModelError('Das Standardmodell fehlt in der Modellliste.');
  const settings: TestingAgentSettings = { ...value, id: 'local', revision: current.revision + 1,
    models: value.models.map(model => ({ ...model, extraArgs: validateExtraArgs(model.provider, model.extraArgs) })),
    providers: { codex: { ...value.providers.codex, extraArgs: validateExtraArgs('codex', value.providers.codex.extraArgs) }, claude: { ...value.providers.claude, extraArgs: validateExtraArgs('claude', value.providers.claude.extraArgs) } },
  };
  return db.upsert(collection, settings);
}
export function resolveAgentConfiguration(modelId?: TestingModel): TestingAgentConfiguration {
  const inherited = context.getStore();
  if (inherited && (!modelId || modelId === inherited.modelId)) return structuredClone(inherited);
  const settings = getTestingAgentSettings(); const id = modelId ?? settings.defaultModel;
  const model = settings.models.find(item => item.id === id);
  if (!model) throw new TestingModelError(`Das Modellprofil „${id}“ ist nicht konfiguriert. Bitte unter Einstellungen ein Modell auswählen.`);
  const provider = settings.providers[model.provider];
  return { provider: model.provider, modelId: model.id, modelLabel: model.label, modelSlug: model.slug, executable: provider.executable || providerExecutable(model.provider), args: mergeValidatedArgs(validateExtraArgs(model.provider, provider.extraArgs), validateExtraArgs(model.provider, model.extraArgs)), settingsRevision: settings.revision };
}
export function withAgentConfiguration<T>(configuration: TestingAgentConfiguration, task: () => T): T { return context.run(structuredClone(configuration), task); }

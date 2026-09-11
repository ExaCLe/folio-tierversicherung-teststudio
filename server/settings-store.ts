import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, extname, resolve } from 'node:path';
import { dataFile, db } from './store';

type SettingsRecord = { id: string };
type SettingsDocument = { testingAgentSettings?: SettingsRecord[] };

export function settingsFilePath(environment: NodeJS.ProcessEnv = process.env): string {
  if (environment.FOLIO_SETTINGS_FILE) {
    const configured=resolve(environment.FOLIO_SETTINGS_FILE);
    if(configured===dataFile)throw new Error('FOLIO_SETTINGS_FILE muss auf eine andere Datei als FOLIO_DATA_FILE zeigen, damit Szenariodaten nicht überschrieben werden.');
    return configured;
  }
  const extension = extname(dataFile);
  return extension ? `${dataFile.slice(0, -extension.length)}.settings${extension}` : `${dataFile}.settings.json`;
}

function readDocument(path = settingsFilePath()): SettingsDocument {
  if (!existsSync(path)) return {};
  let value:unknown;
  try{value=JSON.parse(readFileSync(path,'utf8'));}
  catch(cause){throw new Error(`Die Folio-Einstellungsdatei ${path} enthält kein gültiges JSON. Korrigiere oder sichere die Datei; Folio überschreibt sie nicht automatisch.`,{cause});}
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Die Folio-Einstellungsdatei muss ein JSON-Objekt enthalten.');
  return value as SettingsDocument;
}

function writeDocument(value: SettingsDocument, path = settingsFilePath()): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  renameSync(temporaryPath, path);
}

export const settingsDb = {
  find<T extends SettingsRecord>(id: string): T | undefined {
    const records = readDocument().testingAgentSettings;
    if (Array.isArray(records)) return structuredClone(records.find(record => record.id === id) as T | undefined);
    // Safe one-way migration: copy legacy settings. Scenario data is deliberately
    // left untouched so an older Folio version can still read it.
    const legacy = db.find<T>('testingAgentSettings', id);
    if (legacy) writeDocument({ testingAgentSettings: [structuredClone(legacy)] });
    return legacy ? structuredClone(legacy) : undefined;
  },
  upsert<T extends SettingsRecord>(record: T): T {
    const document = readDocument();
    const records = Array.isArray(document.testingAgentSettings) ? document.testingAgentSettings : [];
    const index = records.findIndex(item => item.id === record.id);
    if (index < 0) records.push(structuredClone(record)); else records[index] = structuredClone(record);
    writeDocument({ ...document, testingAgentSettings: records });
    return structuredClone(record);
  },
};

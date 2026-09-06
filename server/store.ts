import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export const dataFile = resolve(process.env.FOLIO_DATA_FILE || '.local/folio.json');
type Collections = Record<string, unknown[]>;

function readCollections(): Collections {
  if (!existsSync(dataFile)) return {};
  const value: unknown = JSON.parse(readFileSync(dataFile, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Folio data file must contain a collection object.');
  return value as Collections;
}

function writeCollections(collections: Collections): void {
  mkdirSync(dirname(dataFile), { recursive: true });
  const temporaryPath = `${dataFile}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(collections, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  renameSync(temporaryPath, dataFile);
}

export const db = {
  read<T>(collection: string): T[] {
    const records = readCollections()[collection];
    return Array.isArray(records) ? records as T[] : [];
  },
  find<T extends { id: string }>(collection: string, id: string): T | undefined {
    return this.read<T>(collection).find(record => record.id === id);
  },
  upsert<T extends { id: string }>(collection: string, record: T): T {
    const collections = readCollections();
    const records = Array.isArray(collections[collection]) ? collections[collection] as T[] : [];
    const index = records.findIndex(item => item.id === record.id);
    if (index === -1) records.push(record); else records[index] = record;
    collections[collection] = records;
    writeCollections(collections);
    return record;
  },
  remove(collection: string, id: string): boolean {
    const collections = readCollections();
    const records = Array.isArray(collections[collection]) ? collections[collection] as { id: string }[] : [];
    const next = records.filter(record => record.id !== id);
    if (next.length === records.length) return false;
    collections[collection] = next;
    writeCollections(collections);
    return true;
  },
  replace<T>(collection: string, records: T[]): void {
    const collections = readCollections();
    collections[collection] = records;
    writeCollections(collections);
  },
};

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const directory = mkdtempSync(join(tmpdir(), 'folio-settings-'));
process.env.FOLIO_DATA_FILE = join(directory, 'scenarios.json');
process.env.FOLIO_SETTINGS_FILE = join(directory, 'configuration.json');
const { settingsDb, settingsFilePath } = await import('./settings-store');

test('uses an independent configurable settings file', () => {
  assert.equal(settingsFilePath(), process.env.FOLIO_SETTINGS_FILE);
  writeFileSync(process.env.FOLIO_DATA_FILE!, JSON.stringify({ testingScenarios: [{ id: 'scenario' }] }));
  settingsDb.upsert({ id: 'local', revision: 1 });
  assert.deepEqual(JSON.parse(readFileSync(process.env.FOLIO_DATA_FILE!, 'utf8')), { testingScenarios: [{ id: 'scenario' }] });
  assert.deepEqual(JSON.parse(readFileSync(process.env.FOLIO_SETTINGS_FILE!, 'utf8')).testingAgentSettings, [{ id: 'local', revision: 1 }]);
});

test('copies legacy settings without changing scenario storage', () => {
  const legacy = { testingScenarios: [{ id: 'kept' }], testingAgentSettings: [{ id: 'legacy', revision: 7 }] };
  writeFileSync(process.env.FOLIO_DATA_FILE!, JSON.stringify(legacy));
  process.env.FOLIO_SETTINGS_FILE = join(directory, 'migrated.json');
  assert.deepEqual(settingsDb.find('legacy'), { id: 'legacy', revision: 7 });
  assert.deepEqual(JSON.parse(readFileSync(process.env.FOLIO_DATA_FILE!, 'utf8')), legacy);
  assert.deepEqual(JSON.parse(readFileSync(process.env.FOLIO_SETTINGS_FILE!, 'utf8')).testingAgentSettings, [{ id: 'legacy', revision: 7 }]);
});

test('refuses a shared data/settings path and preserves malformed settings', () => {
  process.env.FOLIO_SETTINGS_FILE = process.env.FOLIO_DATA_FILE;
  assert.throws(() => settingsFilePath(), /andere Datei/);
  const malformed = join(directory, 'malformed.json');
  writeFileSync(malformed, '{kaputt');
  process.env.FOLIO_SETTINGS_FILE = malformed;
  assert.throws(() => settingsDb.find('local'), /kein gültiges JSON.*überschreibt sie nicht/s);
  assert.equal(readFileSync(malformed, 'utf8'), '{kaputt');
});

test('deleting scenario data retains the persisted model configuration', () => {
  const data=join(directory,'reset-scenarios.json'),settings=join(directory,'reset-settings.json');
  process.env.FOLIO_DATA_FILE=data;process.env.FOLIO_SETTINGS_FILE=settings;
  writeFileSync(data,JSON.stringify({testingScenarios:[{id:'temporary'}]}));settingsDb.upsert({id:'local',revision:4,defaultModel:'sol'});
  unlinkSync(data);
  assert.deepEqual(settingsDb.find('local'),{id:'local',revision:4,defaultModel:'sol'});
});

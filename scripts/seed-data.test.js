import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { seedData, seedEnvironment } from './seed-data.js';

const seedsDir = fileURLToPath(new URL('../seeds', import.meta.url));
const definitions = [];
for (const namespace of await readdir(new URL('../schemas', import.meta.url))) {
  const directory = new URL(`../schemas/${namespace}/`, import.meta.url);
  for (const filename of await readdir(directory)) {
    definitions.push(yaml.load(await readFile(new URL(filename, directory), 'utf8')));
  }
}

function fakeApi() {
  const rows = new Map();
  const writes = [];
  const request = async (endpoint, options) => {
    const collection = new URL(endpoint, 'http://localhost').pathname.split('/')[2];
    const definition = definitions.find((item) => item.collection === collection);
    const primary = definition.fields.find((field) => field.schema?.is_primary_key).field;
    const stored = rows.get(collection) ?? [];
    if (!options.method) {
      const filter = new URL(endpoint, 'http://localhost').searchParams.get('filter');
      return { data: definition.meta.singleton ? stored[0] ?? {} :
        filter ? stored.filter((row) => row[primary] === JSON.parse(filter)[primary]._eq) : stored };
    }
    writes.push({ collection, method: options.method, body: options.body });
    stored.push({ [primary]: stored.length + 1, ...options.body });
    rows.set(collection, stored);
    return {};
  };
  return { rows, writes, request };
}

for (const environment of ['dev', 'prod']) {
  test(`${environment} selects existing seeds and remains idempotent`, async () => {
    const api = fakeApi();
    await seedData(definitions, api.request, 'test-token', { environment, seedsDir });
    const selected = [...new Set(api.writes.map((write) => write.collection))].sort();
    assert.deepEqual(selected, (environment === 'prod'
      ? ['languages', 'screen_config', 'screen_sections', 'iqama_times']
      : ['languages', 'screen_config', 'screen_sections', 'iqama_times', 'prayer_times',
        'news', 'events', 'campaigns', 'donations']).sort());
    const count = api.writes.length;
    await seedData(definitions, api.request, 'test-token', { environment, seedsDir });
    assert.equal(api.writes.length, count);
  });
}

test('production preserves existing content and saved singleton without backfill', async () => {
  const api = fakeApi();
  for (const definition of definitions) {
    const primary = definition.fields.find((field) => field.schema?.is_primary_key).field;
    api.rows.set(definition.collection, definition.items
      ? definition.items.map((item) => ({ ...item, name: 'Authored language' }))
      : [{ [primary]: 42 }]);
  }
  const before = structuredClone(api.rows);
  await seedData(definitions, api.request, 'test-token', { environment: 'prod', seedsDir });
  assert.deepEqual(api.writes, []);
  assert.deepEqual(api.rows, before);
});

test('missing environment follows dev convention; unknown values fail before requests', async () => {
  const previous = process.env.CMS_ENV;
  delete process.env.CMS_ENV;
  try {
    assert.equal(seedEnvironment(), 'dev');
  } finally {
    if (previous !== undefined) process.env.CMS_ENV = previous;
  }
  for (const environment of ['', 'production', 'development', 'invalid']) {
    await assert.rejects(seedData(definitions, () => assert.fail('unexpected request'), 'test-token',
      { environment, seedsDir }), /CMS_ENV must be "dev" or "prod"/);
  }
});

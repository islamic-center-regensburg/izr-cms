import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';

const seedsDir = '/directus/seeds';

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function loadSeeds(definitions) {
  let namespaces;
  try {
    namespaces = await readdir(seedsDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const seeds = [];
  const seededCollections = new Set();

  for (const namespace of namespaces.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!namespace.isDirectory()) {
      throw new Error(`Expected a namespace directory in ${seedsDir}: ${namespace.name}`);
    }

    const directory = path.join(seedsDir, namespace.name);
    const files = await readdir(directory, { withFileTypes: true });
    for (const file of files.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!file.isFile() || !/\.ya?ml$/i.test(file.name)) {
        throw new Error(`Expected a YAML file in ${directory}: ${file.name}`);
      }

      const filename = path.join(directory, file.name);
      const seed = yaml.load(await readFile(filename, 'utf8'));
      if (!isObject(seed) || typeof seed.collection !== 'string' || !Array.isArray(seed.items)
        || seed.items.length === 0
        || Object.keys(seed).some((key) => !['collection', 'items'].includes(key))) {
        throw new Error(`Invalid seed file: ${filename}`);
      }

      const definition = definitions.find((item) => item.collection === seed.collection);
      if (!definition) {
        throw new Error(`Seed for unmanaged collection ${seed.collection} in ${filename}`);
      }
      if (seededCollections.has(seed.collection)) {
        throw new Error(`Duplicate seed for collection ${seed.collection} in ${filename}`);
      }
      seededCollections.add(seed.collection);

      const fields = new Set(definition.fields.map((field) => field.field));
      for (const item of seed.items) {
        if (!isObject(item) || Object.keys(item).some((key) => !fields.has(key))) {
          throw new Error(`Invalid seed item in ${filename}`);
        }
      }
      if (definition.meta.singleton === true && seed.items.length !== 1) {
        throw new Error(`Singleton ${seed.collection} must have exactly one seed item: ${filename}`);
      }

      seeds.push({ collection: seed.collection, items: seed.items, definition });
    }
  }

  return seeds;
}

export async function seedExampleData(definitions, request, token) {
  if (process.env.CMS_ENV !== 'dev') {
    console.log('Skipping example data seeding; CMS_ENV is not "dev".');
    return;
  }

  const seeds = await loadSeeds(definitions);
  for (const { collection, items, definition } of seeds) {
    const primary = definition.fields.find((field) => field.schema?.is_primary_key === true).field;
    const endpoint = `/items/${collection}`;

    if (definition.meta.singleton === true) {
      const existing = await request(`${endpoint}?${new URLSearchParams({ fields: '*' })}`, { token });
      if (existing.data?.[primary] == null) {
        await request(endpoint, { method: 'PATCH', body: items[0], token });
        console.log(`Seeded singleton ${collection}.`);
      } else if (collection === 'screen_config') {
        const defaults = {};
        for (const field of ['mode', 'manual_section', 'manual_language']) {
          if (existing.data[field] === undefined
            || (field !== 'manual_section' && existing.data[field] === null)) {
            defaults[field] = items[0][field];
          }
        }
        if (Object.keys(defaults).length > 0) {
          await request(`${endpoint}/${existing.data[primary]}`, { method: 'PATCH', body: defaults, token });
          console.log(`Added missing screen_config defaults: ${Object.keys(defaults).join(', ')}.`);
        }
      }
      continue;
    }

    const existing = await request(`${endpoint}?${new URLSearchParams({ fields: primary, limit: '1' })}`, { token });
    if (existing.data.length === 0) {
      for (const item of items) {
        await request(endpoint, { method: 'POST', body: item, token });
      }
      console.log(`Seeded ${items.length} ${collection} item(s).`);
    }
  }
}

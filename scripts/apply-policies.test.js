import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { applyPolicies } from './apply-policies.js';

const filename = fileURLToPath(new URL('../policies/apps.yaml', import.meta.url));

function fakeApi() {
  const rows = { folders: [], policies: [], permissions: [], users: [], access: [] };
  const calls = [];
  let writes = 0;
  const request = async (endpoint, options = {}) => {
    const url = new URL(endpoint, 'http://localhost');
    const [, collection, id] = url.pathname.split('/');
    const method = options.method ?? 'GET';
    calls.push({ endpoint, method, body: options.body });
    if (method === 'GET') {
      const filter = JSON.parse(url.searchParams.get('filter'));
      const [field, condition] = Object.entries(filter)[0];
      const fields = url.searchParams.get('fields')?.split(',');
      return { data: rows[collection].filter((row) => row[field] === condition._eq)
        .map((row) => fields ? Object.fromEntries(fields.map((key) => [key, row[key]])) : { ...row }) };
    }
    writes++;
    if (method === 'POST') {
      const row = { ...options.body };
      if (collection === 'users') row.email = null;
      if (collection === 'permissions') row.id = rows.permissions.length + 1;
      if (collection === 'access') row.id = `access-${rows.access.length + 1}`;
      rows[collection].push(row);
      return { data: row };
    }
    if (method === 'PATCH') {
      Object.assign(rows[collection].find((row) => String(row.id) === id), options.body);
      return {};
    }
    throw new Error('Unexpected request');
  };
  return { request, rows, calls, get writes() { return writes; } };
}

test('reconciles dedicated read-only policies idempotently and repairs managed fields', async () => {
  const api = fakeApi();
  await applyPolicies(api.request, 'token', filename);
  assert.equal(api.rows.policies.length, 2);
  assert.equal(api.rows.permissions.length, 25);
  assert.deepEqual(api.rows.users.map(({ id, first_name, last_name, email, status, role }) =>
    ({ id, first_name, last_name, email, status, role })), [
    { id: 'fd54cc51-521a-4d0c-b6f7-47949aa53bfe', first_name: 'IZR Screen', last_name: 'API Service', email: null, status: 'active', role: null },
    { id: '9cfece03-1c78-48b6-af2c-5567759de7cc', first_name: 'IZR Website', last_name: 'API Service', email: null, status: 'active', role: null },
  ]);
  assert.deepEqual(api.rows.access.map(({ user, role, policy }) => ({ user, role, policy })), [
    { user: api.rows.users[0].id, role: null, policy: api.rows.policies[0].id },
    { user: api.rows.users[1].id, role: null, policy: api.rows.policies[1].id },
  ]);
  assert.ok(api.rows.policies.every((p) => !p.admin_access && !p.app_access));
  assert.ok(api.rows.permissions.every((p) => p.action === 'read'));
  const count = api.writes;
  api.rows.users[0].token = 'existing-token';
  await applyPolicies(api.request, 'token', filename);
  assert.equal(api.writes, count);
  assert.equal(api.rows.users[0].token, 'existing-token');
  for (const call of api.calls.filter((item) => new URL(item.endpoint, 'http://localhost').pathname === '/users')) {
    assert.ok(!JSON.stringify(call.body ?? {}).includes('token'));
    assert.ok(!JSON.stringify(call.body ?? {}).includes('password'));
    assert.ok(!new URL(call.endpoint, 'http://localhost').searchParams.get('fields').split(',').includes('token'));
  }
  api.rows.permissions.find((p) => p.collection === 'donations').fields = ['*'];
  await applyPolicies(api.request, 'token', filename);
  assert.equal(api.writes, count + 1);
  assert.ok(!api.rows.permissions.find((p) => p.collection === 'donations').fields.includes('*'));
});

test('refuses mismatched users and extra or incorrect direct access', async () => {
  const api = fakeApi();
  await applyPolicies(api.request, 'token', filename);
  const count = api.writes;
  api.rows.users[0].role = 'other-role';
  await assert.rejects(applyPolicies(api.request, 'token', filename), /unexpected attributes/);
  api.rows.users[0].role = null;
  api.rows.users[0].first_name = 'Someone else';
  await assert.rejects(applyPolicies(api.request, 'token', filename), /unexpected attributes/);
  api.rows.users[0].first_name = 'IZR Screen';
  api.rows.access.push({ id: 'extra', user: api.rows.users[0].id, role: null, policy: 'other' });
  await assert.rejects(applyPolicies(api.request, 'token', filename), /Unexpected access/);
  api.rows.access.pop();
  api.rows.access[0].policy = api.rows.policies[1].id;
  await assert.rejects(applyPolicies(api.request, 'token', filename), /Unexpected access/);
  assert.equal(api.writes, count);
});

test('refuses to take over conflicting managed IDs or unexpected permissions', async () => {
  const api = fakeApi();
  await applyPolicies(api.request, 'token', filename);
  api.rows.policies[0].admin_access = true;
  await assert.rejects(applyPolicies(api.request, 'token', filename), /already in use/);
  api.rows.policies[0].admin_access = false;
  api.rows.permissions.push({ policy: api.rows.policies[0].id, collection: 'news', action: 'update' });
  await assert.rejects(applyPolicies(api.request, 'token', filename), /Unexpected permissions/);
});

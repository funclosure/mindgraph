import test from 'node:test';
import assert from 'node:assert/strict';
import { ok } from '../src/operations/result.js';
import { createMemoryStore } from '../src/operations/memoryStore.js';

test('memory store put/get round-trips and merges fields', () => {
  const store = createMemoryStore();
  store.put('a', { md: '# hi' });
  store.put('a', { json: { kind: 'x' } });
  assert.deepEqual(store.get('a'), { md: '# hi', json: { kind: 'x' } });
});

test('memory store get returns null for missing id and list enumerates ids', () => {
  const store = createMemoryStore();
  assert.equal(store.get('missing'), null);
  store.put('a', { md: '1' });
  store.put('b', { md: '2' });
  assert.deepEqual(store.list().sort(), ['a', 'b']);
});

test('memory store seeds from initial entries', () => {
  const store = createMemoryStore({ a: { md: 'seed' } });
  assert.deepEqual(store.get('a'), { md: 'seed' });
});

import { createRegistry } from '../src/operations/registry.js';

const sampleOps = [
  {
    name: 'echo',
    summary: 'echo input back',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    handler: ({ text }) => ok({ text }),
  },
  {
    name: 'boom',
    summary: 'always throws',
    inputSchema: { type: 'object', properties: {} },
    handler: () => { throw new Error('kaboom'); },
  },
];

test('registry runs a known op and returns its Result', () => {
  const reg = createRegistry(sampleOps);
  assert.deepEqual(reg.run('echo', { text: 'hi' }).value, { text: 'hi' });
});

test('registry rejects unknown operations', () => {
  const reg = createRegistry(sampleOps);
  const r = reg.run('nope', {});
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].code, 'unknown_operation');
});

test('registry validates required input before calling handler', () => {
  const reg = createRegistry(sampleOps);
  const r = reg.run('echo', {});
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].code, 'missing_input');
  assert.equal(r.errors[0].path, 'text');
});

test('registry checks declared property types', () => {
  const reg = createRegistry(sampleOps);
  const r = reg.run('echo', { text: 123 });
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].code, 'invalid_input');
});

test('registry traps handler exceptions as operational errors', () => {
  const reg = createRegistry(sampleOps);
  const r = reg.run('boom', {});
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].code, 'operation_threw');
  assert.match(r.errors[0].message, /kaboom/);
});

test('registry list exposes name/summary/inputSchema only', () => {
  const reg = createRegistry(sampleOps);
  const listed = reg.list().find((o) => o.name === 'echo');
  assert.deepEqual(Object.keys(listed).sort(), ['inputSchema', 'name', 'summary']);
});

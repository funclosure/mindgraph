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

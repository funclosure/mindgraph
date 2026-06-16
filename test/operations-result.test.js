import test from 'node:test';
import assert from 'node:assert/strict';
import { ok, err, errorItem } from '../src/operations/result.js';

test('ok wraps a value and is ok', () => {
  const r = ok({ a: 1 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { a: 1 });
  assert.deepEqual(r.errors, []);
});

test('err carries a single error item as an array', () => {
  const r = err(errorItem('bad_input', 'nope', 'field'));
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 1);
  assert.deepEqual(r.errors[0], { code: 'bad_input', message: 'nope', path: 'field' });
});

test('err accepts an array of error items', () => {
  const r = err([errorItem('a', 'x'), errorItem('b', 'y')]);
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 2);
});

test('errorItem omits path when not provided', () => {
  assert.deepEqual(errorItem('c', 'm'), { code: 'c', message: 'm' });
});

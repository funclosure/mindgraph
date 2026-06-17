import test from 'node:test';
import assert from 'node:assert/strict';
import { captureAnchor } from '../ui/anchor-snapshot.js';

test('captureAnchor returns the anchor position copy when present', () => {
  const positions = { a: { x: 10, y: 20 }, b: { x: 1, y: 2 } };
  assert.deepEqual(captureAnchor(positions, 'a'), { x: 10, y: 20 });
});

test('captureAnchor returns a copy, not a reference', () => {
  const positions = { a: { x: 10, y: 20 } };
  const snap = captureAnchor(positions, 'a');
  positions.a.x = 999;
  assert.equal(snap.x, 10);
});

test('captureAnchor returns null for a missing or absent anchor', () => {
  assert.equal(captureAnchor({ a: { x: 1, y: 1 } }, 'missing'), null);
  assert.equal(captureAnchor({}, undefined), null);
  assert.equal(captureAnchor(null, 'a'), null);
});

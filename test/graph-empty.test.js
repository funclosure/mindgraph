import test from 'node:test';
import assert from 'node:assert/strict';
import { renderGraphEmpty } from '../ui/panels/graph-empty.js';

test('renderGraphEmpty shows guidance when a graph has 0 atomic concepts', () => {
  const html = renderGraphEmpty({ concepts: { atomic: [], clustered: [] } });
  assert.match(html, /skeleton/i);
  assert.match(html, /agent/i);
  assert.ok(html.length > 0);
});

test('renderGraphEmpty is empty when the graph has concepts', () => {
  const html = renderGraphEmpty({ concepts: { atomic: [{ id: 'a' }], clustered: [] } });
  assert.equal(html, '');
});

test('renderGraphEmpty tolerates a missing view model', () => {
  assert.equal(renderGraphEmpty(null), '');
  assert.equal(renderGraphEmpty({}), '');
});

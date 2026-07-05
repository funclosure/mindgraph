import test from 'node:test';
import assert from 'node:assert/strict';
import { describeProduceState, produceGuidanceLines } from '../src/core/produceState.js';

test('describeProduceState flags a 0-concept skeleton and gives agent-first guidance', () => {
  const doc = {
    kind: 'mindgraph.document',
    concepts: { atomic: [], clustered: [] },
    transcript: { segments: [{ id: 's1' }] },
    frames: { micro: [{ t: 0 }], meso: [], macro: [] },
  };
  const state = describeProduceState(doc, { docPath: 'graphs/foo.mindgraph.json' });
  assert.equal(state.skeleton, true);
  assert.equal(state.conceptCount, 0);
  const text = state.guidance.join('\n');
  assert.match(text, /skeleton/i, 'explains the doc is a skeleton');
  assert.match(text, /agent|skill/i, 'points at the agent/skill path');
  assert.match(text, /mindgraph author/, 'mentions the one-command author path');
  assert.match(text, /graphs\/foo\.mindgraph\.json/, 'echoes the doc path in a command');
});

test('describeProduceState treats a graph with concepts as ready (no guidance)', () => {
  const doc = { concepts: { atomic: [{ id: 'a' }], clustered: [] } };
  const state = describeProduceState(doc, { docPath: 'x.json' });
  assert.equal(state.skeleton, false);
  assert.equal(state.conceptCount, 1);
  assert.deepEqual(state.guidance, []);
});

test('produceGuidanceLines echoes the doc path for callers that only have a path', () => {
  const lines = produceGuidanceLines('graphs/bar.mindgraph.json');
  assert.ok(Array.isArray(lines) && lines.length > 0);
  assert.match(lines.join('\n'), /mindgraph author graphs\/bar\.mindgraph\.json/);
});

test('describeProduceState tolerates a malformed document', () => {
  const state = describeProduceState(null, { docPath: 'x.json' });
  assert.equal(state.conceptCount, 0);
  assert.equal(state.skeleton, true);
});

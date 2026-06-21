import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NODE_ALPHA,
  nodeTier,
  nodeEmphasis,
  edgeTier,
  edgeStyle,
} from '../ui/emphasis.js';

const sets = (sel = [], dim = [], act = []) => ({
  selected: new Set(sel),
  dimmed: new Set(dim),
  active: new Set(act),
});

test('node tier precedence: selected > dimmed > active > revealed', () => {
  // A node flagged in ALL three sets still resolves to the highest tier.
  assert.equal(nodeTier('a', sets(['a'], ['a'], ['a'])), 'selected');
  // dimmed beats active — the spotlight invariant (overview marks ~everything active).
  assert.equal(nodeTier('a', sets([], ['a'], ['a'])), 'dimmed');
  assert.equal(nodeTier('a', sets([], [], ['a'])), 'active');
  assert.equal(nodeTier('a', sets([], [], [])), 'revealed');
});

test('node style values match the frozen table', () => {
  assert.deepEqual(nodeEmphasis('a', sets(['a'])), { alpha: 1.0, tint: 0.0 });
  assert.deepEqual(nodeEmphasis('a', sets([], ['a'], ['a'])), { alpha: 0.22, tint: 0.0 });
  assert.deepEqual(nodeEmphasis('a', sets([], [], ['a'])), { alpha: 0.95, tint: 1.0 });
  assert.deepEqual(nodeEmphasis('a', sets()), { alpha: 0.85, tint: 0.0 });
  assert.equal(NODE_ALPHA.dimmed, 0.22); // table is the single home for the constant
});

test('prominence (alpha) and activation (tint) are independent axes', () => {
  // A selected node that is ALSO the current reading focus shows BOTH the
  // selection prominence (alpha 1.0 + ring) and the active glow (tint 1.0).
  // A single-tier model would force tint 0 here and silently drop the glow.
  assert.deepEqual(nodeEmphasis('a', sets(['a'], [], ['a'])), { alpha: 1.0, tint: 1.0 });
  // ...but an active node dimmed out of a spotlight loses the glow (tint 0).
  assert.deepEqual(nodeEmphasis('a', sets([], ['a'], ['a'])), { alpha: 0.22, tint: 0.0 });
});

const eSets = (selNodes = [], dimEdges = [], actEdges = []) => ({
  selectedNodes: new Set(selNodes),
  dimmedEdges: new Set(dimEdges),
  activeEdges: new Set(actEdges),
});

test('edge tier precedence: onSelection > dimmed > active > inferred > passive', () => {
  const e = { id: 'e', from: 'x', to: 'y', provenance: 'inferred' };
  assert.equal(edgeTier(e, eSets(['x'], ['e'], ['e'])), 'onSelection');
  assert.equal(edgeTier(e, eSets([], ['e'], ['e'])), 'dimmed');
  assert.equal(edgeTier(e, eSets([], [], ['e'])), 'active');
  assert.equal(edgeTier(e, eSets([], [], [])), 'inferred');
  assert.equal(edgeTier({ id: 'e', from: 'x', to: 'y' }, eSets()), 'passive');
});

test('edge style values + dash match the prior renderer', () => {
  const e = { id: 'e', from: 'x', to: 'y' };
  assert.deepEqual(pick(edgeStyle(e, { ...eSets(['x']), animOpacity: 1 })), { alpha: 0.95, lineWidth: 1.4, dash: [] });
  assert.deepEqual(pick(edgeStyle(e, { ...eSets([], ['e']), animOpacity: 1 })), { alpha: 0.06, lineWidth: 0.5, dash: [] });
  assert.deepEqual(pick(edgeStyle(e, { ...eSets([], [], ['e']), animOpacity: 1 })), { alpha: 0.95, lineWidth: 1.0, dash: [] });
  assert.deepEqual(pick(edgeStyle(e, { ...eSets(), animOpacity: 1 })), { alpha: 0.16, lineWidth: 0.6, dash: [] });
  // Inferred passive → wider dash + bumped alpha; inferred on-path → wide [7,4].
  const inf = { id: 'e', from: 'x', to: 'y', provenance: 'inferred' };
  assert.deepEqual(pick(edgeStyle(inf, { ...eSets(), animOpacity: 1 })), { alpha: 0.22, lineWidth: 0.8, dash: [6, 4] });
  assert.deepEqual(edgeStyle(inf, { ...eSets(['x']), animOpacity: 1 }).dash, [7, 4]);
});

function pick(s) {
  return { alpha: s.alpha, lineWidth: s.lineWidth, dash: s.dash };
}

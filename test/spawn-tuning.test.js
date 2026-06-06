import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnimator } from '../ui/animator.js';
import { createLayoutSimulator } from '../ui/layout.js';

function concept(id) {
  return { id, label: id, level: 'atomic', parentIds: [], childIds: [], firstSeenAt: 0 };
}

function edge(id, from, to) {
  return { id, from, to, type: 'related', weight: 1, provenance: 'source' };
}

function vm({ concepts, edges }) {
  const byId = Object.fromEntries(concepts.map((c) => [c.id, c]));
  return {
    concepts: { atomic: concepts, clustered: [], byId, childrenByClusterId: {}, clustersByAtomicId: {} },
    graph: {
      nodes: concepts.map((c) => ({ ...c, degree: edges.filter((e) => e.from === c.id || e.to === c.id).length })),
      edges,
      nodeById: byId,
      coOccurrence: {},
      conceptImportance: {},
    },
    frames: { micro: [], meso: [], macro: [{ span: { start: 0, end: 1 } }] },
  };
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

test('layout config controls bloom placement distance and jitter', () => {
  const document = vm({ concepts: [concept('hub'), concept('newbie')], edges: [edge('e', 'hub', 'newbie')] });
  const sim = createLayoutSimulator(document, { config: { bloomNeighborDistance: 180, bloomHubDistanceBonus: 0, bloomJitter: 0 } });
  const hubBefore = { ...sim.positions.hub };

  sim.placeForBloom('newbie', new Set(['hub']));

  assert.ok(Math.abs(dist(hubBefore, sim.positions.newbie) - 180) < 0.001);
  assert.equal(sim.layoutMeta.config.bloomNeighborDistance, 180);
});

test('layout config controls physics alpha half-life', () => {
  const document = vm({ concepts: [concept('a'), concept('b')], edges: [edge('e', 'a', 'b')] });
  const fast = createLayoutSimulator(document, { config: { alphaHalfLifeFrames: 30 } });
  const slow = createLayoutSimulator(document, { config: { alphaHalfLifeFrames: 240 } });
  fast.reheat(1);
  slow.reheat(1);

  fast.step(1 / 60);
  slow.step(1 / 60);

  assert.ok(slow.alpha > fast.alpha, `expected slow alpha ${slow.alpha} > fast alpha ${fast.alpha}`);
});

test('animator bloom reheat strength controls simulator reheat on new nodes', () => {
  const animator = createAnimator({ config: { bloomReheatStrength: 0.45 } });
  const calls = [];
  const sim = {
    placeForBloom() {},
    unpin() {},
    reheat(value) { calls.push(value); },
    isSettled() { return true; },
  };

  animator.step(0, { cumulativeVisibleConceptIds: ['hub'], cumulativeVisibleEdgeIds: [], sim, dt: 1 / 60 });
  animator.step(1, { cumulativeVisibleConceptIds: ['hub', 'newbie'], cumulativeVisibleEdgeIds: [], sim, dt: 1 / 60 });

  assert.deepEqual(calls, [0.45]);
});

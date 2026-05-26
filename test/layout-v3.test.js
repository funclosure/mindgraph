import test from 'node:test';
import assert from 'node:assert/strict';
import { createLayoutSimulator } from '../ui/layout.js';

function concept(id, parentIds = []) {
  return {
    id,
    label: id,
    level: 'atomic',
    parentIds,
    childIds: [],
    firstSeenAt: 0,
  };
}

function edge(id, from, to, weight = 1) {
  return { id, from, to, type: 'related', weight, provenance: 'source' };
}

function vm({ concepts, edges, coOccurrence = {}, importance = {} }) {
  const byId = Object.fromEntries(concepts.map((c) => [c.id, c]));
  return {
    concepts: {
      atomic: concepts,
      clustered: [],
      byId,
      childrenByClusterId: {},
      clustersByAtomicId: {},
    },
    graph: {
      nodes: concepts.map((c) => ({ ...c, degree: edges.filter((e) => e.from === c.id || e.to === c.id).length })),
      edges,
      nodeById: byId,
      coOccurrence,
      conceptImportance: importance,
    },
    frames: { micro: [], meso: [], macro: [{ span: { start: 0, end: 1 } }] },
  };
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function average(values) {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function step(sim, frames = 180) {
  for (let i = 0; i < frames; i += 1) sim.step(1 / 60);
}

test('hub leaves settle into a wider ring than a simple pair', () => {
  const hubConcepts = [concept('hub'), ...Array.from({ length: 8 }, (_, i) => concept(`leaf-${i}`))];
  const hubVm = vm({
    concepts: hubConcepts,
    edges: hubConcepts.slice(1).map((c, i) => edge(`e-${i}`, 'hub', c.id)),
    importance: { hub: 1 },
  });
  const hubSim = createLayoutSimulator(hubVm);
  hubSim.reheat(1);
  step(hubSim, 240);

  const hub = hubSim.positions.hub;
  const ringDistances = hubConcepts.slice(1).map((c) => dist(hub, hubSim.positions[c.id]));
  const ringAverage = average(ringDistances);

  const pairVm = vm({ concepts: [concept('a'), concept('b')], edges: [edge('ab', 'a', 'b')] });
  const pairSim = createLayoutSimulator(pairVm);
  pairSim.reheat(1);
  step(pairSim, 240);
  const pairDistance = dist(pairSim.positions.a, pairSim.positions.b);

  assert.ok(ringAverage > pairDistance + 8, `expected hub ring ${ringAverage} > pair ${pairDistance} + 8`);
  assert.ok(ringAverage > 90, `expected visible hub orbit, got ${ringAverage}`);
});

test('cluster-only sibling concepts are not pulled together without relation edges', () => {
  const document = vm({
    concepts: [concept('a', ['cluster-x']), concept('b', ['cluster-x']), concept('c', ['cluster-x'])],
    edges: [],
  });
  const sim = createLayoutSimulator(document);
  sim.reheat(1);
  step(sim, 180);

  const ab = dist(sim.positions.a, sim.positions.b);
  const bc = dist(sim.positions.b, sim.positions.c);
  const ac = dist(sim.positions.a, sim.positions.c);
  assert.ok(average([ab, bc, ac]) > 100, `cluster-only siblings should not collapse, distances: ${ab}, ${bc}, ${ac}`);
});

test('placeForBloom moves a new node near its strongest visible relation neighbor', () => {
  const document = vm({
    concepts: [concept('hub'), concept('newbie'), concept('other')],
    edges: [edge('hub-newbie', 'hub', 'newbie'), edge('hub-other', 'hub', 'other')],
    importance: { hub: 1 },
  });
  const sim = createLayoutSimulator(document);
  const before = { ...sim.positions.newbie };
  const hubBefore = { ...sim.positions.hub };

  assert.equal(typeof sim.placeForBloom, 'function');
  sim.placeForBloom('newbie', new Set(['hub', 'other']));

  const after = sim.positions.newbie;
  const moved = dist(before, after);
  const nearHub = dist(hubBefore, after);
  assert.ok(moved > 1, `expected bloom placement to move node, moved ${moved}`);
  assert.ok(nearHub >= 60 && nearHub <= 180, `expected bloom node near hub orbit, got ${nearHub}`);
});

test('step uses dt for smooth alpha decay', () => {
  const document = vm({ concepts: [concept('a'), concept('b')], edges: [edge('ab', 'a', 'b')] });
  const simA = createLayoutSimulator(document);
  const simB = createLayoutSimulator(document);
  simA.reheat(1);
  simB.reheat(1);

  simA.step(1 / 60);
  simB.step(1 / 30);

  assert.ok(simB.alpha < simA.alpha, `larger dt should decay alpha more: ${simB.alpha} < ${simA.alpha}`);
  assert.ok(simA.alpha > 0.9, `single 60fps frame should not overcool alpha, got ${simA.alpha}`);
});

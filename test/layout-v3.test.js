import test from 'node:test';
import assert from 'node:assert/strict';
import { createLayoutSimulator } from '../ui/layout.js';
import { buildGraphRenderState } from '../src/view-model/buildGraphRenderState.js';
import { edgeRenderStyle } from '../ui/draw.js';

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

function vm({ concepts, edges, coOccurrence = {}, importance = {}, sourceFlow }) {
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
    ...(sourceFlow ? { sourceFlow } : {}),
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

test('source-section concepts get weak cohesion without explicit relation edges', () => {
  const concepts = [concept('a'), concept('b'), concept('c'), concept('d')];
  const loose = createLayoutSimulator(vm({ concepts, edges: [] }));
  loose.reheat(1);
  step(loose, 240);

  const grouped = createLayoutSimulator(vm({
    concepts,
    edges: [],
    sourceFlow: {
      readerSteps: [
        {
          id: 'step-1',
          sourceSegmentIds: [],
          foregroundConcepts: concepts.map((c) => ({ id: c.id, weight: 1 })),
        },
      ],
      sections: [
        {
          id: 'section-1',
          sourceFrameRefs: [{ level: 'readerStep', index: 0 }],
        },
      ],
    },
  }));
  grouped.reheat(1);
  step(grouped, 240);

  const pairIds = [['a', 'b'], ['a', 'c'], ['a', 'd'], ['b', 'c'], ['b', 'd'], ['c', 'd']];
  const looseAverage = average(pairIds.map(([a, b]) => dist(loose.positions[a], loose.positions[b])));
  const groupedAverage = average(pairIds.map(([a, b]) => dist(grouped.positions[a], grouped.positions[b])));

  assert.ok(
    groupedAverage < looseAverage - 5 && groupedAverage > looseAverage - 18,
    `expected source-section cohesion to be weak: grouped ${groupedAverage}, loose ${looseAverage}`,
  );
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
  assert.ok(nearHub >= 88 && nearHub <= 180, `expected bloom node outside local separation floor near hub orbit, got ${nearHub}`);
});

test('placeForBloom keeps ordinary new nodes outside unrelated separation floor', () => {
  const document = vm({
    concepts: [concept('neighbor'), concept('newbie')],
    edges: [edge('neighbor-newbie', 'neighbor', 'newbie')],
  });
  const sim = createLayoutSimulator(document);
  const neighborBefore = { ...sim.positions.neighbor };

  sim.placeForBloom('newbie', new Set(['neighbor']));

  const bloomDistance = dist(neighborBefore, sim.positions.newbie);
  assert.ok(bloomDistance >= 88, `expected ordinary bloom distance outside separation floor, got ${bloomDistance}`);
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

test('warm-start alpha is calm enough to ease into first render', () => {
  const document = vm({ concepts: [concept('a'), concept('b')], edges: [edge('ab', 'a', 'b')] });
  const sim = createLayoutSimulator(document);
  assert.ok(sim.alpha <= 0.25, `expected calm initial alpha <= 0.25, got ${sim.alpha}`);
});

test('overview mode renders all bloomed atomic dots and their visible edges', () => {
  const concepts = Array.from({ length: 40 }, (_, i) => concept(`n-${i}`));
  const edges = Array.from({ length: 39 }, (_, i) => edge(`e-${i}`, `n-${i}`, `n-${i + 1}`));
  const document = vm({ concepts, edges });
  document.selectors = {
    getActiveFrameAtTime: () => null,
    getActiveConceptIdsAtTime: () => [],
    getActiveRelationActivationsAtTime: () => [],
    getConceptNeighbors: (id) => edges.flatMap((e) => (
      e.from === id ? [document.concepts.byId[e.to]] : e.to === id ? [document.concepts.byId[e.from]] : []
    )),
    getConceptClusters: () => [],
    getFrame: () => null,
    getFrameConcepts: () => [],
  };
  const layout = {
    nodes: Object.fromEntries(concepts.map((c, i) => [c.id, { x: i * 20, y: 0 }])),
    bounds: { minX: 0, minY: 0, maxX: 780, maxY: 0 },
  };

  const renderState = buildGraphRenderState(document, {
    playheadTime: 0,
    activeLevel: 'macro',
    zoomLevel: 0.5,
    layout,
    viewport: { width: 1000, height: 600 },
  });

  const visible = new Set(renderState.visibleNodeIds);
  const visibleEdges = new Set(renderState.visibleEdgeIds);
  for (const c of concepts) assert.ok(visible.has(c.id), `expected ${c.id} visible in overview`);
  for (const e of edges) assert.ok(visibleEdges.has(e.id), `expected ${e.id} visible when both endpoints are bloomed`);
});

test('unrelated concepts that start too close separate beyond local floor', () => {
  const concepts = Array.from({ length: 12 }, (_, i) => concept(`n-${i}`));
  const document = vm({ concepts, edges: [] });
  const sim = createLayoutSimulator(document);
  concepts.forEach((c, i) => {
    sim.positions[c.id].x = (i % 4) * 10;
    sim.positions[c.id].y = Math.floor(i / 4) * 10;
  });
  sim.reheat(1);
  step(sim, 180);

  let minDistance = Infinity;
  for (let i = 0; i < concepts.length; i += 1) {
    for (let j = i + 1; j < concepts.length; j += 1) {
      minDistance = Math.min(minDistance, dist(sim.positions[concepts[i].id], sim.positions[concepts[j].id]));
    }
  }
  assert.ok(minDistance >= 85, `expected crowded unrelated concepts to separate beyond 85, got ${minDistance}`);
});

test('inferred passive edges render more legibly than source passive edges', () => {
  const source = edgeRenderStyle({ provenance: undefined }, { touchesSelection: false, isActive: false, animOpacity: 1 });
  const inferred = edgeRenderStyle({ provenance: 'inferred' }, { touchesSelection: false, isActive: false, animOpacity: 1 });

  assert.deepEqual(inferred.dash, [6, 4]);
  assert.ok(inferred.alpha > source.alpha, `expected inferred alpha ${inferred.alpha} > source ${source.alpha}`);
  assert.ok(inferred.lineWidth > source.lineWidth, `expected inferred width ${inferred.lineWidth} > source ${source.lineWidth}`);
});

function maxRadius(sim, concepts) {
  return Math.max(...concepts.map((c) => Math.hypot(sim.positions[c.id].x, sim.positions[c.id].y)));
}

test('fragmented sparse graphs settle within a cohesive field', () => {
  const concepts = Array.from({ length: 12 }, (_, i) => concept(`sparse-${i}`));
  const edges = [
    edge('a', 'sparse-0', 'sparse-1'),
    edge('b', 'sparse-2', 'sparse-3'),
    edge('c', 'sparse-4', 'sparse-5'),
    edge('d', 'sparse-6', 'sparse-7'),
  ];
  const document = vm({ concepts, edges });
  const sim = createLayoutSimulator(document);
  sim.reheat(1);
  step(sim, 260);

  assert.equal(sim.layoutMeta.fragmented, true);
  assert.ok(maxRadius(sim, concepts) < 240, `expected sparse graph max radius < 240, got ${maxRadius(sim, concepts)}`);
});

test('dense hub graphs preserve breathing room under adaptive cohesion', () => {
  const concepts = [concept('hub'), ...Array.from({ length: 10 }, (_, i) => concept(`dense-${i}`))];
  const edges = concepts.slice(1).map((c, i) => edge(`dense-edge-${i}`, 'hub', c.id));
  const document = vm({ concepts, edges, importance: { hub: 1 } });
  const sim = createLayoutSimulator(document);
  sim.reheat(1);
  step(sim, 260);

  const hub = sim.positions.hub;
  const avgLeafDistance = average(concepts.slice(1).map((c) => dist(hub, sim.positions[c.id])));
  assert.equal(sim.layoutMeta.fragmented, false);
  assert.ok(avgLeafDistance > 90, `expected dense hub breathing room > 90, got ${avgLeafDistance}`);
});

test('layout config overrides relation rest distance', () => {
  const document = vm({ concepts: [concept('a'), concept('b')], edges: [edge('ab', 'a', 'b')] });
  const compact = createLayoutSimulator(document, { config: { baseLinkDistance: 60 } });
  compact.reheat(1);
  step(compact, 240);

  const loose = createLayoutSimulator(document, { config: { baseLinkDistance: 140 } });
  loose.reheat(1);
  step(loose, 240);

  const compactDistance = dist(compact.positions.a, compact.positions.b);
  const looseDistance = dist(loose.positions.a, loose.positions.b);
  assert.ok(looseDistance > compactDistance + 30, `expected loose distance ${looseDistance} > compact ${compactDistance} + 30`);
  assert.equal(loose.layoutMeta.config.baseLinkDistance, 140);
});

test('updateConfig changes simulator config and reheats layout', () => {
  const document = vm({ concepts: [concept('a'), concept('b')], edges: [edge('ab', 'a', 'b')] });
  const sim = createLayoutSimulator(document, { config: { baseLinkDistance: 60 } });
  sim.alpha = 0;

  sim.updateConfig({ baseLinkDistance: 130 });

  assert.equal(sim.layoutMeta.config.baseLinkDistance, 130);
  assert.ok(sim.alpha > 0, `expected updateConfig to reheat, got alpha ${sim.alpha}`);
});

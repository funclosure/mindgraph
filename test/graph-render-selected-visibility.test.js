import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registry } from '../src/operations/index.js';
import { buildMindgraphViewModel } from '../src/view-model/buildMindgraphViewModel.js';
import { buildGraphRenderState } from '../src/view-model/buildGraphRenderState.js';

const MD = `---
kind: mindgraph.authoring
version: 1
title: T
runtime: t.json
duration_seconds: 600
---

# Sources

@source s
type: article
title: S
path: /tmp/s.txt

# Source Blocks

@block b1 source=s kind=paragraph
Early idea appears here at the start.

@block b2 source=s kind=paragraph
Late idea appears much later in the piece.

# Concepts

@concept early-idea
label: Early idea
aliases: Early idea
first_seen: b1

@concept late-idea
label: Late idea
aliases: Late idea
first_seen: b2

# Reader Steps

@step st1 section=sec blocks=b1
summary: Early.
focus:
  - early-idea 0.9

@step st2 section=sec blocks=b2
summary: Late.
focus:
  - late-idea 0.9
  - early-idea 0.3 latent
relations:
  - early-idea -> late-idea leads_to 0.7

# Sections

@section sec
title: Sec
summary: Sec.
steps: st1, st2
`;

function vm() {
  const doc = registry.run('compile', { markdown: MD }).value.document;
  return buildMindgraphViewModel(doc);
}

test('a concept that first appears after the playhead is gated out when not selected', () => {
  const state = buildGraphRenderState(vm(), { playheadTime: 10, activeLevel: 'readerStep' });
  assert.ok(!state.visibleNodeIds.includes('late-idea'), 'late-idea is past the playhead, so hidden');
});

test('selecting that concept reveals it on the graph despite the playhead', () => {
  const state = buildGraphRenderState(vm(), { playheadTime: 10, activeLevel: 'readerStep', selectedConceptId: 'late-idea' });
  assert.ok(state.visibleNodeIds.includes('late-idea'), 'selected concept stays visible past the playhead');
  assert.ok(state.selectedNodeIds.includes('late-idea'));
});

test('mode is reading without a selection and spotlight with one', () => {
  const reading = buildGraphRenderState(vm(), { playheadTime: 1e9, activeLevel: 'overview' });
  assert.equal(reading.mode, 'reading');
  const spotlight = buildGraphRenderState(vm(), { playheadTime: 1e9, activeLevel: 'overview', selectedConceptId: 'early-idea' });
  assert.equal(spotlight.mode, 'spotlight');
});

// Two sections, two unrelated concepts (no relation, so neither is the other's
// neighbor). Lets us prove the Whole-map reading spotlight: at overview, reading
// section B must spotlight B and dim A even though A is visible.
const MD2 = `---
kind: mindgraph.authoring
version: 1
title: T2
runtime: t2.json
duration_seconds: 600
---

# Sources

@source s
type: article
title: S
path: /tmp/s.txt

# Source Blocks

@block b1 source=s kind=paragraph
Alpha concept shows up first in the opening part of the piece.

@block b2 source=s kind=paragraph
Beta concept appears later in the second part of the piece entirely.

# Concepts

@concept alpha
label: Alpha
aliases: Alpha
first_seen: b1

@concept beta
label: Beta
aliases: Beta
first_seen: b2

# Reader Steps

@step sa section=secA blocks=b1
summary: Alpha.
focus:
  - alpha 0.9

@step sb section=secB blocks=b2
summary: Beta.
focus:
  - beta 0.9

# Sections

@section secA
title: A
summary: A.
steps: sa

@section secB
title: B
summary: B.
steps: sb
`;

function vm2() {
  const doc = registry.run('compile', { markdown: MD2 }).value.document;
  return buildMindgraphViewModel(doc);
}

test('Whole map shows every node but backdrops the off-section ones (section stays bright)', () => {
  // Playhead inside section B, camera pulled all the way out (overview/Whole map).
  const state = buildGraphRenderState(vm2(), { playheadTime: 450, activeLevel: 'overview' });
  assert.equal(state.mode, 'reading');
  // Whole map never HIDES anything — every concept stays on screen…
  assert.ok(state.visibleNodeIds.includes('alpha') && state.visibleNodeIds.includes('beta'));
  // …but the off-section concept falls to the backdrop while section B stays bright
  // and glowing, so the section isn't lost in a field of equally bright dots.
  assert.ok(state.dimmedNodeIds.includes('alpha'), 'off-section alpha is backdropped');
  assert.ok(!state.dimmedNodeIds.includes('beta'), 'current-section beta stays bright');
  assert.deepEqual([...state.activeNodeIds].sort(), ['beta'], 'only section B glows');
  assert.deepEqual(state.focusConceptIds, ['beta'], 'Ask focuses the current section');
});

test('Whole map shows the entire graph regardless of how far you have read', () => {
  // Playhead at the very start: beta (first seen later) is NOT yet revealed while
  // reading — but Whole map shows the whole map, so it must be visible anyway.
  const start = buildGraphRenderState(vm2(), { playheadTime: 1, activeLevel: 'overview' });
  assert.ok(start.visibleNodeIds.includes('beta'), 'Whole map shows future concepts too');
  assert.ok(start.visibleNodeIds.includes('alpha'));

  // The narrower reading levels keep the progressive reveal: beta stays hidden.
  const reading = buildGraphRenderState(vm2(), { playheadTime: 1, activeLevel: 'readerStep' });
  assert.ok(!reading.visibleNodeIds.includes('beta'), 'reading levels still gate by the playhead');
});

test('Section focus DOES dim down to the current section (that is the point of it)', () => {
  const state = buildGraphRenderState(vm2(), { playheadTime: 450, activeLevel: 'section' });
  assert.equal(state.mode, 'reading');
  assert.ok(state.dimmedNodeIds.includes('alpha'), 'off-section alpha dims at Section focus');
  assert.ok(!state.dimmedNodeIds.includes('beta'), 'current-section beta stays bright');
});

test('dimmedEdgeIds: none without a focus; off-focus edges dim under a focus', () => {
  // Reading at the overview tail: past the last section, so there's no current
  // section → no focus → no edge is dimmed (the whole backdrop stays).
  const reading = buildGraphRenderState(vm(), { playheadTime: 1e9, activeLevel: 'overview' });
  assert.deepEqual(reading.dimmedEdgeIds, []);

  // A focus (here an explicit selection; reading-with-a-section uses the same
  // path) keeps edges touching it and dims every other visible edge.
  const spotlight = buildGraphRenderState(vm(), { playheadTime: 1e9, activeLevel: 'overview', selectedConceptId: 'early-idea' });
  const dimmed = new Set(spotlight.dimmedEdgeIds);
  // A visible edge is dimmed iff it does NOT touch the selected node.
  const relations = registry.run('compile', { markdown: MD }).value.document.relations;
  for (const r of relations) {
    if (!spotlight.visibleEdgeIds.includes(r.id)) continue;
    const touches = r.from === 'early-idea' || r.to === 'early-idea';
    assert.equal(dimmed.has(r.id), !touches, `edge ${r.id} dim state should be ${!touches}`);
  }
});

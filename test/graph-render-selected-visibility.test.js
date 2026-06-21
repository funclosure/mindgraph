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

test('dimmedEdgeIds: empty in reading mode; off-selection edges in spotlight mode', () => {
  // Reading mode: no edge is spotlight-dimmed.
  const reading = buildGraphRenderState(vm(), { playheadTime: 1e9, activeLevel: 'overview' });
  assert.deepEqual(reading.dimmedEdgeIds, []);

  // Spotlight on early-idea: the early→late edge touches the selection (not
  // dimmed); any visible edge that does NOT touch early-idea is dimmed.
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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registry } from '../src/operations/index.js';
import { buildNodeContext } from '../src/server/nodeContext.js';

const MD = `---
kind: mindgraph.authoring
version: 1
title: Doc
runtime: doc.mindgraph.json
duration_seconds: 60
---

# Sources

@source s
type: article
title: S
path: /tmp/s.txt

# Source Blocks

@block b1 source=s kind=paragraph
Powerful AI could arrive soon and reframes everything.

@block b2 source=s kind=paragraph
The recursive loop means each model helps build the next.

# Concepts

@concept powerful-ai
label: Powerful AI
aliases: powerful AI
first_seen: b1

@concept recursive-loop
label: Recursive loop
aliases: recursive loop
first_seen: b2

# Reader Steps

@step st1 section=sec blocks=b1,b2
summary: Intro.
focus:
  - powerful-ai 0.9
  - recursive-loop 0.7
relations:
  - recursive-loop -> powerful-ai accelerates 0.8

# Sections

@section sec
title: Sec
summary: Sec.
steps: st1
`;

test('buildNodeContext returns the concept, its foregrounding blocks, and neighbors', () => {
  const doc = registry.run('compile', { markdown: MD }).value.document;
  const ctx = buildNodeContext(doc, 'powerful-ai');

  assert.equal(ctx.concept.id, 'powerful-ai');
  assert.equal(ctx.concept.label, 'Powerful AI');
  assert.deepEqual(ctx.concept.aliases, ['powerful AI']);

  const blockTexts = ctx.blocks.map((b) => b.text);
  assert.ok(blockTexts.some((t) => /Powerful AI could arrive/.test(t)), 'includes the foregrounding block');

  const neighbor = ctx.neighbors.find((n) => n.id === 'recursive-loop');
  assert.ok(neighbor, 'recursive-loop is a neighbor');
  assert.equal(neighbor.label, 'Recursive loop');
  assert.equal(neighbor.type, 'accelerates');
});

test('buildNodeContext falls back to first-seen block when no step foregrounds the concept', () => {
  const doc = registry.run('compile', { markdown: MD }).value.document;
  const ctx = buildNodeContext(doc, 'recursive-loop');
  assert.ok(ctx.blocks.length >= 1);
  assert.ok(ctx.blocks.some((b) => b.id === 'b2'));
});

test('buildNodeContext on an unknown concept returns empty context, not a throw', () => {
  const doc = registry.run('compile', { markdown: MD }).value.document;
  const ctx = buildNodeContext(doc, 'nope');
  assert.equal(ctx.concept, null);
  assert.deepEqual(ctx.blocks, []);
  assert.deepEqual(ctx.neighbors, []);
});

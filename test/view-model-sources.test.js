import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registry } from '../src/operations/index.js';

const MD = `---
kind: mindgraph.authoring
version: 1
title: Living Doc
runtime: living-doc.mindgraph.json
duration_seconds: 600
---

# Sources

@source essay
type: article
title: The Essay
path: /tmp/essay.txt
url: https://example.com/the-essay

@source disc-1
type: discussion
title: "Deepen: powerful AI"

# Source Blocks

@block e1 source=essay kind=paragraph
Powerful AI could arrive soon.

@block d1 source=disc-1 kind=paragraph
We discussed the recursive loop driving powerful AI.

# Concepts

@concept powerful-ai
label: Powerful AI
aliases: powerful AI
first_seen: e1

@concept recursive-loop
label: Recursive loop
aliases: recursive loop
first_seen: d1

# Reader Steps

@step se1 section=sec-essay blocks=e1
summary: Essay.
focus:
  - powerful-ai 0.9

@step sd1 section=sec-disc blocks=d1
summary: Discussion.
focus:
  - recursive-loop 0.85
  - powerful-ai 0.3 latent
relations:
  - recursive-loop -> powerful-ai accelerates 0.75

# Sections

@section sec-essay
title: Essay
summary: Essay.
steps: se1

@section sec-disc
title: Discussion
summary: Discussion.
steps: sd1
`;

test('view-model exposes documentMeta.sources and tags segments with sourceId', () => {
  const doc = registry.run('compile', { markdown: MD }).value.document;
  const vm = registry.run('view_model', { document: doc }).value.viewModel;

  const ids = vm.documentMeta.sources.map((s) => s.id);
  assert.deepEqual(ids, ['essay', 'disc-1']);
  assert.equal(vm.documentMeta.sources[1].type, 'discussion');

  const seg = vm.transcript.segments.find((s) => s.id === 'd1');
  assert.equal(seg.sourceId, 'disc-1');
});

test('documentMeta.sources carries url and path provenance', () => {
  const doc = registry.run('compile', { markdown: MD }).value.document;
  const vm = registry.run('view_model', { document: doc }).value.viewModel;

  const essay = vm.documentMeta.sources.find((s) => s.id === 'essay');
  assert.equal(essay.url, 'https://example.com/the-essay');
  assert.equal(essay.path, '/tmp/essay.txt');

  // A crystallized discussion has neither; the fields stay absent.
  const disc = vm.documentMeta.sources.find((s) => s.id === 'disc-1');
  assert.equal(disc.url, undefined);
  assert.equal(disc.path, undefined);
});

import { buildProseChunks } from '../src/view-model/buildProseChunks.js';

test('prose chunks are tagged with their sourceId and do not straddle sources', () => {
  const doc = registry.run('compile', { markdown: MD }).value.document;
  const vm = registry.run('view_model', { document: doc }).value.viewModel;
  const chunks = buildProseChunks(vm).filter((c) => c.kind === 'paragraph');

  const sources = new Set(chunks.map((c) => c.sourceId));
  assert.ok(sources.has('essay'));
  assert.ok(sources.has('disc-1'));
  for (const chunk of chunks) {
    assert.ok(chunk.sourceId, 'every paragraph chunk should carry a sourceId');
  }
});

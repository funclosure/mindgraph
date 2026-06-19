import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registry } from '../src/operations/index.js';

// A minimal living document: one essay source + one woven discussion source.
// The discussion's derived concept ("recursive loop") binds to the discussion
// block text; the anchor essay concept ("powerful-ai") rides along as `latent`
// so the cross-source relation's endpoints are both foregrounded without
// requiring the anchor's label to appear in the discussion prose.
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

@source disc-powerful-ai-1
type: discussion
title: "Deepen: Powerful AI (timeline)"

# Source Blocks

@block e1 source=essay kind=paragraph
Powerful AI could arrive within a few years, and that prospect reframes everything.

@block d1 source=disc-powerful-ai-1 kind=paragraph
We dug into the timeline question for powerful AI. The key driver we surfaced is the recursive loop: each generation of models helps build the next, compounding the pace.

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
summary: The essay names powerful AI as imminent.
focus:
  - powerful-ai 0.9

@step sd1 section=sec-disc blocks=d1
summary: The discussion derives the recursive loop as a driver of the powerful-AI timeline.
focus:
  - recursive-loop 0.85
  - powerful-ai 0.3 latent
relations:
  - recursive-loop -> powerful-ai accelerates 0.75

# Sections

@section sec-essay
title: The essay
summary: Powerful AI is imminent.
steps: se1

@section sec-disc
title: "Deepen: Powerful AI (timeline)"
summary: The recursive loop drives the timeline.
steps: sd1
`;

test('discussion-as-source: compiles, validates, and QAs 100%', () => {
  const compiled = registry.run('compile', { markdown: MD });
  assert.equal(compiled.ok, true);
  assert.equal(compiled.value.validation.ok, true, JSON.stringify(compiled.value.validation.errors));

  const doc = compiled.value.document;
  assert.equal((doc.sources ?? []).length, 2);
  assert.ok(doc.sources.some((s) => s.id === 'disc-powerful-ai-1' && s.type === 'discussion'));

  const qa = registry.run('qa', { document: doc });
  assert.equal(qa.ok, true);
  assert.equal(qa.value.ok, true, JSON.stringify(qa.value.unboundFocus) + ' / ' + JSON.stringify(qa.value.orphanedRelations));
});

test('discussion-as-source: cross-source relation is grounded in the discussion and present in the view-model', () => {
  const doc = registry.run('compile', { markdown: MD }).value.document;

  const cross = (doc.relations ?? []).find((r) => r.from === 'recursive-loop' && r.to === 'powerful-ai');
  assert.ok(cross, 'expected a recursive-loop -> powerful-ai relation');
  assert.deepEqual(cross.groundedInBlockIds, ['d1'], 'cross-source relation should be grounded in the discussion block');

  const vm = registry.run('view_model', { document: doc }).value.viewModel;
  const edge = vm.relations.all.find((r) => r.from === 'recursive-loop' && r.to === 'powerful-ai');
  assert.ok(edge, 'cross-source edge should surface in the view-model');
});

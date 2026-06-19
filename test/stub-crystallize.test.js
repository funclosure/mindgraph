import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubCrystallizeRunner } from '../src/server/stubRunner.js';
import { registry } from '../src/operations/index.js';

const BASE_MD = `---
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

# Source Blocks

@block e1 source=essay kind=paragraph
Powerful AI could arrive within a few years, and that prospect reframes everything.

# Concepts

@concept powerful-ai
label: Powerful AI
aliases: powerful AI
first_seen: e1

# Reader Steps

@step se1 section=sec-essay blocks=e1
summary: The essay names powerful AI as imminent.
focus:
  - powerful-ai 0.9

# Sections

@section sec-essay
title: The essay
summary: Powerful AI is imminent.
steps: se1
`;

function memoryStore(md) {
  const data = new Map([['living-doc', { md }]]);
  return {
    get: (slug) => data.get(slug),
    put: (slug, value) => data.set(slug, value),
  };
}

test('stub crystallize runner writes a compiling, QA-clean discussion source from the conversation', async () => {
  const store = memoryStore(BASE_MD);
  const events = [];
  const emit = (e) => events.push(e);

  await stubCrystallizeRunner({
    slug: 'living-doc',
    conceptId: 'powerful-ai',
    messages: [{ role: 'you', text: 'add the timeline angle' }],
    store,
    emit,
  });

  const md = store.get('living-doc').md;
  assert.match(md, /@source disc-powerful-ai/, 'a discussion source should be appended');

  const compiled = registry.run('compile', { markdown: md });
  assert.equal(compiled.value.validation.ok, true, JSON.stringify(compiled.value.validation.errors));
  const qa = registry.run('qa', { document: compiled.value.document });
  assert.equal(qa.value.ok, true, JSON.stringify(qa.value.unboundFocus) + ' / ' + JSON.stringify(qa.value.orphanedRelations));

  const cross = compiled.value.document.relations.find((r) => r.to === 'powerful-ai' && r.from !== 'powerful-ai');
  assert.ok(cross, 'discussion concept should link to the anchor');
});

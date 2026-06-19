import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askHandler } from '../src/server/askHandler.js';
import { registry } from '../src/operations/index.js';

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
Powerful AI could arrive soon.

# Concepts

@concept powerful-ai
label: Powerful AI
aliases: powerful AI
first_seen: b1

# Reader Steps

@step st1 section=sec blocks=b1
summary: Intro.
focus:
  - powerful-ai 0.9

# Sections

@section sec
title: Sec
summary: Sec.
steps: st1
`;

test('askHandler preloads node context, runs the runner, and never writes the document', async () => {
  const data = new Map([['demo', { md: MD, json: registry.run('compile', { markdown: MD }).value.document }]]);
  const store = { get: (s) => data.get(s), put: (s, v) => data.set(s, v) };
  const events = [];
  const runner = async ({ conceptId, context, messages, emit }) => {
    assert.equal(conceptId, 'powerful-ai');
    assert.equal(context.concept.label, 'Powerful AI');
    assert.ok(context.blocks.some((b) => /Powerful AI could arrive/.test(b.text)));
    assert.equal(messages[messages.length - 1].text, 'what is this?');
    emit({ type: 'answer', text: 'It is about imminent powerful AI.' });
  };

  await askHandler({
    slug: 'demo',
    conceptId: 'powerful-ai',
    messages: [{ role: 'you', text: 'what is this?' }],
    store,
    runner,
    emit: (e) => events.push(e),
  });

  assert.ok(events.some((e) => e.type === 'answer' && /imminent powerful AI/.test(e.text)));
  assert.ok(!events.some((e) => e.type === 'document'), 'ask never emits a document');
  assert.equal(store.get('demo').md, MD);
});

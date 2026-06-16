import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { createMemoryStore } from '../src/operations/memoryStore.js';
import { deepenHandler } from '../src/server/deepenHandler.js';

const fixturePath = 'examples/authoring/recursive-self-improvement.mindgraph.md';

function seededStore() {
  const md = fs.readFileSync(fixturePath, 'utf8');
  return createMemoryStore({ demo: { md } });
}

test('deepen handler runs injected runner, compiles updated markdown, stores json, and emits document', async () => {
  const store = seededStore();
  const events = [];
  const emit = (event) => events.push(event);
  const goodRunner = async ({ slug, store }) => {
    const cur = store.get(slug).md;
    store.put(slug, {
      md: `${cur}\n\n@concept mock-deepened\nlabel: Mock Deepened Concept\n`,
    });
  };

  await deepenHandler({ slug: 'demo', conceptId: 'x', store, runner: goodRunner, emit });

  assert.ok(events.some((event) => event.type === 'progress'));
  const documentEvents = events.filter((event) => event.type === 'document');
  assert.equal(documentEvents.length, 1);
  assert.equal(documentEvents[0].document.kind, 'mindgraph.source-first');
  assert.ok(documentEvents[0].document.concepts.atomic.some((concept) => concept.id === 'mock-deepened'));
  assert.equal(events.some((event) => event.type === 'error'), false);
  assert.ok(store.get('demo').json);
});

test('deepen handler emits an error and no document when runner writes invalid markdown', async () => {
  const store = seededStore();
  const events = [];
  const emit = (event) => events.push(event);
  const badRunner = async ({ slug, store }) => {
    store.put(slug, { md: 'totally broken, no frontmatter' });
  };

  await deepenHandler({ slug: 'demo', conceptId: 'x', store, runner: badRunner, emit });

  assert.ok(events.some((event) => event.type === 'error'));
  assert.equal(events.some((event) => event.type === 'document'), false);
});

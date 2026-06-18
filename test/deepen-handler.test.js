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

test("deepen snapshots the pre-edit markdown to slug__backup", async () => {
  const md = fs.readFileSync("examples/authoring/recursive-self-improvement.mindgraph.md", "utf8");
  const store = createMemoryStore({ demo: { md } });
  const runner = async ({ slug, store }) => {
    store.put(slug, { md: store.get(slug).md + "\n\n@concept snap-added\nlabel: Snap Added\n" });
  };
  await deepenHandler({ slug: "demo", conceptId: "c", store, runner, emit: () => {} });
  assert.equal(store.get("demo__backup")?.md, md);
});

test('deepen forwards the user prompt to the runner', async () => {
  const md = fs.readFileSync('examples/authoring/recursive-self-improvement.mindgraph.md', 'utf8');
  const store = createMemoryStore({ demo: { md } });
  let received;
  const runner = async ({ prompt, slug, store }) => {
    received = prompt;
    store.put(slug, { md: store.get(slug).md + '\n\n@concept p\nlabel: P\n' });
  };
  await deepenHandler({ slug: 'demo', conceptId: 'c', prompt: 'the cyber angle', store, runner, emit: () => {} });
  assert.equal(received, 'the cyber angle');
});

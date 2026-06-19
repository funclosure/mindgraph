# Conversational Deepen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the one-shot deepen into a clarifying, multi-turn conversation whose outcome is a new discussion `@source` woven into the same `.mindgraph.md` (compiled discussion blocks + derived concepts grounded in them + cross-source relations to the essay's concepts).

**Architecture:** A reusable in-process **question channel** (`ask`/`answer`/`cancel` keyed by `turnId`) lets a deepen runner pause mid-turn for a structured answer. The SSE `/deepen` stream gains a `ready` event (carrying `turnId`) and `question` events; a new `POST /deepen/answer` resolves the waiting handler. The **stub runner** exercises the whole round-trip with no API; the **real agentRunner** wires the same channel to an `ask_user_questions` in-process SDK tool and authors a discussion `@source`. The **view-model** becomes source-aware so the UI can switch between essay and discussion sources.

**Tech Stack:** Node `node:http` + SSE (server), vanilla ES-module browser UI (no framework/bundler), `@anthropic-ai/claude-agent-sdk` (`query` + `createSdkMcpServer`/`tool`), `zod` (tool schema; already present as an SDK transitive dep — this plan declares it explicitly), `node --test` for tests.

**v1 scoping note (read before starting):** The spec mentions a kept-alive streaming-input `query()` session (loupe pattern) for follow-up turns. v1 deliberately defers that. Each deepen turn is its own SSE stream that may contain one or more **within-turn** question round-trips before the edit. Follow-up turns are new streams; because the discussion `@source` persists in the `.md`, the agent reads it and *extends* it, which delivers the conversational behaviour without a long-lived cross-request session. A true persistent session is a future enhancement, not a task here.

---

## File Structure

**New files:**
- `src/server/questionChannel.js` — pure `createQuestionChannel()` (ask/answer/cancel/pendingCount). The risky round-trip mechanic, isolated and unit-tested.
- `test/question-channel.test.js` — unit tests for the channel.
- `test/discussion-source-contract.test.js` — proves a hand-authored discussion `@source` compiles, validates, QAs 100%, and surfaces a cross-source relation in the view-model.
- `test/stub-deepen-discussion.test.js` — proves the stub runner, given a scripted answer, writes a discussion source that compiles + QAs.
- `test/view-model-sources.test.js` — proves the VM exposes `documentMeta.sources` and tags segments/chunks with `sourceId`.
- `ui/panels/question-card.js` — renders a `question` event as structured cards (LoomyQuestion-style), collects answers.

**Modified files:**
- `src/server/index.js` — `turnId` per stream, `ready` event, `question` plumbing, `POST /deepen/answer`, thread `askQuestions` into the runner.
- `src/server/deepenHandler.js` — pass `askQuestions` through to the runner ctx.
- `src/server/stubRunner.js` — ask one scripted question, then author a discussion `@source`.
- `src/server/agentRunner.js` — `ask_user_questions` SDK tool, discussion-source system prompt, opt-in WebSearch, stream-close timeout.
- `src/view-model/buildMindgraphViewModel.js` — `documentMeta.sources`; tag segments with `sourceId`.
- `src/view-model/buildProseChunks.js` — break paragraphs at source boundaries; tag chunks with `sourceId`.
- `ui/app.js` — source switcher; question cards + answer POST; busy heartbeat; auto-scroll thread.
- `ui/index.html` — source-switcher container in the Source tab.
- `ui/styles.css` — switcher + question-card styles.
- `package.json` — declare `zod` dependency.
- `skills/mindgraph/SKILL.md` — short "deepen authors a discussion @source" protocol note.

---

## Task 1: Discussion-as-source contract (pure)

Locks the data shape every later task must produce. No product code — a fixture + assertions against the existing operations registry.

**Files:**
- Create: `test/discussion-source-contract.test.js`

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run it**

Run: `node --test test/discussion-source-contract.test.js`
Expected: PASS (the data model already supports multiple `@source`s, latent focus, and inline step relations hoisted to `document.relations`).

If it FAILS, the failure is the finding — the discussion-source shape needs a core fix before anything else. Stop and report the exact validation/QA error; do not work around it in the fixture. Likely culprits to check in order: (a) `@source` without a `path` rejected by `src/core/authoring/schema.js`; (b) inline cross-source step relation not hoisted/grounded in `src/core/authoring/compile.js`. Fix the core, keep the fixture honest.

- [ ] **Step 3: Commit**

```bash
git add test/discussion-source-contract.test.js
git commit -m "test(deepen): lock discussion-as-source compile/qa/view-model contract"
```

---

## Task 2: Question channel (pure, the risky mechanic)

A standalone promise-broker. No HTTP, no SDK. This is where the "pause for an answer" lives so it can be tested deterministically.

**Files:**
- Create: `src/server/questionChannel.js`
- Test: `test/question-channel.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createQuestionChannel } from '../src/server/questionChannel.js';

test('answer() resolves the pending ask() with the posted answers', async () => {
  const channel = createQuestionChannel();
  const pending = channel.ask('turn-1');
  assert.equal(channel.pendingCount(), 1);

  const delivered = channel.answer('turn-1', [{ header: 'Angle', values: ['Timeline'] }]);
  assert.equal(delivered, true);

  const answers = await pending;
  assert.deepEqual(answers, [{ header: 'Angle', values: ['Timeline'] }]);
  assert.equal(channel.pendingCount(), 0);
});

test('answer() for an unknown turn returns false and resolves nothing', () => {
  const channel = createQuestionChannel();
  assert.equal(channel.answer('nope', []), false);
});

test('cancel() rejects the pending ask()', async () => {
  const channel = createQuestionChannel();
  const pending = channel.ask('turn-2');
  channel.cancel('turn-2', 'deepen cancelled');
  await assert.rejects(pending, /deepen cancelled/);
  assert.equal(channel.pendingCount(), 0);
});

test('a second ask() for the same turn cancels the first', async () => {
  const channel = createQuestionChannel();
  const first = channel.ask('turn-3');
  const second = channel.ask('turn-3');
  await assert.rejects(first, /superseded/);
  channel.answer('turn-3', [{ header: 'h', values: ['v'] }]);
  assert.deepEqual(await second, [{ header: 'h', values: ['v'] }]);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/question-channel.test.js`
Expected: FAIL — `Cannot find module '../src/server/questionChannel.js'`.

- [ ] **Step 3: Implement the channel**

```js
// In-process broker for the deepen question round-trip. A runner calls
// ask(turnId) and awaits; the HTTP layer calls answer(turnId, answers) when the
// client POSTs, or cancel(turnId) on timeout/disconnect. Keyed by turnId so one
// channel instance serves every concurrent deepen stream.
export function createQuestionChannel() {
  const pending = new Map(); // turnId -> { resolve, reject }

  function settleExisting(turnId, rejectReason) {
    const entry = pending.get(turnId);
    if (!entry) return;
    pending.delete(turnId);
    entry.reject(new Error(rejectReason));
  }

  return {
    ask(turnId) {
      settleExisting(turnId, 'superseded by a newer question for this turn');
      return new Promise((resolve, reject) => {
        pending.set(turnId, { resolve, reject });
      });
    },
    answer(turnId, answers) {
      const entry = pending.get(turnId);
      if (!entry) return false;
      pending.delete(turnId);
      entry.resolve(answers);
      return true;
    },
    cancel(turnId, reason = 'cancelled') {
      const entry = pending.get(turnId);
      if (!entry) return false;
      pending.delete(turnId);
      entry.reject(new Error(reason));
      return true;
    },
    pendingCount() {
      return pending.size;
    },
  };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test test/question-channel.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/questionChannel.js test/question-channel.test.js
git commit -m "feat(server): add question channel for the deepen round-trip"
```

---

## Task 3: Server plumbing — `ready`/`question` events + `POST /deepen/answer`

Wire the channel into the live SSE handler and pass an `askQuestions` capability down to the runner. The stream already stays open until `res.end()`, so awaiting a question Just Works; we only add the correlation id and the answer route.

**Files:**
- Modify: `src/server/index.js`
- Modify: `src/server/deepenHandler.js:3` and `:12` (thread `askQuestions` through)

- [ ] **Step 1: Thread `askQuestions` through the deepen handler**

In `src/server/deepenHandler.js`, change the signature and the runner call to forward `askQuestions` (default to a runner-less no-op so existing tests that omit it keep working):

```js
import { registry } from '../operations/index.js';

export async function deepenHandler({ slug, conceptId, prompt, store, runner, emit, askQuestions }) {
  try {
    emit({ type: 'progress', message: 'deepening' });

    const before = store.get(slug);
    if (before && typeof before.md === "string") {
      store.put(`${slug}__backup`, { md: before.md });
    }

    await runner({ slug, conceptId, prompt, store, emit, askQuestions });
```

Leave the rest of `deepenHandler` unchanged (compile/validate/qa/emit document).

- [ ] **Step 2: Add the channel, turnId, `ready` event, and `askQuestions` in the SSE handler**

In `src/server/index.js`, add the import near the other server imports (after line 11):

```js
import { createQuestionChannel } from './questionChannel.js';
```

Add a module-level channel and a turn counter just after `const fsStore = createFsStore({ baseDir: graphsDir });` (around line 32):

```js
const questionChannel = createQuestionChannel();
let turnCounter = 0;
```

Rewrite `handleDeepen` so it mints a `turnId`, emits a `ready` event, builds `askQuestions`, and cancels the pending question if the client disconnects. Replace the body of `handleDeepen` (lines 134–176) with:

```js
async function handleDeepen(req, res, url) {
  const slug = url.searchParams.get('slug') || activeSlug;
  const concept = url.searchParams.get('concept');
  const prompt = url.searchParams.get('prompt') || undefined;
  if (!concept) {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Missing required query parameter: concept');
    return;
  }

  turnCounter += 1;
  const turnId = `turn-${Date.now().toString(36)}-${turnCounter}`;

  let closed = false;
  const keepAlive = setInterval(() => {
    if (!closed) res.write(': ping\n\n');
  }, 20_000);

  const finish = () => {
    closed = true;
    clearInterval(keepAlive);
    // If the agent is still waiting on an answer when the client leaves, free it.
    questionChannel.cancel(turnId, 'deepen cancelled: client disconnected');
  };
  req.on('close', finish);

  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    connection: 'keep-alive',
  });
  res.flushHeaders?.();

  const emit = (event) => {
    if (!closed) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  };

  // Tell the client which turn this stream is, so its POST /deepen/answer can
  // be correlated back to the waiting runner.
  emit({ type: 'ready', turnId });

  // Capability handed to the runner: emit a question event, then await the
  // client's answer via the shared channel.
  const askQuestions = (questions) => {
    emit({ type: 'question', turnId, questions });
    return questionChannel.ask(turnId);
  };

  const runner = await selectRunner(emit);
  if (!runner) {
    finish();
    res.end();
    return;
  }

  await deepenHandler({ slug, conceptId: concept, prompt, store: fsStore, runner, emit, askQuestions });
  finish();
  res.end();
}
```

- [ ] **Step 3: Add the `POST /deepen/answer` route**

In the `http.createServer` callback in `src/server/index.js`, add this block immediately before the `if (req.method === 'GET' && pathname === '/deepen')` check (around line 190):

```js
  if (req.method === 'POST' && pathname === '/deepen/answer') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; if (body.length > 1_000_000) req.destroy(); });
    req.on('end', () => {
      let delivered = false;
      try {
        const payload = JSON.parse(body || '{}');
        delivered = questionChannel.answer(payload.turnId, payload.answers ?? []);
      } catch { /* malformed body -> delivered stays false */ }
      res.writeHead(delivered ? 200 : 409, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ ok: delivered }));
    });
    return;
  }
```

- [ ] **Step 4: Write an integration test for the round-trip over a fake runner**

Create `test/deepen-answer-route.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createQuestionChannel } from '../src/server/questionChannel.js';

// The HTTP wiring is thin; the contract worth pinning is that a runner can ask
// and the answer route's payload resolves it. We assert that against the same
// channel the server uses, simulating the emit/ask/answer sequence.
test('runner ask() resolves when an answer payload arrives for the turn', async () => {
  const channel = createQuestionChannel();
  const events = [];
  const emit = (e) => events.push(e);
  const turnId = 'turn-x';

  const askQuestions = (questions) => {
    emit({ type: 'question', turnId, questions });
    return channel.ask(turnId);
  };

  const runnerPromise = (async () => {
    const answers = await askQuestions([{ header: 'Angle', question: 'Which angle?', options: [], multiSelect: false }]);
    return answers;
  })();

  // Simulate POST /deepen/answer body handling.
  const body = JSON.stringify({ turnId, answers: [{ header: 'Angle', values: ['Timeline'] }] });
  const delivered = channel.answer(JSON.parse(body).turnId, JSON.parse(body).answers);

  assert.equal(delivered, true);
  assert.deepEqual(await runnerPromise, [{ header: 'Angle', values: ['Timeline'] }]);
  assert.equal(events[0].type, 'question');
  assert.equal(events[0].turnId, 'turn-x');
});
```

- [ ] **Step 5: Run tests + syntax check the server**

Run: `node --test test/deepen-answer-route.test.js test/question-channel.test.js && node --check src/server/index.js && node --check src/server/deepenHandler.js`
Expected: PASS; both `--check` print nothing.

- [ ] **Step 6: Commit**

```bash
git add src/server/index.js src/server/deepenHandler.js test/deepen-answer-route.test.js
git commit -m "feat(server): emit ready/question events and accept POST /deepen/answer"
```

---

## Task 4: Stub runner authors a discussion source (no API)

The stub now demonstrates the full mechanic: ask one scripted question, then on answer write a valid discussion `@source` woven to the anchor — the exact shape Task 1 proved. This is what lets the UI tasks (6, 7) be built and verified without credentials.

**Files:**
- Modify: `src/server/stubRunner.js`
- Test: `test/stub-deepen-discussion.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubRunner } from '../src/server/stubRunner.js';
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

test('stub runner asks one question then writes a compiling, QA-clean discussion source', async () => {
  const store = memoryStore(BASE_MD);
  const events = [];
  const emit = (e) => events.push(e);
  // Auto-answer the moment the stub asks.
  const askQuestions = async (questions) => {
    assert.ok(Array.isArray(questions) && questions.length >= 1, 'stub should ask at least one question');
    return [{ header: questions[0].header, values: ['Timeline'] }];
  };

  await stubRunner({ slug: 'living-doc', conceptId: 'powerful-ai', prompt: '', store, emit, askQuestions });

  const md = store.get('living-doc').md;
  assert.match(md, /@source disc-powerful-ai/, 'a discussion source should be appended');

  const compiled = registry.run('compile', { markdown: md });
  assert.equal(compiled.value.validation.ok, true, JSON.stringify(compiled.value.validation.errors));
  const qa = registry.run('qa', { document: compiled.value.document });
  assert.equal(qa.value.ok, true, JSON.stringify(qa.value.unboundFocus) + ' / ' + JSON.stringify(qa.value.orphanedRelations));

  const cross = compiled.value.document.relations.find((r) => r.to === 'powerful-ai' && r.from !== 'powerful-ai');
  assert.ok(cross, 'discussion concept should link to the anchor');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/stub-deepen-discussion.test.js`
Expected: FAIL — the current stub appends a bare `@concept`/`@relation`, not a discussion source, and ignores `askQuestions`.

- [ ] **Step 3: Rewrite the stub runner**

```js
// No-API deepen runner. Demonstrates the full conversational mechanic: ask one
// scripted clarifying question, then weave a discussion @source into the .md
// (compiled discussion block + a derived concept grounded in it + a cross-source
// relation to the anchor + a section/step), matching the shape the real agent
// must produce. Used when MINDGRAPH_STUB_DEEPEN is set.
export async function stubRunner({ slug, conceptId, prompt, store, emit, askQuestions }) {
  emit({ type: 'progress', message: `stub: preparing ${conceptId}` });

  const entry = store.get(slug);
  const md = entry?.md;
  if (typeof md !== 'string') {
    emit({ type: 'progress', message: 'stub: no markdown' });
    return;
  }

  // Ask one structured question so the UI round-trip is exercised end to end.
  let angle = 'a key driver';
  if (typeof askQuestions === 'function') {
    emit({ type: 'progress', message: 'stub: asking a clarifying question' });
    const answers = await askQuestions([
      {
        header: 'Angle',
        question: `Which aspect of "${conceptId}" should we deepen?`,
        options: [
          { label: 'Timeline', description: 'When and how fast it arrives' },
          { label: 'Mechanism', description: 'What drives or enables it' },
          { label: 'Risks', description: 'What could go wrong' },
        ],
        multiSelect: false,
      },
    ]);
    const picked = answers?.[0]?.values?.[0];
    if (picked) angle = picked;
  }

  const suffix = Date.now().toString(36);
  const sourceId = `disc-${conceptId}-${suffix}`;
  const conceptIdNew = `stub-driver-${suffix}`;
  // Keep the derived concept's label verbatim in the block so reading QA binds it.
  const driverPhrase = 'stub driver';
  const block = `We deepened "${conceptId}" along the ${angle} angle. The ${driverPhrase} we surfaced compounds its effect over time.`;

  const addition = `

@source ${sourceId}
type: discussion
title: "Deepen: ${conceptId} (${angle})"

@block ${sourceId}-d1 source=${sourceId} kind=paragraph
${block}

@concept ${conceptIdNew}
label: Stub driver
aliases: ${driverPhrase}
first_seen: ${sourceId}-d1

@step ${sourceId}-s1 section=${sourceId}-sec blocks=${sourceId}-d1
summary: The deepen discussion derives the ${driverPhrase} as a driver of ${conceptId}.
focus:
  - ${conceptIdNew} 0.85
  - ${conceptId} 0.3 latent
relations:
  - ${conceptIdNew} -> ${conceptId} accelerates 0.75

@section ${sourceId}-sec
title: "Deepen: ${conceptId} (${angle})"
summary: A stub deepen discussion woven into the graph.
steps: ${sourceId}-s1
`;

  store.put(slug, { md: md + addition });
  emit({ type: 'progress', message: `stub wove a discussion source for ${conceptId}` });
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test test/stub-deepen-discussion.test.js`
Expected: PASS.

- [ ] **Step 5: Run the existing deepen handler test to confirm no regression**

Run: `node --test test/deepen-handler.test.js`
Expected: PASS. If it dispatches the stub and asserts the old bare-concept shape, update that assertion to look for `@source disc-` instead. Show the diff in your report.

- [ ] **Step 6: Commit**

```bash
git add src/server/stubRunner.js test/stub-deepen-discussion.test.js test/deepen-handler.test.js
git commit -m "feat(server): stub runner weaves a discussion source via the question round-trip"
```

---

## Task 5: View-model source awareness (pure)

So the UI can switch sources, the VM must name its sources and tag each segment with the source it came from. Then prose chunks can be filtered.

**Files:**
- Modify: `src/view-model/buildMindgraphViewModel.js:54-64` (segments) and `:128-135` (return `transcript` + add `documentMeta.sources`)
- Modify: `src/view-model/buildProseChunks.js`
- Test: `test/view-model-sources.test.js`

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/view-model-sources.test.js`
Expected: FAIL — `vm.documentMeta.sources` is undefined and segments have no `sourceId`.

- [ ] **Step 3: Tag segments with `sourceId`**

In `src/view-model/buildMindgraphViewModel.js`, in `normalizeSourceFirstForViewModel`, change the `segments` map (lines 54–64) to carry the block's `sourceId`:

```js
  const segments = orderedBlocks.map((block, index) => {
    const span = spanForIndexes(index, 1, segmentSeconds);
    blockSpanById[block.id] = span;
    return {
      id: block.id,
      sourceId: block.sourceId ?? null,
      start: span.start,
      end: span.end,
      speaker: '',
      text: block.text ?? '',
    };
  });
```

- [ ] **Step 4: Expose `documentMeta.sources`**

`documentMeta` is built by `buildDocumentMetaVM(document, …)` (around line 593), which receives the normalized document — and that document preserves `document.sources` via the `{ ...document }` spread in `normalizeSourceFirstForViewModel`. Add a `sources` field to the object `buildDocumentMetaVM` returns, right after the `speakers:` line (keep every existing field intact):

```js
  return {
    title: document.transcript?.title ?? 'Untitled Transcript',
    source: document.transcript?.source ?? '',
    speakers: document.transcript?.speakers ?? [],
    sources: (document.sources ?? []).map((s) => ({ id: s.id, title: s.title ?? '', type: s.type ?? 'source' })),
    durationSeconds,
    counts: {
```

That is: insert the single `sources:` line; the rest of the `return` is unchanged.

- [ ] **Step 5: Run it to verify it passes**

Run: `node --test test/view-model-sources.test.js`
Expected: PASS.

- [ ] **Step 6: Tag prose chunks with `sourceId` and break paragraphs at source boundaries**

In `src/view-model/buildProseChunks.js`, two changes:

(a) In `newParagraph()`, add a `sourceId` field:

```js
function newParagraph() {
  return {
    kind: 'paragraph',
    text: '',
    speaker: undefined,
    sourceId: undefined,
    segmentIds: [],
    timeSpan: { start: 0, end: 0 },
    conceptMentions: [],
  };
}
```

(b) In the main `for` loop in `buildProseChunks`, before appending a segment, force a paragraph break when the segment's source changes, and record the source on the paragraph. Insert this immediately after the speaker-change break block (after line 64, before `if (!para.speaker && seg.speaker)`):

```js
    // Paragraph break on source change so chunks never straddle two sources.
    if (para.segmentIds.length && seg.sourceId && para.sourceId && seg.sourceId !== para.sourceId) {
      chunks.push(finalizeParagraph(para, vm));
      para = newParagraph();
    }
    if (!para.sourceId && seg.sourceId) para.sourceId = seg.sourceId;
```

- [ ] **Step 7: Extend the test to assert chunk tagging**

Add to `test/view-model-sources.test.js`:

```js
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
```

- [ ] **Step 8: Run it to verify it passes**

Run: `node --test test/view-model-sources.test.js`
Expected: PASS (3 tests).

- [ ] **Step 9: Full suite + commit**

Run: `node --test test/*.test.js`
Expected: PASS (no regressions; if `view-model-source-first` asserted segment shape exactly, relax it to allow the added `sourceId` field).

```bash
git add src/view-model/buildMindgraphViewModel.js src/view-model/buildProseChunks.js test/view-model-sources.test.js
git commit -m "feat(view-model): source-aware segments, sources list, and prose chunks"
```

---

## Task 6: UI source switcher

Reveal the woven sources. The Source tab gains a row of source buttons; selecting one filters the prose to that source's chunks.

**Files:**
- Modify: `ui/index.html` (add switcher container in the Source tab)
- Modify: `ui/app.js` (render switcher, filter prose by `state.activeSourceId`)
- Modify: `ui/styles.css` (switcher styles)

- [ ] **Step 1: Add the switcher container to the Source pane**

In `ui/index.html`, inside the Source tab pane (the element with id `prose-source` or its wrapper — locate `id="prose-source"`), add a switcher container immediately before it within the same tab panel:

```html
<div id="source-switcher" class="source-switcher"></div>
```

(If `prose-source` is the scrollable pane itself, put `#source-switcher` as a sibling directly above it so it doesn't scroll with the prose.)

- [ ] **Step 2: Track the active source and render the switcher in `ui/app.js`**

Add to the `state` object (near `sourceTab: 'source'`, line 57):

```js
  activeSourceId: null,
```

Add a render function (place near `updateProsePanel`, around line 301):

```js
function renderSourceSwitcher() {
  const el = document.getElementById('source-switcher');
  if (!el) return;
  const sources = state.viewModel?.documentMeta?.sources ?? [];
  // Only show the switcher once a deepen has woven in a second source.
  if (sources.length <= 1) { el.innerHTML = ''; return; }
  if (!state.activeSourceId) state.activeSourceId = sources[0].id;
  el.innerHTML = sources.map((s) => {
    const active = s.id === state.activeSourceId ? ' is-active' : '';
    const kind = s.type === 'discussion' ? ' source-chip--discussion' : '';
    const label = s.type === 'discussion' ? (s.title || s.id) : (s.title || 'Source');
    return `<button class="source-chip${active}${kind}" data-source-id="${escapeAttr(s.id)}">${escapeHtml(label)}</button>`;
  }).join('');
  el.querySelectorAll('.source-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.activeSourceId = btn.dataset.sourceId;
      renderSourceSwitcher();
      updateProsePanel();
    });
  });
}
```

If `escapeHtml`/`escapeAttr` aren't already imported in `app.js`, import `escapeHtml` from `./util.js` and use it for both (a minimal `escapeAttr` can just reuse `escapeHtml`). Check the existing imports at the top of `app.js` first and reuse whatever escape helper is already there.

- [ ] **Step 3: Filter prose by the active source**

In `updateProsePanel` (line 301), filter chunks to the active source before rendering:

```js
function updateProsePanel() {
  const el = document.getElementById('prose-source');
  if (!el) return;
  const saved = el.scrollTop;
  const all = state.proseChunks ?? [];
  const activeId = state.activeSourceId;
  // Keep overview headings; filter paragraphs to the selected source. With a
  // single source (no switcher), activeId is null and everything renders.
  const chunks = activeId
    ? all.filter((c) => c.kind !== 'paragraph' || c.sourceId === activeId)
    : all;
  el.innerHTML = renderProse(chunks, state);
  el.scrollTop = saved;
}
```

- [ ] **Step 4: Call `renderSourceSwitcher()` after the document loads and after a deepen**

Find where the VM is first built (search `renderSourceSwitcher` — none yet; add calls). Add `renderSourceSwitcher();` right after the initial prose render in the load path (near line 171 where `updateDeepenPanel()` is called) and inside `rebuildFromDocument` and `applyDeepenedDocument` after `state.proseChunks = buildProseChunks(...)`. After a deepen that wove a new source, set the switcher to that source so the user sees the discussion:

In `applyDeepenedDocument`, after rebuilding `state.proseChunks` (line 368), add:

```js
  // Surface the newest source (the just-woven discussion) in the switcher.
  const sources = state.viewModel?.documentMeta?.sources ?? [];
  if (sources.length > 1) state.activeSourceId = sources[sources.length - 1].id;
  renderSourceSwitcher();
```

- [ ] **Step 5: Style the switcher**

Add to `ui/styles.css`:

```css
.source-switcher { display: flex; gap: 6px; flex-wrap: wrap; padding: 8px 12px; border-bottom: 1px solid var(--border, #2a2a2a); }
.source-switcher:empty { display: none; }
.source-chip { font: inherit; font-size: 12px; padding: 4px 10px; border-radius: 999px; border: 1px solid var(--border, #3a3a3a); background: transparent; color: inherit; cursor: pointer; opacity: 0.7; }
.source-chip.is-active { opacity: 1; border-color: var(--accent, #6aa7ff); }
.source-chip--discussion { border-style: dashed; }
```

- [ ] **Step 6: Syntax check + browser verification**

Run: `node --check ui/app.js`
Then: `MINDGRAPH_STUB_DEEPEN=1 npm run server -- --doc graphs/adolescence-of-technology.mindgraph.md` and open `http://127.0.0.1:4173`. Select a node, deepen it (the stub will ask a question — answer it in Task 7; for now the switcher appears after the woven document arrives). Confirm: a second, dashed "Deepen: …" chip appears; clicking it shows the discussion prose; clicking the essay chip shows the essay. Take a Playwright screenshot if you cannot drive the browser by hand.

Note: the question UI lands in Task 7. Until then, the stub will hang awaiting an answer. To verify the switcher alone before Task 7, temporarily answer via devtools console: `fetch('/deepen/answer',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({turnId:window.__lastTurnId,answers:[{header:'Angle',values:['Timeline']}]})})` after Task 7 stores `window.__lastTurnId`. If verifying strictly before Task 7, skip the deepen and instead point `--doc` at a hand-edited `.md` that already has two sources to confirm the switcher renders.

- [ ] **Step 7: Commit**

```bash
git add ui/index.html ui/app.js ui/styles.css
git commit -m "feat(ui): source switcher reveals woven discussion sources"
```

---

## Task 7: UI question cards + answer POST + heartbeat

The conversational front end: render `question` events as structured cards, collect answers (single/multi select + free-text Other), POST them back, and show a "thinking…" heartbeat so a working turn never looks frozen.

**Files:**
- Create: `ui/panels/question-card.js`
- Modify: `ui/app.js` (`ready`/`question` handling in `runDeepen`, heartbeat, auto-scroll)
- Modify: `ui/styles.css` (card styles)

- [ ] **Step 1: Build the question-card renderer**

Create `ui/panels/question-card.js`:

```js
import { escapeHtml } from '../util.js';

// Render one ask_user_questions set into the deepen thread. `questions` mirrors
// the SDK tool input: [{ header, question, options:[{label,description}], multiSelect }].
// Returns an HTML string; binding/collection is wired by the caller.
export function renderQuestionCards(questions, turnId) {
  const cards = questions.map((q, qi) => {
    const opts = (q.options ?? []).map((opt, oi) => {
      const inputType = q.multiSelect ? 'checkbox' : 'radio';
      return (
        `<label class="qc-option">` +
          `<input type="${inputType}" name="qc-${turnId}-${qi}" value="${escapeHtml(opt.label)}" />` +
          `<span class="qc-option-label">${escapeHtml(opt.label)}</span>` +
          `<span class="qc-option-desc">${escapeHtml(opt.description ?? '')}</span>` +
        `</label>`
      );
    }).join('');
    return (
      `<div class="qc-card" data-qindex="${qi}" data-multi="${q.multiSelect ? '1' : '0'}">` +
        `<div class="qc-header">${escapeHtml(q.header ?? '')}</div>` +
        `<div class="qc-question">${escapeHtml(q.question ?? '')}</div>` +
        `<div class="qc-options">${opts}</div>` +
        `<input class="qc-other" type="text" placeholder="Other… (optional)" />` +
      `</div>`
    );
  }).join('');
  return (
    `<div class="qc-set" data-turn-id="${escapeHtml(turnId)}">` +
      cards +
      `<button class="qc-submit" data-action="qc-submit">Answer</button>` +
    `</div>`
  );
}

// Read the user's selections out of a rendered .qc-set element into the answer
// payload shape the server expects: [{ header, values:[...] }].
export function collectAnswers(setEl, questions) {
  return questions.map((q, qi) => {
    const card = setEl.querySelector(`.qc-card[data-qindex="${qi}"]`);
    const values = [];
    card?.querySelectorAll('input[type="radio"]:checked, input[type="checkbox"]:checked')
      .forEach((input) => values.push(input.value));
    const other = card?.querySelector('.qc-other')?.value?.trim();
    if (other) values.push(other);
    return { header: q.header ?? `q${qi}`, values };
  });
}
```

- [ ] **Step 2: Handle `ready` + `question` in `runDeepen`**

In `ui/app.js`, import the renderer near the other panel imports (around line 19):

```js
import { renderQuestionCards, collectAnswers } from './panels/question-card.js';
```

Replace `runDeepen` (lines 398–426) with a version that captures `turnId`, renders question cards, posts answers, and runs a heartbeat:

```js
let deepenHeartbeat;

function runDeepen(conceptId, prompt) {
  if (!conceptId || state.deepen.busy) return;
  state.deepen.busy = true;
  if (prompt) pushDeepen('you', prompt);
  pushDeepen('agent', `Deepening “${conceptId}” …`);
  let turnId = null;

  const qs = new URLSearchParams({ concept: conceptId });
  if (prompt) qs.set('prompt', prompt);
  const source = new EventSource(`/deepen?${qs.toString()}`);

  startHeartbeat();
  const finish = () => {
    stopHeartbeat();
    source.close();
    state.deepen.busy = false;
    updateDeepenPanel();
  };

  source.addEventListener('ready', (event) => {
    try { turnId = JSON.parse(event.data).turnId; window.__lastTurnId = turnId; } catch { /* ignore */ }
  });

  source.addEventListener('progress', (event) => {
    try { pushDeepen('agent', JSON.parse(event.data).message); } catch { /* ignore */ }
  });

  source.addEventListener('question', (event) => {
    stopHeartbeat(); // waiting on the human now, not the agent
    let questions = [];
    let qTurn = turnId;
    try { const d = JSON.parse(event.data); questions = d.questions ?? []; qTurn = d.turnId ?? turnId; } catch { /* ignore */ }
    renderQuestionInThread(questions, qTurn, () => startHeartbeat());
  });

  source.addEventListener('document', (event) => {
    try {
      applyDeepenedDocument(JSON.parse(event.data).document, conceptId);
      pushDeepen('result', 'Applied. Graph updated.');
      state.deepen.canUndo = true;
    } catch (error) {
      pushDeepen('error', `Failed: ${error.message}`);
    }
    finish();
  });

  source.addEventListener('error', (event) => {
    let message = 'connection lost';
    try { message = JSON.parse(event.data).message; } catch { /* native error has no data */ }
    pushDeepen('error', `Error: ${message}`);
    finish();
  });
}

function startHeartbeat() {
  stopHeartbeat();
  const startedAt = Date.now();
  state.deepen.entries.push({ role: 'heartbeat', text: 'Thinking…' });
  updateDeepenPanel();
  deepenHeartbeat = setInterval(() => {
    const secs = Math.round((Date.now() - startedAt) / 1000);
    const last = state.deepen.entries[state.deepen.entries.length - 1];
    if (last && last.role === 'heartbeat') {
      last.text = `Thinking… (${secs}s)`;
      updateDeepenPanel();
    }
  }, 1000);
}

function stopHeartbeat() {
  if (deepenHeartbeat) { clearInterval(deepenHeartbeat); deepenHeartbeat = null; }
  // Drop a trailing heartbeat entry so it doesn't linger in the transcript.
  const last = state.deepen.entries[state.deepen.entries.length - 1];
  if (last && last.role === 'heartbeat') state.deepen.entries.pop();
}

function renderQuestionInThread(questions, turnId, onSubmitted) {
  if (!questions.length) return;
  state.deepen.entries.push({ role: 'question', html: renderQuestionCards(questions, turnId), questions, turnId });
  updateDeepenPanel();
  // Bind the submit button for the just-rendered set.
  const setEl = document.querySelector(`.qc-set[data-turn-id="${cssEscape(turnId)}"]`);
  const submit = setEl?.querySelector('[data-action="qc-submit"]');
  if (submit) submit.addEventListener('click', () => {
    const answers = collectAnswers(setEl, questions);
    submit.disabled = true;
    pushDeepen('you', answers.map((a) => `${a.header}: ${a.values.join(', ') || '(skip)'}`).join(' · '));
    fetch('/deepen/answer', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ turnId, answers }),
    }).then(() => { onSubmitted?.(); }).catch((e) => pushDeepen('error', `Answer failed: ${e.message}`));
  });
}

function cssEscape(s) {
  return String(s).replace(/["\\]/g, '\\$&');
}
```

- [ ] **Step 3: Render question entries in the thread**

The deepen thread renderer (`ui/panels/deepen-thread.js`) maps `entries` to `<div class="deepen-entry deepen-<role>">text</div>`. Update it to render `role === 'question'` entries as raw HTML and `role === 'heartbeat'` with a muted style. Edit the `entries` map in `renderDeepenThread`:

```js
  const entries = vm.entries
    .map((e) => {
      if (e.role === 'question') return `<div class="deepen-entry deepen-question">${e.html}</div>`;
      return `<div class="deepen-entry deepen-${e.role}">${escapeHtml(e.text)}</div>`;
    })
    .join('');
```

Because `pushDeepen`/`updateDeepenPanel` re-render the whole thread, the submit handler in Step 2 must be re-bound after each render. Simplest robust approach: in `updateDeepenPanel` (after `bindDeepenControls()`), re-bind any unsubmitted question set. Add to `updateDeepenPanel`:

```js
  bindQuestionSubmits();
```

And add `bindQuestionSubmits` in `app.js`:

```js
function bindQuestionSubmits() {
  document.querySelectorAll('.qc-set').forEach((setEl) => {
    const submit = setEl.querySelector('[data-action="qc-submit"]');
    if (!submit || submit.dataset.bound) return;
    submit.dataset.bound = '1';
    const turnId = setEl.dataset.turnId;
    const entry = state.deepen.entries.find((e) => e.role === 'question' && e.turnId === turnId);
    if (!entry) return;
    submit.addEventListener('click', () => {
      const answers = collectAnswers(setEl, entry.questions);
      submit.disabled = true;
      pushDeepen('you', answers.map((a) => `${a.header}: ${a.values.join(', ') || '(skip)'}`).join(' · '));
      fetch('/deepen/answer', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ turnId, answers }),
      }).then(() => startHeartbeat()).catch((e) => pushDeepen('error', `Answer failed: ${e.message}`));
    });
  });
}
```

Then simplify `renderQuestionInThread` to only push the entry + call `updateDeepenPanel()` (binding is handled centrally by `bindQuestionSubmits`):

```js
function renderQuestionInThread(questions, turnId) {
  if (!questions.length) return;
  state.deepen.entries.push({ role: 'question', html: renderQuestionCards(questions, turnId), questions, turnId });
  updateDeepenPanel();
}
```

And update the `question` listener call in `runDeepen` to `renderQuestionInThread(questions, qTurn);` (drop the callback arg).

- [ ] **Step 4: Auto-scroll the thread to the newest entry**

In `updateDeepenPanel` (after setting `el.innerHTML`), scroll the thread container to the bottom:

```js
  const thread = el.querySelector('.deepen-thread');
  if (thread) thread.scrollTop = thread.scrollHeight;
```

- [ ] **Step 5: Style the cards + heartbeat**

Add to `ui/styles.css`:

```css
.deepen-question { background: transparent; padding: 0; }
.qc-set { display: flex; flex-direction: column; gap: 10px; }
.qc-card { border: 1px solid var(--border, #2f2f2f); border-radius: 8px; padding: 10px; }
.qc-header { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; opacity: 0.6; }
.qc-question { font-weight: 600; margin: 4px 0 8px; }
.qc-options { display: flex; flex-direction: column; gap: 6px; }
.qc-option { display: grid; grid-template-columns: auto 1fr; gap: 2px 8px; align-items: baseline; cursor: pointer; }
.qc-option-label { grid-column: 2; font-weight: 500; }
.qc-option-desc { grid-column: 2; font-size: 12px; opacity: 0.65; }
.qc-option input { grid-column: 1; grid-row: 1 / span 2; }
.qc-other { margin-top: 8px; width: 100%; box-sizing: border-box; }
.qc-submit { align-self: flex-end; margin-top: 4px; }
.deepen-heartbeat { opacity: 0.55; font-style: italic; }
```

- [ ] **Step 6: Syntax check + full browser verification with the stub**

Run: `node --check ui/app.js && node --check ui/panels/question-card.js && node --check ui/panels/deepen-thread.js`

Then: `MINDGRAPH_STUB_DEEPEN=1 npm run server -- --doc graphs/adolescence-of-technology.mindgraph.md`, open the UI, select a concept, click Deepen. Verify the full loop: a question card appears → choose an option (or type Other) → Answer → "Thinking…" heartbeat ticks → the graph grows with a connected node → a dashed discussion chip appears in the Source switcher → clicking it shows the discussion prose. Take a Playwright screenshot of the question card and of the grown graph.

- [ ] **Step 7: Commit**

```bash
git add ui/app.js ui/panels/question-card.js ui/panels/deepen-thread.js ui/styles.css
git commit -m "feat(ui): conversational deepen — question cards, answer round-trip, heartbeat"
```

---

## Task 8: Real agentRunner — ask_user_questions tool + discussion-source protocol + opt-in WebSearch

Make the real agent do what the stub demonstrated: ask structured questions through the same channel, optionally web-search, and author a discussion `@source`.

**Files:**
- Modify: `package.json` (declare `zod`)
- Modify: `src/server/agentRunner.js`

- [ ] **Step 1: Declare the `zod` dependency**

`zod` is already installed as a transitive dep of the SDK and resolvable, but `agentRunner` imports it directly, so declare it. In `package.json`, add to `dependencies`:

```json
"zod": "^3.23.8"
```

Then run `npm install` and confirm `node -e "import('zod').then(m=>console.log('zod', !!m.z))"` prints `zod true`. (Match the version npm resolves under `node_modules/zod/package.json` if it differs.)

- [ ] **Step 2: Add the ask_user_questions tool and discussion-source protocol**

Rewrite `src/server/agentRunner.js`. The key additions: an in-process SDK MCP server exposing `ask_user_questions` (its handler awaits `askQuestions`), the namespaced tool in `allowedTools` and `canUseTool`, opt-in `WebSearch`/`WebFetch`, the stream-close timeout for slow human answers, and a system prompt instructing the discussion-as-source protocol.

```js
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const SKILL_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../skills/mindgraph/SKILL.md',
);

function readSkill() {
  try { return readFileSync(SKILL_PATH, 'utf8'); }
  catch { return 'You digest source material into a navigable source-first concept graph.'; }
}

// Human answers can take a while; the SDK closes slow MCP tool calls at 60s by
// default. Give the reader room to think.
process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT ||= '600000';

export async function agentRunner({ slug, conceptId, prompt, emit, askQuestions }) {
  let query, tool, createSdkMcpServer;
  try {
    ({ query, tool, createSdkMcpServer } = await import('@anthropic-ai/claude-agent-sdk'));
  } catch {
    throw new Error('Agent SDK not installed. Run: npm install @anthropic-ai/claude-agent-sdk');
  }

  const mdDir = process.env.MINDGRAPH_MD_DIR || 'graphs';
  const mdPath = path.join(mdDir, `${slug}.mindgraph.md`);

  // The clarification tool. Its handler emits a question event (via askQuestions)
  // and blocks until the client posts an answer through the question channel.
  const askTool = tool(
    'ask_user_questions',
    'Ask the reader 1-2 structured clarifying questions when their intent is ambiguous. ONLY call this when you genuinely cannot tell which aspect of the concept to deepen. If the steer is already clear, skip it and proceed.',
    {
      questions: z.array(z.object({
        header: z.string().describe('Short chip label, max ~12 chars'),
        question: z.string(),
        options: z.array(z.object({ label: z.string(), description: z.string() })).min(2).max(4),
        multiSelect: z.boolean().optional(),
      })).min(1).max(2),
    },
    async (args) => {
      const answers = await askQuestions(args.questions);
      const text = (answers ?? [])
        .map((a) => `${a.header}: ${(a.values ?? []).join(', ') || '(no preference)'}`)
        .join('\n');
      return { content: [{ type: 'text', text: text || '(the reader skipped the questions)' }] };
    },
  );

  const questionServer = createSdkMcpServer({
    name: 'deepen-questions',
    version: '1.0.0',
    tools: [askTool],
  });

  const ASK_TOOL = 'mcp__deepen-questions__ask_user_questions';
  const allowedTools = ['Read', 'Edit', 'Grep', 'Glob', 'WebSearch', 'WebFetch', ASK_TOOL];

  const systemPrompt = `${readSkill()}

---
You are operating as the mindgraph "deepen" agent. A reader anchored on one concept wants to explore it further. This is a scoped, conversational edit — NOT a full re-digest.

PROTOCOL — the outcome of a deepen is a new discussion @source woven into the same .mindgraph.md:
1. If the reader's intent is ambiguous, call ask_user_questions ONCE with 1-2 crisp questions (2-4 options each). If their steer is already clear, skip it.
2. Optionally use WebSearch/WebFetch ONLY when the reader's ask goes beyond the existing source material. When you use the web, say so in the discussion prose and attribute it; never present web facts as if the original essay stated them.
3. Author a NEW @source of "type: discussion" (a discussion needs no path), id "disc-<conceptId>-<short-suffix>", titled "Deepen: <concept> (<angle>)".
4. Under it, write @block(s) of clean, readable prose that SYNTHESISE the exchange (not raw chat turns) — enough text to ground the new concepts.
5. Derive 1-3 @concepts FROM that discussion. Each derived concept's label or an alias MUST appear verbatim in its discussion block (reading QA binds on this).
6. Add a @section + @step(s) for the discussion source. In the step's focus, foreground the derived concepts (non-latent) AND include the anchor concept "${conceptId}" as "latent" (low weight) so cross-source relations validate without needing the anchor's label in the discussion text.
7. Add cross-source @relations (inline in the step's relations:) from the derived concepts to "${conceptId}" and any other clearly-related essay concepts. Use real typed edges (accelerates, enables, constrains, reframes, threatens, mitigates, depends_on, contrasts_with, supports), grounded in the discussion blocks.
8. Edit ONLY ${mdPath}. Do not run compile/validate/qa, do not edit any other file, do not output the whole document — make a surgical Edit appending the new source. When done, stop.`;

  const task = `Deepen the concept "${conceptId}" in ${mdPath} by weaving in a new discussion @source, following your PROTOCOL exactly.
First read ${mdPath} to learn the existing concept ids, the anchor's region, and the authoring format already in use.${prompt ? `\n\nThe reader's steer: "${prompt}". Let it guide whether you need to ask a question and which angle you deepen.` : '\n\nThe reader gave no steer — decide whether a clarifying question is warranted.'}`;

  emit({ type: 'progress', message: `asking Claude to deepen "${conceptId}"` });

  const conversation = query({
    prompt: task,
    options: {
      systemPrompt,
      model: process.env.MINDGRAPH_MODEL || 'claude-sonnet-4-6',
      mcpServers: { 'deepen-questions': questionServer },
      allowedTools,
      canUseTool: async (toolName, input) => {
        if (allowedTools.includes(toolName)) return { behavior: 'allow', updatedInput: input };
        return { behavior: 'deny', message: `Tool ${toolName} is not permitted for deepen.` };
      },
    },
  });

  for await (const message of conversation) {
    const content = message?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block?.type === 'tool_use' && block.name) {
        if (block.name === ASK_TOOL) continue; // the question UI speaks for this one
        const file = block.input?.file_path ? ` ${path.basename(block.input.file_path)}` : '';
        emit({ type: 'progress', message: `Claude: ${block.name}${file}` });
      } else if (block?.type === 'text' && block.text?.trim()) {
        emit({ type: 'progress', message: block.text.trim().slice(0, 140) });
      }
    }
  }

  emit({ type: 'progress', message: 'Claude finished editing' });
}
```

- [ ] **Step 3: Syntax check**

Run: `node --check src/server/agentRunner.js`
Expected: no output (valid).

- [ ] **Step 4: Real credentialed end-to-end (manual, requires ANTHROPIC_API_KEY or an active Claude session)**

Make a scratch copy so the canonical graph isn't mutated:

```bash
cp graphs/adolescence-of-technology.mindgraph.md /tmp/deepen-live.mindgraph.md
npm run server -- --doc /tmp/deepen-live.mindgraph.md
```

Open the UI, select a broad concept (e.g. `powerful-ai`) with NO steer, and Deepen. Verify: the agent asks a clarifying question → you answer → it works (progress streams; may WebSearch if you steer beyond the essay) → a discussion `@source` is appended to `/tmp/deepen-live.mindgraph.md` → the graph grows with connected, source-grounded concepts → the discussion chip is readable in the switcher. Then confirm QA from the CLI:

```bash
node src/cli/index.js authoring qa /tmp/deepen-live.mindgraph.md --json
```

Expected: `"ok": true`. If QA fails on a derived concept, the agent didn't write its label into the discussion block — tighten protocol rule 5 wording and retry. If the run is unavailable (no creds), document that this step is pending and rely on the stub-based verification from Tasks 4/7.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/server/agentRunner.js
git commit -m "feat(server): conversational agent deepen — ask_user_questions tool, discussion-source protocol, opt-in web search"
```

---

## Task 9: Undo + error handling for the woven turn

The deepen handler already snapshots `<slug>__backup` before the runner and `undoHandler` restores it. Confirm that reverts an entire woven turn (source + blocks + concepts + relations + section/step), and that question-cancel + compile/QA failures surface cleanly.

**Files:**
- Test: `test/undo-handler.test.js` (extend)
- Verify: `src/server/deepenHandler.js`, `src/server/undoHandler.js` (no change expected)

- [ ] **Step 1: Add a test that undo reverts a stub-woven discussion turn**

Append to `test/undo-handler.test.js` (reuse its existing import of `undoHandler`; add `deepenHandler`, `stubRunner`, `registry` imports if not present):

```js
import { deepenHandler } from '../src/server/deepenHandler.js';
import { stubRunner } from '../src/server/stubRunner.js';

test('undo reverts an entire woven discussion turn', async () => {
  const BASE = `---
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
Powerful AI could arrive within a few years.

# Concepts

@concept powerful-ai
label: Powerful AI
aliases: powerful AI
first_seen: e1

# Reader Steps

@step se1 section=sec-essay blocks=e1
summary: Essay.
focus:
  - powerful-ai 0.9

# Sections

@section sec-essay
title: Essay
summary: Essay.
steps: se1
`;
  const data = new Map([['living-doc', { md: BASE }]]);
  const store = {
    get: (slug) => data.get(slug),
    put: (slug, value) => data.set(slug, value),
  };
  const askQuestions = async () => [{ header: 'Angle', values: ['Timeline'] }];

  await deepenHandler({ slug: 'living-doc', conceptId: 'powerful-ai', prompt: '', store, runner: stubRunner, emit: () => {}, askQuestions });
  assert.match(store.get('living-doc').md ?? store.get('living-doc').json ? JSON.stringify(store.get('living-doc')) : '', /disc-powerful-ai|stub-driver/);

  const result = undoHandler({ slug: 'living-doc', store });
  assert.equal(result.ok, true);
  // After undo, the markdown is back to the essay-only baseline.
  assert.equal(store.get('living-doc').md, BASE);
});
```

Note: `deepenHandler` overwrites `living-doc` with `{ json }` after compiling; `undoHandler` restores `{ md: BASE }` from the backup and recompiles. Assert on the restored `md` equalling `BASE`. If `undoHandler`'s restore returns the markdown under a different key, adjust the assertion to match its actual contract (read `src/server/undoHandler.js` first).

- [ ] **Step 2: Run it**

Run: `node --test test/undo-handler.test.js`
Expected: PASS. If it fails because `undoHandler` recompiles and stores `{ json }` (not `{ md }`), assert that the recompiled document no longer contains the discussion source instead:

```js
  const restored = store.get('living-doc');
  const doc = restored.json ?? registry.run('compile', { markdown: restored.md }).value.document;
  assert.ok(!(doc.sources ?? []).some((s) => s.id.startsWith('disc-')), 'discussion source should be gone after undo');
```

- [ ] **Step 3: Verify the failure paths by reading the code**

Read `src/server/deepenHandler.js` and confirm: a compile failure or `validation.ok === false` emits `type: 'error'` and returns WITHOUT overwriting the stored document (graph stays unchanged). Confirm the UI `error` listener (Task 7) shows it in the thread. No code change unless a gap is found; if the handler overwrites the doc before validating, move the `store.put(slug, { json })` to AFTER the validation guard. Report what you found.

- [ ] **Step 4: Commit**

```bash
git add test/undo-handler.test.js
git commit -m "test(server): undo reverts the whole woven discussion turn"
```

---

## Task 10: Docs + full regression

Record the new deepen protocol where producers (you) will read it, and run everything.

**Files:**
- Modify: `skills/mindgraph/SKILL.md`
- Modify: `docs/superpowers/specs/2026-06-19-conversational-deepen-design.md` (flip Status)

- [ ] **Step 1: Add a deepen protocol note to the skill**

In `skills/mindgraph/SKILL.md`, add a short subsection (after the repair-loop section) summarising the discussion-as-source deepen so a future session knows the convention:

```markdown
## Conversational deepen (discussion-as-source)

When a reader deepens a concept in the UI, the outcome is a new `@source` of `type: discussion` woven into the same `.mindgraph.md`:

- The clarifying exchange is synthesised into discussion `@block`s (clean prose, not chat turns).
- 1–3 `@concept`s are derived from the discussion; each binds (label or alias verbatim) to a discussion block.
- A `@section` + `@step` foreground the derived concepts; the anchor concept rides along as `latent` so cross-source relations validate.
- Cross-source `@relation`s link the derived concepts to the essay's concepts, grounded in the discussion blocks.
- Web-derived material is attributed in the discussion prose, never presented as the original source.

Undo reverts the whole woven turn. The discussion is readable via the Source-tab source switcher.
```

- [ ] **Step 2: Flip the spec status**

In `docs/superpowers/specs/2026-06-19-conversational-deepen-design.md`, change `**Status:** Design` to `**Status:** Implemented`.

- [ ] **Step 3: Sync the global skill copy**

The skill is installed globally via `postinstall`. Re-sync so the operator copy matches:

```bash
node ./scripts/install-skill.js
```

Expected: prints that it copied the skill (or no-op if paths match). If the script needs a flag, check `scripts/install-skill.js` usage first.

- [ ] **Step 4: Full regression**

Run: `node --test test/*.test.js`
Expected: ALL PASS.

Run: `node --check ui/app.js && node --check ui/panels/question-card.js && node --check ui/panels/deepen-thread.js && npm run ui:check`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add skills/mindgraph/SKILL.md docs/superpowers/specs/2026-06-19-conversational-deepen-design.md
git commit -m "docs(deepen): document discussion-as-source protocol; mark spec implemented"
```

---

## Final verification (before finishing the branch)

1. `node --test test/*.test.js` — all green.
2. Stub end-to-end (no creds): `MINDGRAPH_STUB_DEEPEN=1 npm run server -- --doc graphs/adolescence-of-technology.mindgraph.md` → deepen a node → answer the question → graph grows → discussion chip readable → Undo reverts.
3. Real end-to-end (if creds available): Task 8 Step 4 against `/tmp/deepen-live.mindgraph.md`, ending in CLI `authoring qa … --json` → `"ok": true`.
4. Hand off via **superpowers:finishing-a-development-branch** (do not push without explicit approval — the user said "no hurry to push").

## Notes for the implementer

- **Test runner:** `node --test test/*.test.js`. New tests are plain `node:test` files in `test/`.
- **Operations are the only compile/QA path:** always go through `registry.run('compile'|'qa'|'view_model', …)` from `src/operations/index.js`; never reimplement compilation.
- **Never hand-edit compiled `.mindgraph.json`.** The `.md` is truth; the runner edits the `.md`; the handler recompiles.
- **QA invariant:** a derived non-latent focus concept must have its label/alias verbatim in its step's blocks; a relation's endpoints must both be foregrounded in the step (anchor as `latent`). Tasks 1 and 4 encode this; keep it true everywhere.
- **Don't introduce a bundler/framework** (CLAUDE.md standing rule). The UI stays vanilla ES modules.
- **v1 omits a persistent streaming session** (see the scoping note up top). If you find yourself reaching for a kept-alive `query()` across HTTP requests, stop — that's out of scope.

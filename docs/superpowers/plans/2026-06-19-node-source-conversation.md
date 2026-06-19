# Node ⇄ Source Conversation ("Ask") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reframe the node panel from a one-shot "Deepen" into an "Ask" conversation — fast, source-grounded talk by default (no graph change), plus an explicit "Add to graph" that crystallizes the conversation into a discussion `@source`.

**Architecture:** Two server runners over a shared SDK helper — `answerRunner` (read-only, source-preloaded, streams a fast answer) and `crystallizeRunner` (the existing discussion-authoring agent, fed the chat transcript). Both stream over `POST` + `fetch`/`ReadableStream` SSE frames (replacing `EventSource`). The structured question-card machinery is deleted. The discussion-as-source artifact, source switcher, heartbeat, and Undo all survive.

**Tech Stack:** Node `node:http` (SSE over POST), vanilla ES-module browser UI (fetch streaming, no framework/bundler), `@anthropic-ai/claude-agent-sdk` (`query`), `node --test`.

**Spec:** `docs/superpowers/specs/2026-06-19-node-source-conversation-design.md`. Supersedes the interaction model in `2026-06-19-conversational-deepen-design.md`.

---

## File Structure

**New:**
- `src/server/nodeContext.js` — pure `buildNodeContext(document, conceptId)` → the anchor's blocks + neighbors, for preloading the answer prompt.
- `src/server/crystallizeTask.js` — pure `buildCrystallizeTask({ conceptId, messages, mdPath })` → the agent task string built from the conversation.
- `src/server/agentSdk.js` — shared `loadSdk()` + `readSkill()` helpers used by both runners.
- `src/server/answerRunner.js` — read-only talk runner (streams an answer, writes nothing).
- `src/server/crystallizeRunner.js` — discussion-authoring runner fed the transcript (was `agentRunner.js`, minus the question tool).
- `src/server/askHandler.js` — runs `answerRunner` over a compiled document; writes nothing.
- `ui/sse-stream.js` — `parseSseBuffer(buffer)` (pure) + `streamPost(url, body, onEvent)` (fetch streaming).
- Tests: `test/node-context.test.js`, `test/crystallize-task.test.js`, `test/sse-stream.test.js`, `test/ask-handler.test.js`.

**Renamed/Modified:**
- `src/server/deepenHandler.js` → `src/server/crystallizeHandler.js` (drop `askQuestions`; task from transcript).
- `src/server/stubRunner.js` — split into a stub answer + stub crystallize (keyed by which handler calls it).
- `src/server/index.js` — `POST /ask`, `POST /crystallize`; delete `/deepen`, `/deepen/answer`, the question channel, `ready`/`question`.
- `ui/app.js` — Ask panel: talk (`POST /ask`) + Add-to-graph (`POST /crystallize`); remove all question-card wiring; use `streamPost`.
- `ui/panels/deepen-thread.js` → `ui/panels/ask-thread.js` (header "Ask", input, Add-to-graph + Undo buttons).
- `ui/index.html` — tab label/ids "Deepen" → "Ask".
- `ui/styles.css` — remove `qc-*` rules; rename `deepen-*` selectors used by the panel as needed.
- `skills/mindgraph/SKILL.md` — update the deepen section to the Ask/crystallize model.

**Deleted:**
- `src/server/questionChannel.js`, `src/server/agentRunner.js` (replaced by the two runners), `ui/panels/question-card.js`.
- `test/question-channel.test.js`, `test/deepen-answer-route.test.js`.

---

## Task 1: Node-context preloader (pure)

Powers fast answers: given the document and a concept, return the source blocks that foreground it plus its graph neighbors, so the answer prompt rarely needs `Read`.

**Files:**
- Create: `src/server/nodeContext.js`
- Test: `test/node-context.test.js`

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/node-context.test.js`
Expected: FAIL — `Cannot find module '../src/server/nodeContext.js'`.

- [ ] **Step 3: Implement the preloader**

```js
// Pure: from a compiled source-first document + a concept id, gather the source
// blocks that foreground the concept and its graph neighbors. Used to preload
// the answer prompt so a talk turn rarely needs to Read the file.
export function buildNodeContext(document, conceptId) {
  const atomic = document?.concepts?.atomic ?? [];
  const concept = atomic.find((c) => c.id === conceptId) ?? null;
  if (!concept) return { concept: null, blocks: [], neighbors: [] };

  const blockById = Object.fromEntries((document.sourceBlocks ?? []).map((b) => [b.id, b]));

  // Blocks from every reader step that foregrounds this concept.
  const blockIds = [];
  for (const step of document.readerSteps ?? []) {
    const foregrounds = (step.focusConcepts ?? []).some((f) => f.id === conceptId);
    if (foregrounds) {
      for (const id of step.sourceBlockIds ?? []) if (!blockIds.includes(id)) blockIds.push(id);
    }
  }
  // Fallback: the concept's first-seen block.
  if (blockIds.length === 0 && concept.firstSeenBlockId) blockIds.push(concept.firstSeenBlockId);

  const blocks = blockIds
    .map((id) => blockById[id])
    .filter(Boolean)
    .map((b) => ({ id: b.id, text: b.text ?? '' }));

  // Neighbors: the other endpoint of every relation touching this concept.
  const labelById = Object.fromEntries(atomic.map((c) => [c.id, c.label]));
  const neighbors = [];
  const seen = new Set();
  for (const r of document.relations ?? []) {
    let otherId = null;
    let direction = null;
    if (r.from === conceptId) { otherId = r.to; direction = 'out'; }
    else if (r.to === conceptId) { otherId = r.from; direction = 'in'; }
    if (!otherId || seen.has(otherId + r.type + direction)) continue;
    seen.add(otherId + r.type + direction);
    neighbors.push({ id: otherId, label: labelById[otherId] ?? otherId, type: r.type, direction });
  }

  return {
    concept: { id: concept.id, label: concept.label, aliases: concept.aliases ?? [] },
    blocks,
    neighbors,
  };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test test/node-context.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/nodeContext.js test/node-context.test.js
git commit -m "feat(server): node-context preloader for fast source-grounded answers"
```

---

## Task 2: Crystallize task builder (pure)

Decouples the crystallize prompt text (transcript → task) from the SDK call so it's unit-testable.

**Files:**
- Create: `src/server/crystallizeTask.js`
- Test: `test/crystallize-task.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCrystallizeTask } from '../src/server/crystallizeTask.js';

test('buildCrystallizeTask embeds the concept, transcript, and target file', () => {
  const task = buildCrystallizeTask({
    conceptId: 'powerful-ai',
    mdPath: 'graphs/x.mindgraph.md',
    messages: [
      { role: 'you', text: 'what is this about?' },
      { role: 'agent', text: 'It is about imminent powerful AI.' },
      { role: 'you', text: 'add the recursive loop idea' },
    ],
  });
  assert.match(task, /powerful-ai/);
  assert.match(task, /graphs\/x\.mindgraph\.md/);
  assert.match(task, /what is this about\?/);
  assert.match(task, /It is about imminent powerful AI\./);
  assert.match(task, /add the recursive loop idea/);
  // It must instruct authoring a discussion source from the conversation.
  assert.match(task, /discussion/i);
});

test('buildCrystallizeTask labels speakers readably', () => {
  const task = buildCrystallizeTask({
    conceptId: 'c',
    mdPath: 'm.md',
    messages: [{ role: 'you', text: 'hi' }, { role: 'agent', text: 'hello' }],
  });
  assert.match(task, /Reader: hi/);
  assert.match(task, /You \(assistant\): hello/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/crystallize-task.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the task builder**

```js
// Pure: turn an anchored conversation into the crystallize agent's task prompt.
// The agent will weave the durable concepts the conversation surfaced into a new
// discussion @source (the discussion-as-source protocol lives in the system prompt).
export function buildCrystallizeTask({ conceptId, mdPath, messages }) {
  const transcript = (messages ?? [])
    .map((m) => `${m.role === 'agent' ? 'You (assistant)' : 'Reader'}: ${m.text}`)
    .join('\n');

  return `The reader has been talking with you about the concept "${conceptId}" in ${mdPath}, grounded in its source. Below is the conversation. Crystallise it: weave the durable concepts it surfaced into a NEW discussion @source, following your PROTOCOL exactly.

First read ${mdPath} to learn the existing concept ids and the authoring format already in use.

Conversation:
${transcript}

Capture what is durable and reusable from this conversation (not every aside). Each derived concept must bind verbatim to a discussion block, the anchor "${conceptId}" rides along as latent, and cross-source relations link the new concepts to "${conceptId}" and other relevant existing concepts. Make a surgical Edit appending the new source; do not output the whole document. When done, stop.`;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test test/crystallize-task.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/crystallizeTask.js test/crystallize-task.test.js
git commit -m "feat(server): crystallize task builder (conversation -> agent task)"
```

---

## Task 3: SSE-frame parser + streamPost (client transport)

The pure half (`parseSseBuffer`) is unit-tested; `streamPost` wraps it around `fetch`.

**Files:**
- Create: `ui/sse-stream.js`
- Test: `test/sse-stream.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSseBuffer } from '../ui/sse-stream.js';

test('parseSseBuffer yields complete events and keeps the partial remainder', () => {
  const buf =
    'event: progress\ndata: {"message":"hi"}\n\n' +
    ': keep-alive\n\n' +
    'event: answer\ndata: {"text":"par';
  const { events, rest } = parseSseBuffer(buf);
  assert.equal(events.length, 1, 'only the first complete frame (the comment frame carries no data)');
  assert.equal(events[0].type, 'progress');
  assert.deepEqual(events[0].data, { message: 'hi' });
  assert.equal(rest, 'event: answer\ndata: {"text":"par');
});

test('parseSseBuffer parses an event with no data line as null data', () => {
  const { events } = parseSseBuffer('event: done\n\n');
  assert.equal(events[0].type, 'done');
  assert.equal(events[0].data, null);
});

test('parseSseBuffer leaves non-JSON data as a string', () => {
  const { events } = parseSseBuffer('event: note\ndata: plain text\n\n');
  assert.equal(events[0].data, 'plain text');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/sse-stream.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the parser + streamPost**

```js
// Parse a growing SSE text buffer into complete events. Returns the events found
// and the leftover partial frame (to be prepended to the next chunk). Pure.
export function parseSseBuffer(buffer) {
  const events = [];
  let idx;
  while ((idx = buffer.indexOf('\n\n')) !== -1) {
    const frame = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 2);
    let type = 'message';
    const dataLines = [];
    for (const line of frame.split('\n')) {
      if (line.startsWith('event:')) type = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
      // ':' comment lines (keep-alives) are ignored
    }
    if (dataLines.length) {
      const raw = dataLines.join('\n');
      let data;
      try { data = JSON.parse(raw); } catch { data = raw; }
      events.push({ type, data });
    } else if (type !== 'message') {
      events.push({ type, data: null });
    }
  }
  return { events, rest: buffer };
}

// POST a JSON body and stream the SSE-formatted response, invoking onEvent({type,data})
// for each complete event as it arrives.
export async function streamPost(url, body, onEvent) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    onEvent({ type: 'error', data: { message: `request failed (${res.status})` } });
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const { events, rest } = parseSseBuffer(buffer);
    buffer = rest;
    for (const e of events) onEvent(e);
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test test/sse-stream.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add ui/sse-stream.js test/sse-stream.test.js
git commit -m "feat(ui): SSE-over-fetch stream parser + streamPost"
```

---

## Task 4: SDK helper + the two runners

Split the single `agentRunner.js` into a read-only `answerRunner` and a `crystallizeRunner`, over a shared SDK/skill helper. No more `ask_user_questions` tool or `mcpServers`.

**Files:**
- Create: `src/server/agentSdk.js`, `src/server/answerRunner.js`, `src/server/crystallizeRunner.js`
- Delete (Step 7): `src/server/agentRunner.js`
- Reference: `src/server/crystallizeTask.js` (Task 2), `src/server/nodeContext.js` (Task 1)

- [ ] **Step 1: Create the shared SDK helper `src/server/agentSdk.js`**

```js
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../skills/mindgraph/SKILL.md',
);

export function readSkill() {
  try { return readFileSync(SKILL_PATH, 'utf8'); }
  catch { return 'You digest source material into a navigable source-first concept graph.'; }
}

export async function loadSdk() {
  try {
    const mod = await import('@anthropic-ai/claude-agent-sdk');
    return mod;
  } catch {
    throw new Error('Agent SDK not installed. Run: npm install @anthropic-ai/claude-agent-sdk');
  }
}
```

- [ ] **Step 2: Create `src/server/answerRunner.js` (read-only talk)**

```js
import { readSkill, loadSdk } from './agentSdk.js';

// Read-only talk runner. Answers a question about the anchored node, grounded in
// its preloaded source context. Streams `answer` (assistant text) + `progress`
// (tool use). Never edits the file.
//   ctx: { concept:{id,label,aliases}, blocks:[{id,text}], neighbors:[{id,label,type,direction}] }
//   messages: [{ role:'you'|'agent', text }]  (full conversation so far)
export async function answerRunner({ conceptId, context, messages, emit }) {
  const { query } = await loadSdk();

  const blockText = (context?.blocks ?? []).map((b) => `[${b.id}] ${b.text}`).join('\n\n');
  const neighborText = (context?.neighbors ?? [])
    .map((n) => `- ${n.label} (${n.direction === 'out' ? `${conceptId} ${n.type} ${n.id}` : `${n.id} ${n.type} ${conceptId}`})`)
    .join('\n') || '(none)';
  const label = context?.concept?.label ?? conceptId;

  const systemPrompt = `${readSkill()}

---
You are the mindgraph "Ask" agent. The reader has selected one concept in a digested source and wants to talk about it, grounded in that source. Answer concisely and conversationally (a few sentences). Ground your answer in the SOURCE CONTEXT below; quote or cite block ids when useful. If the question goes beyond the source, you MAY use WebSearch/WebFetch — but say so and attribute it; never present outside facts as if the source stated them. Do NOT edit any file. Do NOT author concepts or relations — this is conversation, not graph editing.

ANCHOR CONCEPT: ${label} (id: ${conceptId})

SOURCE CONTEXT (blocks that foreground this concept):
${blockText || '(no preloaded blocks — use Read/Grep on the source if needed)'}

GRAPH NEIGHBORS:
${neighborText}`;

  // Replay the conversation as the prompt; the latest reader message is last.
  const prompt = (messages ?? [])
    .map((m) => `${m.role === 'agent' ? 'Assistant' : 'Reader'}: ${m.text}`)
    .join('\n') || `Reader: Tell me about "${label}".`;

  const allowedTools = ['Read', 'Grep', 'WebSearch', 'WebFetch'];
  const conversation = query({
    prompt,
    options: {
      systemPrompt,
      model: process.env.MINDGRAPH_MODEL || 'claude-sonnet-4-6',
      allowedTools,
      canUseTool: async (toolName, input) => {
        if (allowedTools.includes(toolName)) return { behavior: 'allow', updatedInput: input };
        return { behavior: 'deny', message: `Tool ${toolName} is not permitted in Ask.` };
      },
    },
  });

  for await (const message of conversation) {
    const content = message?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block?.type === 'text' && block.text?.trim()) {
        emit({ type: 'answer', text: block.text });
      } else if (block?.type === 'tool_use' && block.name) {
        emit({ type: 'progress', message: `Claude: ${block.name}` });
      }
    }
  }
}
```

- [ ] **Step 3: Create `src/server/crystallizeRunner.js` (discussion authoring from the transcript)**

```js
import path from 'node:path';
import { readSkill, loadSdk } from './agentSdk.js';
import { buildCrystallizeTask } from './crystallizeTask.js';

// Crystallize the conversation into a new discussion @source. Edits the .md in
// place; the handler compiles + QAs afterward. No question tool — the chat already
// happened.
export async function crystallizeRunner({ slug, conceptId, messages, emit }) {
  const { query } = await loadSdk();
  const mdDir = process.env.MINDGRAPH_MD_DIR || 'graphs';
  const mdPath = path.join(mdDir, `${slug}.mindgraph.md`);

  const systemPrompt = `${readSkill()}

---
You are the mindgraph "crystallize" agent. The reader has had a conversation about one concept and now wants to add what it surfaced to the graph. This is a scoped edit, NOT a re-digest.

PROTOCOL — author a NEW discussion @source woven into the same .mindgraph.md:
1. Optionally use WebSearch/WebFetch ONLY if the conversation relied on facts beyond the source; attribute them in the prose, never as the original source.
2. Add a NEW @source of "type: discussion" (no path), id "disc-<conceptId>-<short-suffix>", titled Deepen: <concept> (<angle>) — do NOT wrap the title in quotes.
3. Write @block(s) of clean, readable prose that SYNTHESISE the conversation (not raw turns) — enough text to ground the new concepts.
4. Derive 1-3 @concepts from the discussion. Each derived concept's label or an alias MUST appear verbatim in its discussion block (reading QA binds on this).
5. Add a @section + @step(s); the step's focus foregrounds the derived concepts (non-latent) AND includes the anchor "${conceptId}" as "latent" so cross-source relations validate.
6. Add cross-source @relations (inline in the step's relations:) from the derived concepts to "${conceptId}" and other clearly-related existing concepts, with real typed edges, grounded in the discussion blocks.
7. Edit ONLY ${mdPath}. Do not run compile/validate/qa, do not edit any other file, do not output the whole document. When done, stop.`;

  const task = buildCrystallizeTask({ conceptId, mdPath, messages });

  emit({ type: 'progress', message: `crystallising the conversation about "${conceptId}"` });

  const allowedTools = ['Read', 'Edit', 'Grep', 'Glob', 'WebSearch', 'WebFetch'];
  const conversation = query({
    prompt: task,
    options: {
      systemPrompt,
      model: process.env.MINDGRAPH_MODEL || 'claude-sonnet-4-6',
      allowedTools,
      canUseTool: async (toolName, input) => {
        if (allowedTools.includes(toolName)) return { behavior: 'allow', updatedInput: input };
        return { behavior: 'deny', message: `Tool ${toolName} is not permitted for crystallize.` };
      },
    },
  });

  for await (const message of conversation) {
    const content = message?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block?.type === 'tool_use' && block.name) {
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

- [ ] **Step 4: Syntax-check the three files**

Run: `node --check src/server/agentSdk.js && node --check src/server/answerRunner.js && node --check src/server/crystallizeRunner.js`
Expected: no output.

- [ ] **Step 5: Delete the old runner**

```bash
git rm src/server/agentRunner.js
```

- [ ] **Step 6: Commit**

```bash
git add src/server/agentSdk.js src/server/answerRunner.js src/server/crystallizeRunner.js
git commit -m "feat(server): split deepen into answerRunner (talk) + crystallizeRunner"
```

---

## Task 5: Handlers + stub split

`askHandler` runs the answer turn (no file write); `crystallizeHandler` (renamed from `deepenHandler`) runs the authoring turn. The stub gains a matching answer + crystallize.

**Files:**
- Create: `src/server/askHandler.js`, `test/ask-handler.test.js`
- Rename: `src/server/deepenHandler.js` → `src/server/crystallizeHandler.js`
- Modify: `src/server/stubRunner.js`

- [ ] **Step 1: Create `src/server/crystallizeHandler.js` (rename of deepenHandler, drop askQuestions)**

```js
import { registry } from '../operations/index.js';

// Backup -> runner (edits the .md) -> compile -> validate -> qa -> emit document.
// On any failure, returns before overwriting the stored document, so the consumer
// graph stays unchanged and Undo can restore the backup.
export async function crystallizeHandler({ slug, conceptId, messages, store, runner, emit }) {
  try {
    emit({ type: 'progress', message: 'crystallising' });

    const before = store.get(slug);
    if (before && typeof before.md === 'string') {
      store.put(`${slug}__backup`, { md: before.md });
    }

    await runner({ slug, conceptId, messages, store, emit });

    const entry = store.get(slug);
    if (!entry || typeof entry.md !== 'string') {
      emit({ type: 'error', message: `No markdown found for ${slug}` });
      return;
    }

    emit({ type: 'progress', message: 'compiling' });
    const compiled = registry.run('compile', { markdown: entry.md });
    if (!compiled.ok) {
      emit({ type: 'error', message: compiled.errors.map((error) => error.message).join('; ') });
      return;
    }
    if (compiled.value.validation.ok === false) {
      emit({ type: 'error', message: `compiled document invalid: ${compiled.value.validation.errors.join('; ')}` });
      return;
    }

    store.put(slug, { json: compiled.value.document });
    const qa = registry.run('qa', { document: compiled.value.document });
    emit({ type: 'document', document: compiled.value.document, qa: qa.ok ? qa.value : null });
  } catch (error) {
    emit({ type: 'error', message: error?.message ?? String(error) });
  }
}
```

Then delete the old file:
```bash
git rm src/server/deepenHandler.js
```

- [ ] **Step 2: Write the failing test `test/ask-handler.test.js`**

```js
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
  // A fake runner that asserts it received preloaded context and emits an answer.
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
  // The stored markdown is untouched.
  assert.equal(store.get('demo').md, MD);
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `node --test test/ask-handler.test.js`
Expected: FAIL — `Cannot find module '../src/server/askHandler.js'`.

- [ ] **Step 4: Implement `src/server/askHandler.js`**

```js
import { registry } from '../operations/index.js';
import { buildNodeContext } from './nodeContext.js';

// Talk turn: compile the current markdown, preload the node's source context, run
// the (read-only) runner. Writes nothing — the graph never changes on an ask.
export async function askHandler({ slug, conceptId, messages, store, runner, emit }) {
  try {
    const entry = store.get(slug);
    const md = entry?.md;
    if (typeof md !== 'string') {
      emit({ type: 'error', message: `No markdown found for ${slug}` });
      return;
    }
    const compiled = registry.run('compile', { markdown: md });
    if (!compiled.ok || compiled.value.validation.ok === false) {
      emit({ type: 'error', message: 'Could not read the source for this graph.' });
      return;
    }
    const context = buildNodeContext(compiled.value.document, conceptId);
    await runner({ conceptId, context, messages, emit });
    emit({ type: 'done' });
  } catch (error) {
    emit({ type: 'error', message: error?.message ?? String(error) });
  }
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `node --test test/ask-handler.test.js`
Expected: PASS.

- [ ] **Step 6: Split the stub runner into answer + crystallize**

Replace `src/server/stubRunner.js` with two exports. The crystallize stub is the current discussion-weaving (fed by the last user message instead of a scripted question); the answer stub echoes a preloaded block:

```js
// No-API runners for MINDGRAPH_STUB_DEEPEN. stubAnswerRunner mirrors answerRunner
// (emits an `answer`, writes nothing); stubCrystallizeRunner mirrors
// crystallizeRunner (weaves a discussion @source).
export async function stubAnswerRunner({ conceptId, context, messages, emit }) {
  const last = messages?.[messages.length - 1]?.text ?? '';
  const snippet = context?.blocks?.[0]?.text?.slice(0, 160) ?? '(no source preloaded)';
  emit({ type: 'progress', message: `stub: answering about ${conceptId}` });
  emit({
    type: 'answer',
    text: `(stub) You asked: "${last}". This node, "${context?.concept?.label ?? conceptId}", is grounded in: ${snippet}`,
  });
}

export async function stubCrystallizeRunner({ slug, conceptId, messages, store, emit }) {
  emit({ type: 'progress', message: `stub: crystallising ${conceptId}` });
  const entry = store.get(slug);
  const md = entry?.md;
  if (typeof md !== 'string') { emit({ type: 'progress', message: 'stub: no markdown' }); return; }

  const angle = messages?.[messages.length - 1]?.text?.slice(0, 24) || 'discussion';
  const suffix = Date.now().toString(36);
  const sourceId = `disc-${conceptId}-${suffix}`;
  const conceptIdNew = `stub-driver-${suffix}`;
  const driverPhrase = 'stub driver';
  const block = `We discussed "${conceptId}" (${angle}). The ${driverPhrase} we surfaced compounds its effect over time.`;

  const addition = `

@source ${sourceId}
type: discussion
title: Deepen: ${conceptId} (${angle})

@block ${sourceId}-d1 source=${sourceId} kind=paragraph
${block}

@concept ${conceptIdNew}
label: Stub driver
aliases: ${driverPhrase}
first_seen: ${sourceId}-d1

@step ${sourceId}-s1 section=${sourceId}-sec blocks=${sourceId}-d1
summary: The discussion derives the ${driverPhrase} as a driver of ${conceptId}.
focus:
  - ${conceptIdNew} 0.85
  - ${conceptId} 0.3 latent
relations:
  - ${conceptIdNew} -> ${conceptId} accelerates 0.75

@section ${sourceId}-sec
title: Deepen: ${conceptId} (${angle})
summary: A stub discussion woven into the graph.
steps: ${sourceId}-s1
`;
  store.put(slug, { md: md + addition });
  emit({ type: 'progress', message: `stub wove a discussion source for ${conceptId}` });
}
```

- [ ] **Step 7: Update `test/stub-deepen-discussion.test.js` to the new export**

Change its import from `stubRunner` to `stubCrystallizeRunner` and its call to pass `messages` instead of `askQuestions`:

```js
import { stubCrystallizeRunner } from '../src/server/stubRunner.js';
// ...
await stubCrystallizeRunner({
  slug: 'living-doc',
  conceptId: 'powerful-ai',
  messages: [{ role: 'you', text: 'add the timeline angle' }],
  store,
  emit,
});
```
Drop the `askQuestions` definition and the assertion that it asked a question; keep the compile + QA + cross-source assertions. (Rename the test file to `test/stub-crystallize.test.js` with `git mv` for clarity.)

- [ ] **Step 8: Run the affected tests**

Run: `node --test test/ask-handler.test.js test/stub-crystallize.test.js`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/server/askHandler.js src/server/crystallizeHandler.js src/server/stubRunner.js test/ask-handler.test.js test/stub-crystallize.test.js
git rm src/server/deepenHandler.js
git commit -m "feat(server): askHandler (talk, no write) + crystallizeHandler + stub split"
```

---

## Task 6: Server routes — `POST /ask` + `POST /crystallize`; remove question machinery

**Files:**
- Modify: `src/server/index.js`
- Delete: `src/server/questionChannel.js`, `test/question-channel.test.js`, `test/deepen-answer-route.test.js`
- Modify: `test/undo-handler.test.js` (rename imports)

- [ ] **Step 1: Rewrite the deepen wiring in `src/server/index.js`**

Remove these from `index.js`: the `import { deepenHandler }`, `import { stubRunner }`, `import { createQuestionChannel }` lines; the `const questionChannel`/`turnCounter` lines; the entire `handleDeepen` function; the `selectRunner` function; the `POST /deepen/answer` route; and the `GET /deepen` route.

Add the new imports near the other server imports:
```js
import { askHandler } from './askHandler.js';
import { crystallizeHandler } from './crystallizeHandler.js';
import { answerRunner } from './answerRunner.js';
import { crystallizeRunner } from './crystallizeRunner.js';
import { stubAnswerRunner, stubCrystallizeRunner } from './stubRunner.js';
```

Add a JSON body reader and a streaming-response opener near the top-level helpers:
```js
function readJsonBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; if (body.length > 4_000_000) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch { resolve(null); } });
    req.on('error', () => resolve(null));
  });
}

function openSseResponse(req, res) {
  let closed = false;
  const keepAlive = setInterval(() => { if (!closed) res.write(': ping\n\n'); }, 20_000);
  const finish = () => { closed = true; clearInterval(keepAlive); };
  req.on('close', finish);
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
  res.flushHeaders?.();
  const emit = (event) => { if (!closed) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`); };
  return { emit, finish };
}
```

Add the two route handlers. The runners are statically imported (above) — they're safe to import because each one loads the SDK lazily (inside `loadSdk`, only when invoked), so a missing SDK surfaces as a caught `error` event at run time, not a boot failure. The stub swap is a simple per-handler ternary:
```js
const useStub = Boolean(process.env.MINDGRAPH_STUB_DEEPEN);

async function handleAsk(req, res) {
  const payload = await readJsonBody(req);
  if (!payload?.concept) {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Missing required field: concept');
    return;
  }
  const { emit, finish } = openSseResponse(req, res);
  await askHandler({
    slug: payload.slug || activeSlug,
    conceptId: payload.concept,
    messages: payload.messages ?? [],
    store: fsStore,
    runner: useStub ? stubAnswerRunner : answerRunner,
    emit,
  });
  finish();
  res.end();
}

async function handleCrystallize(req, res) {
  const payload = await readJsonBody(req);
  if (!payload?.concept) {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Missing required field: concept');
    return;
  }
  const { emit, finish } = openSseResponse(req, res);
  await crystallizeHandler({
    slug: payload.slug || activeSlug,
    conceptId: payload.concept,
    messages: payload.messages ?? [],
    store: fsStore,
    runner: useStub ? stubCrystallizeRunner : crystallizeRunner,
    emit,
  });
  finish();
  res.end();
}
```
(If the SDK is missing, `loadSdk()` throws inside the runner; `askHandler`/`crystallizeHandler` catch it and emit an `error` event — the server stays up.)

Wire the routes in the `http.createServer` callback (keep `GET /undo`, `/doc.md`, `/doc.json`, static):
```js
  if (req.method === 'POST' && pathname === '/ask') { handleAsk(req, res); return; }
  if (req.method === 'POST' && pathname === '/crystallize') { handleCrystallize(req, res); return; }
```

- [ ] **Step 2: Delete the question machinery + its tests**

```bash
git rm src/server/questionChannel.js test/question-channel.test.js test/deepen-answer-route.test.js
```

- [ ] **Step 3: Fix `test/undo-handler.test.js`**

Update its imports: `deepenHandler` → `crystallizeHandler` (from `../src/server/crystallizeHandler.js`), `stubRunner` → `stubCrystallizeRunner`. In both the existing test and the woven-turn test, replace `deepenHandler({... runner ..., askQuestions})` calls with `crystallizeHandler({ slug, conceptId, messages: [{ role: 'you', text: 'add it' }], store, runner, emit })`. For the custom `addRunner`, update its signature to `async ({ slug, store }) => { ... }` (unchanged body). For the woven-turn test, use `stubCrystallizeRunner` as the runner and drop `askQuestions`.

- [ ] **Step 4: Syntax + full suite**

Run: `node --check src/server/index.js && node --test test/*.test.js`
Expected: `--check` clean; all tests pass. (Tests that imported the deleted modules are gone; undo + stub-crystallize updated.)

- [ ] **Step 5: Commit**

```bash
git add src/server/index.js test/undo-handler.test.js
git rm src/server/questionChannel.js test/question-channel.test.js test/deepen-answer-route.test.js
git commit -m "feat(server): POST /ask + /crystallize routes; remove question channel"
```

---

## Task 7: UI — the Ask panel (talk + Add to graph), remove question cards

**Files:**
- Modify: `ui/index.html`, `ui/app.js`, `ui/styles.css`
- Rename: `ui/panels/deepen-thread.js` → `ui/panels/ask-thread.js`
- Delete: `ui/panels/question-card.js`

- [ ] **Step 1: Rename the tab in `ui/index.html`**

In the prose tabs block, change the Deepen tab to Ask (label + id + data-tab) and the pane id:
```html
        <button class="prose-tab" id="tab-ask" role="tab" data-tab="ask">Ask</button>
```
and
```html
        <div class="prose-view is-hidden" id="prose-ask"></div>
```
(Replace the former `tab-deepen` / `prose-deepen` / `data-tab="deepen"` / "Deepen" occurrences.)

- [ ] **Step 2: Rewrite `ui/panels/deepen-thread.js` as `ui/panels/ask-thread.js`**

```bash
git mv ui/panels/deepen-thread.js ui/panels/ask-thread.js
```
Replace its contents:
```js
import { escapeHtml } from '../util.js';

// Render the Ask tab. `vm`:
//   { conceptId, conceptLabel, busy, entries:[{role,text}], canUndo, canCrystallize, thinking:{seconds}|null }
export function renderAskThread(vm) {
  if (!vm.conceptId) {
    return `<div class="ask-empty">Select a concept to talk about it in the context of the source.</div>`;
  }
  const entries = vm.entries
    .map((e) => `<div class="ask-entry ask-${e.role}">${escapeHtml(e.text)}</div>`)
    .join('');
  const thinking = vm.thinking
    ? `<div class="ask-entry ask-heartbeat">Thinking… (${vm.thinking.seconds}s)</div>`
    : '';
  const add = vm.canCrystallize
    ? `<button class="ask-add" data-action="ask-add" ${vm.busy ? 'disabled' : ''}>Add to graph</button>`
    : '';
  const undo = vm.canUndo
    ? `<button class="ask-undo" data-action="ask-undo">Undo</button>`
    : '';
  return (
    `<div class="ask-head">Ask: <strong>${escapeHtml(vm.conceptLabel)}</strong></div>` +
    `<div class="ask-thread">${entries}${thinking}</div>` +
    `<div class="ask-input">` +
      `<input id="ask-prompt" type="text" placeholder="Ask about ${escapeHtml(vm.conceptLabel)}…" ${vm.busy ? 'disabled' : ''} />` +
      `<button data-action="ask-send" ${vm.busy ? 'disabled' : ''}>${vm.busy ? '…' : 'Send'}</button>` +
      add + undo +
    `</div>`
  );
}
```

- [ ] **Step 3: Rewrite the panel wiring in `ui/app.js`**

(a) Imports (top): replace
```js
import { renderDeepenThread } from './panels/deepen-thread.js';
import { renderQuestionCards, collectAnswers } from './panels/question-card.js';
```
with
```js
import { renderAskThread } from './panels/ask-thread.js';
import { streamPost } from './sse-stream.js';
```

(b) `state` field: rename `state.deepen` initial shape everywhere it's reset to include the conversation + flags. Wherever the code does `state.deepen = { entries: [], busy: false, canUndo: false }`, change to:
```js
    state.ask = { entries: [], busy: false, canUndo: false, canCrystallize: false, thinking: null };
```
and rename the initial `state` declaration field `deepen:` → `ask:` accordingly. Replace ALL `state.deepen` with `state.ask` in the file.

(c) `setSourceTab` (uses `'deepen'`): change the `tab-deepen`/`prose-deepen`/`'deepen'` references to `tab-ask`/`prose-ask`/`'ask'`:
```js
function setSourceTab(tab) {
  state.sourceTab = tab;
  document.getElementById('tab-source')?.classList.toggle('is-active', tab === 'source');
  document.getElementById('tab-ask')?.classList.toggle('is-active', tab === 'ask');
  document.getElementById('prose-source')?.classList.toggle('is-hidden', tab !== 'source');
  document.getElementById('prose-ask')?.classList.toggle('is-hidden', tab !== 'ask');
}
```

(d) Replace `updateDeepenPanel` with `updateAskPanel` (called from the same places — update the call site near line 175 and inside `render()` if present):
```js
function updateAskPanel() {
  const el = document.getElementById('prose-ask');
  if (!el) return;
  const conceptId = state.selectedConceptId;
  if (conceptId && conceptId !== lastDeepenAnchor) {
    lastDeepenAnchor = conceptId;
    state.ask = { entries: [], busy: false, canUndo: false, canCrystallize: false, thinking: null };
    setSourceTab('ask');
  }
  const concept = conceptId ? state.viewModel?.concepts?.byId?.[conceptId] : null;
  const thinking = state.ask.thinking
    ? { seconds: Math.round((Date.now() - state.ask.thinking.startedAt) / 1000) }
    : null;
  el.innerHTML = renderAskThread({
    conceptId,
    conceptLabel: concept?.label ?? conceptId ?? '',
    busy: state.ask.busy,
    entries: state.ask.entries,
    canUndo: state.ask.canUndo,
    canCrystallize: state.ask.canCrystallize,
    thinking,
  });
  bindAskControls();
  const thread = el.querySelector('.ask-thread');
  if (thread) thread.scrollTop = thread.scrollHeight;
}
```
(Keep the existing `let lastDeepenAnchor;` declaration; only the panel function name and ids change.)

(e) Replace `bindDeepenControls` + `pushDeepen` with `bindAskControls` + `pushAsk`:
```js
function bindAskControls() {
  const send = document.querySelector('[data-action="ask-send"]');
  const input = document.getElementById('ask-prompt');
  const submit = () => {
    const text = input?.value?.trim();
    if (text) runAsk(state.selectedConceptId, text);
  };
  if (send) send.addEventListener('click', submit);
  if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
  const add = document.querySelector('[data-action="ask-add"]');
  if (add) add.addEventListener('click', () => runCrystallize(state.selectedConceptId));
  const undo = document.querySelector('[data-action="ask-undo"]');
  if (undo) undo.addEventListener('click', runUndo);
}

function pushAsk(role, text) {
  state.ask.entries.push({ role, text });
  updateAskPanel();
}
```

(f) Replace `runDeepen` + `renderQuestionInThread` + `bindQuestionSubmits` with `runAsk` + `runCrystallize` (and keep the heartbeat helpers, renamed to use `state.ask`):
```js
function runAsk(conceptId, text) {
  if (!conceptId || state.ask.busy) return;
  state.ask.busy = true;
  pushAsk('you', text);
  startHeartbeat();
  let agentEntry = null; // accumulate streamed answer chunks into one entry
  streamPost('/ask', { concept: conceptId, messages: state.ask.entries.filter((e) => e.role === 'you' || e.role === 'agent') }, (event) => {
    if (event.type === 'answer') {
      stopHeartbeat();
      if (!agentEntry) { agentEntry = { role: 'agent', text: '' }; state.ask.entries.push(agentEntry); }
      agentEntry.text += event.data?.text ?? '';
      updateAskPanel();
    } else if (event.type === 'progress') {
      // keep the heartbeat visible; progress is informational during tool use
    } else if (event.type === 'error') {
      pushAsk('error', event.data?.message ?? 'error');
    }
  }).catch((e) => pushAsk('error', `Ask failed: ${e.message}`)).finally(() => {
    stopHeartbeat();
    state.ask.busy = false;
    state.ask.canCrystallize = state.ask.entries.some((e) => e.role === 'agent');
    updateAskPanel();
  });
}

function runCrystallize(conceptId) {
  if (!conceptId || state.ask.busy) return;
  state.ask.busy = true;
  pushAsk('result', 'Adding to graph…');
  startHeartbeat();
  streamPost('/crystallize', { concept: conceptId, messages: state.ask.entries.filter((e) => e.role === 'you' || e.role === 'agent') }, (event) => {
    if (event.type === 'progress') {
      pushAsk('agent', event.data?.message ?? '');
    } else if (event.type === 'document') {
      applyDeepenedDocument(event.data?.document, conceptId);
      pushAsk('result', 'Added. Graph updated.');
      state.ask.canUndo = true;
    } else if (event.type === 'error') {
      pushAsk('error', event.data?.message ?? 'error');
    }
  }).catch((e) => pushAsk('error', `Add failed: ${e.message}`)).finally(() => {
    stopHeartbeat();
    state.ask.busy = false;
    updateAskPanel();
  });
}
```

(g) Heartbeat helpers — rename `state.deepen.thinking` → `state.ask.thinking` and the panel call to `updateAskPanel`:
```js
let deepenHeartbeat;
function startHeartbeat() {
  stopHeartbeat();
  state.ask.thinking = { startedAt: Date.now() };
  updateAskPanel();
  deepenHeartbeat = setInterval(updateAskPanel, 1000);
}
function stopHeartbeat() {
  if (deepenHeartbeat) { clearInterval(deepenHeartbeat); deepenHeartbeat = null; }
  state.ask.thinking = null;
}
```

(h) `runUndo` — rename `pushDeepen`→`pushAsk`, `state.deepen`→`state.ask`, message wording, and reset `canCrystallize` appropriately:
```js
function runUndo() {
  if (state.ask.busy) return;
  fetch('/undo')
    .then((r) => r.json())
    .then((result) => {
      if (!result.ok) { pushAsk('error', `Undo: ${result.message}`); return; }
      rebuildFromDocument(result.document);
      state.ask.canUndo = false;
      pushAsk('result', 'Reverted the last add.');
    })
    .catch((e) => pushAsk('error', `Undo failed: ${e.message}`));
}
```

(i) Update the panel call site (formerly `updateDeepenPanel()` near line 175 and any other call) to `updateAskPanel()`.

- [ ] **Step 4: Delete the question-card module + CSS**

```bash
git rm ui/panels/question-card.js
```
In `ui/styles.css`, remove the `.qc-*` and `.deepen-question` rules; rename the panel selectors `.deepen-head/.deepen-thread/.deepen-entry/.deepen-input/.deepen-undo/.deepen-empty/.deepen-heartbeat/.deepen-<role>` to the `.ask-*` equivalents used by `ask-thread.js` (and add `.ask-add` styled like `.ask-undo`). Keep the `.source-chip*` rules.

- [ ] **Step 5: Syntax check**

Run: `node --check ui/app.js && node --check ui/panels/ask-thread.js && node --check ui/sse-stream.js && npm run ui:check`
Expected: clean. Grep to confirm nothing dangling: `grep -rn "deepen-thread\|question-card\|renderQuestionCards\|EventSource\|/deepen\b\|deepen/answer\|state.deepen" ui/` returns nothing.

- [ ] **Step 6: Commit**

```bash
git add ui/index.html ui/app.js ui/panels/ask-thread.js ui/styles.css
git rm ui/panels/question-card.js
git commit -m "feat(ui): Ask panel — source-grounded talk + Add to graph; remove question cards"
```

---

## Task 8: End-to-end verification (stub + real)

**Files:** none (verification task).

- [ ] **Step 1: Stub end-to-end (no API)**

```bash
cp graphs/adolescence-of-technology.mindgraph.md /tmp/ask-play.mindgraph.md
MINDGRAPH_STUB_DEEPEN=1 npm run server -- --doc /tmp/ask-play.mindgraph.md
```
Open `http://127.0.0.1:4173`. Select a concept (graph node or a prose mention). Confirm:
- The tab reads **Ask**; the panel says "Ask: <node>".
- Typing a question + Send returns a **fast stub answer** in the thread; the graph does **not** change; no discussion chip appears.
- After at least one answer, **Add to graph** appears; clicking it weaves a discussion source (stub), the graph grows, and a dashed chip appears in the source switcher.
- **Undo** reverts the add.
Drive it with Playwright if you can't use the browser by hand; screenshot the talk state and the post-add state. Stop the server; `rm /tmp/ask-play.mindgraph.md`.

- [ ] **Step 2: Real credentialed end-to-end (if ANTHROPIC creds/CLI session available)**

```bash
cp graphs/adolescence-of-technology.mindgraph.md /tmp/ask-live.mindgraph.md
npm run server -- --doc /tmp/ask-live.mindgraph.md
```
Select `powerful-ai`. Ask 2–3 questions — verify answers are **source-grounded and fast** (seconds, streamed) and the file is **not** modified between asks (`grep -c '^@source disc-' /tmp/ask-live.mindgraph.md` stays 0). Then **Add to graph** and verify a discussion source is appended and:
```bash
node src/cli/index.js authoring qa /tmp/ask-live.mindgraph.md --json
```
shows `"ok": true`. If no creds, note this step pending and rely on the stub verification. Stop the server; `rm /tmp/ask-live.mindgraph.md` and any `*__backup*` it created under `/tmp`.

- [ ] **Step 3: Commit (verification notes only, if any fixtures changed — otherwise skip)**

No commit unless a bug fix was needed; if a fix was required, commit it with a `fix(...)` message describing what the live run surfaced.

---

## Task 9: Docs + full regression

**Files:**
- Modify: `skills/mindgraph/SKILL.md`
- Modify: `docs/superpowers/specs/2026-06-19-node-source-conversation-design.md`

- [ ] **Step 1: Update the skill's deepen section to the Ask model**

In `skills/mindgraph/SKILL.md`, replace the "## Conversational deepen (discussion-as-source)" section body with the Ask/crystallize model:

```markdown
## Node conversation ("Ask") and crystallize

Selecting a node opens an **Ask** conversation grounded in its source:

- **Talk** is the default: the agent answers questions about the node from the source (web opt-in, attributed). Talk never changes the graph.
- **Add to graph** crystallizes the conversation into a new `@source` of `type: discussion`: derived concepts (each binding verbatim to a discussion block), the anchor as `latent`, and cross-source `@relation`s to existing concepts. Agent proposes; Undo reverts the whole woven turn.
- Discussions are readable via the Source-tab source switcher. Titles are unquoted.
```

- [ ] **Step 2: Flip the spec status**

In `docs/superpowers/specs/2026-06-19-node-source-conversation-design.md`, change `**Status:** Design` → `**Status:** Implemented`.

- [ ] **Step 3: Full regression**

Run: `node --test test/*.test.js`
Expected: ALL PASS.

Run: `node --check ui/app.js && node --check ui/panels/ask-thread.js && node --check ui/sse-stream.js && npm run ui:check`
Expected: clean.

Run: `grep -rn "agentRunner\|deepenHandler\|questionChannel\|question-card\|ask_user_questions\|/deepen/answer\|EventSource" src/ ui/ test/`
Expected: no matches (all old machinery removed).

- [ ] **Step 4: Commit**

```bash
git add skills/mindgraph/SKILL.md docs/superpowers/specs/2026-06-19-node-source-conversation-design.md
git commit -m "docs(ask): document the Ask/crystallize model; mark spec implemented"
```

---

## Final verification (before finishing the branch)

1. `node --test test/*.test.js` — all green.
2. Stub end-to-end: talk is fast and graph-neutral; Add to graph weaves a discussion; Undo reverts (Task 8 Step 1).
3. Real end-to-end (if creds): source-grounded fast answers, then a QA-clean crystallized source (Task 8 Step 2).
4. Hand off via **superpowers:finishing-a-development-branch** (do not push without explicit approval).

## Notes for the implementer

- **Test runner:** `node --test test/*.test.js`. New tests are plain `node:test` files in `test/`.
- **All compile/QA go through `registry.run(...)`** from `src/operations/index.js`; never reimplement compilation, never hand-edit compiled JSON.
- **QA invariant** for crystallize output: a derived non-latent focus concept's label/alias must appear verbatim in its step's blocks; a relation's endpoints must both be foregrounded (anchor as `latent`).
- **Deepen/crystallize WRITES the on-disk `.md`.** Always verify against a `/tmp` copy, never the canonical graph (it gets mutated).
- **No bundler/framework** (CLAUDE.md standing rule). The UI stays vanilla ES modules; `streamPost` uses `fetch` + `ReadableStream`.
- **v1 omits a persistent agent session** — each ask/crystallize is a fresh POST carrying the client-held conversation. Un-crystallized chat is ephemeral.

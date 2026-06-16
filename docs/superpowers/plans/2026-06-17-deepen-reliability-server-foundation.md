# Deepen Reliability — Server/Agent Foundation (Plan A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a real Claude deepen reliably *complete* (fix the headless `Edit` permission hang), add one-level undo, and stream meaningful progress — the prerequisite foundation before any deepen UI.

**Architecture:** The deepen handler snapshots the pre-edit `.md` to a `<slug>__backup` slot in the injected `Store` before running the agent, so an `undoHandler` can restore it and recompile via the operations catalog. The real `agentRunner` replaces ineffective `permissionMode: 'bypassPermissions'` with the SDK's `canUseTool` callback that auto-approves the scoped tools, fixing the hang, and emits richer progress.

**Tech Stack:** Node ESM, `node:test`, `@anthropic-ai/claude-agent-sdk` (server adapter only), SSE.

**Spec:** `docs/superpowers/specs/2026-06-16-node-anchored-deepen-ux-design.md` (Agent changes; Undo mechanism). This is Plan A of two; Plan B is the tabbed deepen UI + anchor-pinning.

**Verified SDK facts (from `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`):**
- `query({ prompt, options })` where `options.canUseTool: (toolName, input, opts) => Promise<PermissionResult>`.
- `PermissionResult` allow = `{ behavior: 'allow', updatedInput?: Record<string,unknown> }`; deny = `{ behavior: 'deny', message: string }`.

---

## File Structure
- Modify: `src/server/deepenHandler.js` — snapshot pre-edit md to `<slug>__backup` before running the runner.
- Create: `src/server/undoHandler.js` — restore the backup, recompile, return the prior document.
- Modify: `src/server/index.js` — add `GET /undo?slug=<slug>` calling `undoHandler`.
- Modify: `src/server/agentRunner.js` — `canUseTool` auto-approve (the hang fix) + richer progress.
- Modify: `test/deepen-handler.test.js` — add a snapshot test.
- Create: `test/undo-handler.test.js`.

---

## Task 1: Snapshot the pre-edit markdown for undo

**Files:**
- Modify: `src/server/deepenHandler.js`
- Test: `test/deepen-handler.test.js`

- [ ] **Step 1: Write the failing test (append to `test/deepen-handler.test.js`)**

```js
test('deepen snapshots the pre-edit markdown to <slug>__backup', async () => {
  const md = fs.readFileSync('examples/authoring/recursive-self-improvement.mindgraph.md', 'utf8');
  const store = createMemoryStore({ demo: { md } });
  const runner = async ({ slug, store }) => {
    store.put(slug, { md: store.get(slug).md + '\n\n@concept snap-added\nlabel: Snap Added\n' });
  };
  await deepenHandler({ slug: 'demo', conceptId: 'c', store, runner, emit: () => {} });
  assert.equal(store.get('demo__backup')?.md, md); // backup holds the ORIGINAL md
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/deepen-handler.test.js`
Expected: FAIL — `store.get('demo__backup')` is `null`.

- [ ] **Step 3: Implement the snapshot in `deepenHandler`**

In `src/server/deepenHandler.js`, immediately after the first `emit({ type: 'progress', message: 'deepening' });` and BEFORE `await runner(...)`, insert:

```js
    const before = store.get(slug);
    if (before && typeof before.md === 'string') {
      store.put(`${slug}__backup`, { md: before.md });
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test test/deepen-handler.test.js`
Expected: PASS (all deepen-handler tests, including the new snapshot test).

- [ ] **Step 5: Commit**

```bash
git add src/server/deepenHandler.js test/deepen-handler.test.js
git commit -m "feat(server): snapshot pre-edit markdown before deepen for undo"
```

## Task 2: undoHandler — restore the snapshot and recompile

**Files:**
- Create: `src/server/undoHandler.js`
- Test: `test/undo-handler.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/undo-handler.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createMemoryStore } from '../src/operations/memoryStore.js';
import { deepenHandler } from '../src/server/deepenHandler.js';
import { undoHandler } from '../src/server/undoHandler.js';

const md = fs.readFileSync('examples/authoring/recursive-self-improvement.mindgraph.md', 'utf8');
const addRunner = async ({ slug, store }) => {
  store.put(slug, { md: store.get(slug).md + '\n\n@concept undo-added\nlabel: Undo Added\n' });
};

test('undo restores the pre-deepen markdown and returns the prior document', async () => {
  const store = createMemoryStore({ demo: { md } });
  await deepenHandler({ slug: 'demo', conceptId: 'c', store, runner: addRunner, emit: () => {} });
  // after deepen, the doc has the added concept
  const grown = store.get('demo').json;
  assert.ok(grown.concepts.atomic.some((c) => c.id === 'undo-added'));

  const result = undoHandler({ slug: 'demo', store });
  assert.equal(result.ok, true);
  assert.equal(store.get('demo').md, md); // markdown restored exactly
  assert.ok(!result.document.concepts.atomic.some((c) => c.id === 'undo-added')); // prior doc
});

test('undo with no snapshot reports not-ok without throwing', () => {
  const store = createMemoryStore({ demo: { md } });
  const result = undoHandler({ slug: 'demo', store });
  assert.equal(result.ok, false);
  assert.match(result.message, /no deepen/i);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/undo-handler.test.js`
Expected: FAIL — cannot find module `../src/server/undoHandler.js`.

- [ ] **Step 3: Implement `src/server/undoHandler.js`**

```js
import { registry } from '../operations/index.js';

// Restore the most recent pre-deepen snapshot for a slug and recompile it.
// Returns { ok:true, document } or { ok:false, message }. Never throws.
export function undoHandler({ slug, store }) {
  try {
    const backup = store.get(`${slug}__backup`);
    if (!backup || typeof backup.md !== 'string') {
      return { ok: false, message: 'No deepen to undo' };
    }
    store.put(slug, { md: backup.md });
    const compiled = registry.run('compile', { markdown: backup.md });
    if (!compiled.ok) {
      return { ok: false, message: compiled.errors.map((e) => e.message).join('; ') };
    }
    if (compiled.value.validation.ok === false) {
      return { ok: false, message: `backup invalid: ${compiled.value.validation.errors.join('; ')}` };
    }
    store.put(slug, { json: compiled.value.document });
    return { ok: true, document: compiled.value.document };
  } catch (error) {
    return { ok: false, message: error?.message ?? String(error) };
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test test/undo-handler.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/undoHandler.js test/undo-handler.test.js
git commit -m "feat(server): add undoHandler to restore pre-deepen snapshot"
```

## Task 3: Wire `GET /undo` into the server

**Files:**
- Modify: `src/server/index.js`

- [ ] **Step 1: Add the import**

Near the other server imports in `src/server/index.js`:

```js
import { undoHandler } from './undoHandler.js';
```

- [ ] **Step 2: Add the route handler**

In the `http.createServer((req, res) => { ... })` callback, before the `/deepen` block, add:

```js
  if (req.method === 'GET' && pathname === '/undo') {
    const slug = url.searchParams.get('slug') || activeSlug;
    const result = undoHandler({ slug, store: fsStore });
    res.writeHead(result.ok ? 200 : 409, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(result));
    return;
  }
```

- [ ] **Step 3: Manually verify (stub deepen, then undo)**

```bash
cp graphs/inside-anthropic-ai-juggernaut.mindgraph.md graphs/undo-demo.mindgraph.md
MINDGRAPH_STUB_DEEPEN=1 node src/server/index.js --doc graphs/undo-demo.mindgraph.md &
sleep 2
curl -sN --max-time 20 'http://127.0.0.1:4173/deepen?concept=mythos' | grep -c 'event: document'   # expect 1
grep -c '^@concept ' graphs/undo-demo.mindgraph.md                                                   # grew by 1
curl -s 'http://127.0.0.1:4173/undo' | head -c 60; echo                                              # {"ok":true,...}
grep -c '^@concept ' graphs/undo-demo.mindgraph.md                                                   # back to original
kill %1; rm -f graphs/undo-demo.mindgraph.*
```
Expected: deepen grows the file by one `@concept`; `/undo` returns `{"ok":true,...}` and the file returns to the original concept count.

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: green (the new handler tests included; socket layer not unit-tested).

- [ ] **Step 5: Commit**

```bash
git add src/server/index.js
git commit -m "feat(server): add GET /undo endpoint"
```

## Task 4: Fix the headless permission hang + richer progress in agentRunner

**Files:**
- Modify: `src/server/agentRunner.js`

This is the prerequisite bug fix. It cannot be unit-tested (needs the SDK + Claude credentials); verify with a real run.

- [ ] **Step 1: Replace the `query(...)` options to use `canUseTool`**

In `src/server/agentRunner.js`, change the `query({ prompt: task, options: {...} })` call so `options` is exactly:

```js
    options: {
      systemPrompt,
      model: process.env.MINDGRAPH_MODEL || 'claude-sonnet-4-6',
      allowedTools: ['Read', 'Edit', 'Grep', 'Glob'],
      // Headless auto-approval: bypassPermissions does NOT reliably grant Edit
      // in the server, so explicitly allow the scoped tools via canUseTool.
      // PermissionResult allow shape per the SDK: { behavior:'allow', updatedInput }.
      canUseTool: async (toolName, input) => {
        if (['Read', 'Edit', 'Grep', 'Glob'].includes(toolName)) {
          return { behavior: 'allow', updatedInput: input };
        }
        return { behavior: 'deny', message: `Tool ${toolName} is not permitted for deepen.` };
      },
    },
```

(Remove the previous `permissionMode: 'bypassPermissions'` and `allowDangerouslySkipPermissions: true` lines.)

- [ ] **Step 2: Surface Edit progress in the stream loop**

Ensure the `for await (const message of conversation)` loop emits a clear note when the agent edits. The existing block already emits `Claude: <tool><file>` for `tool_use`; confirm it includes `Edit`. Add, immediately after the loop, a completion note if not present:

```js
  emit({ type: 'progress', message: 'Claude finished editing' });
```

- [ ] **Step 3: Real-deepen verification (needs Claude credentials)**

```bash
cp graphs/inside-anthropic-ai-juggernaut.mindgraph.md graphs/real-demo.mindgraph.md
node src/server/index.js --doc graphs/real-demo.mindgraph.md &
sleep 2
# No --max-time cap that's too short; a real turn can take a few minutes.
curl -sN --max-time 600 'http://127.0.0.1:4173/deepen?concept=mythos' | grep -E '^event:' | tail -5
grep -c '^@concept ' graphs/real-demo.mindgraph.md   # should be ORIGINAL+N (the Edit landed)
kill %1; rm -f graphs/real-demo.mindgraph.*
```
Expected: the stream reaches `event: document` (no hang at Read/Edit), and the file's concept count increased — proving the agent's `Edit` completed without a permission prompt. If it still hangs at Edit, STOP and report: the permission-callback shape needs re-checking against the installed SDK version.

- [ ] **Step 4: Commit**

```bash
git add src/server/agentRunner.js
git commit -m "fix(server): auto-approve scoped tools via canUseTool (fixes deepen Edit hang)"
```

---

## Self-Review

**Spec coverage (against the Deepen UX spec):**
- Permission-hang fix (Agent changes) — Task 4 (`canUseTool`). ✓
- Richer progress streaming (Agent changes / liveness) — Task 4 Step 2. ✓
- Pre-deepen snapshot + undo (Undo mechanism) — Tasks 1–3. ✓
- Deferred to Plan B (correctly out of scope): tabbed source panel, deepen thread UI, anchor-pinning, auto-apply animation, node-select trigger. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; the two agent tasks that can't be unit-tested have explicit manual verification commands with expected output. ✓

**Type/name consistency:** `<slug>__backup` slot key identical in Task 1 (write) and Task 2 (read). `undoHandler({ slug, store })` signature identical in Task 2 (def), Task 3 (call), and tests. `deepenHandler` signature unchanged. `PermissionResult` allow/deny shapes match the verified SDK types. ✓

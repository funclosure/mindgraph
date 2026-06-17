# Node-Anchored Deepen UI — Tabbed Panel + Thread (Plan B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`). The UI has no unit-test runner (per CLAUDE.md) — UI tasks are **implement → verify in a real browser** (use playwright + screenshot/console). Pure logic gets a `node --test`.

**Goal:** Turn deepen into a node-anchored conversation: select a concept → a **Deepen** tab in the source panel anchors to it → type-or-default deepen streams live into a thread → changes auto-apply with the anchor pinned in place → one-click Undo.

**Architecture:** The existing `#prose` source panel becomes tabbed (**Source** | **Deepen**). Selecting a concept anchors the Deepen tab to it. The deepen thread reuses the Plan-A SSE endpoints (`/deepen`, `/undo`). On the `document` event the graph rebuilds with the anchor node **pinned at its pre-rebuild position** (via the existing `sim.pin`), so growth is local, not a full reshuffle.

**Tech Stack:** Vanilla ES modules, single canvas, the existing `ui/layout.js` simulator (`pin`/`unpin`/`reheat`/`positions`). No framework, no bundler.

**Spec:** `docs/superpowers/specs/2026-06-16-node-anchored-deepen-ux-design.md`. Plan A (server foundation: hang fix + undo) is already merged.

**Verified integration points:**
- `ui/index.html`: `<aside class="prose" id="prose"></aside>` is the source panel; `ui/app.js:updateProsePanel()` sets `el.innerHTML = renderProse(state.proseChunks, state)`.
- Selection: `state.selectedConceptId` set in `ui/events.js` (select-concept action + canvas hit-test).
- Sim API (`ui/layout.js`): `sim.positions[id] -> {x,y}`, `sim.pin(id, {x,y})`, `sim.unpin(id)`, `sim.reheat(strength)`.
- Existing (from Plan-4 Unit 5, to be refactored): `deepenConcept`, `deepenStatus`, `rebuildFromDocument` in `ui/app.js`.
- `ui/scroll-binding.js` `attachScrollBinding({ container: document.getElementById('prose'), ... })` drives graph focus from the Source scroll; it must bind to the **Source view's** scroll container after tabs are added.

---

## File Structure
- Modify: `ui/index.html` — replace `#prose` inner with a tab bar + two view containers.
- Modify: `ui/styles.css` — tab bar + thread styles.
- Create: `ui/panels/deepen-thread.js` — pure-ish renderer for the Deepen tab (header, input, thread entries, result/undo).
- Modify: `ui/app.js` — `state.sourceTab`; tab switching; selection → anchor; refactor deepen into the thread; anchor-pinning in `rebuildFromDocument`; undo.
- Create: `test/anchor-snapshot.test.js` — unit test for the pure "capture anchor position" helper.

---

## Task 1: Tab shell in the source panel

**Files:** Modify `ui/index.html`, `ui/styles.css`, `ui/app.js`.

- [ ] **Step 1: Restructure `#prose` in `ui/index.html`**

Replace `<aside class="prose" id="prose"></aside>` with:

```html
      <aside class="prose" id="prose">
        <div class="prose-tabs" role="tablist">
          <button class="prose-tab is-active" id="tab-source" role="tab" data-tab="source">Source</button>
          <button class="prose-tab" id="tab-deepen" role="tab" data-tab="deepen">Deepen</button>
        </div>
        <div class="prose-view" id="prose-source"></div>
        <div class="prose-view is-hidden" id="prose-deepen"></div>
      </aside>
```

- [ ] **Step 2: Add styles to `ui/styles.css`**

```css
.prose-tabs { display: flex; gap: 4px; padding: 8px 12px 0; border-bottom: 1px solid #2c281e; }
.prose-tab { background: none; border: none; color: #8a8270; font: 12px/1.6 system-ui, sans-serif; padding: 6px 10px; cursor: pointer; border-radius: 6px 6px 0 0; }
.prose-tab.is-active { color: #e8e3d4; background: #1c1913; }
.prose-tab:disabled { opacity: 0.4; cursor: default; }
.prose-view { height: 100%; overflow: auto; }
.prose-view.is-hidden { display: none; }
```

- [ ] **Step 3: Render into the Source view + wire tab switching in `ui/app.js`**

In `updateProsePanel()`, change the target from `#prose` to `#prose-source`:

```js
function updateProsePanel() {
  const el = document.getElementById('prose-source');
  if (!el) return;
  el.innerHTML = renderProse(state.proseChunks ?? [], state);
}
```

Add `sourceTab: 'source'` to the `state` object. Add a tab-switch function and call it once in `bootstrap()` after `render()`:

```js
function bindProseTabs() {
  document.querySelectorAll('.prose-tab').forEach((btn) => {
    btn.addEventListener('click', () => setSourceTab(btn.dataset.tab));
  });
}

function setSourceTab(tab) {
  state.sourceTab = tab;
  document.getElementById('tab-source').classList.toggle('is-active', tab === 'source');
  document.getElementById('tab-deepen').classList.toggle('is-active', tab === 'deepen');
  document.getElementById('prose-source').classList.toggle('is-hidden', tab !== 'source');
  document.getElementById('prose-deepen').classList.toggle('is-hidden', tab !== 'deepen');
}
```

Call `bindProseTabs()` once in `bootstrap()` (after the first `render()`).

- [ ] **Step 4: Fix scroll-binding to target the Source view**

In `bootstrap()`, change the `attachScrollBinding` container to the Source view:

```js
  attachScrollBinding({
    container: document.getElementById('prose-source'),
    getState: () => state,
    onChange: render,
  });
```

- [ ] **Step 5: Verify in browser**

```bash
npm run ui:check
npm run ui:dev -- --doc graphs/inside-anthropic-ai-juggernaut.mindgraph.md
```
Open http://127.0.0.1:4173. Expected: two tabs; **Source** shows the reading view and scroll still drives graph focus; **Deepen** is empty for now; clicking tabs switches views. Screenshot to confirm.

- [ ] **Step 6: Commit**

```bash
git add ui/index.html ui/styles.css ui/app.js
git commit -m "feat(ui): add Source/Deepen tabs to the source panel"
```

## Task 2: deepen-thread renderer + anchor to the selected node

**Files:** Create `ui/panels/deepen-thread.js`; modify `ui/app.js`, `ui/styles.css`.

- [ ] **Step 1: Create `ui/panels/deepen-thread.js`**

```js
import { escapeHtml } from '../util.js';

// Render the Deepen tab. `vm` model:
//   { conceptId, conceptLabel, busy, entries:[{role,text}], canUndo }
export function renderDeepenThread(vm) {
  if (!vm.conceptId) {
    return `<div class="deepen-empty">Select a concept in the graph to deepen it.</div>`;
  }
  const entries = vm.entries.map((e) =>
    `<div class="deepen-entry deepen-${e.role}">${escapeHtml(e.text)}</div>`).join('');
  const undo = vm.canUndo ? `<button class="deepen-undo" data-action="deepen-undo">Undo</button>` : '';
  return (
    `<div class="deepen-head">Deepening: <strong>${escapeHtml(vm.conceptLabel)}</strong></div>` +
    `<div class="deepen-thread">${entries}</div>` +
    `<div class="deepen-input">` +
      `<input id="deepen-prompt" type="text" placeholder="What about ${escapeHtml(vm.conceptLabel)} to go deeper on? (optional)" ${vm.busy ? 'disabled' : ''} />` +
      `<button data-action="deepen-run" ${vm.busy ? 'disabled' : ''}>${vm.busy ? 'Deepening…' : 'Deepen'}</button>` +
      undo +
    `</div>`
  );
}
```

- [ ] **Step 2: Add thread styles to `ui/styles.css`**

```css
.prose-view#prose-deepen { display: flex; flex-direction: column; padding: 12px; }
.deepen-empty { color: #8a8270; font: 13px/1.5 system-ui, sans-serif; padding: 16px; }
.deepen-head { color: #e8e3d4; font: 13px/1.5 system-ui, sans-serif; margin-bottom: 8px; }
.deepen-thread { flex: 1; overflow: auto; display: flex; flex-direction: column; gap: 6px; }
.deepen-entry { font: 12px/1.4 system-ui, sans-serif; padding: 6px 8px; border-radius: 6px; }
.deepen-agent { color: #cfc8b4; background: #1c1913; }
.deepen-you { color: #e8e3d4; background: #243; align-self: flex-end; }
.deepen-result { color: #b9d8b0; }
.deepen-error { color: #e3a6a6; }
.deepen-input { display: flex; gap: 6px; margin-top: 8px; }
.deepen-input input { flex: 1; background: #14110b; border: 1px solid #3a3426; color: #e8e3d4; border-radius: 6px; padding: 6px 8px; font: 12px system-ui, sans-serif; }
.deepen-input button { background: #3a3426; color: #e8e3d4; border: none; border-radius: 6px; padding: 6px 10px; cursor: pointer; font: 12px system-ui, sans-serif; }
.deepen-input button:disabled { opacity: 0.5; cursor: default; }
```

- [ ] **Step 3: Wire the Deepen tab state + render in `ui/app.js`**

Add to `state`: `deepen: { entries: [], busy: false, canUndo: false }`. Add an importer at the top: `import { renderDeepenThread } from './panels/deepen-thread.js';`. Add an `updateDeepenPanel()` and call it inside `render()` after `updateProsePanel()`:

```js
function updateDeepenPanel() {
  const el = document.getElementById('prose-deepen');
  if (!el) return;
  const conceptId = state.selectedConceptId;
  const concept = conceptId ? state.viewModel?.concepts?.byId?.[conceptId] : null;
  el.innerHTML = renderDeepenThread({
    conceptId,
    conceptLabel: concept?.label ?? conceptId ?? '',
    busy: state.deepen.busy,
    entries: state.deepen.entries,
    canUndo: state.deepen.canUndo,
  });
  bindDeepenControls();
}
```

- [ ] **Step 4: Activate the Deepen tab on selection**

In the select-concept handler path, after `state.selectedConceptId` is set, reset the thread and switch to the Deepen tab. Simplest: in `render()`, detect a selection change and switch. Add a module-level `let lastDeepenAnchor;` and in `updateDeepenPanel()`:

```js
  if (conceptId && conceptId !== lastDeepenAnchor) {
    lastDeepenAnchor = conceptId;
    state.deepen = { entries: [], busy: false, canUndo: false };
    setSourceTab('deepen');
  }
```
(Place this block at the top of `updateDeepenPanel()` before building `el.innerHTML`, and re-read `state.deepen` after.)

- [ ] **Step 5: Verify in browser**

Reload the dev server. Click a concept node. Expected: the panel auto-switches to **Deepen**, header reads "Deepening: *<label>*", with an input + Deepen button. Selecting a different node resets the thread. Screenshot.

- [ ] **Step 6: Commit**

```bash
git add ui/panels/deepen-thread.js ui/styles.css ui/app.js
git commit -m "feat(ui): node-anchored Deepen thread panel"
```

## Task 3: Run a deepen from the thread (streamed entries)

**Files:** Modify `ui/app.js`.

- [ ] **Step 1: Replace the floating-badge deepen with thread-driven deepen**

Remove `deepenStatus` and its floating-`div` usage. Rewrite `deepenConcept` to push entries into `state.deepen.entries` and re-render the panel. Add a `bindDeepenControls()` that wires the Deepen button, the Undo button, and Enter in the input:

```js
function pushDeepen(role, text) {
  state.deepen.entries.push({ role, text });
  updateDeepenPanel();
}

function bindDeepenControls() {
  const run = document.querySelector('[data-action="deepen-run"]');
  if (run) run.addEventListener('click', () => {
    const prompt = document.getElementById('deepen-prompt')?.value?.trim() || '';
    runDeepen(state.selectedConceptId, prompt);
  });
  const undo = document.querySelector('[data-action="deepen-undo"]');
  if (undo) undo.addEventListener('click', runUndo);
  const input = document.getElementById('deepen-prompt');
  if (input) input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); runDeepen(state.selectedConceptId, input.value.trim()); }
  });
}

function runDeepen(conceptId, prompt) {
  if (!conceptId || state.deepen.busy) return;
  state.deepen.busy = true;
  if (prompt) pushDeepen('you', prompt);
  pushDeepen('agent', `Deepening “${conceptId}”…`);
  const qs = new URLSearchParams({ concept: conceptId });
  if (prompt) qs.set('prompt', prompt);
  const source = new EventSource(`/deepen?${qs.toString()}`);
  const done = () => { source.close(); state.deepen.busy = false; updateDeepenPanel(); };
  source.addEventListener('progress', (e) => {
    try { pushDeepen('agent', JSON.parse(e.data).message); } catch { /* ignore */ }
  });
  source.addEventListener('document', (e) => {
    try {
      const next = JSON.parse(e.data).document;
      applyDeepenedDocument(next, conceptId);
      pushDeepen('result', 'Applied. Graph updated.');
      state.deepen.canUndo = true;
    } catch (err) { pushDeepen('error', `Failed: ${err.message}`); }
    done();
  });
  source.addEventListener('error', (e) => {
    let message = 'connection lost';
    try { message = JSON.parse(e.data).message; } catch { /* native */ }
    pushDeepen('error', `Error: ${message}`);
    done();
  });
}
```

(Note: the server ignores an unknown `prompt` query param today; threading the prompt into the agent task is a follow-up. Passing it now is harmless and keeps the UI ready.)

- [ ] **Step 2: Verify in browser with the stub runner**

```bash
cp graphs/inside-anthropic-ai-juggernaut.mindgraph.md graphs/ux-demo.mindgraph.md
MINDGRAPH_STUB_DEEPEN=1 npm run server -- --doc graphs/ux-demo.mindgraph.md
```
Open the UI, select a node, click **Deepen**. Expected: progress entries stream into the thread ("deepening", "stub deepened…", "compiling"), then "Applied. Graph updated." and the graph grows. Screenshot + console (0 errors). Then `rm -f graphs/ux-demo.mindgraph.*`.

- [ ] **Step 3: Commit**

```bash
git add ui/app.js
git commit -m "feat(ui): run deepen from the thread with streamed progress"
```

## Task 4: Anchored growth — pin the anchor on apply

**Files:** Create `ui/anchor-snapshot.js`; create `test/anchor-snapshot.test.js`; modify `ui/app.js`.

- [ ] **Step 1: Write the failing unit test**

```js
// test/anchor-snapshot.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { captureAnchor } from '../ui/anchor-snapshot.js';

test('captureAnchor returns the anchor position copy when present', () => {
  const positions = { a: { x: 10, y: 20 }, b: { x: 1, y: 2 } };
  assert.deepEqual(captureAnchor(positions, 'a'), { x: 10, y: 20 });
});

test('captureAnchor returns null for a missing or absent anchor', () => {
  assert.equal(captureAnchor({ a: { x: 1, y: 1 } }, 'missing'), null);
  assert.equal(captureAnchor({}, undefined), null);
});
```

- [ ] **Step 2: Run → fail**

Run: `node --test test/anchor-snapshot.test.js` → FAIL (module missing).

- [ ] **Step 3: Implement `ui/anchor-snapshot.js`**

```js
// Capture a copy of an anchor concept's current layout position, or null.
export function captureAnchor(positions, anchorId) {
  if (!anchorId || !positions || !positions[anchorId]) return null;
  return { x: positions[anchorId].x, y: positions[anchorId].y };
}
```

- [ ] **Step 4: Run → pass**

Run: `node --test test/anchor-snapshot.test.js` → PASS (2 tests).

- [ ] **Step 5: Use it in `applyDeepenedDocument` (ui/app.js)**

Add `import { captureAnchor } from './anchor-snapshot.js';`. Implement `applyDeepenedDocument` (the function called in Task 3) to pin the anchor across the rebuild:

```js
function applyDeepenedDocument(nextDocument, anchorId) {
  const anchorPos = captureAnchor(state.sim?.positions, anchorId);
  rebuildFromDocument(nextDocument);          // builds a fresh sim from the new VM
  if (anchorPos && state.sim.positions[anchorId]) {
    state.sim.positions[anchorId].x = anchorPos.x;
    state.sim.positions[anchorId].y = anchorPos.y;
    state.sim.pin(anchorId, anchorPos);       // hold the anchor where it was
    state.sim.reheat(1);                       // let only the neighborhood resettle
    kickAnimationLoop();
  }
}
```

(`rebuildFromDocument` already rebuilds VM + sim + redraw from Plan-4 Unit 5; keep it. The new sim seeds previously-unseen nodes near their pinned neighbors via the existing `ui/layout.js` logic, so new concepts grow around the pinned anchor.)

- [ ] **Step 6: Verify in browser (stub)**

Same stub setup as Task 3. Select a node near a screen edge, deepen. Expected: the anchor node **stays roughly where it was** (does not fly to center), and new nodes appear near it; the rest of the graph only lightly resettles. Screenshot before/after.

- [ ] **Step 7: Commit**

```bash
git add ui/anchor-snapshot.js test/anchor-snapshot.test.js ui/app.js
git commit -m "feat(ui): pin the anchor concept across deepen so growth is local"
```

## Task 5: Undo from the thread

**Files:** Modify `ui/app.js`.

- [ ] **Step 1: Implement `runUndo`**

```js
function runUndo() {
  if (state.deepen.busy) return;
  fetch('/undo')
    .then((r) => r.json())
    .then((result) => {
      if (!result.ok) { pushDeepen('error', `Undo: ${result.message}`); return; }
      rebuildFromDocument(result.document);
      state.deepen.canUndo = false;
      pushDeepen('result', 'Reverted the last deepen.');
    })
    .catch((err) => pushDeepen('error', `Undo failed: ${err.message}`));
}
```

(`bindDeepenControls` from Task 3 already wires the Undo button to `runUndo`.)

- [ ] **Step 2: Verify in browser (stub)**

Select a node, Deepen (graph grows, **Undo** appears), click **Undo**. Expected: the graph returns to its prior state, thread shows "Reverted the last deepen." Screenshot.

- [ ] **Step 3: Commit**

```bash
git add ui/app.js
git commit -m "feat(ui): undo the last deepen from the thread"
```

## Task 6: Retire the floating badge + hidden `d`, real-deepen pass

**Files:** Modify `ui/app.js`.

- [ ] **Step 1: Remove the now-dead Plan-4 Unit-5 code**

Delete the leftover `deepenStatus` helper and the `window.addEventListener('keydown', … 'd' …)` block and `window.__mindgraphDeepen` (the thread is now the trigger). Keep `rebuildFromDocument`. Verify `npm run ui:check`.

- [ ] **Step 2: Full real-deepen verification (needs Claude credentials)**

```bash
cp graphs/inside-anthropic-ai-juggernaut.mindgraph.md graphs/ux-real.mindgraph.md
npm run server -- --doc graphs/ux-real.mindgraph.md
```
Open the UI, select **Mythos**, click **Deepen**, wait for the real agent. Expected: thread streams `Claude: Read…` → `Claude: Edit…` → "Applied", the graph grows around the pinned Mythos node with source-grounded concepts, and **Undo** reverts it. Then `rm -f graphs/ux-real.mindgraph.*`.

- [ ] **Step 3: Run the full suite + commit**

```bash
npm test   # expect green (anchor-snapshot test added)
git add ui/app.js
git commit -m "feat(ui): make node selection the deepen trigger; remove floating badge"
```

---

## Self-Review

**Spec coverage (against the deepen-UX spec):**
- Tabbed source panel (Source | Deepen) — Task 1. ✓
- Node-anchored conversation, header = node label, empty state — Task 2. ✓
- Live streamed progress in a thread (liveness) — Task 3. ✓
- Graph stays / anchored local growth (anchor pinning + reheat) — Task 4. ✓
- Auto-apply — Task 3 (`applyDeepenedDocument`). ✓
- One-click Undo (restore snapshot) — Task 5 (uses Plan-A `/undo`). ✓
- Selection is the trigger (replaces hidden `d`) — Tasks 2 & 6. ✓
- Non-goals respected (no floating canvas popover, no preview/accept, single-level undo). ✓

**Placeholder scan:** No TBD/TODO; each code step shows complete code; UI tasks have explicit browser-verify steps; the one pure helper (`captureAnchor`) is TDD'd. ✓

**Type/name consistency:** `state.deepen` shape (`{entries, busy, canUndo}`) consistent across Tasks 2–5. `applyDeepenedDocument(nextDocument, anchorId)` defined in Task 4, called in Task 3 — note Task 3 introduces the call and Task 4 implements the function; an executor doing Task 3 before Task 4 should add a temporary `applyDeepenedDocument = rebuildFromDocument` alias, replaced in Task 4. `runDeepen`/`runUndo`/`pushDeepen`/`updateDeepenPanel`/`bindDeepenControls`/`setSourceTab` names consistent. `captureAnchor(positions, anchorId)` identical in test, impl, and use. ✓

(Fix applied: Task 3 Step 1 should define a stub `function applyDeepenedDocument(doc) { rebuildFromDocument(doc); }` so it runs standalone; Task 4 Step 5 replaces it with the anchor-pinning version.)

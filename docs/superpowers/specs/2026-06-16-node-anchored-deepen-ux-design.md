# Node-Anchored Deepen UX

**Date:** 2026-06-16
**Status:** Design
**Author:** drafted with Claude (Opus 4.8)

## Problem

The deepen loop works end-to-end (Plan 4: agent server → SSE → graph regrows) but the *experience* is raw, and one part is outright broken:

- **"Stuck at Read, then nothing."** In the headless server the agent reads the file, then its `Edit` blocks on a permission prompt nothing can answer, so the turn hangs. `permissionMode: 'bypassPermissions'` is not auto-approving the edit. This is a real bug, not slowness.
- **No liveness.** Even when it works, the UI surfaces one cryptic line (`Claude: Read…`) then silence for minutes. No sense of progress, no idea what changed.
- **Hidden trigger.** Deepen is bound to pressing `d` on a selection — undiscoverable.
- **Abrupt result.** On completion the whole graph rebuilds and reshuffles, so you lose your place and can't tell what grew.
- **No undo.** A bad deepen edits your authored `.md` with no way back.

## Goal

Make deepening a **node-anchored conversation**: select a node, talk to it in a tab of the existing source panel, watch it work live, and have changes auto-apply with a one-click undo — while the graph stays put and new nodes grow attached to the node you're focused on.

## Design

### Interaction model
- The **node is the unit of attention.** Selecting a node anchors the deepen conversation to it. The graph **does not** zoom or reshuffle; the selected node is **pinned + highlighted** so it's visibly "the one we're talking about."
- New concepts/relations from a deepen **attach to the anchor** and animate in locally; the anchor's position is held so you never lose your place.
- Re-selecting a different node re-anchors the conversation to it.

### The panel: a new tab in the source panel
The right-hand source panel becomes **tabbed**:
- **Source** — today's reading view (prose + scroll-binding that drives graph focus). Unchanged.
- **Deepen** — the node-anchored conversation. Header shows the anchored node's label ("Deepening: *Mythos*"). Empty/disabled state when no node is selected ("Select a concept to deepen it").

Selecting a node makes the **Deepen** tab active for that node (the Source tab remains one click away, preserving the reading position). This replaces the hidden `d` shortcut as the primary trigger; `d` may remain as an accelerator.

(The Figma-style *floating canvas popover anchored beside the node* is explicitly a later polish — the moving, settling canvas nodes make a pinned popover jittery; a tab is stable and reuses existing layout. Out of scope here.)

### Inside the Deepen tab (a thread)
1. **Input.** A text box ("What about *Mythos* should we go deeper on?") with a primary **Deepen** button that works with no text (default: "expand this concept's region per the skill rules").
2. **Live activity.** SSE `progress` events render as thread entries in real time — "reading source (b022–b024)… drafting… added *Project Glasswing*… linked to *cat-and-mouse*…". This is the liveness fix; the agent must emit meaningful, frequent progress (see Agent changes).
3. **Result + auto-apply.** On the `document` event the graph rebuilds with the new nodes attached to the anchor; the thread shows a summary ("+3 concepts, +2 relations") and an **Undo** affordance.
4. **Undo.** Reverts to the pre-deepen `.md` (server restores the snapshot, recompiles, returns the prior document; client rebuilds). One level of undo in v1.
5. **Errors.** Agent/compile/QA failure shows in the thread; the graph is left unchanged (no partial apply — the handler only applies a successfully compiled document, which it already does).

### Anchor stability (graph behavior)
- Before applying a deepened document, record the anchor node's current layout position; after rebuild, **pin the anchor** at that position (reuse the simulator's existing `pin`/`unpin`) and seed new neighbor nodes near it, then `reheat` so only the local region resettles rather than the whole graph flying apart.
- This directly addresses the "abrupt rebuild" problem and keeps the anchor as a stable visual home.

### Agent changes (the hang fix + real liveness)
- **Permission hang:** pass the SDK a permission resolver that auto-approves the scoped edit (e.g. `canUseTool`/permission callback returning allow for `Edit`/`Read` on the target `.md`), instead of relying on `permissionMode: 'bypassPermissions'` alone. The agent must be able to edit without a human prompt in the headless server. This is the prerequisite; nothing else matters until `Edit` completes.
- **Liveness:** stream meaningful progress — surface tool-use (`Read`, `Edit`) with the target, and the agent's short interstitial text, as `progress` events. Consider `includePartialMessages` for token-level streaming of the agent's reasoning (loupe's pattern) so the thread feels alive.

### Undo mechanism
- The server snapshots `graphs/<slug>.mindgraph.md` (e.g. to an in-memory or `.deepen-backup` copy) **before** running the agent.
- A `GET /undo?slug=<slug>` (or an SSE control) restores the snapshot, recompiles via the catalog, and returns the prior `document`; the client rebuilds. Single-level for v1.

## Components / where the work lands
- `ui/` — tabbed source panel (Source | Deepen); a `deepen-thread` view module rendering input + streamed entries + result/undo; `app.js` wiring: node-selection → activate Deepen tab + anchor; apply document with anchor-pinning; undo.
- `src/server/agentRunner.js` — permission auto-approve; richer progress streaming.
- `src/server/index.js` / `deepenHandler.js` — pre-deepen snapshot; `/undo` endpoint.
- View-model/layout — reuse existing `pin`/`unpin`/`reheat`; no new simulator.

## Error handling
- Agent error / compile failure / QA failure → thread error entry, graph unchanged.
- Undo with no snapshot → no-op with a notice.
- A long turn is expected; the thread's live progress *is* the "still working" signal. A **Cancel** (close the SSE) is a nice-to-have; include only if cheap.

## Testing
- **Unit (no API key):** the `/undo` snapshot/restore path through `deepenHandler`/server with a memory store + mock runner; the anchor-pin application logic if extractable as a pure function.
- **Manual / playwright with `MINDGRAPH_STUB_DEEPEN`:** select node → Deepen tab activates → thread streams stub progress → graph grows attached to anchor → Undo restores. Then a real-Claude pass once the permission fix lands.

## Non-goals (v1)
- Floating canvas popover anchored beside the node (later polish).
- Multi-node / persisted conversation history across selections.
- Preview-then-accept (we chose auto-apply + Undo).
- Multi-level undo / full edit history.

## Risks
- **SDK permission API specifics.** The exact `canUseTool`/permission-callback shape must be confirmed against `@anthropic-ai/claude-agent-sdk` 0.3.x; the hang fix depends on it. Verify with a real run before building UI on top.
- **Anchor pinning vs layout quality.** Pinning the anchor may distort the global layout; tune `reheat` scope so the rest stays readable.
- **Tab state vs scroll-binding.** The Source tab's scroll-binding drives graph focus; ensure switching to Deepen and back preserves reading position and doesn't fight the deepen's anchor focus.

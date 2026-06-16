# Portable Core: the Operations Catalog

**Date:** 2026-06-16
**Status:** Design — Phase 1
**Author:** drafted with Claude (Opus 4.8)

## Problem

mindgraph's capabilities (validate, compile, qa, digest, inspect, view) are
implemented inside surface code and duplicated across surfaces. Today there are
three operator surfaces and they have already drifted:

- **CLI** (`src/cli/index.js`) — a 933-line flat `if`-ladder that fuses argument
  parsing, filesystem I/O, `console.log`, and `process.exit` with the actual
  logic. It has the current source-first verbs (`authoring validate/qa/compile`).
- **MCP server** (`src/mcp/server.js`) — the *agent's* surface. Its tools are the
  **legacy** path only (`prepare_source`, `build_starter_digest`,
  `apply_digest_plan`, `inspect_document`, `open_viewer`). It has **no
  source-first tool** — an agent driving mindgraph over MCP literally cannot run
  the source-first authoring loop. It also `spawn`s subprocesses, partly
  re-implementing rather than calling core.
- **UI** (`ui/` + `src/view-model/`) — consumes only; it reveals, it does not author.

This drift produces concrete bugs the recent review found:

- `mindgraph validate` and `inspect` reject compiled source-first JSON
  (`kind must be 'mindgraph.document'`) — they call the *legacy* validator with no
  routing by `kind`, even though source-first is now the primary output.
- The MCP agent surface is a generation behind the CLI.

The root cause is the same in every case: **the verbs are defined more than once.**

## Goal

Make mindgraph's operations a single portable substrate so that:

1. **The CLI becomes robust** — a thin adapter over pure operations, not a place
   where logic lives.
2. **The same core runs in the browser** — the pure operations are
   dependency-free ESM with no `fs`/`process`/`console`, so the browser imports
   them directly.
3. **An AI agent is a first-class operator** — whether it speaks through MCP, the
   in-browser Agent SDK, or the CLI, it gets the *same* verbs with the *same*
   schemas and the *same* result shape as any other caller. No surface is
   privileged; capability drift becomes structurally impossible.

This unlocks the longer-term vision (out of scope for Phase 1, see Non-Goals): a
**living document** where the user points at a graph node and an in-browser agent
deepens that region, the shared core recompiles, and the graph co-evolves.

## Non-Goals (Phase 1)

- No Vite/React/TypeScript rewrite of the UI. The hand-built vanilla Canvas
  renderer is preserved; mindgraph's "no bundler / no framework" rules stand.
- No removal of the legacy micro/meso/macro path. It keeps working; it is simply
  re-expressed as catalog operations alongside the source-first ones.
- No multi-user, no cloud, no auth. mindgraph stays a local-first personal tool.
- The full living-document interaction model (multi-region deepening, undo/redo of
  agent edits, conflict handling) is deferred. Phase 1 ships exactly **one**
  end-to-end `deepen(conceptId)` loop as a proof of the architecture.

## Architecture

Ports & adapters (hexagonal). One pure core, surfaces are thin equal adapters.

```
                 ┌─────────────────────────────────────────────┐
                 │  CORE  (pure ESM, zero deps, browser-safe)   │
                 │                                              │
                 │  authoring/  parse · compile · schema · qa   │
                 │  view-model/ buildViewModel · renderState    │
                 │                                              │
                 │  operations/  THE CATALOG                    │
                 │    each verb = { name, inputSchema,          │
                 │                  handler(input, ctx)->Result}│
                 │    • pure: no fs / console / process / throw  │
                 │    • ctx = { store, clock, ids }  (ports)     │
                 └──────────▲──────────────▲──────────────▲─────┘
        generated adapters  │              │              │  direct import
     ┌──────────────────────┴──┐ ┌─────────┴────────┐ ┌───┴─────────────────┐
     │ CLI adapter (Node/Bun)  │ │ MCP server       │ │ Browser client      │
     │  argv → op → print/exit │ │  tools generated │ │  (vanilla canvas)   │
     │  dispatch MAP           │ │  from catalog    │ │  local ops directly │
     │  Store = fs             │ │  Store = fs      │ │  Store = OPFS/IDB    │
     └─────────────────────────┘ └──────────────────┘ └──────▲──────────────┘
                                 ┌──────────────────────────┐ │ SSE / fetch
                                 │ Agent server (Bun, loupe)│ │
                                 │  Claude Agent SDK query()│◄┘
                                 │  catalog ops exposed as  │
                                 │  in-process agent tools  │
                                 │  holds ANTHROPIC_API_KEY │
                                 │  streams events over SSE │
                                 └──────────────────────────┘
```

### Component 1 — `core/operations` (the catalog)

A registry of operation descriptors. One descriptor per verb:

```
Operation = {
  name: string,                 // e.g. "compile", "validate", "qa", "deepen_region"
  summary: string,              // one line, reused as CLI help + MCP description
  inputSchema: JSONSchema,      // single source of validation for every surface
  handler: (input, ctx) => Result   // pure; returns data, never throws/prints/exits
}
```

- `Result = { ok: boolean, value?: any, errors?: Array<{code, message, path?}> }`.
  Operations **return** errors as data; they never throw raw, never `process.exit`,
  never `console.log`. Adapters decide how to present a `Result`.
- `ctx` carries the **ports** the operation needs — see Component 2. A pure
  transform op (e.g. `compile(md) -> {document, validation}`) ignores `ctx`; a
  read/write op (e.g. `open(id)`, `save(id, md)`) uses `ctx.store`.
- The catalog is the *only* place a capability is defined. Adding a verb = adding
  one descriptor; every surface picks it up automatically.

Initial verb set (Phase 1): `validate`, `compile`, `qa`, `inspect`, `view_model`,
`render_state`, `open`/`save`/`list` (storage), and — routed by document `kind` —
a single `inspect`/`validate` that handles both source-first and legacy documents
(this alone fixes the validate/inspect-rejects-source-first bug). Plus the new
`deepen_region` (Component 4).

### Component 2 — Ports

The only things core needs injected so it can stay I/O-free:

- **`Store`** — `get(id) -> {md?, json?}`, `put(id, {md?, json?})`, `list()`. The
  unit of storage is a graph identified by slug; a graph has a source-first `.md`
  and/or a compiled `.json`.
  - **Node/Bun adapter:** filesystem under `./graphs/` (today's behavior).
  - **Browser adapter:** OPFS (Origin Private File System) with IndexedDB
    fallback. Same interface; the browser never knows it isn't a filesystem.
- **`Clock` / `ids`** — injected time + id generation so operations are
  deterministic and testable (no `Date.now()`/random inside core).

### Component 3 — Surface adapters

Each is thin and **derived from the catalog**, not hand-maintained per verb.

- **CLI** (`src/cli/`): replace the `if`-ladder with a **dispatch map** built from
  the catalog. Each command: parse argv against the op's `inputSchema` → call
  `handler(input, {store: fsStore})` → format the `Result` (human text or
  `--json`) → set exit code. A single top-level `try/catch` turns any unexpected
  throw into a structured error (fixes the raw-stack-trace gap). The existing
  command names are preserved as aliases so nothing the skill/docs reference
  breaks.
- **MCP** (`src/mcp/`): generate `tools/list` from the catalog (name, summary →
  description, `inputSchema` passed through) and route `tools/call` straight to
  `handler`. This **automatically brings MCP to full source-first parity** —
  `compile`, `qa`, `deepen_region`, etc. appear as MCP tools with zero extra work,
  closing the drift. Remove the `child_process.spawn` re-implementation.
- **Browser client**: imports `core/operations` directly for instant local
  `validate`/`compile`/`view_model`/`render_state` (no server round-trip for
  anything that doesn't need Claude), with the OPFS `Store`.

### Component 4 — Agent server + the deepen loop (loupe pattern)

A thin Bun server (modeled on `Projects/loupe/src/server/`) that:

- runs the **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`, `query()`),
- exposes the **catalog operations as in-process agent tools** (the same
  descriptors → Agent SDK tool definitions),
- holds `ANTHROPIC_API_KEY` server-side (never shipped to the browser),
- streams agent events to the client over **SSE**.

The agent's **system prompt is the mindgraph skill** (`skills/mindgraph/SKILL.md`)
— the producer protocol we just refined, including the connectivity rule and the
focus/QA mechanics.

**The one Phase-1 loop:** user points at a graph node → client sends
`deepen(conceptId)` over SSE → server-side agent: reads the source + current `.md`
via `Store`, expands that concept's neighbors / steps / relations *scoped to the
region*, edits the `.md`, runs `compile` + `qa` from the catalog, and emits the
patched document → client recomputes the view-model (locally, via core) and the
canvas re-settles around the expansion.

## Data flow (deepen loop)

1. Browser: user selects concept `C`; client opens `EventSource('/deepen?concept=C')`.
2. Server: `query()` runs with the mindgraph skill as system prompt and catalog
   tools; the agent reads `graphs/<slug>.mindgraph.md` + source via `Store`.
3. Agent edits the `.md` (new concepts/relations/steps around `C`), calls
   `compile` + `qa` tools; on `qa` failure it self-repairs (same loop as the CLI).
4. Server streams progress events, then the final `{document, viewModel}` over SSE.
5. Browser: diffs the new VM against current, applies it, reheats the layout
   simulator locally so the graph re-settles. No full reload.

## Error handling

- Operations never throw/exit; they return `Result` with structured `errors`
  (`{code, message, path}`). The `inputSchema` is validated *before* the handler
  runs, in one shared place, so every surface rejects bad input identically.
- CLI: `Result.errors` → stderr lines + nonzero exit; unexpected throws caught at
  top level → one structured error, never a raw stack.
- MCP: `Result` → tool result content; `ok:false` maps to an error result.
- Agent/SSE: each step emits an event; a failed op streams its `errors` so the
  agent can react (retry/repair) and the client can show status.

## Testing

- **Operations are the test surface.** Each catalog op gets a unit test calling
  `handler(input, {store: memoryStore})` with an in-memory `Store` — no fs, no
  process. This is where correctness lives now.
- **Adapters get thin tests:** CLI arg-parse → op dispatch (one happy + one error
  path per command family); MCP `tools/list` is generated-from-catalog (snapshot)
  and `tools/call` routes to the right handler.
- **Fix the test-runner hygiene the review flagged as part of this work:** add
  `"test": "node --test test/*.test.js"` so all suites (including the orphaned
  `source-first-reading-qa.test.js`) run, and a minimal CI workflow. The catalog
  refactor is the natural moment to do this.
- The deepen loop gets one integration test with a **mock agent** (a fake `query()`
  that emits a scripted edit) to verify the server→core→SSE→client contract
  without calling the real API.

## Migration / sequencing (within Phase 1)

1. Introduce `core/operations` + `Result` + `Store` port; implement the pure verbs
   by wrapping existing `core/authoring` + `view-model` functions (no behavior
   change). Add the memory `Store` and the fs `Store`.
2. Rewrite the CLI as a generated dispatch-map adapter over the catalog; keep all
   current command names; add the aggregate `npm test` + CI.
3. Rewrite the MCP server as a generated adapter — this restores source-first
   parity for agents.
4. Add the OPFS `Store` and wire the browser client to call core ops locally.
5. Add the thin agent server + the single `deepen(conceptId)` SSE loop.

Each step is independently shippable and leaves the tool working.

## Risks

- **Legacy surface area.** The catalog must cover the legacy frame ops
  (`concept upsert`, `relation upsert`, `frame …`) so existing fixtures keep
  working. Mitigation: wrap, don't rewrite; the legacy doc path already has
  functions to wrap.
- **Agent SDK as a new runtime dependency.** mindgraph is currently zero-dep. The
  Agent SDK lands **only** in the agent-server adapter, never in `core` or the CLI,
  so the zero-dep purity of core/CLI is preserved.
- **OPFS browser support / persistence semantics** differ from fs (async, origin-
  scoped). The `Store` port absorbs this; the deepen loop is async already.
- **Scope creep toward the full living document.** Held off by shipping exactly one
  deepen loop and deferring multi-region/undo to a later phase.

# AGENTS.md — `mindgraph`

Orientation for Codex sessions inside this project. Read on wake-up. Stays a **pointer**, not a duplicate of `README.md`.

## What this is

`mindgraph` digests learning material (YouTube transcripts, articles, lectures, papers) into an evolving multi-layer concept graph that a human can navigate.

User-facing tour → `README.md`.

## Operating model — read this first

Two-sided architecture. **Where you are in this picture determines where new code belongs.**

**Producer side — agent + CLI.** The CLI is *your* tool, built for the LLM (you) to fully operate end-to-end. When Victor brings source material, **you drive the pipeline**: `ingest → micro/meso/macro frames → atomic + clustered concepts → relations → activations → stats recompute`. Don't write Victor a runbook of commands to type — run them. CLI ergonomics are optimised for the LLM-as-operator (idempotent upserts, sensible defaults, parseable errors), not for human typists. Worked end-to-end example: `npm run test:smoke`.

**Consumer side — human + UI.** Victor reads the digested artifact through the UI (graph + timeline + inspectors). The UI does not author — it *reveals*. He gives high-level direction (which material, what to focus on) and review (catches when output looks off). He does not drop into the CLI to fix things.

**If a producer task needs a capability the CLI doesn't have, extend the CLI.** Don't write a one-off script alongside it. The CLI is the substrate; gaps are work to do.

## Layered mental model

Four layers, mapped onto the operating model. When in doubt about where new code belongs, name the layer first.

1. **`src/core/`** — pure document layer (producer-side internals)
   - `schema.js` — canonical document shape, validation
   - `document.js` — load / save / mutate operations
   - `transcript.js` — transcript parsing (timed + untimed)
   - `build.js` — staged `build timeline` pipeline (ingest → micro → meso)
   - No I/O concerns beyond fs read/write of mindgraph JSON. No CLI, no UI.

2. **`src/cli/index.js`** — agent operator surface (producer-side)
   - The single command file. Dispatch + arg parsing + calls into `core/`.
   - **You operate this.** Subcommands listed in `README.md § LLM-actuator workflow`.
   - Smoke test = worked end-to-end example: `npm run test:smoke` (Bun) or `test:smoke:node` (Node).

3. **`src/view-model/`** — pure derivation layer (consumer-side, upstream of UI)
   - `buildMindgraphViewModel.js` — document → shell-ready VM (concepts, clusters, frames, timeline, inspectors).
   - `buildGraphRenderState.js` — VM + selection → overview / region / local visibility for the graph canvas.
   - `example.js` — driver: `npm run vm:example` prints a representative VM slice from `examples/out/episode-1-built.mindgraph.json`.
   - **Pure functions only.** No DOM, no fetch, no fs (except the example driver).
   - Canonical contract → `docs/ui-view-model-spec.md`.

4. **`ui/` + `src/ui/dev-server.js`** — browser shell (consumer-side)
   - `ui/index.html` + `ui/styles.css` + `ui/app.js` — vanilla ES modules, single HTML5 Canvas, hand-written camera + hit-testing + progressive label reveal. No graph engine, no bundler.
   - `ui/layout.js` is the continuous-physics simulator (`createLayoutSimulator(vm) → sim` with `step/reheat/pin/unpin/isSettled`). `ui/animator.js` drives it on the rAF loop. `ui/labels.js` owns the importance-driven screen-space label policy.
   - `src/ui/dev-server.js` — tiny static server (path-traversal guarded, no-store), `npm run ui:dev` → `http://127.0.0.1:4173`. Accepts `--doc <path>` to load a different document.
   - `npm run ui:check` parses both for syntax. There is no test runner for the UI yet — verify behavior in the browser.
   - The current canvas design lives at `docs/superpowers/specs/2026-05-11-graph-rendering-v2-design.md` (v2: continuous physics, co-occurrence-driven distances, screen-space labels, drag-to-pin). Earlier `docs/canvas-ui-v1-*.md` files are historical context — the build log of how the UI got here.

## Conventions

- **Runtime:** Bun preferred for CLI (`bun src/cli/index.js …`); Node works for everything (`start:node`, `vm:example`, `ui:dev`).
- **No bundler, no framework** in the UI. Browser loads `ui/app.js` as a module directly. Keep it that way unless explicitly asked.
- **ES modules** throughout (`"type": "module"`).
- **Dependencies are minimal** — currently zero runtime deps. Add new deps only with reason.
- **Sample data:** `examples/out/episode-1-built.mindgraph.json` is the canonical input the UI loads. Built sample lives in `examples/out/`; raw fixtures in `examples/`.

## Specs in `docs/`

Read before substantive UI or VM work. These describe the **intended destination** of the consumer side; cross-check against the as-built `ui/app.js` because the UI is early.

- `docs/superpowers/specs/2026-05-11-graph-rendering-v2-design.md` — **current** graph-rendering design (v2 continuous physics: co-occurrence-driven distances, sub-stepped integrator, screen-space labels, drag-to-pin). Read first when touching the simulator, labels, or render state.
- `docs/superpowers/specs/2026-05-10-graph-rendering-design.md` — predecessor v1 design (static precompute + Maps-style labels); historical context for the v2 spec.
- `docs/ui-view-model-spec.md` — VM contract (concepts, clusters, frames, inspectors, co-occurrence matrix). The joint between producer document schema and consumer rendering — re-check this whenever the document schema changes.
- `docs/ui-component-architecture.md` — component decomposition for the shell
- `docs/dynamic-graph-interaction-architecture.md` — zoom / pan / level transitions
- `docs/ui-wireframe-spec.md` — visual wireframes (older; cross-check against above)

## Verification before claiming done

- CLI changes → run `npm run test:smoke` (Bun) end-to-end.
- New producer pipeline → run it on real source material end-to-end via the CLI; inspect the output document with `mindgraph inspect …` and (if relevant) load it in the UI.
- View-model changes → run `npm run vm:example` and inspect output.
- UI changes → `npm run ui:check` for syntax, then **load `npm run ui:dev` in a browser** (use playwright to take a screenshot if you cannot drive a real browser) and exercise the changed feature. Syntax-check alone is not verification.

## Standing rules

If a workspace-level `AGENTS.md` exists above this repo, apply it too. Project-specific:

- 🚫 Do not introduce a bundler (Vite/Webpack/etc.) without explicit approval.
- 🚫 Do not add a UI framework (React/Vue/Svelte) without explicit approval.
- 🚫 Do not commit `examples/out/` artifacts other than the canonical sample inputs the UI/tests rely on.
- 🚫 Do not write a "here's what to type" runbook for producer tasks. Run the CLI yourself.
- 🚫 Do not work around a missing CLI capability with a one-off script. Extend the CLI instead.
- 🟢 Free to: run smoke tests, run the dev server, edit any layer, add new CLI subcommands, refactor within a single layer, drive the producer pipeline end-to-end on new source material.

## On wake-up

1. Read this file (already loaded). Internalise the producer/consumer split before deciding what to do.
2. If Victor brings source material → producer task. Read `src/cli/index.js` + `src/core/schema.js`, then drive the pipeline yourself.
3. If touching the UI or VM → skim the matching `docs/ui-*.md` spec, but cross-check against `ui/app.js` (the UI is early; spec ≠ as-built).
4. If touching the CLI / document model → check `src/core/schema.js` and `src/cli/index.js` first.
5. Run the relevant verification command above before claiming the task is done.

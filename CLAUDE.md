# CLAUDE.md — `mindgraph`

Orientation for Claude Code sessions inside this project. Read on wake-up. Stays a **pointer**, not a duplicate of `README.md`.

## What this is

`mindgraph` turns transcripts into evolving concept timelines. CLI is the rigid structural layer an LLM (or human) writes into; the view-model + UI layer reads the resulting documents.

User-facing tour → `README.md`.

## Layered mental model

Four layers, kept deliberately separate. When in doubt about where new code belongs, name the layer first.

1. **`src/core/`** — pure document layer
   - `schema.js` — canonical document shape, validation
   - `document.js` — load / save / mutate operations
   - `transcript.js` — transcript parsing (timed + untimed)
   - `build.js` — staged `build timeline` pipeline (ingest → micro → meso)
   - No I/O concerns beyond fs read/write of mindgraph JSON. No CLI, no UI.

2. **`src/cli/index.js`** — actuator surface
   - The single command file. Dispatch + arg parsing + calls into `core/`.
   - Treat as the LLM-actuator API. Subcommands listed in `README.md § LLM-actuator workflow`.
   - Smoke test: `npm run test:smoke` (Bun) or `test:smoke:node` (Node).

3. **`src/view-model/`** — pure derivation layer
   - `buildMindgraphViewModel.js` — document → shell-ready VM (concepts, clusters, frames, timeline, inspectors).
   - `buildGraphRenderState.js` — VM + selection → overview / region / local visibility for the graph canvas.
   - `example.js` — driver: `npm run vm:example` prints a representative VM slice from `examples/out/episode-1-built.mindgraph.json`.
   - **Pure functions only.** No DOM, no fetch, no fs (except the example driver).
   - Canonical contract → `docs/ui-view-model-spec.md`.

4. **`ui/` + `src/ui/dev-server.js`** — minimal browser shell
   - `ui/index.html` + `ui/styles.css` + `ui/app.js` (~1k LOC, vanilla ES modules, cytoscape).
   - `src/ui/dev-server.js` — tiny static server (path-traversal guarded, no-store), `npm run ui:dev` → `http://127.0.0.1:4173`.
   - `npm run ui:check` parses both for syntax. There is no test runner for the UI yet — verify behavior in the browser.

## Conventions

- **Runtime:** Bun preferred for CLI (`bun src/cli/index.js …`); Node works for everything (`start:node`, `vm:example`, `ui:dev`).
- **No bundler, no framework** in the UI. Browser loads `ui/app.js` as a module directly. Keep it that way unless explicitly asked.
- **ES modules** throughout (`"type": "module"`).
- **Dependencies are minimal** — only `cytoscape` so far. Add new deps only with reason.
- **Sample data:** `examples/out/episode-1-built.mindgraph.json` is the canonical input the UI loads. Built sample lives in `examples/out/`; raw fixtures in `examples/`.

## POC files (untracked, do not commit)

These exist as scratch references for the cytoscape integration and were intentionally left out of git:

- `ui/cytoscape-spike.{html,js,css}`
- `ui/cytoscape-camera-test.{html,js,css}`

Don't reference them from `index.html`. If something useful crystallises, port it into `ui/app.js` and trash the spike — don't grow them.

## Specs in `docs/`

Read these before substantive UI or VM work. They are the source of truth for behavior, not the code.

- `docs/ui-view-model-spec.md` — VM contract (concepts, clusters, frames, inspectors)
- `docs/ui-component-architecture.md` — component decomposition for the shell
- `docs/dynamic-graph-interaction-architecture.md` — zoom / pan / level transitions
- `docs/ui-wireframe-spec.md` — visual wireframes (older; cross-check against above)

## Verification before claiming done

- CLI changes → run `npm run test:smoke` (Bun) end-to-end.
- View-model changes → run `npm run vm:example` and inspect output.
- UI changes → `npm run ui:check` for syntax, then **load `npm run ui:dev` in a browser** and exercise the changed feature. Syntax-check alone is not verification.

## Standing rules

Workspace-level rules in `../../../CLAUDE.md` apply (no `git push` without approval, prefer `trash` over `rm -rf`, use `_archive/` over deletion). Project-specific:

- 🚫 Do not introduce a bundler (Vite/Webpack/etc.) without explicit approval.
- 🚫 Do not add a UI framework (React/Vue/Svelte) without explicit approval.
- 🚫 Do not commit `examples/out/` artifacts other than the canonical sample inputs the UI/tests rely on.
- 🟢 Free to: run smoke tests, run the dev server, edit any layer, add new CLI subcommands, refactor within a single layer.

## On wake-up

1. Read this file (already loaded).
2. If touching the UI or VM → skim the matching `docs/*.md` spec.
3. If touching the CLI / document model → check `src/core/schema.js` and `src/cli/index.js` first.
4. Run the relevant verification command above before claiming the task is done.

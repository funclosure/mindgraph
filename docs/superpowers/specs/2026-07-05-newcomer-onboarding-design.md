# Newcomer onboarding — design

**Date:** 2026-07-05
**Status:** approved (scope + phasing confirmed)
**Goal:** optimize the first-time experience for someone who discovers mindgraph and wants to use it.

## The problem (grounded in the code)

A newcomer hits three friction points:

1. **The instant win is thin.** `mindgraph view` (no args) opens the one bundled
   sample (`examples/out/episode-1-built.mindgraph.json`); the `files` whitelist
   ships exactly that one graph and `graphs/` is gitignored. One graph is the
   whole gallery.
2. **Producing your own graph is a silent cliff.** Standalone `ingest`/`digest`/
   `build timeline` yield **0 concepts, 0 relations** — a transcript skeleton.
   The semantic pass (concepts, grounded relations) is inherently an LLM agent's
   job (`skills/mindgraph/SKILL.md`). The UI renders a 0-concept doc as a blank
   canvas with no explanation; the CLI prints terse frame counts.
3. **Discovery is a wall.** Bare `mindgraph` dumps ~30 commands with no "start here".

The throughline of the fix: **set expectations honestly, hand newcomers an
instant agent-free win, and make the agent path one command for those with
credentials.**

## Architecture facts the design relies on

- Both servers (`src/ui/dev-server.js`, `src/server/index.js`) bind a single
  `--doc` at launch (fallback episode-1); no multi-doc endpoint, no in-UI
  document switcher (the `renderSourceSwitcher` in `ui/app.js` switches *sources
  within* a doc, not documents).
- `open`'s `listGraphs()` (`src/cli/index.js`) scans cwd `./graphs/` for
  `*.mindgraph.md`, newest wins.
- `ingest`/`build` next-steps come from `meta.build.suggestedNextCommands`
  (`src/core/build.js`); low-level manual authoring commands.
- Agent runners `answerRunner.js` (86 lines, read-only) and `crystallizeRunner.js`
  (59 lines, **edits `.mindgraph.md` in place**) wrap `query()` from
  `@anthropic-ai/claude-agent-sdk` via `agentSdk.js` `loadSdk()` (dynamic import,
  throws if absent; SDK is server-only today). A producer runner is a sibling.
- UI has no empty-state anywhere; overlay panels live absolutely-positioned in
  `.graph-cell` (`#graph-focus`, `#digest-inspector`). `buildProseChunks` returns
  `[]` for a segment-less doc → empty `<article>`.

## Phase 1 — Honest produce path (lowest risk, first)

- **CLI.** When `ingest`/`digest`/`build timeline` write a doc with 0 atomic
  concepts, print a clear guidance block instead of the terse tail: the doc is a
  skeleton; the semantic pass is an agent's; options are (a) the mindgraph skill
  in Claude Code, (b) `mindgraph author <src>` (Phase 3), (c) hand-author the
  `.mindgraph.md`. Factor into one helper so all three commands share it.
- **UI.** Add a `#graph-empty` overlay in `.graph-cell`, shown only when the VM
  has 0 atomic concepts: "No concepts yet — this is a transcript skeleton.
  Digest it with an agent to see the map." Hidden otherwise.
- **Tests.** VM/CLI: a helper `describeProduceState(doc)` returns
  `{ conceptCount, skeleton: bool, guidance: string[] }`; assert skeleton
  detection and guidance text. UI: `ui:check` + browser check with a skeleton doc.

## Phase 2 — Sample gallery + first-run (agent-free win; CLI picker only)

- **Ship a gallery.** `examples/gallery/` with 3 curated source-first graphs
  across domains (validate each before committing; swap any that fail):
  - `adolescence-of-technology` (~44 concepts / 48 relations) — tech · society
  - `anthropic-safety-superpower` (~39 / 30) — AI · safety
  - `awakening-meaning-crisis-introduction-reading` (~41 / 29) — philosophy · meaning
  Ship compiled `.mindgraph.json` (what the reader needs; `view` is credential-free)
  plus a curated `examples/gallery/gallery.json` manifest
  (`[{slug, title, blurb}]`). Add `examples/gallery/` to `files`.
- **`mindgraph gallery` command.** Prints the manifest: title, blurb, and
  `mindgraph view <slug>` for each.
- **Name resolution.** `mindgraph view <slug>` resolves, in order: an existing
  path → `./graphs/<…>` → the bundled `examples/gallery/` (resolved relative to
  the CLI install dir, not cwd), so it works from anywhere.
- **First-run nudge.** Bare `mindgraph` prints a short "👋 New here? Try
  `mindgraph gallery`" banner above the usage.
- **Deferred:** in-UI multi-doc picker (needs server list routes + reactive
  rebuild on switch) — its own follow-up.
- **Tests.** Gallery manifest loads and every slug resolves to an existing,
  valid shipped `.json`; `view` slug-resolution order; bare-command nudge present.

## Phase 3 — One-command agent produce (biggest; plumbing + stub first)

- **`mindgraph author <source> [-o …] [--stub] [--open]`.** Pipeline: prepare
  source (reuse `prepareSourceOperation`) → draft scaffold (reuse
  `createAuthoringDraftFromText`) → **producer runner** authors the semantic
  `.mindgraph.md` → validate → compile → qa → optionally open.
- **`src/server/producerRunner.js`** (or `src/produce/…`), modeled on
  `crystallizeRunner`: `loadSdk()` + `query()` with system prompt from SKILL.md,
  allowedTools Read/Edit/Grep/Glob/WebSearch/WebFetch, streaming progress to the
  terminal, editing the scaffold `.mindgraph.md` in place.
- **`--stub`** mirrors the server: a canned deterministic runner that writes a
  small valid `.mindgraph.md`, so the whole pipeline is unit-testable without
  credentials. The real runner is credential-gated (`loadSdk()` throws → friendly
  message telling the user to use the skill instead).
- **Tests.** With `--stub`: author end-to-end produces a valid compiled graph
  (validate + qa pass). Real runner: plumbing only (invoked, streams, writes),
  not output quality.

## Verification

Each phase: TDD (`npm test`), `npm run ui:check` + browser for UI, `npm run
test:smoke` after CLI changes, and a global `mindgraph validate` sweep of the
shipped gallery. Ship phases as separate commits; release when 1 & 2 are in.

## Rejected / deferred

- In-UI document picker (deferred, own follow-up) — reactive-rebuild risk.
- Full real producer agent this session (deferred) — token cost + non-deterministic
  output; stub-first keeps the pipeline verifiable now.

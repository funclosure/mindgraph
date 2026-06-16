# Agent Server + Deepen Loop — Implementation Plan (Plan 4 of 4)

> **For agentic workers:** This plan is executed with **Codex** as the implementer for the server units, with Claude orchestrating and reviewing. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A thin local agent server that runs the Claude Agent SDK to "deepen" a concept region of a graph on demand, recompiles via the shared `core/operations` catalog, and streams the new document to the browser over SSE — the living-document loop.

**Architecture:** New `src/server/` adapter (Node `http`, matching the existing dev-server) that (a) serves the UI + `/doc.md` like the dev-server, and (b) adds a `GET /deepen` SSE endpoint. The deepen handler loads the graph's `.mindgraph.md` via a `Store`, runs an **injectable agent runner** that edits the `.md`, then compiles + QAs via the catalog and streams `progress` and a final `document` event. The real runner uses `@anthropic-ai/claude-agent-sdk` (`query()`); tests inject a mock runner so the whole loop is verifiable **without an API key**. The Agent SDK is the *only* new dependency and lives *only* in this adapter — `core`, `operations`, and the CLI stay zero-dependency.

**Tech Stack:** Node ESM, `node:http`, `node:test`, `@anthropic-ai/claude-agent-sdk` (server adapter only), browser `EventSource`.

**Spec:** `docs/superpowers/specs/2026-06-16-portable-core-operations-catalog-design.md` (§ Component 4, Data flow).

**Reference:** `Projects/loupe/src/server/lens-session.ts` and `index.ts` — proven Agent SDK `query()` usage (multi-turn channel, `stream_event`/`event.delta.text`, `idleTimeout`).

---

## Key interfaces (define once, used across units)

**`Store`** (already exists as a port; add a filesystem implementation):
```
get(id) -> { md?, json? } | null      // id = graph slug
put(id, { md?, json? })
list() -> string[]
```
Filesystem mapping for slug `s`: `md` ↔ `graphs/<s>.mindgraph.md`, `json` ↔ `graphs/<s>.mindgraph.json`.

**Agent runner** (the injectable seam — this is what makes the loop testable):
```
type DeepenRequest = { slug, conceptId, store, emit }
type AgentRunner = (req: DeepenRequest) => Promise<void>
// Contract: the runner edits the graph's .md (via store.put or by editing the
// file) to expand `conceptId`'s region, calling `emit({type:'progress', message})`
// as it works. It MUST NOT compile — the handler compiles after the runner returns.
```

**SSE event protocol** (`GET /deepen?slug=<slug>&concept=<conceptId>`):
- `event: progress` `data: {"message": "..."}` — zero or more
- `event: document` `data: {"document": <compiled doc>, "qa": <report>}` — exactly one, last, on success
- `event: error`    `data: {"message": "..."}` — terminal, on failure

---

## File Structure
- Create: `src/adapters/fsStore.js` — Node filesystem `Store` (used by server; later by CLI/MCP). Lives outside `core` (touches `fs`).
- Create: `src/server/deepenHandler.js` — pure-ish handler: given `{slug, conceptId, store, runner, emit}`, runs runner → `compile` → `qa` → emits events. No `http`, no SDK. Unit-testable with a mock runner + memory store.
- Create: `src/server/agentRunner.js` — the real `AgentRunner` using `@anthropic-ai/claude-agent-sdk`. Isolated; not unit-tested (needs API key).
- Create: `src/server/index.js` — Node `http` server: static + `/doc.md` (reuse dev-server logic) + `GET /deepen` SSE wired to `deepenHandler` with the real runner.
- Create: `test/deepen-handler.test.js` — drives `deepenHandler` with a **mock runner** and a memory store; asserts the event sequence and the recompiled document.
- Create: `test/fs-store.test.js` — round-trips a slug through a temp dir.
- Modify: `package.json` — add `@anthropic-ai/claude-agent-sdk` dependency + a `server` script (`node src/server/index.js`).
- Modify: `ui/app.js` — on a "deepen" action (double-click / button on a selected concept), open `EventSource('/deepen?...')`, apply the `document` event (rebuild VM + reheat layout), show `progress`.

---

## Unit 1 — fsStore (Codex implements; Claude reviews)

**Files:** Create `src/adapters/fsStore.js`, `test/fs-store.test.js`.

TDD. The store maps a slug to `graphs/<slug>.mindgraph.{md,json}` under a configurable base dir (default `graphs/`). `get` returns `{md?, json?}` reading whichever files exist (json parsed), or `null` if neither exists. `put` writes the provided fields. `list` returns slugs that have an `.md` or `.json`.

- [ ] Write `test/fs-store.test.js`: in a `mkdtemp` dir, `put('demo', {md:'# x'})` then `get('demo')` returns `{md:'# x'}`; `put('demo', {json:{kind:'k'}})` merges; `get('missing')` is `null`; `list()` returns `['demo']`. Run → fail.
- [ ] Implement `src/adapters/fsStore.js` exporting `createFsStore({ baseDir = 'graphs' } = {})`. Run → pass.
- [ ] Commit: `feat(server): add filesystem Store adapter`.

## Unit 2 — deepenHandler (Codex implements; Claude reviews) — the core, fully testable

**Files:** Create `src/server/deepenHandler.js`, `test/deepen-handler.test.js`.

`deepenHandler({ slug, conceptId, store, runner, emit })`:
1. `emit({ type: 'progress', message: 'reading graph' })`.
2. `await runner({ slug, conceptId, store, emit })` — the runner mutates the `.md` (in tests, the mock does a scripted edit).
3. Read the (now edited) `md` from `store.get(slug)`.
4. `registry.run('compile', { markdown: md })`. If `!result.ok` or `validation.ok === false`, `emit({type:'error', ...})` and return.
5. Persist compiled json: `store.put(slug, { json: result.value.document })`.
6. `registry.run('qa', { document })`.
7. `emit({ type: 'document', document, qa: qaResult.value })`. Return.
Wrap in try/catch → `emit({type:'error', message})`. The handler imports `registry` from `../operations/index.js` — no `http`, no SDK.

- [ ] Write `test/deepen-handler.test.js`: seed a memory store with a real fixture `.md` (read `examples/authoring/recursive-self-improvement.mindgraph.md`). Define a **mock runner** that appends a new `@concept`/`@relation` (or a trivially valid edit) to the slug's `md` via `store.put`. Collect `emit` events into an array. Call `deepenHandler`. Assert: events include at least one `progress`, exactly one `document` whose `document.kind === 'mindgraph.source-first'` and which contains the mock's added concept, and no `error`. Add a second test where the mock writes BROKEN markdown → assert an `error` event and no `document` event. Run → fail.
- [ ] Implement `src/server/deepenHandler.js`. Run → pass.
- [ ] Commit: `feat(server): add deepen handler (runner-injected, mock-tested)`.

## Unit 3 — HTTP/SSE server (Codex implements; Claude reviews)

**Files:** Create `src/server/index.js`.

Node `http` server (reuse the static-file + `/doc.md` + `/doc.json` logic from `src/ui/dev-server.js` — factor shared bits if clean, else copy). Add:
- `GET /deepen?slug=<slug>&concept=<conceptId>`: set headers `content-type: text/event-stream`, `cache-control: no-store`, `connection: keep-alive`; build an `emit(event)` that writes `event: <type>\ndata: <json>\n\n`; call `deepenHandler({ slug, conceptId, store: fsStore, runner: agentRunner, emit })`; `res.end()` after the terminal event. Default `slug` from the `--doc` path's basename when omitted.
- Keep-alive: the connection may idle while the agent thinks; send a `: ping\n\n` comment every ~20s.

- [ ] Manual verification (no unit test for the socket layer): start `node src/server/index.js --doc graphs/<slug>.mindgraph.md`, then `curl -N 'http://127.0.0.1:4173/deepen?concept=<id>'` with a **stub runner** env (`MINDGRAPH_STUB_DEEPEN=1`) that does a scripted edit, and confirm the SSE `progress`→`document` sequence prints. (Codex adds the stub-runner toggle so this works without an API key.)
- [ ] Commit: `feat(server): add http+SSE server with /deepen endpoint`.

## Unit 4 — real Agent SDK runner (Codex drafts; Claude reviews; runtime-gated)

**Files:** Create `src/server/agentRunner.js`, modify `package.json`.

- [ ] `npm install @anthropic-ai/claude-agent-sdk` (server-only dependency).
- [ ] Implement `agentRunner({ slug, conceptId, store, emit })` using `query()` (loupe pattern). System prompt = contents of `skills/mindgraph/SKILL.md` + a task line: "Deepen the concept '<conceptId>' in `graphs/<slug>.mindgraph.md`: add 2–4 durable, source-grounded concepts/relations/steps connected to it, following the connectivity and focus/QA rules. Edit only that file. Do not compile." Options: `model` (default `claude-sonnet-4-6`), `permissionMode: 'bypassPermissions'`, `allowedTools: ['Read','Edit']`, working dir = repo root; map `stream_event` text deltas to `emit({type:'progress', message})`. The agent edits the `.md` on disk (the fsStore reads the same path). If `ANTHROPIC_API_KEY`/Claude auth is absent, `emit` an error explaining how to set it.
- [ ] Document in the commit body that this path needs Claude credentials and is exercised manually, not in CI.
- [ ] Commit: `feat(server): add Claude Agent SDK deepen runner`.

## Unit 5 — browser deepen action (Claude implements; small, visual)

**Files:** Modify `ui/app.js`.

- [ ] On a concept "deepen" trigger (double-click a selected node, or a small "Deepen" button in the digest/inspector), open `new EventSource('/deepen?slug=' + slug + '&concept=' + conceptId)`. Show `progress` messages in a small status line. On `document`: set `state.document`, rebuild `state.viewModel = buildMindgraphViewModel(doc)`, rebuild prose chunks, `state.sim = createLayoutSimulator(vm)` (or reheat), and redraw so the graph grows around the deepened concept. On `error`: show it; close the stream.
- [ ] Manual verification: `npm run server -- --doc graphs/<slug>.mindgraph.md`, open the UI, deepen a node; with `MINDGRAPH_STUB_DEEPEN=1` confirm the graph gains the stub's nodes without the real API; then (with credentials) confirm a real deepen.
- [ ] Commit: `feat(ui): deepen a concept via the agent server over SSE`.

---

## Testing strategy
- **Unit-tested without an API key:** `fsStore` (Unit 1) and `deepenHandler` with a mock runner (Unit 2) — these cover the whole load→edit→compile→qa→emit contract, which is the risky logic.
- **Manually verified:** the socket/SSE layer (Unit 3) and the browser loop (Unit 5) via a `MINDGRAPH_STUB_DEEPEN` stub runner (no key needed), then end-to-end with real Claude credentials (Unit 4).
- `npm test` must stay green; new suites added to the default `node --test test/*.test.js` glob automatically.

## Risks
- **New dependency.** The Agent SDK is the first runtime dep. Keep it imported only in `src/server/agentRunner.js`; verify `core`/`operations`/CLI still import nothing from it (a grep check in review).
- **API key / auth at runtime.** The real runner needs Claude credentials; the stub runner keeps the loop demoable and CI-safe without them.
- **Agent edits vs concurrent compile.** The agent edits the `.md`; the handler compiles only after the runner returns, avoiding mid-edit reads. Single in-flight deepen per slug (serialize) for now.
- **Layout disruption on regrow.** Rebuilding the VM may reshuffle the graph; reheating the existing simulator and preserving pinned positions is preferable to a full rebuild — note for Unit 5, tune if jarring.

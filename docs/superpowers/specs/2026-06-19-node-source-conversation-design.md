# Node ⇄ Source Conversation ("Ask")

**Date:** 2026-06-19
**Status:** Implemented
**Author:** drafted with Claude (Opus 4.8)
**Supersedes:** the interaction model in `2026-06-19-conversational-deepen-design.md` (the discussion-as-source *artifact* survives; the *one-shot, always-grows, asks-structured-questions* flow is replaced).

## Problem

The shipped "Deepen" has one gear: every interaction spends ~90s having the agent re-read the whole `.mindgraph.md` and author a new source, mutating the graph. So a plain question — *"what is this node about?"* — becomes a slow, graph-changing operation. There is no way to simply **talk to a node**. The structured question-cards we built assume the agent must interrogate the user *before* acting; in practice the user wants the reverse: talk first, act only when it's worth it.

## Goal

Reframe the node panel from a **command ("Deepen")** into a **place ("Ask")** — a conversation with the selected node, grounded in its source. Two kinds of turn:

1. **Talk (default):** fast, source-grounded answers; no file write, no graph change; the conversation accumulates.
2. **Crystallize ("Add to graph"):** explicit; the agent turns the conversation so far into a new `type: discussion` `@source` whose derived concepts become new nodes woven to this one (the existing discussion-as-source machinery, now *fed by the chat* and *triggered by the user*). Undo reverts the whole woven turn.

## Decisions (from brainstorming)

- **Growth only on request.** Talk never changes the graph. Only "Add to graph" does.
- **Grounding: source-first, web opt-in.** Answers come from this source's text by default; the agent reaches the web only when asked, and says so.
- **Crystallize: agent proposes, it just happens.** No preview gate, no per-node naming. Undo is the safety net.
- **Remove the question-card machinery.** `ask_user_questions`, the question channel, `/deepen/answer`, the `question`/`ready` SSE events, and `ui/panels/question-card.js` are deleted — the conversation supersedes structured questions, and crystallize doesn't ask.
- **Rename:** the "Deepen" tab becomes **"Ask"**.

## Design

### Interaction flow
1. Select a node → the **Ask** tab opens, anchored to that node.
2. Type a message → the agent streams a **source-grounded answer** into the thread (seconds, not minutes). Repeat freely; history accumulates client-side.
3. When worth keeping, click **Add to graph** → the agent authors a discussion `@source` from the conversation; the graph grows around the anchor; the discussion becomes readable in the source switcher.
4. **Undo** reverts the last crystallize.

### Two turn types, two runners
- **`answerRunner` (talk).** A read-only agent turn. The server preloads the node's context — its label/aliases, the source blocks it is grounded in, and its immediate graph neighbors — into the prompt, so the common question is answered without any tool round-trips. Tools allowed: `Read`, `Grep`, `WebSearch`, `WebFetch` (web opt-in per the system prompt); **no `Edit`**. The turn streams `progress`/`answer` and ends — it never writes the file. Fast because the answer usually comes straight from preloaded context and there is no compile.
- **`crystallizeRunner` (add to graph).** Essentially today's `agentRunner` discussion-authoring behavior, but its task input is *the conversation transcript* rather than a one-line steer: "the reader and you discussed `<concept>`; below is the conversation; weave the durable concepts it surfaced into a new discussion `@source` …" It edits the `.md`; the handler compiles + QAs + emits the document. Undo/backup unchanged.

### Transport
Both turns are `POST` with a JSON body and a streamed response (SSE-formatted lines read via `fetch()` + `ReadableStream`), replacing `EventSource`:
- `POST /ask` `{ concept, messages: [{role, text}] }` → streams `progress` then `answer` events; no document.
- `POST /crystallize` `{ concept, messages }` → streams `progress` then a final `document` event (graph grew).
- `POST` carries the conversation history cleanly (no query-string limit) and removes the need for a server-side question channel or `turnId` correlation. `GET /undo` and `/doc.md` are unchanged.

(Why fetch-streaming over EventSource: EventSource is GET-only, so multi-message history would not fit; and we are removing the only thing that needed a second correlated request — the answer channel.)

### UI (`ui/`)
- **Rename** the tab/labels "Deepen" → **"Ask"**; the panel header reads "Ask: `<node>`".
- The thread renders `you` / `agent` entries (plain text, escaped) plus the pinned **"Thinking…" heartbeat** during a turn. The **input** sends a talk turn (Enter / Send). An **"Add to graph"** button (enabled once the conversation has at least one exchange) sends the crystallize turn; an **Undo** button appears after a successful crystallize.
- **Delete** `ui/panels/question-card.js` and all question-card wiring (`renderQuestionCards`, `collectAnswers`, `bindQuestionSubmits`, the `question`/`ready` listeners, the `qc-*` CSS). Keep the **source switcher** (crystallized discussions stay readable) and the **heartbeat** (still useful during talk/crystallize).
- The thread keeps the client-side conversation array; it is what gets POSTed.

### Server (`src/server/`)
- **Delete** `questionChannel.js`, the `POST /deepen/answer` route, the `ask_user_questions` SDK tool + `mcpServers` wiring, and the `ready`/`question` emits.
- **Split** the runner: `answerRunner.js` (read-only, source-preloaded, streams the answer) and `crystallizeRunner.js` (the discussion-authoring agent, fed the transcript). `agentRunner.js` is refactored into these two (shared skill-reading + SDK-import helpers).
- **`deepenHandler.js` → `crystallizeHandler.js`** (or keep the name, drop `askQuestions`): backup → crystallizeRunner → compile → validate → qa → emit document (unchanged pipeline, no `askQuestions`).
- New **`askHandler.js`**: runs `answerRunner`, streams its output, writes nothing.
- `index.js` routes `POST /ask` → askHandler, `POST /crystallize` → crystallizeHandler; `selectRunner` still swaps in the stub under `MINDGRAPH_STUB_DEEPEN` (stub gains a trivial answer mode).

### Stub (no-API)
`stubRunner` splits to match: a stub **answer** ("(stub) This node, `<concept>`, is about …" echoing a preloaded block) and a stub **crystallize** (the current discussion-weaving, fed by the last user message instead of a scripted question). Keeps the whole flow demoable without credentials.

## Data flow

**Talk turn:** client POSTs `{concept, messages}` → server preloads node context → `answerRunner` streams `answer` → client appends the agent reply to the thread. No file touched.

**Crystallize turn:** client POSTs `{concept, messages}` → backup → `crystallizeRunner` edits the `.md` from the transcript → compile + qa → `document` emitted → client applies it (anchored local growth, source switcher shows the new discussion). Undo restores the backup.

## Error handling
- Talk: if the agent errors or the source can't be read, stream an `error` into the thread; the conversation is preserved so the user can retry.
- Crystallize: unchanged — a compile/QA failure emits `error` and leaves the consumer document untouched (handler returns before `store.put`); the conversation stays so the user can adjust and retry; Undo reverts a bad-but-valid weave.
- Web search unavailable / no results → the agent says so and stays within the source.

## Testing
- **Pure / unit:** node-context preloader (given a document + conceptId, returns the anchor's blocks + neighbors); the `crystallizeRunner` task builder (transcript → task prompt) shape; the existing discussion-as-source compile/QA contract still holds; undo still reverts a woven turn.
- **Stub / manual:** `MINDGRAPH_STUB_DEEPEN=1` — a multi-message talk exchange (fast, no graph change) followed by "Add to graph" (weaves a discussion source) — drives the whole UI without the API.
- **Real:** one credentialed session — ask 2–3 questions (verify source-grounded, fast, no file change), then crystallize (verify a `validate`-clean, `qa.ok=true` discussion source woven to the anchor). Run against a `/tmp` copy of a graph, never the canonical sample (deepen/crystallize writes the on-disk `.md`).

## Non-goals (v1)
- No persistent server-side agent session — each turn is a fresh `POST` carrying the client-held history (same v1 scoping as before).
- No preview/confirm gate on crystallize, no per-node naming (agent proposes; Undo is the safety net).
- No editing of crystallized discussion prose in the UI (read-only via the source switcher; re-converse to extend).
- No persistence of the live chat beyond what crystallize captures — the crystallized discussion source is the record; un-crystallized chat is ephemeral (lost on reselect/reload).

## Risks
- **Answer speed** depends on preloading enough node context that the agent rarely needs `Read`. If answers are still slow, widen the preloaded neighborhood or instruct tighter. Mitigate by measuring the real run.
- **Removing just-built code** (question cards/channel) is deliberate; ensure all references are pulled so nothing dangles (tests for `/deepen/answer` and the channel are deleted with it).
- **Transport switch** (EventSource → fetch streaming) touches the client read loop; verify streaming chunks parse incrementally across browsers (target is the local dev browser only).
- **Ephemeral chat** means a user can lose a good conversation by reselecting before crystallizing. Acceptable for v1; a "you have unsaved conversation" hint is a possible later affordance.

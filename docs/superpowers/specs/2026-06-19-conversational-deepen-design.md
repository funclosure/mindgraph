# Conversational Deepen — Discussion-as-Source

**Date:** 2026-06-19
**Status:** Implemented
**Author:** drafted with Claude (Opus 4.8)

## Problem

The current deepen is a **one-shot**: click Deepen → a silent multi-minute agent turn → concepts appended to the graph. Three problems surfaced in use:

1. **No clarification.** It guesses what you want to explore. A broad concept ("Powerful AI") has many angles (capabilities, timeline, risks); the one-shot picks one blindly.
2. **The interaction feels weird / stuck.** During the silent "composing the edit" phase there is zero feedback, so a working agent looks frozen.
3. **The growth has thin provenance.** New concepts are appended with `grounded_in` pointing at the original essay's blocks, but they came from a *reasoning process*, not a verbatim passage — the grounding is a stretch, and the reasoning itself is thrown away.

## Goal

Make deepen a **clarifying, multi-turn conversation** whose outcome is **a new source woven into the living document**:

- The conversation **compiles into a new `@source`** (the discussion) inside the same `.mindgraph.md`.
- **Derived concepts** are grounded in that discussion source (honest provenance), and **cross-source relations** link them to the essay's existing concepts.
- The agent **asks structured questions only when your intent is ambiguous** (otherwise it just proceeds), can **optionally search the web**, and the panel becomes a real back-and-forth thread.

The graph still grows (per the earlier scoping decision); the growth is now anchored in a saved, navigable discussion rather than appended from nowhere.

## Design

### Interaction flow
1. Select a concept → **Deepen** (optionally typing a steer).
2. **Smart clarification.** If the intent is ambiguous (broad concept, no/vague prompt), the agent calls `ask_user_questions`; the Deepen panel renders 1–2 **AskUserQuestion-style cards** (each: `header`, `question`, 2–4 `options` of label+description, `multiSelect`, plus a free-text "Other"). You answer; answers return to the agent. If the intent is clear, the agent skips questions.
3. **Conversation.** The agent works, streaming readable progress. It may **web-search** when you ask about something beyond the essay (it says so, and marks web-derived material distinctly).
4. **Outcome (this turn).** The agent authors a **new source** (see below); the handler compiles + QAs; the graph grows, anchored, and the new discussion source becomes readable.
5. **Multi-turn.** The thread stays anchored to the concept. Follow-ups ("now the timeline angle", "go deeper on that new node") continue the same conversation; each turn appends to / extends the discussion source and grows the graph further.

### The outcome: discussion-as-source
Each deepen turn edits the `.mindgraph.md` to add, in mindgraph's own authoring format:

- **One `@source`** for the discussion, id `deepen-<conceptId>-<n>`, `type: discussion`, titled e.g. "Deepen: Powerful AI (capabilities)".
- **`@block`s** = the **compiled, cleaned discussion** (readable prose synthesising the exchange — *not* raw "you:/Loomy:" turns), enough text to ground the derived concepts.
- **`@concept`s** derived from the discussion, each `grounded_in` a discussion block (so QA's label/alias binding holds against the discussion text).
- **`@relation`s** — **cross-source** edges from the derived concepts to the anchor and other relevant essay concepts (the "weave"). `source` provenance when the discussion block states the link; `inferred` (with rationale) for editorial bridges.
- **A `@section` + `@step`s** for the discussion source, foregrounding the derived concepts on the discussion blocks (so QA passes and the discussion is navigable as a reader journey).

Result: one graph, **multiple woven sources** (essay + discussions). Essay-concepts stay grounded in the essay; discussion-concepts in the discussion; anything web-derived is grounded in a discussion block that cites the source and is flagged.

### Reading the discussion
The **Source** tab gains a lightweight **source switcher** (e.g. "Essay" / each "Deepen: …"). Selecting a discussion source renders its blocks as prose exactly like the essay, with its derived concepts highlighted. The discussion is first-class and navigable, not a hidden log. (The live conversation also remains in the Deepen tab's thread for the active turn.)

### Provenance & honesty
- `type: discussion` sources are visually distinguishable from the primary source (a subtle style on their nodes/source label).
- Web-derived content lives in a discussion block that names its origin; concepts from it are grounded in that block and the relation/concept may carry an `inferred` marker. The graph never claims the essay said something it didn't.

## Architecture / components

Reuses the Plan-4 agent server + Agent SDK loop; adds tools and a multi-turn session.

- **`src/server/agentRunner.js`** — gains:
  - **`ask_user_questions`** custom in-process tool. Its handler returns a Promise that the server resolves when the client posts answers. Tool input mirrors shuttle's `AskUserQuestionsInput` (`questions[]` of `{header, question, options[], multiSelect}`).
  - **`WebSearch`/`WebFetch`** added to `allowedTools` (opt-in; the system prompt tells the agent to use them only when the ask exceeds the source, and to mark results).
  - A **kept-alive `query()` session** via a message channel (loupe pattern) so follow-up turns continue the conversation.
  - System prompt = mindgraph skill **+ the "deepen authors a new `@source`" protocol** (write discussion blocks; derive grounded concepts; cross-source relations; minimal section/steps).
- **`src/server/index.js`** — `/deepen` SSE stream gains a **`question`** event (carries the `LoomyQuestion[]`); a new **`POST /deepen/answer`** (or a query channel) delivers the user's answers back to the waiting tool handler, keyed by a turn id. Multi-turn: the SSE connection stays open across turns, or a follow-up reuses the session id.
- **Client (`ui/`)** —
  - `ui/panels/deepen-thread.js`: render `question` events as **structured cards** (port shuttle's `LoomyQuestion` UI), collect answers (multi-select + Other), POST them back; keep multi-turn history; cleaner/deduped progress + a "thinking…" heartbeat.
  - Source tab: a **source switcher** + render any selected source's prose (reuse the existing prose renderer over the chosen source's blocks).
- **`src/operations` / `core`** — unchanged in principle; `compile`/`qa`/`view_model` already handle multiple `@source`s and cross-source relations. Verify the view-model renders multi-source prose and cross-source edges (it should; add a test if gaps appear).

## Data flow (one ambiguous deepen turn)
1. Client: select concept → SSE `GET /deepen?concept=…` (+ optional prompt).
2. Server agent turn begins; intent ambiguous → agent calls `ask_user_questions`.
3. Server emits SSE `event: question` with the question set; the tool handler awaits.
4. Client renders cards → user answers → `POST /deepen/answer` (turn id + answers).
5. Server resolves the handler with the answers; the agent proceeds (optionally `WebSearch`), then **edits the `.md`** to add the discussion `@source` + blocks + derived concepts + cross-source relations + steps.
6. Handler runs `compile` + `qa`; streams `progress` then the final `document`.
7. Client applies the document (anchored local growth), and the new discussion source appears in the Source switcher.

## Error handling
- If the user dismisses/answers "skip" on the questions, the agent proceeds with a best-effort default (and says so).
- If `compile`/`qa` fails on the agent's edit, surface the error in the thread and leave the graph unchanged (the deepen handler already snapshots for **Undo**, which now reverts the whole woven turn — source, concepts, relations, steps).
- Web search unavailable / no results → the agent says so and stays within the source.
- Question round-trip timeout (user walks away) → the turn ends gracefully after a generous timeout; the thread shows "deepen cancelled".

## Testing
- **Pure / unit (no API):** the discussion-source authoring shape compiles + QAs (fixture: a hand-written discussion `@source` + derived concepts + cross-source relations → `compile` ok, `qa` 100%, cross-source edges present in the view-model). `ask_user_questions` parsing (`AskUserQuestionsInput` → question set). The answer round-trip resolution logic (handler promise resolves on a posted answer), with a mock.
- **Manual / stub:** a `MINDGRAPH_STUB_DEEPEN` path that emits one scripted `question` event and, on answer, writes a tiny valid discussion source — so the whole UI flow (cards → answer → woven growth → readable discussion) is demoable without the API.
- **Real:** one credentialed end-to-end deepen producing a real discussion source + grounded derived concepts + cross-source relations, QA 100%.

## Non-goals (v1)
- The discussion is **not** a separate file or a free-form artifact — it's a woven `@source` in the same document (the chosen model).
- No editing of the discussion prose by hand in the UI (read-only; re-deepen to extend).
- No multi-concept / cross-anchor conversations in one thread (one anchor per thread).
- No persistence of the live chat transcript beyond the compiled discussion source (the compiled discussion *is* the record).

## Risks
- **The question round-trip** (tool handler pausing for a client answer over SSE+POST) is the trickiest mechanic; prototype it first behind the stub before the real agent.
- **QA on derived concepts** depends on the agent writing the concept's label/alias verbatim into the discussion blocks. The system prompt must enforce this (same rule the skill already states); otherwise QA fails and the turn is rejected (safe, but frustrating). Mitigate with a clear protocol + the stub test.
- **Multi-source view-model rendering** must handle several sources and cross-source edges cleanly; verify early.
- **Discussion sprawl** — many deepens grow the `.md` with many discussion sources. Acceptable for a living document; a future "archive/collapse old discussions" affordance is out of scope.
- **Cost/latency** — multi-turn + web search increase token use and time; the heartbeat/streaming UX mitigates the *feel*, not the cost.

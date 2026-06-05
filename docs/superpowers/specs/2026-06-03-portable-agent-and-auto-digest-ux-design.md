# Portable agent and auto-digest UX design

- **Status:** approved through brainstorm
- **Date:** 2026-06-03
- **Scope:** Product/user-journey architecture for making mindgraph cohesive across CLI, MCP-capable agent apps, and a future hosted web app.

## Problem

mindgraph currently has a strong internal operating model: an LLM agent operates the CLI, writes a `.mindgraph.json` artifact, and the human reads the result in the browser UI. That works well in Claude Code/pi-style environments, but the product journey is incomplete for broader use:

- Claude Desktop and other apps need a non-shell interface.
- A hosted web app needs a guided flow where the user can bring an API key and run digestion without a coding-agent shell.
- The current CLI exposes many low-level document operations, which are powerful but not yet cohesive as a product journey.

The core question is where the user <> LLM interface lives when mindgraph ships as a product. The answer should not be one fixed surface. mindgraph should expose a stable journey layer that multiple LLM-capable environments can use.

## Design goals

1. **Preserve the CLI as canonical actuator.** The CLI remains durable, local, scriptable, testable, and ideal for Claude Code/pi/Codex.
2. **Add MCP as an ergonomic adapter.** Claude Desktop and other MCP clients should operate mindgraph through tools/resources/prompts without shell choreography.
3. **Prepare for hosted web.** The hosted app should use the same conceptual operations, with a user-provided model API key.
4. **Stay model agnostic.** mindgraph should not be architected around one vendor. Model invocation must sit behind provider adapters, and external-agent operation must remain a first-class path.
5. **Keep one artifact contract.** Both agent-operated and built-in auto-digest paths produce the same `.mindgraph.json` document and use the same reading UI.
6. **Avoid duplicated product logic.** CLI and MCP should expose shared core operations rather than separately reimplementing workflows.

## Product architecture

mindgraph becomes three layers:

1. **Artifact layer**
   - Canonical `.mindgraph.json` document.
   - Existing schema, validation, document mutation, view-model, and browser reader.

2. **Journey operation layer**
   - A small set of high-level operations that express the product workflow:
     - initialize/open workspace
     - import or prepare source
     - build starter timeline
     - generate or accept digest plan
     - apply digest plan
     - evaluate digest quality
     - inspect/refine graph
     - open viewer
   - These operations call existing `src/core/` modules and CLI primitives where appropriate.

3. **Interface adapters**
   - **CLI adapter:** human/agent-callable commands such as `mindgraph digest`, `mindgraph source import`, `mindgraph digest evaluate`, `mindgraph view`.
   - **MCP adapter:** tools/resources/prompts wrapping the same journey operations for Claude Desktop and other apps.
   - **Hosted web adapter:** later browser flow using the same operations and provider model, with user-supplied API keys.

## Two production paths

### Path A — agent-operated digest

The user works in an LLM environment such as Claude Code, pi, Codex, or Claude Desktop.

Flow:

1. User gives a source: YouTube URL, article URL, local transcript, notes, or later PDFs.
2. The external LLM calls mindgraph CLI/MCP tools.
3. mindgraph imports/prepares source and builds a starter timeline.
4. The external LLM reads frames and source text, creates a structured `DigestPlan`, and applies it.
5. mindgraph evaluates quality, validates the document, and opens the viewer.
6. User reviews and asks the LLM to refine weak areas.

Properties:

- No model API key is required inside mindgraph.
- The external agent performs semantic reasoning.
- Best for local workspaces, expert curation, iterative refinement, and environments where the LLM already has filesystem/tool access.

### Path B — built-in auto-digest

The user works through a guided CLI command or hosted web app.

Flow:

1. User provides a source and chooses/configures a model provider.
2. User supplies an API key locally or in the hosted app session.
3. mindgraph imports/prepares source and builds a starter timeline.
4. mindgraph orchestrates prompt calls through a provider adapter.
5. The provider returns a structured `DigestPlan`.
6. mindgraph applies the plan, evaluates quality, validates the document, and opens the viewer.
7. User can continue with manual/agent-assisted refinement.

Properties:

- Same artifact and viewer as Path A.
- Same `DigestPlan` format as Path A.
- Best for non-coding users, hosted web, and repeatable batch processing.
- Provider integration is model agnostic: Anthropic, OpenAI, Gemini, local models, or future providers.

## Shared intermediate: `DigestPlan`

`DigestPlan` is the boundary between semantic reasoning and deterministic document mutation.

It should include:

- atomic concept upserts
- clustered concept upserts and membership updates
- relation upserts, including provenance (`source` or `inferred`)
- frame activation updates for foreground/background concepts and relations
- macro frame/chapter definitions
- ignored spans or weakly-grounded spans
- optional evaluation notes or confidence metadata

Existing `digest apply` already points in this direction. The design makes it the central cross-interface object.

Rules:

- Both Path A and Path B produce `DigestPlan`.
- Applying a plan is deterministic and idempotent where possible.
- Evaluation happens after application and produces machine-readable quality signals.
- Plans should be inspectable before application when the interface supports review.

## CLI design direction

The CLI should evolve from only low-level document operations toward a two-level surface:

### Low-level actuator commands

Keep existing commands:

- `concept upsert`
- `relation upsert`
- `frame set-activations`
- `frame merge`
- `stats recompute`
- `digest apply`
- `digest evaluate`

These remain useful for agents and tests.

### High-level journey commands

Add cohesive commands over time:

- `mindgraph source import <source>`
  - Accepts YouTube URL, article URL, or local file.
  - Produces a local prepared text/transcript artifact and source metadata.

- `mindgraph digest <source> -o <document>`
  - Runs source preparation and starter timeline build.
  - In agent-operated mode, emits a clear next-step report for the LLM to create/apply a `DigestPlan`.
  - In auto mode, calls a configured provider to generate a plan.

- `mindgraph digest plan <document>`
  - Optional future command for built-in provider generation of a plan without applying it.

- `mindgraph digest apply <document> --plan <plan-file>`
  - Existing command, formalized as a central operation.

- `mindgraph digest evaluate <document> --json`
  - Existing command, used by both CLI and MCP flows.

- `mindgraph view <document>`
  - Existing viewer command, remains the handoff into reading/exploration.

The first implementation slice should prefer agent-operated journey improvements while reserving flags/configuration for auto-digest later.

## MCP design direction

The MCP server should expose product-level tools rather than a one-to-one mirror of every low-level CLI command.

Initial tools:

- `mindgraph_list_documents`
  - Lists known `.mindgraph.json` files in a workspace.

- `mindgraph_import_source`
  - Imports/prepares a source and returns metadata plus local paths.

- `mindgraph_build_timeline`
  - Builds starter timeline document from prepared text/transcript.

- `mindgraph_apply_digest_plan`
  - Applies a structured `DigestPlan` to a document.

- `mindgraph_evaluate_digest`
  - Returns JSON quality signals.

- `mindgraph_inspect_document`
  - Returns summary counts, frame/concept overview, and validation state.

- `mindgraph_open_viewer`
  - Starts/opens the local viewer for a document.

Useful resources:

- document summaries
- frame slices
- concept lists
- digest evaluation reports
- prompt templates for external agents to produce valid `DigestPlan` JSON

Principles:

- MCP should call shared operations or CLI-equivalent internals, not fork document logic.
- MCP responses should be structured and parseable.
- MCP should be safe around filesystem scope: operate inside an explicit workspace root.
- MCP should support the external-agent path without requiring model API keys.

## Model-provider design direction

For built-in auto-digest, model calls should sit behind a provider interface.

Conceptual provider contract:

```ts
interface ModelProvider {
  id: string
  completeJson(request: {
    system: string
    prompt: string
    schemaName: string
    schema: unknown
    apiKeyRef?: string
    model?: string
  }): Promise<unknown>
}
```

Provider configuration should support:

- provider id (`anthropic`, `openai`, `gemini`, `local`, etc.)
- model name
- API key from environment variable, local config, or hosted-session secret input
- request limits and timeout

The CLI/MCP must not hard-code one provider as the architecture. A default can exist later, but the boundary remains model agnostic.

## Hosted web design direction

The hosted site is a later adapter, not the first substrate.

Expected flow:

1. User opens web app.
2. User pastes source URL or uploads/pastes text.
3. User chooses provider/model and enters API key for the session.
4. App imports/prepares source.
5. App runs auto-digest through provider adapter.
6. App shows digest progress and evaluation report.
7. App opens the graph/reader.
8. User asks exploratory/refinement questions in the reader.

Storage can be decided later. The important near-term constraint is that the hosted app should speak the same journey language and produce the same artifact.

## Reader/exploration implication

The reading UI remains the human-facing consumer surface, but should eventually gain an assistant affordance:

- ask why two concepts are connected
- show source evidence for a concept/relation
- jump to frames where a concept peaks
- explain weakly grounded or inferred edges
- request graph refinements

This assistant can use MCP/journey operations in local environments or hosted provider calls in the web app.

## Recommended implementation sequence

1. **Define and document the journey operations and `DigestPlan` contract.**
2. **Improve CLI around source import and high-level digest orchestration for agent-operated use.**
3. **Add MCP server wrapping the shared operations.**
4. **Add provider adapter seam without committing to a full auto-digest hosted workflow.**
5. **Implement built-in auto-digest for CLI first, using the provider adapter.**
6. **Bring the same flow into the hosted web app.**

This sequence keeps current strengths useful while making the product architecture coherent.

## Non-goals for the first implementation slice

- Full hosted web app deployment.
- Full browser-based source storage/account system.
- Audio transcription from raw audio/video without a transcript provider.
- Perfect one-click auto-digest quality across all source types.
- Replacing the low-level CLI commands.

## Success criteria

The design succeeds if:

- A coding agent can use high-level CLI commands without memorizing the full low-level choreography.
- Claude Desktop can operate mindgraph through MCP.
- Both CLI/MCP agent flows and future hosted auto-digest produce the same `.mindgraph.json` artifact.
- The semantic reasoning step is cleanly represented as a structured `DigestPlan`.
- Model providers are swappable and optional.
- The UI remains a reader/explorer for the same durable document.

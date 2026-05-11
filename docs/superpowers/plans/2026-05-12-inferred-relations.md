# Inferred Relations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the producer agent add common-knowledge connections the source assumed but didn't state (e.g. "Dreyfus interprets Heidegger"), rendered distinctly so the user can tell at a glance what came from the speaker vs the LLM.

**Architecture:** One optional `provenance: 'source' | 'inferred'` field on relation entities (default missing ≡ `'source'`). The CLI exposes a `--provenance` flag on `relation upsert`. The view-model carries it onto `GraphEdgeVM` (only — not `RelationVM`). The UI renders inferred edges dashed; layout treats them identically to source relations. SKILL.md adds a kind-based heuristic for when the agent should reach for `inferred`. Five focused commits; smoke test extended to exercise the path end-to-end.

**Tech Stack:** Node 18+ / Bun (`bun` is the canonical runtime per CLAUDE.md, `node` works equivalently for everything in this plan). Zero new dependencies. The producer side is plain ES modules under `src/`; the consumer side is vanilla ES modules under `ui/` running on a single HTML5 Canvas. No bundler, no UI framework.

**Spec reference:** `docs/superpowers/specs/2026-05-12-inferred-relations-design.md` (commit `14b0cc5`). Read it before starting.

**TDD adaptation note.** This project has no unit-test framework — verification is via the integration smoke test (`npm run test:smoke`), the VM driver (`npm run vm:example`), and manual browser inspection. Each producer-side task therefore writes the smoke-test extension FIRST, runs it to see it fail, then implements the change until it passes. UI changes are syntax-checked + verified in the browser.

---

## File Structure

| File | Purpose | Touched in task |
|---|---|---|
| `src/core/schema.js` | Validation — accept `provenance` literal on relations | 1 |
| `src/core/document.js` | `upsertRelation` accepts `provenance` argument | 1 |
| `src/cli/index.js` | CLI `--provenance` flag, help text, confirmation | 1 |
| `package.json` | `test:smoke` and `test:smoke:node` exercise the new flag; version bump | 1, 5 |
| `src/view-model/buildMindgraphViewModel.js` | `buildGraphVM` threads provenance to `GraphEdgeVM` | 2 |
| `src/view-model/example.js` | Print first edge so the VM driver surfaces the shape regression | 2 |
| `docs/ui-view-model-spec.md` | Document `provenance?` field on `GraphEdgeVM` interface | 2 |
| `ui/draw.js` | `drawEdges` applies dashed line for inferred edges | 3 |
| `skills/mindgraph/SKILL.md` | "On inferred relations" heuristic block, command-table flag, install command bump | 4, 5 |
| `README.md` | Mention `--provenance` in actuator-commands list | 4 |

No file is touched in more than two tasks; no task touches more than four files. Each file's role is contained.

---

## Task 1: feat(core+cli): relation upsert accepts --provenance

**Files:**
- Modify: `package.json` (extend `test:smoke` and `test:smoke:node`)
- Modify: `src/core/schema.js` (validate `provenance` literal)
- Modify: `src/core/document.js` (`upsertRelation` accepts `provenance`)
- Modify: `src/cli/index.js` (parse `--provenance` flag, help text, confirmation)

This is the producer-side change. We write the smoke-test extension FIRST so the existing CLI fails (silently — it'll run but the produced JSON won't contain `provenance: "inferred"`). A `grep` step on the produced JSON gives us the failing check. Then we implement schema validation, `upsertRelation` handling, and CLI flag parsing until the grep passes.

- [ ] **Step 1: Extend `test:smoke` (Bun) with the new concept + inferred relation + grep check**

Open `package.json`. Find the `"test:smoke"` line.

Insert a `john-vervaeke` concept upsert AFTER the existing `--id wisdom` concept upsert, and a `vervaeke-coined-meaning-crisis` relation upsert with `--provenance inferred` AFTER the existing `--id responds-to` relation upsert. Append a `grep -q '"provenance": "inferred"'` check at the very end of the chain so the script exits non-zero if the JSON doesn't contain the field.

The full replacement for the `"test:smoke"` value:

```json
"test:smoke": "bun ./src/cli/index.js --help && rm -f examples/out/empty.mindgraph.json examples/out/awakening.mindgraph.json && bun ./src/cli/index.js init examples/out/empty.mindgraph.json && bun ./src/cli/index.js validate examples/out/empty.mindgraph.json && bun ./src/cli/index.js ingest transcript examples/awakening.sample.transcript.txt -o examples/out/awakening.mindgraph.json --title \"Awakening Sample\" && bun ./src/cli/index.js concept upsert examples/out/awakening.mindgraph.json --id meaning-crisis --label \"Meaning Crisis\" --first-seen-at 0 && bun ./src/cli/index.js concept upsert examples/out/awakening.mindgraph.json --id wisdom --label \"Wisdom\" --first-seen-at 42 && bun ./src/cli/index.js concept upsert examples/out/awakening.mindgraph.json --id john-vervaeke --label \"John Vervaeke\" --first-seen-at 0 && bun ./src/cli/index.js relation upsert examples/out/awakening.mindgraph.json --id responds-to --from wisdom --to meaning-crisis --type addresses && bun ./src/cli/index.js relation upsert examples/out/awakening.mindgraph.json --id vervaeke-coined-meaning-crisis --from john-vervaeke --to meaning-crisis --type coined-term --provenance inferred && bun ./src/cli/index.js frame set-activations examples/out/awakening.mindgraph.json --level micro --index 0 --foreground-json '[{\"id\":\"meaning-crisis\",\"weight\":1,\"mode\":\"explicit\"}]' && bun ./src/cli/index.js frame set-activations examples/out/awakening.mindgraph.json --level micro --index 2 --foreground-json '[{\"id\":\"wisdom\",\"weight\":0.9,\"mode\":\"explicit\"},{\"id\":\"meaning-crisis\",\"weight\":0.7,\"mode\":\"explicit\"}]' --relations-json '[{\"id\":\"responds-to\",\"weight\":0.9}]' && bun ./src/cli/index.js frame merge examples/out/awakening.mindgraph.json --from micro --to meso --start-index 0 --end-index 2 --title \"Opening Problem Space\" && bun ./src/cli/index.js frame backfill-activations examples/out/awakening.mindgraph.json --from meso --to micro && bun ./src/cli/index.js stats recompute examples/out/awakening.mindgraph.json && bun ./src/cli/index.js validate examples/out/awakening.mindgraph.json && bun ./src/cli/index.js inspect examples/out/awakening.mindgraph.json && grep -q '\"provenance\": \"inferred\"' examples/out/awakening.mindgraph.json"
```

Apply the same set of insertions to the `"test:smoke:node"` value (it's identical except `bun ./src/cli/index.js` is replaced with `node ./src/cli/index.js`).

- [ ] **Step 2: Run the smoke test and verify it fails on the grep**

Run: `npm run test:smoke`

Expected: the chain progresses through ingest, both upserts, and validate. The final `grep` step exits non-zero because `examples/out/awakening.mindgraph.json` doesn't contain `"provenance": "inferred"` (the CLI silently ignores the unrecognized flag today). The npm script reports a non-zero exit code.

If the chain fails earlier (e.g. on validate), inspect the failure — the current CLI parses but ignores the flag, so it should *not* fail validation. If it does, the cause must be diagnosed before continuing.

- [ ] **Step 3: Add provenance validation to `src/core/schema.js`**

Open `src/core/schema.js`. Find the relation-validation loop (around line 132):

```js
  const relationIds = new Set();
  for (const [i, relation] of (doc.relations ?? []).entries()) {
    if (!relation?.id) errors.push(`relations[${i}].id is required`);
    if (!relation?.from) errors.push(`relations[${i}].from is required`);
    if (!relation?.to) errors.push(`relations[${i}].to is required`);
    if (relation?.from && !conceptIds.has(relation.from)) errors.push(`relations[${i}].from references missing concept '${relation.from}'`);
    if (relation?.to && !conceptIds.has(relation.to)) errors.push(`relations[${i}].to references missing concept '${relation.to}'`);
    if (relation?.id) relationIds.add(relation.id);
  }
```

Insert a provenance check after the `relation.to` reference check, before the `relationIds.add` line:

```js
  const relationIds = new Set();
  for (const [i, relation] of (doc.relations ?? []).entries()) {
    if (!relation?.id) errors.push(`relations[${i}].id is required`);
    if (!relation?.from) errors.push(`relations[${i}].from is required`);
    if (!relation?.to) errors.push(`relations[${i}].to is required`);
    if (relation?.from && !conceptIds.has(relation.from)) errors.push(`relations[${i}].from references missing concept '${relation.from}'`);
    if (relation?.to && !conceptIds.has(relation.to)) errors.push(`relations[${i}].to references missing concept '${relation.to}'`);
    if (relation?.provenance != null && relation.provenance !== 'source' && relation.provenance !== 'inferred') {
      errors.push(`relations[${i}].provenance must be 'source' or 'inferred' when present`);
    }
    if (relation?.id) relationIds.add(relation.id);
  }
```

- [ ] **Step 4: Update `upsertRelation` in `src/core/document.js` to accept and write provenance**

Open `src/core/document.js`. Replace the entire `upsertRelation` function (currently lines 51-76):

```js
export function upsertRelation(doc, { id, from, to, type, label, description, meta }) {
  if (!id) throw new Error('relation id is required');
  if (!from) throw new Error('relation from is required');
  if (!to) throw new Error('relation to is required');
  if (!type) throw new Error('relation type is required');

  const relations = doc.relations ?? (doc.relations = []);
  const existing = relations.find((relation) => relation.id === id);
  const next = {
    id,
    from,
    to,
    type,
    ...(label != null ? { label } : {}),
    ...(description != null ? { description } : {}),
    ...(meta != null ? { meta } : {}),
  };

  if (existing) {
    Object.assign(existing, next);
    return existing;
  }

  relations.push(next);
  return next;
}
```

With:

```js
export function upsertRelation(doc, { id, from, to, type, label, description, meta, provenance }) {
  if (!id) throw new Error('relation id is required');
  if (!from) throw new Error('relation from is required');
  if (!to) throw new Error('relation to is required');
  if (!type) throw new Error('relation type is required');
  if (provenance != null && provenance !== 'source' && provenance !== 'inferred') {
    throw new Error("relation provenance must be 'source' or 'inferred' when provided");
  }

  const relations = doc.relations ?? (doc.relations = []);
  const existing = relations.find((relation) => relation.id === id);
  const next = {
    id,
    from,
    to,
    type,
    ...(label != null ? { label } : {}),
    ...(description != null ? { description } : {}),
    ...(meta != null ? { meta } : {}),
    ...(provenance === 'inferred' ? { provenance: 'inferred' } : {}),
  };

  if (existing) {
    Object.assign(existing, next);
    // Explicit 'source' on an upsert strips any pre-existing provenance key — caller is
    // saying "set this relation back to source." Implicit (provenance === undefined) leaves
    // the existing value alone for idempotency.
    if (provenance === 'source' && existing.provenance != null) {
      delete existing.provenance;
    }
    return existing;
  }

  relations.push(next);
  return next;
}
```

- [ ] **Step 5: Add `--provenance` flag parsing in `src/cli/index.js`**

Open `src/cli/index.js`. Find the `relation upsert` block (currently starting around line 389):

```js
if (command === 'relation' && subcommand === 'upsert') {
  const [documentFile, ...flagArgs] = rest;
  if (!documentFile) {
    console.error('Missing document file path.');
    process.exit(1);
  }

  const flags = parseFlags(flagArgs);
  const id = requireFlag(flags, '--id');
  const from = requireFlag(flags, '--from');
  const to = requireFlag(flags, '--to');
  const type = requireFlag(flags, '--type');
  const label = requireFlag(flags, '--label');
  const description = requireFlag(flags, '--description');
  const metaJson = requireFlag(flags, '--meta-json');

  const doc = readJson(documentFile);
  upsertRelation(doc, {
    id,
    from,
    to,
    type,
    label,
    description,
    meta: metaJson ? parseJsonValue(metaJson, 'meta JSON') : undefined,
  });
  validateOrExit(doc, documentFile);
  writeJson(documentFile, doc);
  console.log(`Upserted relation '${id}'.`);
  process.exit(0);
}
```

Replace with:

```js
if (command === 'relation' && subcommand === 'upsert') {
  const [documentFile, ...flagArgs] = rest;
  if (!documentFile) {
    console.error('Missing document file path.');
    process.exit(1);
  }

  const flags = parseFlags(flagArgs);
  const id = requireFlag(flags, '--id');
  const from = requireFlag(flags, '--from');
  const to = requireFlag(flags, '--to');
  const type = requireFlag(flags, '--type');
  const label = requireFlag(flags, '--label');
  const description = requireFlag(flags, '--description');
  const metaJson = requireFlag(flags, '--meta-json');
  const provenance = requireFlag(flags, '--provenance');

  const doc = readJson(documentFile);
  upsertRelation(doc, {
    id,
    from,
    to,
    type,
    label,
    description,
    meta: metaJson ? parseJsonValue(metaJson, 'meta JSON') : undefined,
    provenance,
  });
  validateOrExit(doc, documentFile);
  writeJson(documentFile, doc);
  console.log(`Upserted relation '${id}'${provenance === 'inferred' ? ' (inferred)' : ''}.`);
  process.exit(0);
}
```

- [ ] **Step 6: Update the help text in `src/cli/index.js`**

In the same file, find the `printHelp` block (around line 28):

```
  mindgraph relation upsert <document-file> --id <id> --from <concept-id> --to <concept-id> --type <type>
```

Replace with:

```
  mindgraph relation upsert <document-file> --id <id> --from <concept-id> --to <concept-id> --type <type> [--provenance source|inferred]
```

Then find the `Commands:` summary lines (around line 47):

```
  relation upsert        Create or update a relation deterministically
```

Replace with:

```
  relation upsert        Create or update a relation deterministically (use --provenance inferred for common-knowledge connections the speaker assumed)
```

- [ ] **Step 7: Run the smoke test and verify it passes**

Run: `npm run test:smoke`

Expected: the chain completes cleanly. The final `grep` finds `"provenance": "inferred"` in `examples/out/awakening.mindgraph.json` and exits zero. `npm run test:smoke` reports success.

If it still fails: inspect `examples/out/awakening.mindgraph.json` and look for the `vervaeke-coined-meaning-crisis` relation. It should have `"provenance": "inferred"` as a sibling field of `type`. The other relation (`responds-to`) should have no `provenance` field at all (default-omitted-for-clean-diffs is part of the contract).

- [ ] **Step 8: Run the Node variant of the smoke test**

Run: `npm run test:smoke:node`

Expected: same success. This catches any Bun-only behavior we accidentally relied on.

- [ ] **Step 9: Manual negative test — invalid provenance value**

Run:

```bash
bun ./src/cli/index.js relation upsert examples/out/awakening.mindgraph.json \
  --id responds-to --from wisdom --to meaning-crisis --type addresses \
  --provenance bogus
```

Expected: the CLI exits non-zero with stderr containing `relation provenance must be 'source' or 'inferred' when provided` (thrown by `upsertRelation`). The `examples/out/awakening.mindgraph.json` file is unchanged on disk (the throw happens before `writeJson`).

If `node` is being used instead of Bun, substitute `node` for `bun` in the command.

After confirming, run `npm run test:smoke` once more to regenerate the canonical sample file, since the negative test exercised the file in place even though the throw should have left it intact. Re-run is cheap and resets state cleanly.

- [ ] **Step 10: Manual negative test — explicit 'source' strips a pre-existing inferred marker**

Run:

```bash
bun ./src/cli/index.js relation upsert examples/out/awakening.mindgraph.json \
  --id vervaeke-coined-meaning-crisis \
  --from john-vervaeke --to meaning-crisis --type coined-term \
  --provenance source
```

Then:

```bash
grep -c '"provenance": "inferred"' examples/out/awakening.mindgraph.json
```

Expected: the second command prints `0` (no inferred relations remain in the document). The strip-on-explicit-source behavior worked.

Then run `npm run test:smoke` once more to regenerate the sample with the inferred relation back in place.

- [ ] **Step 11: Commit**

```bash
git add package.json src/core/schema.js src/core/document.js src/cli/index.js
git commit -m "$(cat <<'EOF'
feat(core+cli): relation upsert accepts --provenance

Adds optional 'source' | 'inferred' provenance on relation entities,
exposed via mindgraph relation upsert --provenance. Missing key ≡
source for legacy-document compatibility. Smoke test extended to
exercise the flag end-to-end.
EOF
)"
```

---

## Task 2: feat(view-model): expose relation provenance on GraphEdgeVM

**Files:**
- Modify: `src/view-model/buildMindgraphViewModel.js` (`buildGraphVM` threads provenance to edges)
- Modify: `src/view-model/example.js` (print first edge so the shape surfaces)
- Modify: `docs/ui-view-model-spec.md` (document the `provenance?` field on `GraphEdgeVM`)

Provenance flows from `document.relations[i].provenance` → `GraphEdgeVM.provenance`. `RelationVM` does NOT carry the field (per the spec's "inspector parked" decision); we pass the raw relations array into `buildGraphVM` as a new fourth argument so it can look up provenance without RelationVM mediating.

Verification: extend `example.js` to print the first edge, then run `npm run vm:example` against the smoke-test output (`examples/out/awakening.mindgraph.json`, which contains exactly one inferred relation as of Task 1) and grep for `"provenance": "inferred"`.

- [ ] **Step 1: Extend `src/view-model/example.js` to print the first edge**

Open `src/view-model/example.js`. Find the `sampleGraph` object in the final `console.log` (around line 49):

```js
  sampleGraph: {
    nodeCount: vm.graph.nodes.length,
    edgeCount: vm.graph.edges.length,
    firstCluster: vm.concepts.clustered[0],
  },
```

Replace with:

```js
  sampleGraph: {
    nodeCount: vm.graph.nodes.length,
    edgeCount: vm.graph.edges.length,
    firstCluster: vm.concepts.clustered[0],
    // Surface a sample edge so a regression in buildGraphVM's edge mapping
    // (including provenance threading) shows up in vm:example output.
    firstEdge: vm.graph.edges[0],
  },
```

- [ ] **Step 2: Run vm:example against the awakening sample and verify provenance is absent**

Run: `node ./src/view-model/example.js examples/out/awakening.mindgraph.json | grep -c '"provenance"'`

Expected: prints `0`. The edge VM hasn't been wired yet, so even though the document contains an inferred relation, no edge in the VM surfaces provenance.

If `examples/out/awakening.mindgraph.json` doesn't exist, run `npm run test:smoke` first to produce it.

- [ ] **Step 3: Update `buildGraphVM` to thread provenance onto edges**

Open `src/view-model/buildMindgraphViewModel.js`. Find `buildGraphVM` (around line 307):

```js
function buildGraphVM(conceptsVM, relationsVM, framesVM) {
  const nodes = [...conceptsVM.clustered, ...conceptsVM.atomic].map((concept) => ({
    id: concept.id,
    label: concept.label,
    level: concept.level,
    parentIds: concept.parentIds,
    childIds: concept.childIds,
    stats: concept.stats,
    regionKey: concept.level === 'atomic' ? concept.parentIds?.[0] : concept.id,
    visualWeight: concept.stats?.peakActivation ?? 0.5,
    degree: 0,
  }));

  const edges = relationsVM.all.map((relation) => ({
    id: relation.id,
    from: relation.from,
    to: relation.to,
    type: relation.type,
    label: relation.label,
    visualWeight: 0.5,
  }));
```

Replace with:

```js
function buildGraphVM(conceptsVM, relationsVM, framesVM, rawRelations) {
  const nodes = [...conceptsVM.clustered, ...conceptsVM.atomic].map((concept) => ({
    id: concept.id,
    label: concept.label,
    level: concept.level,
    parentIds: concept.parentIds,
    childIds: concept.childIds,
    stats: concept.stats,
    regionKey: concept.level === 'atomic' ? concept.parentIds?.[0] : concept.id,
    visualWeight: concept.stats?.peakActivation ?? 0.5,
    degree: 0,
  }));

  // Build a quick id → provenance lookup from the raw document relations.
  // RelationVM intentionally does not carry provenance (the inspector is parked
  // for v0.5.0); GraphEdgeVM is the only consumer-side surface that exposes it.
  const provenanceById = {};
  for (const rel of rawRelations) {
    if (rel?.id && rel.provenance === 'inferred') provenanceById[rel.id] = 'inferred';
  }

  const edges = relationsVM.all.map((relation) => ({
    id: relation.id,
    from: relation.from,
    to: relation.to,
    type: relation.type,
    label: relation.label,
    visualWeight: 0.5,
    ...(provenanceById[relation.id] === 'inferred' ? { provenance: 'inferred' } : {}),
  }));
```

- [ ] **Step 4: Update the call site of `buildGraphVM` to pass the raw relations**

In the same file, find `buildMindgraphViewModel` (around line 531):

```js
export function buildMindgraphViewModel(document) {
  const transcript = buildTranscriptVM(document);
  const concepts = buildConceptsVM(document);
  const relations = buildRelationsVM(document);
  const frames = buildFramesVM(document, concepts, relations);
  assignFrameAncestry(frames);
  const graph = buildGraphVM(concepts, relations, frames);
```

Change the `buildGraphVM` call to pass `document.relations`:

```js
  const graph = buildGraphVM(concepts, relations, frames, document.relations ?? []);
```

- [ ] **Step 5: Re-run vm:example and verify provenance is present**

Run: `node ./src/view-model/example.js examples/out/awakening.mindgraph.json | grep '"provenance"'`

Expected: the `firstEdge` block prints with a `"provenance": "inferred"` line (or, if the first edge happens to be `responds-to` rather than `vervaeke-coined-meaning-crisis`, the grep prints nothing — see below).

The order of `vm.graph.edges` mirrors `document.relations` order, which is upsert order. The smoke test upserts `responds-to` before `vervaeke-coined-meaning-crisis`, so `firstEdge` is `responds-to` (source — no provenance key). The grep returns 0.

To verify the inferred relation specifically, run:

```bash
node ./src/view-model/example.js examples/out/awakening.mindgraph.json | head -200
```

And scan the `firstEdge` block. `responds-to` should NOT contain a provenance key (correct — source is the implicit default).

Then run a more direct verification:

```bash
node -e "import('./src/view-model/buildMindgraphViewModel.js').then(({ buildMindgraphViewModel }) => { const doc = JSON.parse(require('fs').readFileSync('examples/out/awakening.mindgraph.json', 'utf8')); const vm = buildMindgraphViewModel(doc); const inferred = vm.graph.edges.find((e) => e.id === 'vervaeke-coined-meaning-crisis'); console.log(JSON.stringify(inferred, null, 2)); })"
```

Expected: prints the edge object with `"provenance": "inferred"` present. If the field is missing or the script errors, the threading is broken — diagnose before continuing.

- [ ] **Step 6: Update `docs/ui-view-model-spec.md` to document the new field**

Open `docs/ui-view-model-spec.md`. Find the `GraphEdgeVM` interface block (around line 314):

```
### Graph edges
```ts
interface GraphEdgeVM {
  id: string
  from: string
  to: string
  type: string
  label?: string
  visualWeight: number
}
```
```

Replace with:

````
### Graph edges
```ts
interface GraphEdgeVM {
  id: string
  from: string
  to: string
  type: string
  label?: string
  visualWeight: number
  provenance?: 'source' | 'inferred'   // missing key ≡ source
}
```

### Provenance

The optional `provenance` field distinguishes source-derived edges (the speaker asserted the relation) from LLM-inferred edges (the agent added the relation from world knowledge — typically biographical or attributional connections the speaker assumed the audience knew). Missing key ≡ `'source'`; only `'inferred'` is ever written. The UI renders inferred edges as dashed lines (`ctx.setLineDash([4, 3])`); layout treats both kinds identically. `RelationVM` does *not* carry this field — the inspector is intentionally provenance-blind in v0.5.0; the canvas dash is the only user surface. See `docs/superpowers/specs/2026-05-12-inferred-relations-design.md`.
````

- [ ] **Step 7: Commit**

```bash
git add src/view-model/buildMindgraphViewModel.js src/view-model/example.js docs/ui-view-model-spec.md
git commit -m "$(cat <<'EOF'
feat(view-model): expose relation provenance on GraphEdgeVM

buildGraphVM accepts the raw relations array as a fourth argument and
threads provenance === 'inferred' onto matching edges. RelationVM is
unchanged — the inspector is intentionally provenance-blind for v0.5.0.
vm:example surfaces the first edge so the shape regression visible.
EOF
)"
```

---

## Task 3: feat(ui): render inferred relations as dashed edges

**Files:**
- Modify: `ui/draw.js` (`drawEdges` applies `setLineDash` for inferred edges)

The change is local to one loop in one function. Same color, same alpha curve, same width curve — only the dash differs. Reset `setLineDash([])` after every successful stroke (defensive, immune to ordering bugs). Verify by syntax-check + manual browser load of the smoke-test output.

- [ ] **Step 1: Modify `drawEdges` in `ui/draw.js`**

Open `ui/draw.js`. Find the `drawEdges` function (around line 53) and the stroke section at the end of its loop (around lines 90-99):

```js
    const baseAlpha = touchesSelection || isActive ? 0.95 : 0.16;
    ctx.strokeStyle = `rgba(218, 184, 116, ${baseAlpha * animOpacity})`;
    ctx.lineWidth = touchesSelection ? 1.4 : isActive ? 1.0 : 0.6;

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
}
```

Replace with:

```js
    const baseAlpha = touchesSelection || isActive ? 0.95 : 0.16;
    ctx.strokeStyle = `rgba(218, 184, 116, ${baseAlpha * animOpacity})`;
    ctx.lineWidth = touchesSelection ? 1.4 : isActive ? 1.0 : 0.6;

    // Inferred edges render dashed so the user can tell at a glance which
    // relations were added by the agent from world knowledge vs derived from
    // the source. Same color, alpha curve, and width curve as source edges —
    // only the dash differs. Reset every iteration (defensive: no leak even
    // if a future change adds a `continue` between setLineDash and stroke).
    if (edge.provenance === 'inferred') ctx.setLineDash([4, 3]);

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    ctx.setLineDash([]);
  }
}
```

- [ ] **Step 2: Syntax-check the UI**

Run: `npm run ui:check`

Expected: exits zero, no syntax errors.

If `ui:check` reports an error, the most likely cause is a stray bracket from the edit — diff against `git diff ui/draw.js` to confirm the structure.

- [ ] **Step 3: Regenerate the smoke-test output and verify it contains the inferred relation**

Run: `npm run test:smoke`

Expected: succeeds (Task 1's grep step confirms the inferred relation is in `examples/out/awakening.mindgraph.json`).

- [ ] **Step 4: Open the smoke-test output in the browser**

Run in a background-friendly shell:

```bash
bun ./src/cli/index.js view examples/out/awakening.mindgraph.json &
```

Open `http://127.0.0.1:4173` in a browser. The "Awakening Sample" mindgraph should render with three atomic concepts (`meaning-crisis`, `wisdom`, `john-vervaeke`) and two relations (`responds-to`, `vervaeke-coined-meaning-crisis`).

If the UI fails to load, check the dev-server console output for the error.

- [ ] **Step 5: Manual verification — dashed inferred edge at passive alpha**

In the browser, with no concept selected, observe the two edges. Expected:

- `responds-to` (wisdom ↔ meaning-crisis) renders as a **solid** warm-gold thin line at passive alpha.
- `vervaeke-coined-meaning-crisis` (john-vervaeke ↔ meaning-crisis) renders as a **dashed** warm-gold thin line at passive alpha (same color, same width as the source edge — only the dash differs).

If the dash gestalt blurs into "thin broken gold line" (you can't clearly see the gaps), proceed to Step 6 to tune. Otherwise skip Step 6.

- [ ] **Step 6: (Conditional) Tune dash/width/alpha if the passive-alpha dash reads poorly**

Try tunings in this priority order, one at a time, re-running Step 2 (`ui:check`) and Step 5 (manual eyeball) after each:

1. Dash pattern: `ctx.setLineDash([4, 3])` → `ctx.setLineDash([5, 4])`
2. Inferred-edge passive width: when `edge.provenance === 'inferred' && !touchesSelection && !isActive`, set `ctx.lineWidth = 0.8` instead of `0.6`
3. Inferred-edge passive alpha: when `edge.provenance === 'inferred' && !touchesSelection && !isActive`, use baseAlpha `0.22` instead of `0.16`

Stop at the first tuning that reads clearly. If you change defaults from the values in the spec, append a brief section to `docs/superpowers/specs/2026-05-11-graph-rendering-v2-tuning.md` documenting the as-shipped values; otherwise leave the tuning addendum alone.

- [ ] **Step 7: Manual verification — selection lifts to bright alpha while preserving the dash**

In the browser, click the `john-vervaeke` node. Expected:

- The node highlights with the selection ring (per `drawAtomicNodes`'s selected branch).
- The `vervaeke-coined-meaning-crisis` edge brightens to `0.95` alpha (`baseAlpha` flips on `touchesSelection`), thickens to width `1.4`, and **remains dashed** — the dash pattern stays visible at the brighter alpha and thicker width.
- The `responds-to` edge (which doesn't touch `john-vervaeke`) stays at passive alpha and solid.

Click `meaning-crisis` next — both edges now touch the selected node, both should be bright; only `vervaeke-coined-meaning-crisis` is dashed.

Click empty space to deselect; both edges return to passive alpha.

If the dash disappears when an inferred edge becomes selected (which would mean the dash got reset before the stroke), inspect the function — the setLineDash call must come AFTER the lineWidth/strokeStyle assignment and BEFORE `beginPath` / `stroke`, and the reset must come AFTER `stroke`.

- [ ] **Step 8: Stop the dev server and commit**

Stop the backgrounded server (`fg` then Ctrl+C, or kill the process).

```bash
git add ui/draw.js
git commit -m "$(cat <<'EOF'
feat(ui): render inferred relations as dashed edges

drawEdges applies setLineDash([4, 3]) when edge.provenance ===
'inferred'; reset to [] every iteration for defense against ordering
bugs. Same color/alpha/width curves as source edges — only the dash
distinguishes provenance. Selection and active states preserve the
dash while lifting alpha and width as usual.
EOF
)"
```

If Step 6 also changed the v2 tuning addendum, include it in the same commit (`git add docs/superpowers/specs/2026-05-11-graph-rendering-v2-tuning.md`) and mention the tuning in the commit body.

---

## Task 4: docs(skill): heuristic for adding inferred relations from world knowledge

**Files:**
- Modify: `skills/mindgraph/SKILL.md` (heuristic block, command-table flag update)
- Modify: `README.md` (mention `--provenance` in actuator commands list)

Pure docs task — no code paths exercised. Verification is reading the diff.

- [ ] **Step 1: Insert the "On inferred relations" heuristic in `skills/mindgraph/SKILL.md`**

Open `skills/mindgraph/SKILL.md`. Find the `## Heuristics and judgment` section. Locate the `**On idempotency.**` paragraph and the `**On scaling.**` paragraph that follows it.

Insert this block BETWEEN them (after `**On idempotency.**` block ends, before `**On scaling.**` begins):

```markdown
**On inferred relations.** When you know a connection from world knowledge that the source assumes but doesn't state, add it via `mindgraph relation upsert ... --provenance inferred`. The UI renders these as dashed lines and they participate in the layout at the same stiffness as source-derived edges — adding `inferred` *changes the geometry the user sees*, not just decoration. Treat it as an editorial choice.

**What qualifies.** Inferred relations are *only* for biographical, foundational, or attributional facts the source's audience would treat as common knowledge — facts the speaker is silently presupposing rather than asserting. Examples: "X interpreted Y", "X is a student of Y", "X co-authored Z with W", "X founded movement Z", "X developed concept Y". These are connections any introductory text in the field would state as part of its scaffolding.

**Two tests, apply both.** **(1) Introductory-textbook test** — would an introductory text in this field state this connection as part of the scaffolding the field is built on? If no, don't add it. **(2) Audience-eye-roll gut-check** — would a knowledgeable audience member be mildly bored if the speaker stopped to explain this? If yes, it's table-stakes; safe to add. If they'd lean in because it's contested or interesting, it's not table-stakes — that's the speaker's editorial territory, not yours. Fail-safe to "don't add" when both tests aren't clearly satisfied.

**What does NOT qualify.** Don't infer *inferential bridges*: "X causes Y", "X is similar to Y", "X opposes Y", "X anticipates Y", or any connection that interprets, compares, or evaluates. Those are the speaker's editorial territory — if the speaker didn't make the bridge, you don't either. Don't infer connections that a domain expert *might* assert but isn't field-consensus (specific scholarly theses). Don't infer topical co-occurrence ("both come up in this field") — that's what cluster siblings and co-occurrence already capture.

**Worked example — Sean Kelly *Existentialism* lecture.** Yes-add: `hubert-dreyfus → martin-heidegger` (interprets — Dreyfus is the canonical 20th-century Heidegger interpreter); `søren-kierkegaard → jean-paul-sartre` (influences — Kierkegaard is a foundational existentialist precursor any intro treats as such). No-add: `heidegger → derrida` ("anticipates deconstruction" — specific scholarly thesis, not common knowledge); `sartre ↔ camus` ("opposed each other politically" — inferential bridge, speaker's territory); `existentialism → phenomenology` ("draws methodologically from" — too interpretive, even if defensible).

**Don't activate inferred relations in frames.** Inferred relations exist as latent structural facts — they're visible on the graph once both endpoints have first-appeared, and clicking either endpoint lights them up. Don't add them to any frame's `--relations-json` activations, because the speaker didn't activate them. Adding them to `activeRelations` would say "the speaker is foregrounding the connection they didn't make" — incoherent.
```

- [ ] **Step 2: Update the command-table row in `skills/mindgraph/SKILL.md`**

In the same file, find the `## Reference: full command list` table near the bottom. Locate the row:

```
| `mindgraph relation upsert <file> --id ... --from ... --to ... --type ...` | Create or update a relation |
```

Replace with:

```
| `mindgraph relation upsert <file> --id ... --from ... --to ... --type ... [--provenance source\|inferred]` | Create or update a relation (provenance defaults to source; use `inferred` for common-knowledge connections the speaker assumed — see "On inferred relations") |
```

The `\|` inside the inline-code span is a Markdown-table-cell escape for the literal `|`. Verify with a Markdown preview if available.

- [ ] **Step 3: Mention `--provenance` in `README.md`'s actuator-commands list**

Open `README.md`. Find the actuator-commands list (around line 159):

```
Current actuator commands:

- `mindgraph concept upsert ...`
- `mindgraph concept list/show ...`
- `mindgraph relation upsert ...`
- `mindgraph frame list/show ...`
...
```

Replace the `mindgraph relation upsert ...` bullet with:

```
- `mindgraph relation upsert ...` (use `--provenance inferred` to mark common-knowledge connections the speaker assumed; the UI renders these as dashed edges)
```

- [ ] **Step 4: Eyeball the docs**

Re-read the inserted blocks. Check:

- The heuristic block sits between `**On idempotency.**` and `**On scaling.**` paragraphs.
- The command-table row reads cleanly when rendered (the `\|` escape works in your viewer of choice).
- The README bullet renders as a single bullet with a parenthetical, not as a sub-list.

- [ ] **Step 5: Commit**

```bash
git add skills/mindgraph/SKILL.md README.md
git commit -m "$(cat <<'EOF'
docs(skill): heuristic for adding inferred relations from world knowledge

Adds an "On inferred relations" block under SKILL.md's "Heuristics and
judgment" section: two-test kind-based heuristic (introductory-textbook
+ audience-eye-roll), explicit yes/no examples from a Sean Kelly
Existentialism lecture, and a rule against activating inferred relations
in frames. Updates the command-table row and README actuator list to
mention --provenance.
EOF
)"
```

---

## Task 5: chore(release): 0.5.0

**Files:**
- Modify: `package.json` (`version` bump)
- Modify: `skills/mindgraph/SKILL.md` (prerequisite-check install command tag)

Pure release-engineering task. Bump the version, update the install URL the SKILL.md prerequisite block points to, run the smoke test one final time as a sanity check.

- [ ] **Step 1: Bump the version in `package.json`**

Open `package.json`. Find the `"version"` line (around line 4):

```json
  "version": "0.4.1",
```

Replace with:

```json
  "version": "0.5.0",
```

- [ ] **Step 2: Update the install-command tag in `skills/mindgraph/SKILL.md`**

Open `skills/mindgraph/SKILL.md`. Find the prerequisite-check install command (around line 31):

```
npm install -g github:funclosure/mindgraph#v0.4.1
```

Replace with:

```
npm install -g github:funclosure/mindgraph#v0.5.0
```

- [ ] **Step 3: Final smoke-test sanity run**

Run: `npm run test:smoke && npm run test:smoke:node`

Expected: both succeed. The chain is green end-to-end on both runtimes.

If either fails, do not commit the release — fix the regression first.

- [ ] **Step 4: Commit**

```bash
git add package.json skills/mindgraph/SKILL.md
git commit -m "$(cat <<'EOF'
chore(release): 0.5.0 — inferred relations
EOF
)"
```

- [ ] **Step 5: Verify the commit log shape**

Run: `git log --oneline -7`

Expected: the top five entries are this release's commits in order:

```
<sha> chore(release): 0.5.0 — inferred relations
<sha> docs(skill): heuristic for adding inferred relations from world knowledge
<sha> feat(ui): render inferred relations as dashed edges
<sha> feat(view-model): expose relation provenance on GraphEdgeVM
<sha> feat(core+cli): relation upsert accepts --provenance
<sha> docs(spec): lock inferred-relations design for v0.5.0
<sha> docs(spec): inferred-relations brainstorm seed for next session
```

If the order is different or commits are missing, investigate before considering the release complete.

---

## Out of scope (do NOT do as part of this plan)

- Macro-firstSeenAt fix (parked as v0.5.1 — separate session).
- Inferred concepts or inferred frame activations.
- Canvas hover tooltip on edges.
- Threading provenance onto `RelationVM` or surfacing it in the inspector panel.
- Pushing the v0.5.0 tag to the remote — that's a separate user-approved step.

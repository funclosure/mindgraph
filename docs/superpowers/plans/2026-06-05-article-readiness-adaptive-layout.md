# Article Readiness and Adaptive Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make web article digests produce better reading timelines, warn agents when UX-readiness is poor, and keep sparse viewer graphs visually cohesive without squeezing dense graphs.

**Architecture:** Extend deterministic core utilities: source extraction preserves article blocks, digest evaluation reports UX-readiness, journey operations surface readiness, and the layout simulator adds component-aware adaptive cohesion. CLI/MCP remain thin adapters over shared core results.

**Tech Stack:** Node 18+ ES modules, built-in test runner, vanilla JS UI layout module, no new runtime dependencies.

---

## File structure

- Modify `src/core/source.js`
  - Preserve block structure for article extraction.
  - Export `extractArticleBlocks(html)` for tests.
  - Write prepared web article text as blank-line-separated blocks.

- Modify `src/core/digest.js`
  - Add `evaluateUxReadiness(doc)`.
  - Include `ux` section in `evaluateDigest(doc)`.

- Modify `src/core/journey.js`
  - Include `readiness: { ux }` in `buildStarterDigestOperation` results.

- Modify `src/cli/index.js`
  - Print readiness warnings from high-level `mindgraph digest`.
  - Print UX readiness in `mindgraph digest evaluate` text output.

- Modify `ui/layout.js`
  - Compute relation connected components.
  - Add adaptive component-centroid cohesion for fragmented/sparse graphs.
  - Expose debug/meta shape on simulator for tests.

- Modify `test/source.test.js`
  - Add article block extraction regression.

- Modify `test/digest.test.js`
  - Add UX-readiness evaluation tests.

- Modify `test/journey.test.js`
  - Assert starter digest readiness is returned.

- Modify `test/layout-v3.test.js`
  - Add sparse compactness and dense non-collapse regression tests.

---

### Task 1: Preserve article blocks during web import

**Files:**
- Modify: `src/core/source.js`
- Modify: `test/source.test.js`

- [ ] **Step 1: Add failing source extraction tests**

Append these tests to `test/source.test.js`:

```js
test('extractArticleBlocks preserves headings, paragraphs, list items, and blockquotes', async () => {
  const { extractArticleBlocks } = await import('../src/core/source.js');
  const blocks = extractArticleBlocks(`<!doctype html>
    <html><body><article>
      <h1>Main Title</h1>
      <p>First paragraph with <strong>inline</strong> text.</p>
      <h2>Second Section</h2>
      <ul><li>First item</li><li>Second item</li></ul>
      <blockquote>Quoted idea.</blockquote>
    </article></body></html>`);

  assert.deepEqual(blocks, [
    'Main Title',
    'First paragraph with inline text.',
    'Second Section',
    'First item',
    'Second item',
    'Quoted idea.',
  ]);
});

test('prepareSource writes readable web article blocks separated by blank lines', async () => {
  const workspace = makeTempWorkspace();
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(`<!doctype html><html><body><article>
      <h1>Structured Article</h1>
      <p>Paragraph one.</p>
      <p>Paragraph two.</p>
      <p>Paragraph three.</p>
    </article></body></html>`);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try {
    const result = await prepareSource({ source: `http://127.0.0.1:${address.port}/structured`, workspaceDir: workspace });
    const saved = fs.readFileSync(result.preparedPath, 'utf8');
    assert.match(saved, /Structured Article\n\nParagraph one\.\n\nParagraph two\.\n\nParagraph three\./);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
```

- [ ] **Step 2: Run source tests and verify failure**

Run:

```bash
node --test test/source.test.js
```

Expected: FAIL because `extractArticleBlocks` is not exported and/or prepared text is not block-separated.

- [ ] **Step 3: Implement block extraction**

In `src/core/source.js`, replace `htmlToText(html)` and `prepareWebSource` internals with this implementation shape:

```js
function stripNoise(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ');
}

function cleanBlock(html) {
  return decodeHtmlEntities(String(html).replace(/<[^>]+>/g, ' '))
    .replace(/[ \t\n\r]+/g, ' ')
    .trim();
}

export function extractArticleBlocks(html) {
  const withoutNoise = stripNoise(html);
  const article = withoutNoise.match(/<article[^>]*>([\s\S]*?)<\/article>/i)?.[1] ?? withoutNoise;
  const blocks = [];
  const blockPattern = /<(h1|h2|h3|h4|p|li|blockquote)[^>]*>([\s\S]*?)<\/\1>/gi;
  let match;
  while ((match = blockPattern.exec(article))) {
    const block = cleanBlock(match[2]);
    if (block) blocks.push(block);
  }
  if (blocks.length) return blocks;
  const fallback = cleanBlock(article);
  return fallback ? [fallback] : [];
}

export function htmlToText(html) {
  return extractArticleBlocks(html).join('\n\n');
}
```

Then in `prepareWebSource`, compute:

```js
const blocks = extractArticleBlocks(html);
if (!blocks.length) throw new Error(`Fetched source did not contain readable text: ${source}`);
const text = blocks.join('\n\n');
```

Keep the existing title extraction behavior.

- [ ] **Step 4: Run source tests and verify pass**

Run:

```bash
node --test test/source.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/core/source.js test/source.test.js
git commit -m "fix(source): preserve article block structure"
```

---

### Task 2: Add UX-readiness evaluation

**Files:**
- Modify: `src/core/digest.js`
- Modify: `test/digest.test.js`

- [ ] **Step 1: Add failing digest UX tests**

Append these tests to `test/digest.test.js`:

```js
test('evaluateDigest reports UX warnings for single-segment flat documents', () => {
  const doc = baseDoc();
  doc.transcript.segments = [doc.transcript.segments[0]];
  doc.frames.micro = [doc.frames.micro[0]];
  doc.frames.meso = [doc.frames.meso[0]];
  applyDigestPlan(doc, {
    concepts: [
      { id: 'a', label: 'A', firstSeenAt: 0 },
      { id: 'b', label: 'B', firstSeenAt: 0 },
      { id: 'c', label: 'C', firstSeenAt: 0 },
    ],
    mesoActivations: [{ index: 0, foreground: [
      { id: 'a', weight: 1, mode: 'explicit' },
      { id: 'b', weight: 1, mode: 'explicit' },
      { id: 'c', weight: 1, mode: 'explicit' },
    ] }],
    recomputeStats: true,
  });

  const report = evaluateDigest(doc);
  assert.equal(report.ux.status, 'warning');
  assert.deepEqual(report.ux.warnings.map((w) => w.code), ['single-segment-source', 'few-micro-frames', 'flat-concept-reveal']);
  assert.equal(report.ux.transcriptSegments, 1);
  assert.equal(report.ux.distinctAtomicFirstSeenTimes, 1);
});

test('evaluateDigest reports ready UX for multi-frame documents with staggered first-seen concepts', () => {
  const doc = baseDoc();
  applyDigestPlan(doc, {
    concepts: [
      { id: 'ai-safety', label: 'AI Safety', firstSeenAt: 0, grounding: { kind: 'source', sourceSpan: { start: 0, end: 10 }, quote: 'AI safety matters.' } },
      { id: 'scaling-laws', label: 'Scaling Laws', firstSeenAt: 20, grounding: { kind: 'source', sourceSpan: { start: 20, end: 30 }, quote: 'Scaling laws continue.' } },
    ],
    mesoActivations: [
      { index: 0, foreground: [{ id: 'ai-safety', weight: 1, mode: 'explicit' }] },
      { index: 2, foreground: [{ id: 'scaling-laws', weight: 1, mode: 'explicit' }] },
    ],
    recomputeStats: true,
  });

  const report = evaluateDigest(doc);
  assert.equal(report.ux.status, 'ready');
  assert.deepEqual(report.ux.warnings, []);
  assert.equal(report.ux.frameCounts.micro, 3);
  assert.equal(report.ux.distinctAtomicFirstSeenTimes, 2);
});
```

- [ ] **Step 2: Run digest tests and verify failure**

Run:

```bash
node --test test/digest.test.js
```

Expected: FAIL because `report.ux` is missing.

- [ ] **Step 3: Implement UX readiness**

In `src/core/digest.js`, add before `export function evaluateDigest(doc)`:

```js
export function evaluateUxReadiness(doc) {
  const transcriptSegments = doc.transcript?.segments?.length ?? 0;
  const microFrames = doc.frames?.micro?.length ?? 0;
  const mesoFrames = doc.frames?.meso?.length ?? 0;
  const macroFrames = doc.frames?.macro?.length ?? 0;
  const activatedAtomicIds = new Set();
  for (const level of ['micro', 'meso', 'macro']) {
    for (const frame of doc.frames?.[level] ?? []) {
      for (const activation of [...(frame.foregroundConcepts ?? []), ...(frame.backgroundConcepts ?? [])]) {
        if ((doc.concepts?.atomic ?? []).some((concept) => concept.id === activation.id)) activatedAtomicIds.add(activation.id);
      }
    }
  }
  const firstSeenTimes = new Set(
    (doc.concepts?.atomic ?? [])
      .filter((concept) => activatedAtomicIds.has(concept.id))
      .map((concept) => concept.firstSeenAt)
      .filter((value) => typeof value === 'number')
  );
  const warnings = [];
  if (transcriptSegments <= 1) warnings.push({ code: 'single-segment-source', message: 'Source produced only one transcript segment; graph reveal will be flat.', recommendedAction: 'Provide paragraph-separated source text or improve article extraction.' });
  if (microFrames < 3) warnings.push({ code: 'few-micro-frames', message: `Document has only ${microFrames} micro frame(s); reading progression will be limited.`, recommendedAction: 'Use paragraph-level source segmentation before digesting.' });
  if (activatedAtomicIds.size >= 3 && firstSeenTimes.size <= 1) warnings.push({ code: 'flat-concept-reveal', message: 'Most activated concepts share the same first-seen time; graph reveal will happen all at once.', recommendedAction: 'Set firstSeenAt from paragraph/frame evidence during semantic enrichment.' });
  return {
    status: warnings.length ? 'warning' : 'ready',
    warnings,
    frameCounts: { micro: microFrames, meso: mesoFrames, macro: macroFrames },
    transcriptSegments,
    distinctAtomicFirstSeenTimes: firstSeenTimes.size,
  };
}
```

Then add `ux: evaluateUxReadiness(doc),` to the object returned by `evaluateDigest(doc)`.

- [ ] **Step 4: Run digest tests and verify pass**

Run:

```bash
node --test test/digest.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/core/digest.js test/digest.test.js
git commit -m "feat(digest): report UX readiness"
```

---

### Task 3: Surface readiness through journey operations and CLI

**Files:**
- Modify: `src/core/journey.js`
- Modify: `src/cli/index.js`
- Modify: `test/journey.test.js`

- [ ] **Step 1: Add failing journey readiness assertions**

In `test/journey.test.js`, inside `buildStarterDigestOperation imports source...`, after `assert.deepEqual(result.next.agentAction, 'create-digest-plan');`, add:

```js
  assert.equal(result.readiness.ux.status, 'warning');
  assert.deepEqual(result.readiness.ux.warnings.map((warning) => warning.code), ['few-micro-frames']);
```

Add a new test:

```js
test('buildStarterDigestOperation warns when source collapses to one segment', async () => {
  const workspace = makeTempWorkspace();
  const transcript = path.join(workspace, 'source.txt');
  const output = path.join(workspace, 'graphs', 'flat.mindgraph.json');
  fs.writeFileSync(transcript, 'One long unstructured article block with no paragraph breaks.', 'utf8');

  const result = await buildStarterDigestOperation({ source: transcript, outputPath: output, workspaceDir: workspace, title: 'Flat Source', mode: 'untimed' });

  assert.equal(result.ok, true);
  assert.equal(result.readiness.ux.status, 'warning');
  assert.ok(result.readiness.ux.warnings.some((warning) => warning.code === 'single-segment-source'));
});
```

- [ ] **Step 2: Run journey tests and verify failure**

Run:

```bash
node --test test/journey.test.js
```

Expected: FAIL because `result.readiness` is missing.

- [ ] **Step 3: Add readiness to journey results**

In `src/core/journey.js`, change digest import to:

```js
import { applyDigestPlan, evaluateDigest, evaluateUxReadiness } from './digest.js';
```

In `buildStarterDigestOperation`, after validation and before return, compute:

```js
const ux = evaluateUxReadiness(doc);
```

Then add to the returned success object:

```js
readiness: { ux },
```

- [ ] **Step 4: Print CLI readiness warnings**

In `src/cli/index.js`, add helper after `exitWithOperationResult`:

```js
function formatWarnings(warnings = []) {
  if (!warnings.length) return '';
  return ['Warnings:', ...warnings.map((warning) => `  - ${warning.code}: ${warning.message}`)].join('\n');
}
```

In high-level `digest <source>` success text, insert after frame counts:

```js
formatWarnings(value.readiness?.ux?.warnings),
```

and filter empty lines:

```js
].filter(Boolean).join('\n')
```

In `printDigestEvaluation(report)`, add after frame counts:

```js
  console.log(`  UX readiness: ${report.ux?.status ?? 'unknown'}`);
  for (const warning of report.ux?.warnings ?? []) console.log(`    - ${warning.code}: ${warning.message}`);
```

- [ ] **Step 5: Run journey and CLI manual checks**

Run:

```bash
node --test test/journey.test.js
TMPDIR=$(mktemp -d)
mkdir -p "$TMPDIR/graphs"
printf 'Only one paragraph source.' > "$TMPDIR/source.txt"
node src/cli/index.js digest "$TMPDIR/source.txt" --workspace "$TMPDIR" --title "Flat" --mode untimed | grep -q 'single-segment-source'
node src/cli/index.js digest evaluate "$TMPDIR/graphs/flat.mindgraph.json" | grep -q 'UX readiness: warning'
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/core/journey.js src/cli/index.js test/journey.test.js
git commit -m "feat(journey): surface UX readiness warnings"
```

---

### Task 4: Add adaptive layout cohesion

**Files:**
- Modify: `ui/layout.js`
- Modify: `test/layout-v3.test.js`

- [ ] **Step 1: Add failing sparse/dense layout tests**

Append to `test/layout-v3.test.js`:

```js
function maxRadius(sim, concepts) {
  return Math.max(...concepts.map((c) => Math.hypot(sim.positions[c.id].x, sim.positions[c.id].y)));
}

test('fragmented sparse graphs settle within a cohesive field', () => {
  const concepts = Array.from({ length: 12 }, (_, i) => concept(`sparse-${i}`));
  const edges = [
    edge('a', 'sparse-0', 'sparse-1'),
    edge('b', 'sparse-2', 'sparse-3'),
    edge('c', 'sparse-4', 'sparse-5'),
    edge('d', 'sparse-6', 'sparse-7'),
  ];
  const document = vm({ concepts, edges });
  const sim = createLayoutSimulator(document);
  sim.reheat(1);
  step(sim, 260);

  assert.equal(sim.layoutMeta.fragmented, true);
  assert.ok(maxRadius(sim, concepts) < 520, `expected sparse graph max radius < 520, got ${maxRadius(sim, concepts)}`);
});

test('dense hub graphs preserve breathing room under adaptive cohesion', () => {
  const concepts = [concept('hub'), ...Array.from({ length: 10 }, (_, i) => concept(`dense-${i}`))];
  const edges = concepts.slice(1).map((c, i) => edge(`dense-edge-${i}`, 'hub', c.id));
  const document = vm({ concepts, edges, importance: { hub: 1 } });
  const sim = createLayoutSimulator(document);
  sim.reheat(1);
  step(sim, 260);

  const hub = sim.positions.hub;
  const avgLeafDistance = average(concepts.slice(1).map((c) => dist(hub, sim.positions[c.id])));
  assert.equal(sim.layoutMeta.fragmented, false);
  assert.ok(avgLeafDistance > 90, `expected dense hub breathing room > 90, got ${avgLeafDistance}`);
});
```

- [ ] **Step 2: Run layout tests and verify failure**

Run:

```bash
node --test test/layout-v3.test.js
```

Expected: FAIL because `layoutMeta` is missing and sparse compactness is not enforced.

- [ ] **Step 3: Implement component metadata**

In `ui/layout.js`, after `buildRelationNeighborIds`, add helper functions:

```js
function buildComponents(nodes, relationNeighborIds) {
  const unseen = new Set(nodes.map((node) => node.id));
  const components = [];
  while (unseen.size) {
    const start = unseen.values().next().value;
    const stack = [start];
    unseen.delete(start);
    const ids = [];
    while (stack.length) {
      const id = stack.pop();
      ids.push(id);
      for (const neighbor of relationNeighborIds.get(id) ?? []) {
        if (unseen.has(neighbor)) {
          unseen.delete(neighbor);
          stack.push(neighbor);
        }
      }
    }
    components.push(ids);
  }
  return components;
}

function computeLayoutMeta(nodes, relationPairs, relationNeighborIds) {
  const components = buildComponents(nodes, relationNeighborIds);
  const largest = components.reduce((max, component) => Math.max(max, component.length), 0);
  const nodeCount = nodes.length || 1;
  const relationDensity = relationPairs.length / Math.max(1, nodeCount);
  const largestComponentRatio = largest / nodeCount;
  const fragmented = nodeCount >= 8 && components.length >= 3 && largestComponentRatio < 0.75 && relationDensity < 1.2;
  return { components, componentCount: components.length, largestComponentRatio, relationDensity, fragmented };
}
```

Inside `createLayoutSimulator`, after `relationNeighborIds`, add:

```js
const layoutMeta = computeLayoutMeta(nodes, relationPairs, relationNeighborIds);
```

Expose it on `sim`:

```js
layoutMeta,
```

- [ ] **Step 4: Implement adaptive component cohesion**

In `ui/layout.js`, near center constants add:

```js
const COMPONENT_COHESION_STRENGTH = 0.018;
const COMPONENT_COHESION_COMFORT_RADIUS = 230;
const COMPONENT_COHESION_MAX_COMPONENT_SIZE = 5;
```

Add this force inside `createLayoutSimulator`:

```js
function applyComponentCohesion() {
  if (!layoutMeta.fragmented) return;
  for (const component of layoutMeta.components) {
    if (component.length > COMPONENT_COHESION_MAX_COMPONENT_SIZE) continue;
    let cx = 0;
    let cy = 0;
    for (const id of component) {
      cx += positions[id].x;
      cy += positions[id].y;
    }
    cx /= component.length;
    cy /= component.length;
    const radius = Math.hypot(cx, cy);
    if (radius <= COMPONENT_COHESION_COMFORT_RADIUS) continue;
    const pull = COMPONENT_COHESION_STRENGTH * ((radius - COMPONENT_COHESION_COMFORT_RADIUS) / radius);
    for (const id of component) {
      if (pinState.has(id)) continue;
      velocities[id].x -= cx * pull;
      velocities[id].y -= cy * pull;
    }
  }
}
```

Call it in the simulator step loop after `applyCenter()` and before `applyCollision()`.

- [ ] **Step 5: Run layout tests and tune only if needed**

Run:

```bash
node --test test/layout-v3.test.js
```

Expected: PASS. If sparse max radius is slightly above threshold, adjust only `COMPONENT_COHESION_STRENGTH` or `COMPONENT_COHESION_COMFORT_RADIUS`, then re-run. Do not change unrelated separation or base link distance in this task.

- [ ] **Step 6: Commit**

Run:

```bash
git add ui/layout.js test/layout-v3.test.js
git commit -m "fix(layout): add adaptive component cohesion"
```

---

### Task 5: Full verification and manual viewer check

**Files:**
- Modify only if verification reveals a concrete issue in files changed by Tasks 1-4.

- [ ] **Step 1: Run focused test suite**

Run:

```bash
npm run test:source
npm run test:journey
npm run test:mcp
npm run test:digest
npm run test:layout
npm run ui:check
```

Expected: all pass.

- [ ] **Step 2: Run smoke test**

Run:

```bash
npm run test:smoke
```

Expected: pass.

- [ ] **Step 3: Clean generated smoke artifacts**

Run:

```bash
git checkout -- examples/out/awakening.mindgraph.json
git clean -f examples/out/empty.mindgraph.json
```

Expected: generated smoke changes removed.

- [ ] **Step 4: Manual article readiness check**

Run:

```bash
TMPDIR=$(mktemp -d)
mkdir -p "$TMPDIR/graphs"
printf 'Title\n\nParagraph one.\n\nParagraph two.\n\nParagraph three.\n' > "$TMPDIR/article.txt"
node src/cli/index.js digest "$TMPDIR/article.txt" --workspace "$TMPDIR" --title "Article Readiness" --mode untimed --meso-size 2 --json | grep -q '"readiness"'
node src/cli/index.js digest evaluate "$TMPDIR/graphs/article-readiness.mindgraph.json" --json | grep -q '"ux"'
```

Expected: both grep commands pass.

- [ ] **Step 5: Manual viewer check**

Run sparse article document server on 4175:

```bash
node src/ui/dev-server.js --port 4175 --host 127.0.0.1 --doc "/Users/victor/Documents/New project/recursive-self-improvement.evolving.mindgraph.json"
```

Open `http://127.0.0.1:4175`. Expected: sparse components are closer to the visual center than before, without overlapping.

Run Meaning Crisis sample server on 4173:

```bash
node src/ui/dev-server.js --port 4173 --host 127.0.0.1 --doc examples/out/episode-1-built.mindgraph.json
```

Open `http://127.0.0.1:4173`. Expected: dense regions remain breathable; no obvious global squeeze.

- [ ] **Step 6: Check status and commit fixes if any**

Run:

```bash
git status --short
```

Expected: only intentional source changes are committed, and no generated artifacts remain except user-owned local files such as `transcripts/recursive-self-improvement.txt`.

If verification required fixes, commit them:

```bash
git add <fixed-files>
git commit -m "fix: stabilize article readiness layout"
```

---

## Self-review notes

- Spec coverage: covers article block import, UX readiness in evaluation, CLI/MCP/journey surfacing, and adaptive layout cohesion.
- Placeholder scan: no TODO/TBD placeholders are intentionally present.
- Type consistency: `evaluateUxReadiness(doc)` is introduced in Task 2, reused by journey in Task 3, and `report.ux` is used by CLI output.

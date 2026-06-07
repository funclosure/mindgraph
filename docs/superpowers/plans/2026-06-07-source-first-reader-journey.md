# Source-first Reader Journey Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a compatibility-layer `ReaderJourneyVM` so the UI navigates source-first reader steps with guaranteed focus and a UI-only after-end whole-picture state, without migrating the document schema yet.

**Architecture:** Add a pure view-model derivation module that maps legacy transcript segments/frames into `sourceBlocks`, grouped `readerSteps`, and provisional `sections`. Wire graph render state and UI scroll/prose/chapter strip to consume reader journey state while keeping legacy frame selectors available. Add core readiness warnings for no-focus reader steps so LLM operators get actionable repair signals.

**Tech Stack:** ES modules, Node `node:test`, vanilla browser modules, current no-framework/no-bundler UI.

---

## File Structure

- Create `src/view-model/buildReaderJourneyVM.js`
  - Pure derivation from existing `MindgraphViewModel` to `ReaderJourneyVM`.
  - Owns source block derivation, low-signal grouping, section derivation, and after-end helper metadata.

- Modify `src/view-model/buildMindgraphViewModel.js`
  - Import and attach `readerJourney`.
  - Add selectors for reader steps and active reader position.

- Modify `src/view-model/buildGraphRenderState.js`
  - Accept optional `readerStepIndex` and `presentationMode`.
  - Prefer reader step focus over `activeLevel` frame focus.
  - Support `presentationMode: 'whole-picture'` after the final step.

- Modify `src/view-model/buildProseChunks.js`
  - Emit prose chunks from `readerJourney.sourceBlocks` / `readerJourney.readerSteps` instead of paragraphizing raw transcript only.
  - Preserve concept mention highlighting.

- Modify `ui/scroll-binding.js`
  - Read centered `data-reader-step-index` instead of `data-time-start`.
  - Detect after-end when scroll is past the final reader step.

- Modify `ui/panels/prose.js`
  - Render reader-step data attributes.
  - Add an end recap sentinel element that triggers whole-picture mode.

- Modify `ui/panels/chapter-strip.js`
  - Render sections from `readerJourney.sections`, not macro frames directly.

- Modify `ui/app.js`
  - Add `readerStepIndex` and `presentationMode` state.
  - Initialize from first reader step.
  - Pass reader journey state into graph render state.

- Modify `src/core/digest.js`
  - Add readiness warnings based on derived reader journey: no-focus visible steps, uncovered source blocks, section coverage gaps.

- Create `test/reader-journey.test.js`
  - Unit tests for source blocks, grouping, sections, and after-end metadata.

- Create `test/reader-journey-render-state.test.js`
  - Unit tests for graph render state focus and whole-picture mode.

- Modify `test/digest.test.js`
  - Add readiness tests for reader journey warnings.

---

## ReaderJourneyVM Shape

Implement this shape in `src/view-model/buildReaderJourneyVM.js`:

```js
/**
 * @typedef {Object} SourceBlockVM
 * @property {string} id
 * @property {number} index
 * @property {'heading'|'paragraph'|'quote'|'list-item'|'transcript'} kind
 * @property {string} text
 * @property {{ start: number, end: number }} span
 * @property {string[]} segmentIds
 * @property {{ level: string, index: number }[]} frameRefs
 */

/**
 * @typedef {Object} ReaderStepVM
 * @property {string} id
 * @property {number} index
 * @property {string[]} sourceBlockIds
 * @property {{ start: number, end: number }} span
 * @property {string} summary
 * @property {Array<{ id: string, label: string, weight: number, mode?: string }>} focusConcepts
 * @property {Array<{ id: string, label: string, weight: number, mode?: string }>} supportingConcepts
 * @property {Array<{ id: string, weight: number, relation?: object }>} focusRelations
 * @property {string|undefined} sectionId
 * @property {boolean} hasFocus
 * @property {boolean} derivedFromLegacyFrames
 */

/**
 * @typedef {Object} SectionVM
 * @property {string} id
 * @property {number} index
 * @property {string} title
 * @property {string} summary
 * @property {number[]} readerStepIndexes
 * @property {{ start: number, end: number }} span
 * @property {{ level: string, index: number }|undefined} legacyFrameRef
 */

/**
 * @typedef {Object} ReaderJourneyVM
 * @property {SourceBlockVM[]} sourceBlocks
 * @property {ReaderStepVM[]} readerSteps
 * @property {SectionVM[]} sections
 * @property {Object<string, SourceBlockVM>} sourceBlockById
 * @property {Object<string, ReaderStepVM>} readerStepById
 * @property {Object<string, SectionVM>} sectionById
 * @property {{ index: number, label: 'whole-picture' }} afterEnd
 */
```

---

### Task 1: Add pure ReaderJourneyVM derivation

**Files:**
- Create: `src/view-model/buildReaderJourneyVM.js`
- Create: `test/reader-journey.test.js`

- [ ] **Step 1: Write failing tests for source blocks and focused grouping**

Create `test/reader-journey.test.js` with this content:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReaderJourneyVM } from '../src/view-model/buildReaderJourneyVM.js';

function concept(id, label = id) {
  return { id, label, level: 'atomic', parentIds: [], childIds: [] };
}

function activation(id, weight = 1) {
  return { id, label: id, weight, mode: 'explicit', parentClusterIds: [] };
}

function relationActivation(id, weight = 1) {
  return { id, weight, relation: { id, from: 'a', to: 'b', type: 'relates-to' } };
}

function frame(index, { text, start, end, foreground = [], background = [], relations = [], macroIndex } = {}) {
  return {
    ref: { level: 'micro', index },
    key: `micro:${index}`,
    id: `micro-${index}`,
    title: undefined,
    t: start,
    span: { start, end },
    duration: end - start,
    speakers: [],
    summary: text,
    foregroundConcepts: foreground,
    backgroundConcepts: background,
    activeRelations: relations,
    sourceSegmentIds: [`seg-${index}`],
    sourceFrameRefs: [],
    ancestry: macroIndex == null ? {} : { macro: { level: 'macro', index: macroIndex } },
  };
}

function vm({ micro, macro = [], segments }) {
  return {
    transcript: {
      segments,
      byId: Object.fromEntries(segments.map((s) => [s.id, s])),
    },
    concepts: {
      atomic: [concept('a'), concept('b'), concept('c')],
      clustered: [],
      byId: { a: concept('a'), b: concept('b'), c: concept('c') },
      childrenByClusterId: {},
      clustersByAtomicId: {},
    },
    relations: { all: [], byId: {}, outgoingByConceptId: {}, incomingByConceptId: {} },
    frames: { micro, meso: [], macro, byRef: Object.fromEntries([...micro, ...macro].map((f) => [f.key, f])) },
    indexes: {},
    documentMeta: { durationSeconds: segments.at(-1)?.end ?? 0 },
  };
}

test('buildReaderJourneyVM derives source blocks from transcript segments', () => {
  const model = vm({
    segments: [
      { id: 'seg-0', start: 0, end: 10, text: 'Opening paragraph.' },
      { id: 'seg-1', start: 10, end: 20, text: 'Second paragraph.' },
    ],
    micro: [
      frame(0, { text: 'Opening paragraph.', start: 0, end: 10, foreground: [activation('a')] }),
      frame(1, { text: 'Second paragraph.', start: 10, end: 20, foreground: [activation('b')] }),
    ],
  });

  const journey = buildReaderJourneyVM(model);

  assert.equal(journey.sourceBlocks.length, 2);
  assert.deepEqual(journey.sourceBlocks.map((b) => b.id), ['source-block-0', 'source-block-1']);
  assert.equal(journey.sourceBlocks[0].text, 'Opening paragraph.');
  assert.deepEqual(journey.sourceBlocks[0].frameRefs, [{ level: 'micro', index: 0 }]);
});

test('buildReaderJourneyVM groups low-signal blocks into a focused reader step', () => {
  const model = vm({
    segments: [
      { id: 'seg-0', start: 0, end: 10, text: 'Context with no focus.' },
      { id: 'seg-1', start: 10, end: 20, text: 'Focused explanation.' },
      { id: 'seg-2', start: 20, end: 30, text: 'Trailing detail with no focus.' },
    ],
    micro: [
      frame(0, { text: 'Context with no focus.', start: 0, end: 10 }),
      frame(1, { text: 'Focused explanation.', start: 10, end: 20, foreground: [activation('a')], relations: [relationActivation('r1')] }),
      frame(2, { text: 'Trailing detail with no focus.', start: 20, end: 30 }),
    ],
  });

  const journey = buildReaderJourneyVM(model);

  assert.equal(journey.readerSteps.length, 1);
  assert.deepEqual(journey.readerSteps[0].sourceBlockIds, ['source-block-0', 'source-block-1', 'source-block-2']);
  assert.deepEqual(journey.readerSteps[0].focusConcepts.map((c) => c.id), ['a']);
  assert.deepEqual(journey.readerSteps[0].focusRelations.map((r) => r.id), ['r1']);
  assert.equal(journey.readerSteps[0].hasFocus, true);
});

test('buildReaderJourneyVM derives sections from macro frames and assigns reader steps', () => {
  const macro = [{
    ref: { level: 'macro', index: 0 },
    key: 'macro:0',
    title: 'The Setup',
    summary: 'A setup section.',
    span: { start: 0, end: 40 },
    foregroundConcepts: [],
    backgroundConcepts: [],
    activeRelations: [],
    sourceSegmentIds: [],
    sourceFrameRefs: [],
    ancestry: {},
  }];
  const model = vm({
    segments: [
      { id: 'seg-0', start: 0, end: 10, text: 'First.' },
      { id: 'seg-1', start: 10, end: 20, text: 'Second.' },
    ],
    micro: [
      frame(0, { text: 'First.', start: 0, end: 10, foreground: [activation('a')], macroIndex: 0 }),
      frame(1, { text: 'Second.', start: 10, end: 20, foreground: [activation('b')], macroIndex: 0 }),
    ],
    macro,
  });

  const journey = buildReaderJourneyVM(model);

  assert.equal(journey.sections.length, 1);
  assert.equal(journey.sections[0].title, 'The Setup');
  assert.deepEqual(journey.sections[0].readerStepIndexes, [0, 1]);
  assert.equal(journey.readerSteps[0].sectionId, 'section-0');
  assert.deepEqual(journey.afterEnd, { index: 2, label: 'whole-picture' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test test/reader-journey.test.js
```

Expected: FAIL with module not found for `buildReaderJourneyVM.js`.

- [ ] **Step 3: Implement `src/view-model/buildReaderJourneyVM.js`**

Create `src/view-model/buildReaderJourneyVM.js` with this content:

```js
function frameRefKey(ref) {
  return `${ref.level}:${ref.index}`;
}

function spanUnion(items) {
  const spans = items.map((item) => item.span).filter(Boolean);
  if (!spans.length) return { start: 0, end: 0 };
  return {
    start: Math.min(...spans.map((span) => span.start)),
    end: Math.max(...spans.map((span) => span.end)),
  };
}

function hasFocusFrame(frame) {
  return Boolean((frame?.foregroundConcepts ?? []).length || (frame?.activeRelations ?? []).length);
}

function mergeActivations(frames, field) {
  const byId = new Map();
  for (const frame of frames) {
    for (const activation of frame?.[field] ?? []) {
      const existing = byId.get(activation.id);
      if (!existing || (activation.weight ?? 0) > (existing.weight ?? 0)) {
        byId.set(activation.id, activation);
      }
    }
  }
  return [...byId.values()];
}

function sourceKindForSegment(segment) {
  const rawKind = segment?.kind ?? segment?.meta?.kind;
  if (['heading', 'paragraph', 'quote', 'list-item', 'transcript'].includes(rawKind)) return rawKind;
  return 'transcript';
}

function buildSourceBlocks(vm) {
  const microBySegmentId = new Map();
  for (const frame of vm.frames?.micro ?? []) {
    for (const id of frame.sourceSegmentIds ?? []) {
      if (!microBySegmentId.has(id)) microBySegmentId.set(id, []);
      microBySegmentId.get(id).push(frame);
    }
  }

  return (vm.transcript?.segments ?? []).map((segment, index) => {
    const frames = microBySegmentId.get(segment.id) ?? [];
    return {
      id: `source-block-${index}`,
      index,
      kind: sourceKindForSegment(segment),
      text: segment.text ?? '',
      span: { start: segment.start ?? 0, end: segment.end ?? segment.start ?? 0 },
      segmentIds: [segment.id].filter(Boolean),
      frameRefs: frames.map((frame) => frame.ref),
    };
  });
}

function framesForSourceBlock(block, vm) {
  return (block.frameRefs ?? [])
    .map((ref) => vm.frames?.byRef?.[frameRefKey(ref)])
    .filter(Boolean);
}

function makeReaderStep(index, blocks, vm) {
  const frames = blocks.flatMap((block) => framesForSourceBlock(block, vm));
  const foreground = mergeActivations(frames, 'foregroundConcepts');
  const background = mergeActivations(frames, 'backgroundConcepts')
    .filter((activation) => !foreground.some((fg) => fg.id === activation.id));
  const relations = mergeActivations(frames, 'activeRelations');
  const summary = frames.find((frame) => frame.summary)?.summary
    ?? blocks.map((block) => block.text).join(' ').slice(0, 180);
  return {
    id: `reader-step-${index}`,
    index,
    sourceBlockIds: blocks.map((block) => block.id),
    span: spanUnion(blocks),
    summary,
    focusConcepts: foreground,
    supportingConcepts: background,
    focusRelations: relations,
    sectionId: undefined,
    hasFocus: Boolean(foreground.length || relations.length),
    derivedFromLegacyFrames: true,
  };
}

function buildReaderSteps(sourceBlocks, vm) {
  const steps = [];
  let buffer = [];

  const flush = () => {
    if (!buffer.length) return;
    const step = makeReaderStep(steps.length, buffer, vm);
    if (!step.hasFocus && steps.length) {
      const previous = steps[steps.length - 1];
      const mergedBlocks = [
        ...previous.sourceBlockIds.map((id) => sourceBlocks.find((block) => block.id === id)).filter(Boolean),
        ...buffer,
      ];
      steps[steps.length - 1] = makeReaderStep(previous.index, mergedBlocks, vm);
    } else {
      steps.push(step);
    }
    buffer = [];
  };

  for (const block of sourceBlocks) {
    buffer.push(block);
    const frames = framesForSourceBlock(block, vm);
    if (frames.some(hasFocusFrame)) flush();
  }
  flush();

  return steps.map((step, index) => ({ ...step, id: `reader-step-${index}`, index }));
}

function buildSections(readerSteps, vm) {
  const macros = vm.frames?.macro ?? [];
  if (!macros.length) {
    const span = spanUnion(readerSteps);
    return readerSteps.length
      ? [{ id: 'section-0', index: 0, title: 'Source Journey', summary: '', readerStepIndexes: readerSteps.map((step) => step.index), span, legacyFrameRef: undefined }]
      : [];
  }

  return macros.map((macro, index) => {
    const stepIndexes = readerSteps
      .filter((step) => step.span.start < macro.span.end && step.span.end > macro.span.start)
      .map((step) => step.index);
    return {
      id: `section-${index}`,
      index,
      title: macro.title || `Section ${index + 1}`,
      summary: macro.summary ?? '',
      readerStepIndexes: stepIndexes,
      span: { start: macro.span.start, end: macro.span.end },
      legacyFrameRef: macro.ref,
    };
  });
}

function assignSections(readerSteps, sections) {
  const byIndex = new Map();
  for (const section of sections) {
    for (const index of section.readerStepIndexes) byIndex.set(index, section.id);
  }
  return readerSteps.map((step) => ({ ...step, sectionId: byIndex.get(step.index) }));
}

export function buildReaderJourneyVM(vm) {
  const sourceBlocks = buildSourceBlocks(vm);
  let readerSteps = buildReaderSteps(sourceBlocks, vm);
  const sections = buildSections(readerSteps, vm);
  readerSteps = assignSections(readerSteps, sections);

  return {
    sourceBlocks,
    readerSteps,
    sections,
    sourceBlockById: Object.fromEntries(sourceBlocks.map((block) => [block.id, block])),
    readerStepById: Object.fromEntries(readerSteps.map((step) => [step.id, step])),
    sectionById: Object.fromEntries(sections.map((section) => [section.id, section])),
    afterEnd: { index: readerSteps.length, label: 'whole-picture' },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
node --test test/reader-journey.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/view-model/buildReaderJourneyVM.js test/reader-journey.test.js
git commit -m "feat(vm): derive source-first reader journey"
```

---

### Task 2: Attach ReaderJourneyVM to the main view model and selectors

**Files:**
- Modify: `src/view-model/buildMindgraphViewModel.js`
- Modify: `test/reader-journey.test.js`

- [ ] **Step 1: Add failing integration tests**

Append this to `test/reader-journey.test.js`:

```js
import { buildMindgraphViewModel } from '../src/view-model/buildMindgraphViewModel.js';

test('buildMindgraphViewModel exposes readerJourney and reader step selectors', () => {
  const doc = {
    version: 1,
    kind: 'mindgraph.document',
    transcript: {
      title: 'Doc',
      source: '',
      speakers: [],
      segments: [
        { id: 'seg-0', start: 0, end: 10, text: 'Focused paragraph.' },
      ],
    },
    concepts: { atomic: [{ id: 'a', label: 'A' }], clustered: [] },
    relations: [],
    frames: {
      micro: [{
        id: 'micro-0',
        t: 0,
        span: { start: 0, end: 10 },
        speakers: [],
        summary: 'Focused paragraph.',
        foregroundConcepts: [{ id: 'a', weight: 1, mode: 'explicit' }],
        backgroundConcepts: [],
        activeRelations: [],
        sourceSegmentIds: ['seg-0'],
        sourceFrameRefs: [],
      }],
      meso: [],
      macro: [],
    },
    meta: {},
  };

  const built = buildMindgraphViewModel(doc);

  assert.equal(built.readerJourney.readerSteps.length, 1);
  assert.equal(built.selectors.getReaderStep(0).id, 'reader-step-0');
  assert.equal(built.selectors.getReaderStepAtSourcePosition(5).id, 'reader-step-0');
  assert.equal(built.selectors.getReaderPresentationState(1).presentationMode, 'whole-picture');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test test/reader-journey.test.js
```

Expected: FAIL because `readerJourney` / selectors are undefined.

- [ ] **Step 3: Modify `src/view-model/buildMindgraphViewModel.js` imports**

Add this import at the top:

```js
import { buildReaderJourneyVM } from './buildReaderJourneyVM.js';
```

- [ ] **Step 4: Add reader journey selectors inside `buildSelectors`**

Inside `buildSelectors(viewModel)`, add `readerJourney` to the destructuring:

```js
const { concepts, relations, frames, transcript, indexes, readerJourney } = viewModel;
```

Then add these functions before the returned selector object:

```js
function getReaderStep(index) {
  return readerJourney?.readerSteps?.[index];
}

function getReaderStepAtSourcePosition(position) {
  return readerJourney?.readerSteps?.find((step) => step.span.start <= position && position < step.span.end);
}

function getReaderPresentationState(index) {
  const steps = readerJourney?.readerSteps ?? [];
  if (index == null) return { presentationMode: 'focused-step', readerStep: steps[0], readerStepIndex: 0 };
  if (index >= steps.length) return { presentationMode: 'whole-picture', readerStep: null, readerStepIndex: null };
  return { presentationMode: 'focused-step', readerStep: steps[index], readerStepIndex: index };
}
```

Add these properties to the returned selector object:

```js
getReaderStep,
getReaderStepAtSourcePosition,
getReaderPresentationState,
```

- [ ] **Step 5: Attach `readerJourney` before selectors are built**

In `buildMindgraphViewModel(document)`, after `documentMeta` is created, add:

```js
const baseViewModel = {
  documentMeta,
  transcript,
  concepts,
  relations,
  frames,
  graph,
  indexes,
};
const readerJourney = buildReaderJourneyVM(baseViewModel);
```

Replace the existing `const viewModel = { ... }` with:

```js
const viewModel = {
  ...baseViewModel,
  readerJourney,
};
```

- [ ] **Step 6: Run test to verify it passes**

Run:

```bash
node --test test/reader-journey.test.js
```

Expected: PASS.

- [ ] **Step 7: Run VM example**

Run:

```bash
npm run vm:example
```

Expected: command prints a representative VM slice without throwing.

- [ ] **Step 8: Commit**

```bash
git add src/view-model/buildMindgraphViewModel.js test/reader-journey.test.js
git commit -m "feat(vm): expose reader journey selectors"
```

---

### Task 3: Make graph render state prefer reader step focus and support whole-picture mode

**Files:**
- Modify: `src/view-model/buildGraphRenderState.js`
- Create: `test/reader-journey-render-state.test.js`

- [ ] **Step 1: Write failing graph render state tests**

Create `test/reader-journey-render-state.test.js` with this content:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMindgraphViewModel } from '../src/view-model/buildMindgraphViewModel.js';
import { buildGraphRenderState } from '../src/view-model/buildGraphRenderState.js';

function doc() {
  return {
    version: 1,
    kind: 'mindgraph.document',
    transcript: {
      title: 'Doc',
      source: '',
      speakers: [],
      segments: [
        { id: 'seg-0', start: 0, end: 10, text: 'A.' },
        { id: 'seg-1', start: 10, end: 20, text: 'B.' },
      ],
    },
    concepts: { atomic: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], clustered: [] },
    relations: [{ id: 'a-b', from: 'a', to: 'b', type: 'supports' }],
    frames: {
      micro: [
        { id: 'm0', t: 0, span: { start: 0, end: 10 }, speakers: [], foregroundConcepts: [{ id: 'a', weight: 1 }], backgroundConcepts: [], activeRelations: [], sourceSegmentIds: ['seg-0'], sourceFrameRefs: [] },
        { id: 'm1', t: 10, span: { start: 10, end: 20 }, speakers: [], foregroundConcepts: [{ id: 'b', weight: 1 }], backgroundConcepts: [], activeRelations: [{ id: 'a-b', weight: 1 }], sourceSegmentIds: ['seg-1'], sourceFrameRefs: [] },
      ],
      meso: [],
      macro: [],
    },
    meta: {},
  };
}

test('buildGraphRenderState uses reader step focus when readerStepIndex is provided', () => {
  const vm = buildMindgraphViewModel(doc());
  const state = buildGraphRenderState(vm, { readerStepIndex: 1, presentationMode: 'focused-step', playheadTime: 0 });

  assert.deepEqual(state.activeNodeIds, ['b']);
  assert.ok(state.activeEdgeIds.includes('a-b'));
});

test('buildGraphRenderState whole-picture mode has no local active focus but keeps graph visible', () => {
  const vm = buildMindgraphViewModel(doc());
  const state = buildGraphRenderState(vm, { readerStepIndex: null, presentationMode: 'whole-picture', playheadTime: 20 });

  assert.deepEqual(state.activeNodeIds, []);
  assert.equal(state.presentationMode, 'whole-picture');
  assert.ok(state.visibleNodeIds.includes('a'));
  assert.ok(state.visibleNodeIds.includes('b'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test test/reader-journey-render-state.test.js
```

Expected: FAIL because `readerStepIndex` and `presentationMode` are ignored.

- [ ] **Step 3: Add reader journey options to `buildGraphRenderState`**

In the parameter destructuring for `buildGraphRenderState`, add:

```js
readerStepIndex,
presentationMode = 'focused-step',
```

- [ ] **Step 4: Add helper functions in `src/view-model/buildGraphRenderState.js`**

Add these helpers near `buildFocusSets`:

```js
function idsFromReaderStep(step) {
  return unique([
    ...(step?.focusConcepts ?? []).map((a) => a.id),
    ...(step?.supportingConcepts ?? []).map((a) => a.id),
  ]);
}

function relationIdsFromReaderStep(step) {
  return unique((step?.focusRelations ?? []).map((a) => a.id));
}

function buildReaderStepFocusSets(viewModel, { selectedConceptId, selectedFrameRef, readerStepIndex, presentationMode }) {
  if (presentationMode === 'whole-picture') {
    return {
      focusMode: 'whole-picture',
      selectedNodeIds: selectedConceptId ? [selectedConceptId] : [],
      activeNodeIds: [],
      playheadRelationIds: [],
      primaryFocusIds: [],
      nearContextIds: [],
      farContextIds: [],
      selectedClusterIds: [],
    };
  }
  const step = viewModel.selectors.getReaderStep(readerStepIndex);
  if (!step) return undefined;
  const activeNodeIds = idsFromReaderStep(step);
  const playheadRelationIds = relationIdsFromReaderStep(step);
  const primaryFocusIds = unique((step.focusConcepts ?? []).map((a) => a.id));
  const nearContextIds = unique(primaryFocusIds.flatMap((id) => viewModel.selectors.getConceptNeighbors(id).map((concept) => concept.id)));
  const farContextIds = unique(nearContextIds.flatMap((id) => viewModel.selectors.getConceptNeighbors(id).map((concept) => concept.id)));
  const selectedClusterIds = unique(primaryFocusIds.flatMap((id) => viewModel.selectors.getConceptClusters(id).map((concept) => concept.id)));
  return {
    focusMode: selectedConceptId ? 'concept' : selectedFrameRef ? 'frame' : 'reader-step',
    selectedNodeIds: selectedConceptId ? [selectedConceptId] : [],
    activeNodeIds,
    playheadRelationIds,
    primaryFocusIds,
    nearContextIds,
    farContextIds,
    selectedClusterIds,
  };
}
```

- [ ] **Step 5: Prefer reader-step focus in `buildGraphRenderState`**

Replace the line that creates `focus` with:

```js
const focus = buildReaderStepFocusSets(viewModel, { selectedConceptId, selectedFrameRef, readerStepIndex, presentationMode })
  ?? buildFocusSets(viewModel, { selectedConceptId, selectedFrameRef, playheadTime, activeLevel });
```

In the returned object from `buildGraphRenderState`, include:

```js
presentationMode,
readerStepIndex: presentationMode === 'whole-picture' ? null : readerStepIndex,
```

- [ ] **Step 6: Ensure whole-picture visible nodes use all graph nodes**

Find where `visibleNodeIds` is derived in `buildGraphRenderState`. If whole-picture mode currently gets only cumulative visible nodes, add this after `visibleNodeIds` is computed and before return:

```js
if (presentationMode === 'whole-picture') {
  visibleNodeIds = viewModel.graph.nodes.map((node) => node.id);
  visibleEdgeIds = viewModel.graph.edges.map((edge) => edge.id);
}
```

If `visibleNodeIds` / `visibleEdgeIds` are `const`, change them to `let`.

- [ ] **Step 7: Run tests**

Run:

```bash
node --test test/reader-journey-render-state.test.js
npm run test:layout
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/view-model/buildGraphRenderState.js test/reader-journey-render-state.test.js
git commit -m "feat(vm): render graph from reader step focus"
```

---

### Task 4: Switch prose rendering and scroll binding to reader steps

**Files:**
- Modify: `src/view-model/buildProseChunks.js`
- Modify: `ui/panels/prose.js`
- Modify: `ui/scroll-binding.js`
- Modify: `ui/app.js`
- Create: `test/prose-reader-journey.test.js`

- [ ] **Step 1: Write failing prose chunk test**

Create `test/prose-reader-journey.test.js` with this content:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMindgraphViewModel } from '../src/view-model/buildMindgraphViewModel.js';
import { buildProseChunks } from '../src/view-model/buildProseChunks.js';

function doc() {
  return {
    version: 1,
    kind: 'mindgraph.document',
    transcript: {
      title: 'Doc',
      source: '',
      speakers: [],
      segments: [
        { id: 'seg-0', start: 0, end: 10, text: 'Context.' },
        { id: 'seg-1', start: 10, end: 20, text: 'Focus.' },
      ],
    },
    concepts: { atomic: [{ id: 'focus', label: 'Focus' }], clustered: [] },
    relations: [],
    frames: {
      micro: [
        { id: 'm0', t: 0, span: { start: 0, end: 10 }, speakers: [], foregroundConcepts: [], backgroundConcepts: [], activeRelations: [], sourceSegmentIds: ['seg-0'], sourceFrameRefs: [] },
        { id: 'm1', t: 10, span: { start: 10, end: 20 }, speakers: [], foregroundConcepts: [{ id: 'focus', weight: 1 }], backgroundConcepts: [], activeRelations: [], sourceSegmentIds: ['seg-1'], sourceFrameRefs: [] },
      ],
      meso: [],
      macro: [],
    },
    meta: {},
  };
}

test('buildProseChunks emits reader-step chunks and after-end sentinel', () => {
  const vm = buildMindgraphViewModel(doc());
  const chunks = buildProseChunks(vm);

  assert.equal(chunks[0].kind, 'reader-step');
  assert.equal(chunks[0].readerStepIndex, 0);
  assert.equal(chunks[0].text, 'Context. Focus.');
  assert.equal(chunks.at(-1).kind, 'whole-picture');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test test/prose-reader-journey.test.js
```

Expected: FAIL because `buildProseChunks` still emits `paragraph` chunks.

- [ ] **Step 3: Replace `buildProseChunks` derivation**

In `src/view-model/buildProseChunks.js`, keep `computeMentions` and `escapeRegExp`, but replace `buildProseChunks(vm)` with:

```js
export function buildProseChunks(vm) {
  const journey = vm.readerJourney;
  if (!journey?.readerSteps?.length) return [];

  const chunks = [];
  let currentSectionId;
  for (const step of journey.readerSteps) {
    if (step.sectionId && step.sectionId !== currentSectionId) {
      const section = journey.sectionById[step.sectionId];
      if (section) {
        chunks.push({
          kind: 'section',
          title: section.title,
          sectionId: section.id,
          readerStepIndex: step.index,
          timeSpan: section.span,
        });
      }
      currentSectionId = step.sectionId;
    }
    const blocks = step.sourceBlockIds.map((id) => journey.sourceBlockById[id]).filter(Boolean);
    const text = blocks.map((block) => block.text).join(' ');
    const segmentIds = blocks.flatMap((block) => block.segmentIds ?? []);
    chunks.push({
      kind: 'reader-step',
      readerStepIndex: step.index,
      sourceBlockIds: step.sourceBlockIds,
      text,
      summary: step.summary,
      timeSpan: step.span,
      conceptMentions: computeMentions(text, segmentIds, vm),
    });
  }
  chunks.push({ kind: 'whole-picture', readerStepIndex: journey.afterEnd.index });
  return chunks;
}
```

Remove the old `PARAGRAPH_WORD_TARGET`, `PARAGRAPH_WORD_HARD_CEILING`, `newParagraph`, `finalizeParagraph`, and `countWords` code because paragraph grouping is now owned by `ReaderJourneyVM`.

- [ ] **Step 4: Update `ui/panels/prose.js` rendering**

Replace `renderChunk` with:

```js
function renderChunk(chunk, activeIds, selectedId) {
  if (chunk.kind === 'section') {
    return `<h2 class="prose-chapter" data-reader-step-index="${chunk.readerStepIndex}">${escapeHtml(chunk.title)}</h2>`;
  }
  if (chunk.kind === 'whole-picture') {
    return `<section class="prose-end" data-reader-step-index="${chunk.readerStepIndex}" data-presentation-mode="whole-picture"><h2>Whole picture</h2><p>End of source journey. The graph now shows the complete map.</p></section>`;
  }
  return renderReaderStep(chunk, activeIds, selectedId);
}
```

Replace `renderParagraph` with:

```js
function renderReaderStep(step, activeIds, selectedId) {
  const inner = renderParagraphInner(step.text, step.conceptMentions, activeIds, selectedId);
  return `<p class="prose-para" data-reader-step-index="${step.readerStepIndex}" data-time-start="${step.timeSpan.start}" data-time-end="${step.timeSpan.end}">${inner}</p>`;
}
```

- [ ] **Step 5: Update `ui/scroll-binding.js`**

Replace `computeCenteredPlayhead` with `computeCenteredReaderPosition`:

```js
function computeCenteredReaderPosition(container) {
  const containerRect = container.getBoundingClientRect();
  const centerY = containerRect.top + containerRect.height / 2;
  const nodes = container.querySelectorAll('[data-reader-step-index]');
  if (!nodes.length) return null;

  let chosen = nodes[0];
  for (const node of nodes) {
    const rect = node.getBoundingClientRect();
    if (rect.top > centerY) break;
    chosen = node;
  }
  const index = Number(chosen.getAttribute('data-reader-step-index'));
  const mode = chosen.getAttribute('data-presentation-mode') || 'focused-step';
  return Number.isFinite(index) ? { readerStepIndex: index, presentationMode: mode } : null;
}
```

In the scroll listener, replace playhead update logic with:

```js
const position = computeCenteredReaderPosition(container);
if (position == null) return;
const state = getState();
if (state.readerStepIndex === position.readerStepIndex && state.presentationMode === position.presentationMode) return;
state.readerStepIndex = position.readerStepIndex;
state.presentationMode = position.presentationMode;
const step = state.viewModel.selectors.getReaderStep(position.readerStepIndex);
if (step) state.playheadTime = step.span.start;
onChange();
```

- [ ] **Step 6: Update `ui/app.js` state and graph render call**

In `state`, add:

```js
readerStepIndex: 0,
presentationMode: 'focused-step',
```

In `bootstrap()`, replace initial `playheadTime` assignment with:

```js
state.readerStepIndex = 0;
state.presentationMode = 'focused-step';
state.playheadTime = state.viewModel.readerJourney.readerSteps[0]?.span.start ?? 0;
```

In `computeGraphRenderState()`, pass:

```js
readerStepIndex: state.readerStepIndex,
presentationMode: state.presentationMode,
```

- [ ] **Step 7: Run tests and syntax checks**

Run:

```bash
node --test test/prose-reader-journey.test.js
node --test test/reader-journey.test.js
node --test test/reader-journey-render-state.test.js
npm run ui:check
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/view-model/buildProseChunks.js ui/panels/prose.js ui/scroll-binding.js ui/app.js test/prose-reader-journey.test.js
git commit -m "feat(ui): navigate prose by reader steps"
```

---

### Task 5: Render section strip from ReaderJourney sections

**Files:**
- Modify: `ui/panels/chapter-strip.js`
- Modify: `ui/events.js`
- Modify: `ui/app.js`
- Create: `test/chapter-strip-reader-journey.test.js`

- [ ] **Step 1: Write failing section strip test**

Create `test/chapter-strip-reader-journey.test.js` with this content:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderChapterStrip } from '../ui/panels/chapter-strip.js';

test('renderChapterStrip renders reader journey sections', () => {
  const vm = {
    documentMeta: { durationSeconds: 100 },
    readerJourney: {
      sections: [{ id: 'section-0', index: 0, title: 'Opening', span: { start: 0, end: 40 }, readerStepIndexes: [0, 1] }],
    },
  };
  const html = renderChapterStrip(vm, { readerStepIndex: 1, presentationMode: 'focused-step' });

  assert.match(html, /Opening/);
  assert.match(html, /data-action="jump-section"/);
  assert.match(html, /data-section-index="0"/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test test/chapter-strip-reader-journey.test.js
```

Expected: FAIL because the strip renders macro frame actions.

- [ ] **Step 3: Modify `ui/panels/chapter-strip.js`**

Replace macro derivation with section derivation:

```js
const sections = vm.readerJourney?.sections ?? [];
const total = Math.max(1, vm.documentMeta.durationSeconds);
const currentStep = vm.readerJourney?.readerSteps?.[state.readerStepIndex];
const activeSectionId = currentStep?.sectionId;
```

Replace segment mapping with:

```js
const segments = sections
  .map((section) => {
    const leftPct = (section.span.start / total) * 100;
    const widthPct = ((section.span.end - section.span.start) / total) * 100;
    const isActive = section.id === activeSectionId;
    const cls = ['strip-seg'];
    if (isActive) cls.push('is-active');
    const title = escapeHtml(section.title || `Section ${section.index + 1}`);
    return `<button type="button" class="${cls.join(' ')}" data-action="jump-section" data-section-index="${section.index}" title="${title}" style="left:${leftPct}%;width:${widthPct}%"></button>`;
  })
  .join('');
```

Change label text from `chapters` to `sections`:

```js
`<span class="strip-label">sections</span>`
```

- [ ] **Step 4: Update jump action handling**

Open `ui/events.js`. Find the existing `jump-chapter` handler. Add a `jump-section` branch:

```js
if (action === 'jump-section') {
  const index = Number(target.dataset.sectionIndex);
  const section = state.viewModel.readerJourney.sections[index];
  const firstStepIndex = section?.readerStepIndexes?.[0];
  if (Number.isInteger(firstStepIndex)) {
    state.readerStepIndex = firstStepIndex;
    state.presentationMode = 'focused-step';
    const step = state.viewModel.selectors.getReaderStep(firstStepIndex);
    if (step) state.playheadTime = step.span.start;
    state.cameraMode = 'auto';
    render();
  }
  return;
}
```

If the file uses a different local variable than `target`, match the existing event target variable name.

- [ ] **Step 5: Run tests and syntax checks**

Run:

```bash
node --test test/chapter-strip-reader-journey.test.js
npm run ui:check
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add ui/panels/chapter-strip.js ui/events.js test/chapter-strip-reader-journey.test.js
git commit -m "feat(ui): show reader journey sections"
```

---

### Task 6: Add reader journey readiness warnings

**Files:**
- Modify: `src/core/digest.js`
- Modify: `test/digest.test.js`

- [ ] **Step 1: Write failing digest readiness tests**

Append to `test/digest.test.js`:

```js
test('evaluateDigest reports reader journey readiness warnings for unfocused source progress', () => {
  const doc = createEmptyDocument({
    transcript: {
      title: 'Unfocused Article',
      source: '',
      speakers: [],
      segments: [
        { id: 'seg-0', start: 0, end: 10, text: 'A source block without semantic annotation.' },
      ],
    },
    concepts: { atomic: [], clustered: [] },
    relations: [],
    frames: {
      micro: [{
        id: 'micro-0',
        t: 0,
        span: { start: 0, end: 10 },
        speakers: [],
        foregroundConcepts: [],
        backgroundConcepts: [],
        activeRelations: [],
        sourceSegmentIds: ['seg-0'],
        sourceFrameRefs: [],
      }],
      meso: [],
      macro: [],
    },
  });

  const result = evaluateDigest(doc);

  assert.ok(result.uxReadiness.warnings.some((warning) => warning.code === 'reader-step-without-focus'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm run test:digest
```

Expected: FAIL because no `reader-step-without-focus` warning exists.

- [ ] **Step 3: Import view model builder in `src/core/digest.js`**

Add import:

```js
import { buildMindgraphViewModel } from '../view-model/buildMindgraphViewModel.js';
```

- [ ] **Step 4: Add reader journey warnings inside `evaluateUxReadiness(doc)`**

Near the end of `evaluateUxReadiness`, before returning, add:

```js
let readerJourney;
try {
  readerJourney = buildMindgraphViewModel(doc).readerJourney;
} catch {
  readerJourney = undefined;
}

for (const step of readerJourney?.readerSteps ?? []) {
  if (!step.hasFocus) {
    warnings.push({
      code: 'reader-step-without-focus',
      message: `Reader step ${step.index} has no focus concepts or relations.`,
      recommendedAction: 'Merge this source span with a neighboring step or add semantic focus during digesting.',
    });
  }
}

const coveredBlockIds = new Set((readerJourney?.readerSteps ?? []).flatMap((step) => step.sourceBlockIds));
for (const block of readerJourney?.sourceBlocks ?? []) {
  if (!coveredBlockIds.has(block.id)) {
    warnings.push({
      code: 'source-block-uncovered',
      message: `Source block ${block.index} is not covered by any reader step.`,
      recommendedAction: 'Regenerate reader steps so every source block is covered or explicitly skipped.',
    });
  }
}
```

- [ ] **Step 5: Run digest tests**

Run:

```bash
npm run test:digest
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/digest.js test/digest.test.js
git commit -m "feat(digest): report reader journey readiness"
```

---

### Task 7: Final verification and browser smoke

**Files:**
- No source changes expected unless verification finds bugs.

- [ ] **Step 1: Run full automated checks**

Run:

```bash
npm run test:source
npm run test:journey
npm run test:mcp
npm run test:digest
npm run test:layout
node --test test/animator.test.js
node --test test/spawn-tuning.test.js
node --test test/reader-journey.test.js
node --test test/reader-journey-render-state.test.js
node --test test/prose-reader-journey.test.js
node --test test/chapter-strip-reader-journey.test.js
npm run ui:check
npm run vm:example
```

Expected: all pass.

- [ ] **Step 2: Run smoke test**

Run:

```bash
npm run test:smoke
```

Expected: PASS. It will generate smoke artifacts.

- [ ] **Step 3: Clean smoke artifacts**

Run:

```bash
git checkout -- examples/out/awakening.mindgraph.json
git clean -f examples/out/empty.mindgraph.json
```

Expected: generated smoke files removed or restored.

- [ ] **Step 4: Start UI dev server for manual verification**

Run:

```bash
node src/ui/dev-server.js --port 4173 --host 127.0.0.1 --doc examples/out/episode-1-built.mindgraph.json
```

Expected log:

```txt
mindgraph UI shell available at http://127.0.0.1:4173
```

Open `http://127.0.0.1:4173/?debugLayout=1` in the browser.

Verify:

- prose scroll changes the graph focus step-by-step
- section strip says `sections`, not `chapters`
- clicking a section jumps to its first reader step
- scrolling past the final prose block shows the whole graph with no local active focus
- the graph does not go dark at the end

- [ ] **Step 5: Commit any verification fixes**

If Step 4 required fixes, commit them:

```bash
git add src/view-model/buildReaderJourneyVM.js src/view-model/buildMindgraphViewModel.js src/view-model/buildGraphRenderState.js src/view-model/buildProseChunks.js src/core/digest.js ui/app.js ui/scroll-binding.js ui/panels/prose.js ui/panels/chapter-strip.js ui/events.js test/reader-journey.test.js test/reader-journey-render-state.test.js test/prose-reader-journey.test.js test/chapter-strip-reader-journey.test.js test/digest.test.js
git commit -m "fix(ui): polish reader journey navigation"
```

If no fixes were needed, do not create an empty commit.

---

## Self-review

Spec coverage:

- Source-first reader navigation: Tasks 1, 2, 4.
- Focus required for visible progress: Tasks 1 and 6.
- UI-only after-end whole-picture state: Tasks 3 and 4.
- Hide user-facing micro/meso/macro navigation: Tasks 4 and 5.
- Compatibility over current document schema: Tasks 1 and 2.
- LLM/operator readiness feedback: Task 6.

Scope intentionally excluded from this implementation slice:

- First-class schema migration to `sourceBlocks`, `readerSteps`, and `sections`.
- CLI/MCP commands for producing first-class reader steps.
- New digest prompt templates.
- Multiple reader journeys over the same source.

Placeholder scan: no `TBD`, `TODO`, or unspecified implementation steps remain.

Type consistency: `ReaderJourneyVM`, `SourceBlockVM`, `ReaderStepVM`, `SectionVM`, `readerStepIndex`, and `presentationMode` names are used consistently across tasks.

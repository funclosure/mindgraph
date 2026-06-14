# Mindgraph Authoring v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first testable source-first authoring substrate: parse `*.mindgraph.md`, validate it, compile it to source-first JSON, and expose CLI commands for validation and compilation.

**Architecture:** Add a focused `src/core/authoring/` module with three boundaries: `parse.js` turns Markdown directives into an authoring model, `compile.js` turns that model into source-first runtime JSON, and `schema.js` validates the compiled shape and invariants. Keep this slice independent from the old `micro / meso / macro` document model and from the UI.

**Tech Stack:** Node 18+ ES modules, built-in `fs/path` APIs, `node:test`, no runtime dependencies, no bundler, no UI framework.

---

## File Structure

- Create `src/core/authoring/schema.js`
  - Owns source-first runtime validation.
  - Exports `validateSourceFirstDocument(doc)` and `formatSourceFirstValidationErrors(result)`.
  - Does not import legacy `src/core/schema.js`.

- Create `src/core/authoring/parse.js`
  - Owns parsing `*.mindgraph.md` text into a normalized authoring model.
  - Exports `parseAuthoringMarkdown(markdown, { filePath } = {})`.
  - Uses a small hand-written parser for frontmatter, directive headers, key-value fields, YAML-ish lists, and directive body text.

- Create `src/core/authoring/compile.js`
  - Owns conversion from parsed authoring model to source-first runtime JSON.
  - Exports `compileAuthoringMarkdown(markdown, opts)` and `compileAuthoringModel(model, opts)`.
  - Calls `validateSourceFirstDocument` and returns `{ document, validation }`.

- Modify `src/cli/index.js`
  - Import authoring compile/validate helpers.
  - Add `mindgraph authoring validate <file.md> [--json]`.
  - Add `mindgraph authoring compile <file.md> -o <file.json> [--json]`.
  - Update help text.

- Modify `package.json`
  - Add `test:authoring`.

- Create `test/authoring-schema.test.js`
  - Unit tests for source-first runtime validation.
  - Task 1 starts `test:authoring` with this suite only; later tasks expand the script as their suites are created.

- Create `test/authoring-parse.test.js`
  - Unit tests for Markdown parsing.

- Create `test/authoring-compile.test.js`
  - Unit tests for compilation and CLI behavior.

- Create `examples/authoring/recursive-self-improvement.mindgraph.md`
  - Small hand-authored fixture using the v1 format.

---

### Task 1: Add Source-First Runtime Schema Validation

**Files:**
- Create: `src/core/authoring/schema.js`
- Create: `test/authoring-schema.test.js`
- Modify: `package.json`

- [ ] **Step 1: Add the test script**

Open `package.json`. In `scripts`, add this entry after `test:mcp`:

```json
"test:authoring": "node --test test/authoring-schema.test.js"
```

Keep the surrounding comma placement valid JSON.

- [ ] **Step 2: Write failing schema tests**

Create `test/authoring-schema.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSourceFirstDocument } from '../src/core/authoring/schema.js';

function validDoc(overrides = {}) {
  return {
    kind: 'mindgraph.source-first',
    version: 1,
    title: 'Recursive Self-Improvement',
    sources: [
      { id: 'rsi-note', type: 'text', title: 'RSI Note', path: '../transcripts/recursive-self-improvement.txt' },
    ],
    sourceBlocks: [
      { id: 'b001', sourceId: 'rsi-note', kind: 'heading', text: 'Recursive Self-Improvement', order: 0 },
      { id: 'b002', sourceId: 'rsi-note', kind: 'paragraph', text: 'A feedback process.', order: 1 },
    ],
    readerSteps: [
      {
        id: 's001',
        sectionId: 'setup',
        sourceBlockIds: ['b001', 'b002'],
        summary: 'The source introduces recursive self-improvement as feedback.',
        focusConcepts: [{ id: 'recursive-self-improvement', weight: 0.95, mode: 'explicit' }],
        focusRelations: [{ id: 'rsi-depends-on-feedback', weight: 0.85 }],
      },
    ],
    sections: [
      { id: 'setup', title: 'Setup', summary: '', readerStepIds: ['s001'] },
    ],
    concepts: {
      atomic: [
        { id: 'recursive-self-improvement', label: 'Recursive Self-Improvement', parentIds: ['ai-capability-growth'], firstSeenBlockId: 'b002' },
        { id: 'feedback-loop', label: 'Feedback Loop', parentIds: [], firstSeenBlockId: 'b002' },
      ],
      clustered: [
        { id: 'ai-capability-growth', label: 'AI Capability Growth', childIds: ['recursive-self-improvement'] },
      ],
    },
    relations: [
      {
        id: 'rsi-depends-on-feedback',
        from: 'recursive-self-improvement',
        to: 'feedback-loop',
        type: 'depends_on',
        provenance: 'source',
        groundedInBlockIds: ['b002'],
      },
    ],
    intakes: [],
    revisions: [],
    ...overrides,
  };
}

test('validateSourceFirstDocument accepts a minimal source-first graph', () => {
  const result = validateSourceFirstDocument(validDoc());
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test('validateSourceFirstDocument rejects missing top-level identity', () => {
  const result = validateSourceFirstDocument({ ...validDoc(), kind: 'mindgraph.document' });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /kind must be 'mindgraph.source-first'/);
});

test('validateSourceFirstDocument rejects duplicate concept ids across atomic and clustered namespaces', () => {
  const doc = validDoc({
    concepts: {
      atomic: [
        { id: 'recursive-self-improvement', label: 'Recursive Self-Improvement', parentIds: [], firstSeenBlockId: 'b002' },
      ],
      clustered: [
        { id: 'recursive-self-improvement', label: 'Recursive Self-Improvement Cluster', childIds: [] },
      ],
    },
  });

  const result = validateSourceFirstDocument(doc);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /concepts\.recursive-self-improvement is duplicated across atomic and clustered concepts/);
});

test('validateSourceFirstDocument rejects section membership disagreement', () => {
  const doc = validDoc({
    readerSteps: [
      {
        id: 's001',
        sectionId: 'setup',
        sourceBlockIds: ['b001', 'b002'],
        summary: 'The source introduces recursive self-improvement as feedback.',
        focusConcepts: [{ id: 'recursive-self-improvement', weight: 0.95, mode: 'explicit' }],
        focusRelations: [{ id: 'rsi-depends-on-feedback', weight: 0.85 }],
      },
    ],
    sections: [
      { id: 'setup', title: 'Setup', summary: '', readerStepIds: [] },
      { id: 'wrong-section', title: 'Wrong Section', summary: '', readerStepIds: ['s001'] },
    ],
  });

  const result = validateSourceFirstDocument(doc);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /readerSteps\.s001 references section 'setup' but that section does not list the step/);
  assert.match(result.errors.join('\n'), /sections\.wrong-section lists readerStep 's001' but the step belongs to section 'setup'/);
});

test('validateSourceFirstDocument rejects partial missing relation grounding', () => {
  const doc = validDoc({
    relations: [
      {
        id: 'partially-grounded',
        from: 'recursive-self-improvement',
        to: 'feedback-loop',
        type: 'depends_on',
        provenance: 'source',
        groundedInBlockIds: ['missing-block', 'b002'],
      },
    ],
    readerSteps: [
      {
        id: 's001',
        sectionId: 'setup',
        sourceBlockIds: ['b001', 'b002'],
        summary: 'The source introduces recursive self-improvement as feedback.',
        focusConcepts: [{ id: 'recursive-self-improvement', weight: 0.95, mode: 'explicit' }],
        focusRelations: [{ id: 'partially-grounded', weight: 0.85 }],
      },
    ],
  });

  const result = validateSourceFirstDocument(doc);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /relations\.partially-grounded groundedInBlockId 'missing-block' references missing block/);
});

test('validateSourceFirstDocument rejects empty source-first graphs', () => {
  const result = validateSourceFirstDocument({
    kind: 'mindgraph.source-first',
    version: 1,
    title: 'Empty',
    sources: [],
    sourceBlocks: [],
    readerSteps: [],
    sections: [],
    concepts: { atomic: [], clustered: [] },
    relations: [],
    intakes: [],
    revisions: [],
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /sources must include at least one source/);
  assert.match(result.errors.join('\n'), /sourceBlocks must include at least one block/);
  assert.match(result.errors.join('\n'), /readerSteps must include at least one step/);
  assert.match(result.errors.join('\n'), /sections must include at least one section/);
});

test('validateSourceFirstDocument rejects missing references and focus-less visible steps', () => {
  const doc = validDoc({
    sourceBlocks: [{ id: 'b001', sourceId: 'missing-source', kind: 'paragraph', text: 'Text.', order: 0 }],
    readerSteps: [{
      id: 's001',
      sectionId: 'missing-section',
      sourceBlockIds: ['missing-block'],
      summary: 'Broken.',
      focusConcepts: [],
      focusRelations: [],
    }],
    sections: [{ id: 'setup', title: 'Setup', summary: '', readerStepIds: ['missing-step'] }],
    relations: [{ id: 'bad-relation', from: 'missing-from', to: 'missing-to', type: 'relates', provenance: 'source', groundedInBlockIds: [] }],
  });

  const result = validateSourceFirstDocument(doc);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /sourceBlocks\.b001 references missing source 'missing-source'/);
  assert.match(result.errors.join('\n'), /readerSteps\.s001 references missing sourceBlock 'missing-block'/);
  assert.match(result.errors.join('\n'), /readerSteps\.s001 has no focus anchors/);
  assert.match(result.errors.join('\n'), /readerSteps\.s001 references missing section 'missing-section'/);
  assert.match(result.errors.join('\n'), /sections\.setup references missing readerStep 'missing-step'/);
  assert.match(result.errors.join('\n'), /relations\.bad-relation\.from references missing concept 'missing-from'/);
  assert.match(result.errors.join('\n'), /relations\.bad-relation source provenance requires groundedInBlockIds/);
});

test('validateSourceFirstDocument requires inferred relation rationale', () => {
  const doc = validDoc({
    relations: [
      {
        id: 'inferred-without-rationale',
        from: 'recursive-self-improvement',
        to: 'feedback-loop',
        type: 'relates',
        provenance: 'inferred',
        rationale: '',
      },
    ],
    readerSteps: [
      {
        id: 's001',
        sectionId: 'setup',
        sourceBlockIds: ['b001'],
        summary: 'Uses inferred relation.',
        focusConcepts: [{ id: 'recursive-self-improvement', weight: 1 }],
        focusRelations: [{ id: 'inferred-without-rationale', weight: 1 }],
      },
    ],
  });

  const result = validateSourceFirstDocument(doc);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /relations\.inferred-without-rationale inferred provenance requires rationale/);
});
```

- [ ] **Step 3: Run schema tests and verify they fail**

Run:

```bash
node --test test/authoring-schema.test.js
```

Expected: FAIL with `Cannot find module '../src/core/authoring/schema.js'`.

- [ ] **Step 4: Implement source-first validation**

Create `src/core/authoring/schema.js`:

```js
function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function addDuplicateErrors(items, name, errors) {
  const seen = new Set();
  for (const item of items) {
    if (!item?.id) continue;
    if (seen.has(item.id)) errors.push(`${name}.${item.id} is duplicated`);
    seen.add(item.id);
  }
}

function collectIds(items) {
  return new Set(asArray(items).map((item) => item?.id).filter(Boolean));
}

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function validateSourceFirstDocument(doc) {
  const errors = [];

  if (!isObject(doc)) return { ok: false, errors: ['Document must be an object.'] };
  if (doc.kind !== 'mindgraph.source-first') errors.push("kind must be 'mindgraph.source-first'");
  if (doc.version !== 1) errors.push('version must be 1');
  if (!hasText(doc.title)) errors.push('title must be a non-empty string');

  for (const key of ['sources', 'sourceBlocks', 'readerSteps', 'sections', 'relations', 'intakes', 'revisions']) {
    if (!Array.isArray(doc[key])) errors.push(`${key} must be an array`);
  }
  if (!isObject(doc.concepts)) errors.push('concepts must be an object');
  if (!Array.isArray(doc.concepts?.atomic)) errors.push('concepts.atomic must be an array');
  if (!Array.isArray(doc.concepts?.clustered)) errors.push('concepts.clustered must be an array');

  const sources = asArray(doc.sources);
  const blocks = asArray(doc.sourceBlocks);
  const steps = asArray(doc.readerSteps);
  const sections = asArray(doc.sections);
  const atomic = asArray(doc.concepts?.atomic);
  const clustered = asArray(doc.concepts?.clustered);
  const relations = asArray(doc.relations);

  if (!sources.length) errors.push('sources must include at least one source');
  if (!blocks.length) errors.push('sourceBlocks must include at least one block');
  if (!steps.length) errors.push('readerSteps must include at least one step');
  if (!sections.length) errors.push('sections must include at least one section');

  addDuplicateErrors(sources, 'sources', errors);
  addDuplicateErrors(blocks, 'sourceBlocks', errors);
  addDuplicateErrors(steps, 'readerSteps', errors);
  addDuplicateErrors(sections, 'sections', errors);
  addDuplicateErrors(atomic, 'concepts.atomic', errors);
  addDuplicateErrors(clustered, 'concepts.clustered', errors);
  addDuplicateErrors(relations, 'relations', errors);

  const sourceIds = collectIds(sources);
  const blockIds = collectIds(blocks);
  const stepIds = collectIds(steps);
  const sectionIds = collectIds(sections);
  const conceptIds = new Set([...collectIds(atomic), ...collectIds(clustered)]);
  const relationIds = collectIds(relations);

  const atomicIds = collectIds(atomic);
  const clusteredIds = collectIds(clustered);
  for (const id of atomicIds) {
    if (clusteredIds.has(id)) errors.push(`concepts.${id} is duplicated across atomic and clustered concepts`);
  }

  for (const source of sources) {
    if (!hasText(source.id)) errors.push('sources entry id is required');
    if (!hasText(source.type)) errors.push(`sources.${source.id ?? '?'} type is required`);
    if (!hasText(source.title)) errors.push(`sources.${source.id ?? '?'} title is required`);
  }

  for (const block of blocks) {
    if (!hasText(block.id)) errors.push('sourceBlocks entry id is required');
    if (!sourceIds.has(block.sourceId)) errors.push(`sourceBlocks.${block.id ?? '?'} references missing source '${block.sourceId}'`);
    if (!hasText(block.kind)) errors.push(`sourceBlocks.${block.id ?? '?'} kind is required`);
    if (typeof block.text !== 'string') errors.push(`sourceBlocks.${block.id ?? '?'} text must be a string`);
    if (typeof block.order !== 'number') errors.push(`sourceBlocks.${block.id ?? '?'} order must be a number`);
  }

  for (const concept of atomic) {
    if (!hasText(concept.id)) errors.push('concepts.atomic entry id is required');
    if (!hasText(concept.label)) errors.push(`concepts.${concept.id ?? '?'} label is required`);
    for (const parentId of asArray(concept.parentIds)) {
      if (!collectIds(clustered).has(parentId)) errors.push(`concepts.${concept.id} references missing cluster '${parentId}'`);
    }
    if (concept.firstSeenBlockId != null && !blockIds.has(concept.firstSeenBlockId)) {
      errors.push(`concepts.${concept.id} firstSeenBlockId references missing block '${concept.firstSeenBlockId}'`);
    }
  }

  for (const cluster of clustered) {
    if (!hasText(cluster.id)) errors.push('concepts.clustered entry id is required');
    if (!hasText(cluster.label)) errors.push(`concepts.${cluster.id ?? '?'} label is required`);
    for (const childId of asArray(cluster.childIds)) {
      if (!collectIds(atomic).has(childId)) errors.push(`concepts.${cluster.id} references missing child concept '${childId}'`);
    }
  }

  for (const relation of relations) {
    if (!hasText(relation.id)) errors.push('relations entry id is required');
    if (!conceptIds.has(relation.from)) errors.push(`relations.${relation.id ?? '?'} .from references missing concept '${relation.from}'`.replace(' .from', '.from'));
    if (!conceptIds.has(relation.to)) errors.push(`relations.${relation.id ?? '?'} .to references missing concept '${relation.to}'`.replace(' .to', '.to'));
    if (!hasText(relation.type)) errors.push(`relations.${relation.id ?? '?'} type is required`);
    const provenance = relation.provenance ?? 'source';
    if (provenance !== 'source' && provenance !== 'inferred') errors.push(`relations.${relation.id ?? '?'} provenance must be 'source' or 'inferred'`);
    const groundedInBlockIds = asArray(relation.groundedInBlockIds);
    if (provenance === 'source' && !groundedInBlockIds.length) {
      errors.push(`relations.${relation.id ?? '?'} source provenance requires groundedInBlockIds`);
    }
    for (const blockId of groundedInBlockIds) {
      if (!blockIds.has(blockId)) errors.push(`relations.${relation.id ?? '?'} groundedInBlockId '${blockId}' references missing block`);
    }
    if (provenance === 'inferred' && !hasText(relation.rationale)) {
      errors.push(`relations.${relation.id ?? '?'} inferred provenance requires rationale`);
    }
  }

  for (const step of steps) {
    if (!hasText(step.id)) errors.push('readerSteps entry id is required');
    for (const blockId of asArray(step.sourceBlockIds)) {
      if (!blockIds.has(blockId)) errors.push(`readerSteps.${step.id ?? '?'} references missing sourceBlock '${blockId}'`);
    }
    if (!sectionIds.has(step.sectionId)) errors.push(`readerSteps.${step.id ?? '?'} references missing section '${step.sectionId}'`);
    for (const activation of asArray(step.focusConcepts)) {
      if (!conceptIds.has(activation.id)) errors.push(`readerSteps.${step.id ?? '?'} focusConcept '${activation.id}' references missing concept`);
      if (typeof activation.weight !== 'number') errors.push(`readerSteps.${step.id ?? '?'} focusConcept '${activation.id}' must include numeric weight`);
    }
    for (const activation of asArray(step.focusRelations)) {
      if (!relationIds.has(activation.id)) errors.push(`readerSteps.${step.id ?? '?'} focusRelation '${activation.id}' references missing relation`);
      if (typeof activation.weight !== 'number') errors.push(`readerSteps.${step.id ?? '?'} focusRelation '${activation.id}' must include numeric weight`);
    }
    if (!step.skipped && !asArray(step.focusConcepts).length && !asArray(step.focusRelations).length) {
      errors.push(`readerSteps.${step.id ?? '?'} has no focus anchors`);
    }
    const section = sections.find((candidate) => candidate.id === step.sectionId);
    if (section && !asArray(section.readerStepIds).includes(step.id)) {
      errors.push(`readerSteps.${step.id ?? '?'} references section '${step.sectionId}' but that section does not list the step`);
    }
  }

  for (const section of sections) {
    if (!hasText(section.id)) errors.push('sections entry id is required');
    if (!hasText(section.title)) errors.push(`sections.${section.id ?? '?'} title is required`);
    for (const stepId of asArray(section.readerStepIds)) {
      if (!stepIds.has(stepId)) errors.push(`sections.${section.id ?? '?'} references missing readerStep '${stepId}'`);
      const step = steps.find((candidate) => candidate.id === stepId);
      if (step && step.sectionId !== section.id) {
        errors.push(`sections.${section.id ?? '?'} lists readerStep '${stepId}' but the step belongs to section '${step.sectionId}'`);
      }
    }
  }

  const coveredBlockIds = new Set(steps.flatMap((step) => asArray(step.sourceBlockIds)));
  for (const block of blocks) {
    if (!block.skipped && !coveredBlockIds.has(block.id)) {
      errors.push(`sourceBlocks.${block.id} is not covered by any readerStep`);
    }
  }

  return { ok: errors.length === 0, errors };
}

export function formatSourceFirstValidationErrors(result) {
  return asArray(result?.errors).map((error) => `- ${error}`).join('\n');
}
```

- [ ] **Step 5: Run schema tests**

Run:

```bash
node --test test/authoring-schema.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

Run:

```bash
git add package.json src/core/authoring/schema.js test/authoring-schema.test.js
git commit -m "feat(authoring): validate source-first documents"
```

---

### Task 2: Parse Mindgraph Markdown

**Files:**
- Create: `src/core/authoring/parse.js`
- Create: `test/authoring-parse.test.js`
- Create: `examples/authoring/recursive-self-improvement.mindgraph.md`

- [ ] **Step 1: Add the example authoring file**

Create `examples/authoring/recursive-self-improvement.mindgraph.md`:

```md
---
kind: mindgraph.authoring
version: 1
title: Recursive Self-Improvement
runtime: ../out/recursive-self-improvement.mindgraph.json
---

# Sources

@source rsi-note
type: text
title: Recursive Self-Improvement Notes
path: ../../transcripts/recursive-self-improvement.txt

# Source Blocks

@block b001 source=rsi-note kind=heading
Recursive Self-Improvement

@block b002 source=rsi-note kind=paragraph
Recursive self-improvement is a feedback process where improved capability increases the ability to improve further.

# Reader Steps

@step s001 section=setup blocks=b001,b002
summary: The source introduces recursive self-improvement as a capability feedback loop.
focus:
  - recursive-self-improvement 0.95 explicit
  - feedback-loop 0.80 explicit
relations:
  - recursive-self-improvement -> feedback-loop depends_on 0.85

# Sections

@section setup
title: Setup: improvement as feedback
summary: The opening step frames recursive self-improvement as a feedback loop.
steps: s001

# Concepts

@concept recursive-self-improvement
label: Recursive Self-Improvement
aliases: RSI
cluster: ai-capability-growth
first_seen: b002

@concept feedback-loop
label: Feedback Loop
cluster: systems-dynamics
first_seen: b002

@cluster ai-capability-growth
label: AI Capability Growth
children: recursive-self-improvement

@cluster systems-dynamics
label: Systems Dynamics
children: feedback-loop

# Relations

@relation rsi-depends-on-feedback
from: recursive-self-improvement
to: feedback-loop
type: depends_on
provenance: source
grounded_in: b002
```

- [ ] **Step 2: Write failing parser tests**

Create `test/authoring-parse.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseAuthoringMarkdown } from '../src/core/authoring/parse.js';

const fixturePath = 'examples/authoring/recursive-self-improvement.mindgraph.md';

test('parseAuthoringMarkdown parses frontmatter and directives', () => {
  const markdown = fs.readFileSync(fixturePath, 'utf8');
  const model = parseAuthoringMarkdown(markdown, { filePath: fixturePath });

  assert.equal(model.meta.kind, 'mindgraph.authoring');
  assert.equal(model.meta.version, 1);
  assert.equal(model.meta.title, 'Recursive Self-Improvement');
  assert.equal(model.sources[0].id, 'rsi-note');
  assert.equal(model.sources[0].fields.title, 'Recursive Self-Improvement Notes');
  assert.equal(model.blocks[1].id, 'b002');
  assert.equal(model.blocks[1].attrs.source, 'rsi-note');
  assert.match(model.blocks[1].body, /feedback process/);
  assert.equal(model.steps[0].fields.summary, 'The source introduces recursive self-improvement as a capability feedback loop.');
  assert.deepEqual(model.steps[0].fields.focus, [
    { id: 'recursive-self-improvement', weight: 0.95, mode: 'explicit' },
    { id: 'feedback-loop', weight: 0.8, mode: 'explicit' },
  ]);
  assert.deepEqual(model.steps[0].fields.relations, [
    { from: 'recursive-self-improvement', to: 'feedback-loop', type: 'depends_on', weight: 0.85 },
  ]);
});

test('parseAuthoringMarkdown rejects documents without frontmatter', () => {
  assert.throws(
    () => parseAuthoringMarkdown('@source x\ntype: text\n'),
    /Missing frontmatter/
  );
});

test('parseAuthoringMarkdown rejects unknown directives', () => {
  assert.throws(
    () => parseAuthoringMarkdown('---\nkind: mindgraph.authoring\nversion: 1\ntitle: X\n---\n\n@unknown x\n'),
    /Unknown directive '@unknown'/
  );
});
```

- [ ] **Step 3: Run parser tests and verify they fail**

Run:

```bash
node --test test/authoring-parse.test.js
```

Expected: FAIL with `Cannot find module '../src/core/authoring/parse.js'`.

- [ ] **Step 4: Implement the parser**

Create `src/core/authoring/parse.js`:

```js
const DIRECTIVE_COLLECTIONS = {
  source: 'sources',
  block: 'blocks',
  step: 'steps',
  section: 'sections',
  concept: 'concepts',
  cluster: 'clusters',
  relation: 'relations',
  intake: 'intakes',
  revision: 'revisions',
};

function parseScalar(value) {
  const trimmed = String(value ?? '').trim();
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  return trimmed;
}

function parseCsv(value) {
  return String(value ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseFrontmatter(markdown) {
  if (!markdown.startsWith('---\n')) throw new Error('Missing frontmatter.');
  const end = markdown.indexOf('\n---', 4);
  if (end === -1) throw new Error('Unclosed frontmatter.');
  const raw = markdown.slice(4, end).trim();
  const meta = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) throw new Error(`Invalid frontmatter line: ${line}`);
    meta[match[1]] = parseScalar(match[2]);
  }
  return { meta, body: markdown.slice(end + 5).replace(/^\r?\n/, '') };
}

function parseDirectiveHeader(line) {
  const match = line.match(/^@([A-Za-z0-9_-]+)(?:\s+([A-Za-z0-9_.:-]+))?(.*)$/);
  if (!match) return null;
  const [, type, id, rest] = match;
  const collection = DIRECTIVE_COLLECTIONS[type];
  if (!collection) throw new Error(`Unknown directive '@${type}'.`);
  const attrs = {};
  for (const token of rest.trim().split(/\s+/).filter(Boolean)) {
    const attr = token.match(/^([A-Za-z0-9_-]+)=(.+)$/);
    if (!attr) throw new Error(`Invalid directive attribute '${token}' on @${type}.`);
    attrs[attr[1]] = attr[2];
  }
  return { type, collection, id, attrs, fields: {}, bodyLines: [] };
}

function parseFocusItem(value) {
  const [id, weight, mode] = value.trim().split(/\s+/);
  return { id, weight: Number(weight), ...(mode ? { mode } : {}) };
}

function parseRelationItem(value) {
  const match = value.trim().match(/^(\S+)\s+->\s+(\S+)\s+(\S+)\s+(-?\d+(?:\.\d+)?)$/);
  if (!match) throw new Error(`Invalid relation activation item: ${value}`);
  return { from: match[1], to: match[2], type: match[3], weight: Number(match[4]) };
}

function parseList(lines, startIndex, itemParser) {
  const values = [];
  let i = startIndex;
  while (i < lines.length) {
    const line = lines[i];
    const match = line.match(/^\s+-\s+(.+)$/);
    if (!match) break;
    values.push(itemParser(match[1]));
    i += 1;
  }
  return { values, nextIndex: i };
}

function parseDirectiveFields(entry) {
  const fields = {};
  const bodyLines = [];
  const lines = entry.bodyLines;
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    const field = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!field) {
      bodyLines.push(line);
      i += 1;
      continue;
    }
    const [, key, rawValue] = field;
    if (rawValue === '' && (key === 'focus' || key === 'relations')) {
      const parsed = parseList(lines, i + 1, key === 'focus' ? parseFocusItem : parseRelationItem);
      fields[key] = parsed.values;
      i = parsed.nextIndex;
      continue;
    }
    fields[key] = key === 'steps' || key === 'children' || key === 'cluster' || key === 'aliases' || key === 'grounded_in'
      ? parseCsv(rawValue)
      : parseScalar(rawValue);
    i += 1;
  }
  return { fields, body: bodyLines.join('\n').trim() };
}

export function parseAuthoringMarkdown(markdown, { filePath } = {}) {
  const { meta, body } = parseFrontmatter(markdown);
  const model = {
    filePath,
    meta,
    sources: [],
    blocks: [],
    steps: [],
    sections: [],
    concepts: [],
    clusters: [],
    relations: [],
    intakes: [],
    revisions: [],
  };

  let current = null;
  for (const line of body.split(/\r?\n/)) {
    if (line.startsWith('#')) continue;
    if (line.startsWith('@')) {
      if (current) {
        const parsed = parseDirectiveFields(current);
        model[current.collection].push({ id: current.id, attrs: current.attrs, fields: parsed.fields, body: parsed.body });
      }
      current = parseDirectiveHeader(line);
      continue;
    }
    if (current) current.bodyLines.push(line);
  }

  if (current) {
    const parsed = parseDirectiveFields(current);
    model[current.collection].push({ id: current.id, attrs: current.attrs, fields: parsed.fields, body: parsed.body });
  }

  return model;
}
```

- [ ] **Step 5: Run parser tests**

Run:

```bash
node --test test/authoring-parse.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

Run:

```bash
git add src/core/authoring/parse.js test/authoring-parse.test.js examples/authoring/recursive-self-improvement.mindgraph.md
git commit -m "feat(authoring): parse mindgraph markdown"
```

---

### Task 3: Compile Authoring Markdown To Source-First JSON

**Files:**
- Create: `src/core/authoring/compile.js`
- Create: `test/authoring-compile.test.js`

- [ ] **Step 1: Write failing compiler tests**

Create `test/authoring-compile.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { compileAuthoringMarkdown } from '../src/core/authoring/compile.js';

const fixturePath = 'examples/authoring/recursive-self-improvement.mindgraph.md';

test('compileAuthoringMarkdown emits valid source-first JSON', () => {
  const markdown = fs.readFileSync(fixturePath, 'utf8');
  const { document, validation } = compileAuthoringMarkdown(markdown, { filePath: fixturePath });

  assert.equal(validation.ok, true);
  assert.equal(document.kind, 'mindgraph.source-first');
  assert.equal(document.version, 1);
  assert.equal(document.title, 'Recursive Self-Improvement');
  assert.equal(document.sources[0].id, 'rsi-note');
  assert.deepEqual(document.sourceBlocks.map((block) => block.id), ['b001', 'b002']);
  assert.deepEqual(document.readerSteps[0].sourceBlockIds, ['b001', 'b002']);
  assert.deepEqual(document.readerSteps[0].focusConcepts.map((concept) => concept.id), ['recursive-self-improvement', 'feedback-loop']);
  assert.deepEqual(document.sections[0].readerStepIds, ['s001']);
  assert.deepEqual(document.concepts.atomic.map((concept) => concept.id), ['recursive-self-improvement', 'feedback-loop']);
  assert.deepEqual(document.concepts.clustered.map((concept) => concept.id), ['ai-capability-growth', 'systems-dynamics']);
  assert.equal(document.relations[0].id, 'rsi-depends-on-feedback');
  assert.deepEqual(document.relations[0].groundedInBlockIds, ['b002']);
});

test('compileAuthoringMarkdown returns validation errors for broken references', () => {
  const markdown = `---
kind: mindgraph.authoring
version: 1
title: Broken
---

@source src
type: text
title: Source

@block b001 source=src kind=paragraph
Text.

@step s001 section=setup blocks=missing-block
summary: Broken.
focus:
  - missing-concept 1 explicit

@section setup
title: Setup
steps: s001
`;

  const { validation } = compileAuthoringMarkdown(markdown);
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join('\n'), /readerSteps\.s001 references missing sourceBlock 'missing-block'/);
  assert.match(validation.errors.join('\n'), /readerSteps\.s001 focusConcept 'missing-concept' references missing concept/);
});
```

- [ ] **Step 2: Run compiler tests and verify they fail**

Run:

```bash
node --test test/authoring-compile.test.js
```

Expected: FAIL with `Cannot find module '../src/core/authoring/compile.js'`.

- [ ] **Step 3: Implement the compiler**

Create `src/core/authoring/compile.js`:

```js
import { parseAuthoringMarkdown } from './parse.js';
import { validateSourceFirstDocument } from './schema.js';

function asArray(value) {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}

function firstString(value) {
  return Array.isArray(value) ? value[0] : value;
}

function sourceFrom(entry) {
  return {
    id: entry.id,
    type: String(entry.fields.type ?? 'text'),
    title: String(entry.fields.title ?? entry.id),
    ...(entry.fields.path ? { path: String(entry.fields.path) } : {}),
  };
}

function blockFrom(entry, order) {
  return {
    id: entry.id,
    sourceId: entry.attrs.source,
    kind: entry.attrs.kind ?? 'paragraph',
    text: entry.body,
    order,
    ...(entry.fields.skipped ? { skipped: Boolean(entry.fields.skipped) } : {}),
  };
}

function relationIdForInline(item) {
  return `${item.from}-${item.type}-${item.to}`;
}

function stepFrom(entry) {
  const relationActivations = asArray(entry.fields.relations).map((item) => ({
    id: relationIdForInline(item),
    weight: item.weight,
  }));
  return {
    id: entry.id,
    sectionId: entry.attrs.section ?? entry.fields.section,
    sourceBlockIds: asArray(entry.attrs.blocks ? String(entry.attrs.blocks).split(',').map((id) => id.trim()).filter(Boolean) : entry.fields.blocks),
    summary: String(entry.fields.summary ?? ''),
    focusConcepts: asArray(entry.fields.focus),
    focusRelations: relationActivations,
    ...(entry.fields.skipped ? { skipped: Boolean(entry.fields.skipped) } : {}),
  };
}

function sectionFrom(entry) {
  return {
    id: entry.id,
    title: String(entry.fields.title ?? entry.id),
    summary: String(entry.fields.summary ?? ''),
    readerStepIds: asArray(entry.fields.steps),
  };
}

function atomicConceptFrom(entry) {
  return {
    id: entry.id,
    label: String(entry.fields.label ?? entry.id),
    aliases: asArray(entry.fields.aliases),
    parentIds: asArray(entry.fields.cluster),
    firstSeenBlockId: firstString(entry.fields.first_seen),
  };
}

function clusterFrom(entry) {
  return {
    id: entry.id,
    label: String(entry.fields.label ?? entry.id),
    childIds: asArray(entry.fields.children),
  };
}

function relationFrom(entry) {
  const provenance = entry.fields.provenance ?? 'source';
  return {
    id: entry.id,
    from: String(entry.fields.from ?? ''),
    to: String(entry.fields.to ?? ''),
    type: String(entry.fields.type ?? ''),
    provenance,
    groundedInBlockIds: asArray(entry.fields.grounded_in),
    ...(entry.fields.rationale ? { rationale: String(entry.fields.rationale) } : {}),
  };
}

function inlineRelationFrom(item) {
  return {
    id: relationIdForInline(item),
    from: item.from,
    to: item.to,
    type: item.type,
    provenance: 'source',
    groundedInBlockIds: [],
  };
}

export function compileAuthoringModel(model) {
  const explicitRelations = model.relations.map(relationFrom);
  const explicitRelationKeys = new Set(explicitRelations.map((relation) => `${relation.from}|${relation.type}|${relation.to}`));
  const inlineRelations = [];
  for (const step of model.steps) {
    for (const item of asArray(step.fields.relations)) {
      const key = `${item.from}|${item.type}|${item.to}`;
      if (!explicitRelationKeys.has(key)) inlineRelations.push(inlineRelationFrom(item));
    }
  }

  const document = {
    kind: 'mindgraph.source-first',
    version: 1,
    title: String(model.meta.title ?? 'Untitled Mindgraph'),
    sources: model.sources.map(sourceFrom),
    sourceBlocks: model.blocks.map(blockFrom),
    readerSteps: model.steps.map(stepFrom),
    sections: model.sections.map(sectionFrom),
    concepts: {
      atomic: model.concepts.map(atomicConceptFrom),
      clustered: model.clusters.map(clusterFrom),
    },
    relations: [...explicitRelations, ...inlineRelations],
    intakes: [],
    revisions: [],
    meta: {
      authoring: {
        kind: model.meta.kind,
        runtime: model.meta.runtime,
        filePath: model.filePath,
      },
    },
  };

  const validation = validateSourceFirstDocument(document);
  return { document, validation };
}

export function compileAuthoringMarkdown(markdown, opts = {}) {
  return compileAuthoringModel(parseAuthoringMarkdown(markdown, opts));
}
```

- [ ] **Step 4: Fix inline relation grounding**

Run:

```bash
node --test test/authoring-compile.test.js
```

Expected: FAIL because inline relation generation may create an ungrounded duplicate relation if the explicit relation ID differs from `relationIdForInline`.

Update `stepFrom` in `src/core/authoring/compile.js` so relation activations prefer explicit relation IDs:

```js
function stepFrom(entry, relationIdBySignature) {
  const relationActivations = asArray(entry.fields.relations).map((item) => {
    const signature = `${item.from}|${item.type}|${item.to}`;
    return {
      id: relationIdBySignature.get(signature) ?? relationIdForInline(item),
      weight: item.weight,
    };
  });
  return {
    id: entry.id,
    sectionId: entry.attrs.section ?? entry.fields.section,
    sourceBlockIds: asArray(entry.attrs.blocks ? String(entry.attrs.blocks).split(',').map((id) => id.trim()).filter(Boolean) : entry.fields.blocks),
    summary: String(entry.fields.summary ?? ''),
    focusConcepts: asArray(entry.fields.focus),
    focusRelations: relationActivations,
    ...(entry.fields.skipped ? { skipped: Boolean(entry.fields.skipped) } : {}),
  };
}
```

Then update `compileAuthoringModel` before `document` creation:

```js
const relationIdBySignature = new Map(explicitRelations.map((relation) => [`${relation.from}|${relation.type}|${relation.to}`, relation.id]));
```

And change:

```js
readerSteps: model.steps.map(stepFrom),
```

to:

```js
readerSteps: model.steps.map((step) => stepFrom(step, relationIdBySignature)),
```

- [ ] **Step 5: Run compiler tests**

Run:

```bash
node --test test/authoring-compile.test.js
```

Expected: PASS.

- [ ] **Step 6: Run all authoring tests**

Run:

```bash
npm run test:authoring
```

Expected: PASS.

- [ ] **Step 7: Commit Task 3**

Run:

```bash
git add src/core/authoring/compile.js test/authoring-compile.test.js
git commit -m "feat(authoring): compile markdown to source-first json"
```

---

### Task 4: Add Authoring CLI Commands

**Files:**
- Modify: `src/cli/index.js`
- Modify: `test/authoring-compile.test.js`

- [ ] **Step 1: Add CLI tests**

Append to `test/authoring-compile.test.js`:

```js
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('CLI validates and compiles authoring markdown', () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindgraph-authoring-cli-'));
  const outPath = path.join(outDir, 'compiled.mindgraph.json');

  const validate = spawnSync(process.execPath, ['src/cli/index.js', 'authoring', 'validate', fixturePath], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.equal(validate.status, 0, validate.stderr);
  assert.match(validate.stdout, /OK: .* is a valid mindgraph authoring document/);

  const compile = spawnSync(process.execPath, ['src/cli/index.js', 'authoring', 'compile', fixturePath, '-o', outPath], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.equal(compile.status, 0, compile.stderr);
  assert.match(compile.stdout, /Compiled .* to .*/);

  const compiled = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  assert.equal(compiled.kind, 'mindgraph.source-first');
  assert.equal(compiled.title, 'Recursive Self-Improvement');
});

test('CLI reports validation failures for broken authoring markdown', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindgraph-authoring-broken-'));
  const filePath = path.join(dir, 'broken.mindgraph.md');
  fs.writeFileSync(filePath, `---
kind: mindgraph.authoring
version: 1
title: Broken
---

@source src
type: text
title: Source
`, 'utf8');

  const result = spawnSync(process.execPath, ['src/cli/index.js', 'authoring', 'validate', filePath], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /INVALID:/);
  assert.match(result.stderr, /sourceBlocks must include at least one block/);
  assert.match(result.stderr, /readerSteps must include at least one step/);
  assert.match(result.stderr, /sections must include at least one section/);
});
```

- [ ] **Step 2: Run CLI tests and verify they fail**

Run:

```bash
node --test test/authoring-compile.test.js
```

Expected: FAIL because `mindgraph authoring` is not implemented.

- [ ] **Step 3: Import authoring helpers in CLI**

In `src/cli/index.js`, add imports near the existing core imports:

```js
import { compileAuthoringMarkdown } from '../core/authoring/compile.js';
import { formatSourceFirstValidationErrors } from '../core/authoring/schema.js';
```

- [ ] **Step 4: Update help text**

In `printHelp()`, add usage lines after `mindgraph inspect <input-file>`:

```txt
  mindgraph authoring validate <input-file.md> [--json]
  mindgraph authoring compile <input-file.md> -o <output-file.json> [--json]
```

Add command descriptions after `inspect`:

```txt
  authoring validate    Validate a source-first mindgraph Markdown authoring document
  authoring compile     Compile mindgraph Markdown authoring to source-first runtime JSON
```

- [ ] **Step 5: Add CLI dispatch**

In `src/cli/index.js`, insert this block after the existing `inspect` command block and before `source import`:

```js
if (command === 'authoring' && subcommand === 'validate') {
  const [inputFile, ...flagArgs] = rest;
  if (!inputFile) {
    console.error('Missing input file path.');
    process.exit(1);
  }
  const flags = parseFlags(flagArgs);
  const markdown = fs.readFileSync(inputFile, 'utf8');
  const result = compileAuthoringMarkdown(markdown, { filePath: inputFile });
  if (flags['--json']) {
    console.log(JSON.stringify({ ok: result.validation.ok, validation: result.validation }, null, 2));
  } else if (result.validation.ok) {
    console.log(`OK: ${inputFile} is a valid mindgraph authoring document.`);
  } else {
    console.error(`INVALID: ${inputFile}`);
    console.error(formatSourceFirstValidationErrors(result.validation));
  }
  process.exit(result.validation.ok ? 0 : 1);
}

if (command === 'authoring' && subcommand === 'compile') {
  const [inputFile, ...flagArgs] = rest;
  if (!inputFile) {
    console.error('Missing input file path.');
    process.exit(1);
  }
  const flags = parseFlags(flagArgs);
  const outputFile = requireFlag(flags, '-o', '--output');
  if (!outputFile) {
    console.error('Missing -o <output-file.json>.');
    process.exit(1);
  }
  const markdown = fs.readFileSync(inputFile, 'utf8');
  const result = compileAuthoringMarkdown(markdown, { filePath: inputFile });
  if (!result.validation.ok) {
    if (flags['--json']) console.log(JSON.stringify({ ok: false, validation: result.validation }, null, 2));
    else {
      console.error(`INVALID: ${inputFile}`);
      console.error(formatSourceFirstValidationErrors(result.validation));
    }
    process.exit(1);
  }
  writeJson(outputFile, result.document);
  if (flags['--json']) console.log(JSON.stringify({ ok: true, inputFile, outputFile, validation: result.validation }, null, 2));
  else console.log(`Compiled ${inputFile} to ${outputFile}`);
  process.exit(0);
}
```

- [ ] **Step 6: Run CLI tests**

Run:

```bash
node --test test/authoring-compile.test.js
```

Expected: PASS.

- [ ] **Step 7: Run authoring script and CLI syntax check**

Run:

```bash
npm run test:authoring
node --check src/cli/index.js
```

Expected: both PASS.

- [ ] **Step 8: Commit Task 4**

Run:

```bash
git add src/cli/index.js test/authoring-compile.test.js
git commit -m "feat(cli): add mindgraph authoring commands"
```

---

### Task 5: Document The Authoring Slice And Final Verification

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update README current scope**

In `README.md`, add a short section after "Product journey commands":

```md
## Source-first authoring

New living graphs can be authored as structured Markdown and compiled to source-first runtime JSON:

```bash
mindgraph authoring validate examples/authoring/recursive-self-improvement.mindgraph.md
mindgraph authoring compile examples/authoring/recursive-self-improvement.mindgraph.md -o graphs/recursive-self-improvement.mindgraph.json
```

The Markdown file is the editing surface. The compiled JSON is the runtime artifact for validation, view-model construction, and future reader/workbench UI work.
```

- [ ] **Step 2: Update project agent instructions**

In both `AGENTS.md` and `CLAUDE.md`, update the producer-side paragraph so it mentions source-first authoring for new living graphs:

```md
For new living-graph work, prefer the source-first authoring path: edit/produce `*.mindgraph.md`, then run `mindgraph authoring validate` and `mindgraph authoring compile`. The old `micro/meso/macro` document path remains available for existing fixtures but does not constrain new architecture.
```

- [ ] **Step 3: Run full authoring verification**

Run:

```bash
npm run test:authoring
npm run ui:check
npm run vm:example
node src/cli/index.js authoring validate examples/authoring/recursive-self-improvement.mindgraph.md
```

Expected:

- authoring tests pass
- UI syntax check passes
- VM example still prints representative JSON
- authoring validation prints `OK: examples/authoring/recursive-self-improvement.mindgraph.md is a valid mindgraph authoring document.`

- [ ] **Step 4: Compile the example manually**

Run:

```bash
node src/cli/index.js authoring compile examples/authoring/recursive-self-improvement.mindgraph.md -o graphs/recursive-self-improvement.mindgraph.json
node -e "const fs=require('fs'); const doc=JSON.parse(fs.readFileSync('graphs/recursive-self-improvement.mindgraph.json','utf8')); console.log(doc.kind, doc.sourceBlocks.length, doc.readerSteps.length, doc.relations.length)"
```

Expected:

```txt
mindgraph.source-first 2 1 1
```

Do not stage `graphs/recursive-self-improvement.mindgraph.json`; `graphs/` is ignored and this is local verification output.

- [ ] **Step 5: Commit Task 5**

Run:

```bash
git add README.md AGENTS.md CLAUDE.md
git commit -m "docs: describe source-first authoring workflow"
```

---

## Final Verification

After all tasks are complete, run:

```bash
npm run test:authoring
npm run test:digest
npm run test:source
npm run test:journey
npm run test:mcp
npm run ui:check
npm run vm:example
git status --short --ignored graphs transcripts .superpowers | sed -n '1,80p'
```

Expected:

- all test commands exit 0
- `ui:check` exits 0
- `vm:example` exits 0 and prints a representative view-model slice
- ignored local artifacts may appear as `!! graphs/`, `!! transcripts/`, and `!! .superpowers/`
- no tracked files are modified except intentional committed changes

Do not run `npm run test:smoke` unless you are prepared to restore the sample files it rewrites. This plan does not change the legacy smoke path.

## Self-Review Checklist

Spec coverage:

- Canonical Markdown authoring: Tasks 2 and 3.
- Source-first runtime JSON: Tasks 1 and 3.
- Strict compiler/validator: Tasks 1, 3, and 4.
- CLI validation/compilation: Task 4.
- One small example: Task 2.
- No legacy migration: no task exports or preserves `micro / meso / macro`.
- No UI/provider work: explicitly deferred.

Placeholder scan:

- No empty marker text, "same as previous" shortcuts, or unspecified validation steps.
- Every task has exact file paths, commands, and expected results.

Type consistency:

- `sourceBlocks`, `readerSteps`, `sections`, `concepts.atomic`, `concepts.clustered`, `relations`, `intakes`, and `revisions` match the design spec.
- Authoring parser names `blocks` internally but compiler emits `sourceBlocks`.
- Relation activation signatures use `from|type|to`, and compiled runtime relation activations use relation IDs.

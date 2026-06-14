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

test('validateSourceFirstDocument rejects duplicate concept IDs across atomic and clustered namespaces', () => {
  const base = validDoc();
  const doc = validDoc({
    concepts: {
      atomic: [
        ...base.concepts.atomic,
        { id: 'shared-id', label: 'Shared Atomic', parentIds: [], firstSeenBlockId: 'b001' },
      ],
      clustered: [
        ...base.concepts.clustered,
        { id: 'shared-id', label: 'Shared Cluster', childIds: ['recursive-self-improvement'] },
      ],
    },
  });

  const result = validateSourceFirstDocument(doc);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /concept id 'shared-id' appears in both concepts\.atomic and concepts\.clustered/);
});

test('validateSourceFirstDocument enforces section/reader-step agreement', () => {
  const base = validDoc();
  const doc = validDoc({
    readerSteps: [
      base.readerSteps[0],
      {
        id: 's002',
        sectionId: 'setup',
        sourceBlockIds: ['b002'],
        summary: 'Secondary step follows section A.',
        focusConcepts: [{ id: 'recursive-self-improvement', weight: 0.7 }],
        focusRelations: [{ id: 'rsi-depends-on-feedback', weight: 0.6 }],
      },
    ],
    sections: [
      { id: 'setup', title: 'Setup', summary: '', readerStepIds: ['s002'] },
      { id: 'deeper', title: 'Deeper', summary: '', readerStepIds: ['s001'] },
    ],
  });

  const result = validateSourceFirstDocument(doc);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /readerSteps\.s001 is not listed in sections\.setup\.readerStepIds/);
  assert.match(result.errors.join('\n'), /sections\.deeper\.readerStepIds includes step 's001' that belongs to 'setup'/);
});

test('validateSourceFirstDocument validates all grounded blocks for source relations', () => {
  const doc = validDoc({
    relations: [
      {
        id: 'partial-grounding',
        from: 'recursive-self-improvement',
        to: 'feedback-loop',
        type: 'depends_on',
        provenance: 'source',
        groundedInBlockIds: ['missing', 'b002'],
      },
    ],
    readerSteps: [
      {
        id: 's001',
        sectionId: 'setup',
        sourceBlockIds: ['b001', 'b002'],
        summary: 'Uses partial grounding.',
        focusConcepts: [{ id: 'recursive-self-improvement', weight: 1 }],
      },
    ],
  });

  const result = validateSourceFirstDocument(doc);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /relations\.partial-grounding groundedInBlockIds includes missing block 'missing'/);
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

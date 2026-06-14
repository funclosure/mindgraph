import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMindgraphViewModel } from '../src/view-model/buildMindgraphViewModel.js';
import { buildProseChunks } from '../src/view-model/buildProseChunks.js';
import { buildGraphRenderState } from '../src/view-model/buildGraphRenderState.js';

test('buildMindgraphViewModel adapts source-first documents for the reader UI', () => {
  const doc = {
    kind: 'mindgraph.source-first',
    version: 1,
    title: 'Policy on Fast Systems',
    sources: [{ id: 'article', type: 'article', title: 'Policy on Fast Systems' }],
    sourceBlocks: [
      { id: 'b001', sourceId: 'article', kind: 'paragraph', text: 'Fast systems create public-safety pressure.', order: 0 },
      { id: 'b002', sourceId: 'article', kind: 'paragraph', text: 'Economic adaptation needs measurement.', order: 1 },
    ],
    readerSteps: [
      {
        id: 's001',
        sectionId: 'regulation',
        sourceBlockIds: ['b001'],
        summary: 'Regulation pressure.',
        focusConcepts: [{ id: 'fast-systems', weight: 0.9, mode: 'explicit' }],
        focusRelations: [{ id: 'r001', weight: 0.8 }],
      },
      {
        id: 's002',
        sectionId: 'economics',
        sourceBlockIds: ['b002'],
        summary: 'Adaptation pressure.',
        focusConcepts: [{ id: 'economic-adaptation', weight: 0.9, mode: 'explicit' }],
        focusRelations: [],
      },
    ],
    sections: [
      { id: 'regulation', title: 'Regulation', summary: 'Safety policy.', readerStepIds: ['s001'] },
      { id: 'economics', title: 'Economics', summary: 'Economic policy.', readerStepIds: ['s002'] },
    ],
    concepts: {
      atomic: [
        { id: 'fast-systems', label: 'Fast Systems', parentIds: ['policy'], firstSeenBlockId: 'b001' },
        { id: 'economic-adaptation', label: 'Economic Adaptation', parentIds: ['policy'], firstSeenBlockId: 'b002' },
      ],
      clustered: [{ id: 'policy', label: 'Policy', childIds: ['fast-systems', 'economic-adaptation'] }],
    },
    relations: [
      { id: 'r001', from: 'fast-systems', to: 'economic-adaptation', type: 'pressures', provenance: 'source', groundedInBlockIds: ['b001'] },
    ],
    intakes: [],
    revisions: [],
  };

  const vm = buildMindgraphViewModel(doc);
  assert.equal(vm.documentMeta.title, 'Policy on Fast Systems');
  assert.deepEqual(vm.documentMeta.speakers, ['Article']);
  assert.equal(vm.transcript.segments.length, 2);
  assert.equal(vm.frames, undefined);
  assert.equal(vm.sourceFlow.readerSteps.length, 2);
  assert.equal(vm.sourceFlow.sections.length, 2);
  assert.equal(vm.sourceFlow.overview.length, 1);
  assert.equal(vm.selectors.getActiveFrameAtTime('readerStep', 0).id, 's001');
  assert.equal(vm.selectors.getActiveFrameAtTime('section', 0).id, 'regulation');
  assert.equal(vm.selectors.getActiveFrameAtTime('overview', 0).id, 'source-first-overview');
  assert.deepEqual(vm.selectors.getActiveConceptIdsAtTime(0, 'readerStep'), ['fast-systems']);
  assert.deepEqual(vm.selectors.getActiveConceptIdsAtTime(0, 'section'), ['fast-systems']);
  assert.deepEqual(vm.selectors.getActiveConceptIdsAtTime(0, 'overview'), ['fast-systems', 'economic-adaptation']);
  assert.equal(vm.sourceFlow.readerSteps[0].sourceSegmentIds[0], 'b001');
  assert.equal(vm.sourceFlow.sections[0].sourceFrameRefs[0].level, 'readerStep');
  assert.equal(vm.sourceFlow.overview[0].sourceFrameRefs[0].level, 'section');
  assert.equal(vm.selectors.getActiveFrameAtTime('overview', 0).title, 'Policy on Fast Systems');
  assert.deepEqual(vm.selectors.getFrameTranscriptSegments({ level: 'readerStep', index: 0 }).map((s) => s.id), ['b001']);

  const chunks = buildProseChunks(vm);
  assert.equal(chunks[0].kind, 'overview');
  assert.equal(chunks[0].title, 'Policy on Fast Systems');
  const firstParagraph = chunks.find((chunk) => chunk.kind === 'paragraph' && chunk.text.includes('Fast systems'));
  assert.ok(firstParagraph);
  assert.deepEqual(firstParagraph.focus, {
    timeLabel: '00:00',
    summary: 'Regulation pressure.',
    concepts: [{ id: 'fast-systems', label: 'Fast Systems', weight: 0.9, mode: 'explicit' }],
  });

  const renderState = buildGraphRenderState(vm, {
    playheadTime: 0,
    activeLevel: 'readerStep',
    layout: {
      nodes: {
        'fast-systems': { x: 0, y: 0 },
        'economic-adaptation': { x: 100, y: 0 },
      },
    },
    viewport: { width: 800, height: 600 },
  });
  assert.deepEqual(renderState.activeNodeIds, ['fast-systems']);
});

test('buildMindgraphViewModel uses explicit source-first duration metadata', () => {
  const doc = {
    kind: 'mindgraph.source-first',
    version: 1,
    title: 'Timed Transcript',
    sources: [{ id: 'lecture', type: 'transcript', title: 'Timed Transcript' }],
    sourceBlocks: [
      { id: 'b001', sourceId: 'lecture', kind: 'transcript', text: 'Opening.', order: 0 },
      { id: 'b002', sourceId: 'lecture', kind: 'transcript', text: 'Closing.', order: 1 },
    ],
    readerSteps: [
      {
        id: 's001',
        sectionId: 'whole',
        sourceBlockIds: ['b001', 'b002'],
        summary: 'Whole transcript.',
        focusConcepts: [{ id: 'timed-concept', weight: 1, mode: 'explicit' }],
        focusRelations: [],
      },
    ],
    sections: [{ id: 'whole', title: 'Whole', summary: 'Whole transcript.', readerStepIds: ['s001'] }],
    concepts: {
      atomic: [{ id: 'timed-concept', label: 'Timed Concept', parentIds: ['topic'], firstSeenBlockId: 'b001' }],
      clustered: [{ id: 'topic', label: 'Topic', childIds: ['timed-concept'] }],
    },
    relations: [],
    intakes: [],
    revisions: [],
    meta: { durationSeconds: 90 },
  };

  const vm = buildMindgraphViewModel(doc);
  assert.equal(vm.documentMeta.durationSeconds, 90);
  assert.deepEqual(vm.transcript.segments.map((segment) => [segment.start, segment.end]), [[0, 45], [45, 90]]);
  assert.deepEqual(vm.sourceFlow.readerSteps[0].span, { start: 0, end: 90 });
});

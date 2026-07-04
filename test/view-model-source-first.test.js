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
        { id: 'economic-adaptation', label: 'Economic Adaptation', aliases: ['measurement'], parentIds: ['policy'], firstSeenBlockId: 'b002' },
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
  const secondParagraph = chunks.find((chunk) => chunk.kind === 'paragraph' && chunk.text.includes('Economic adaptation'));
  assert.ok(secondParagraph);
  assert.ok(
    secondParagraph.conceptMentions.some((mention) => (
      mention.conceptId === 'economic-adaptation'
      && secondParagraph.text.slice(mention.start, mention.end) === 'measurement'
    )),
    'expected concept alias "measurement" to bind economic-adaptation in prose',
  );

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

test('source-first active step concepts are visible before their exact first mention', () => {
  const doc = {
    kind: 'mindgraph.source-first',
    version: 1,
    title: 'Step Lead-in',
    sources: [{ id: 'article', type: 'article', title: 'Step Lead-in' }],
    sourceBlocks: [
      { id: 'b001', sourceId: 'article', kind: 'paragraph', text: 'A short introductory lead-in.', order: 0 },
      { id: 'b002', sourceId: 'article', kind: 'paragraph', text: 'The thesis concept appears here.', order: 1 },
    ],
    readerSteps: [
      {
        id: 's001',
        sectionId: 'opening',
        sourceBlockIds: ['b001', 'b002'],
        summary: 'Opening step.',
        focusConcepts: [{ id: 'thesis-concept', weight: 1, mode: 'explicit' }],
        focusRelations: [],
      },
    ],
    sections: [{ id: 'opening', title: 'Opening', summary: 'Opening.', readerStepIds: ['s001'] }],
    concepts: {
      atomic: [{ id: 'thesis-concept', label: 'Thesis Concept', parentIds: [], firstSeenBlockId: 'b002' }],
      clustered: [],
    },
    relations: [],
    intakes: [],
    revisions: [],
  };

  const vm = buildMindgraphViewModel(doc);
  const renderState = buildGraphRenderState(vm, {
    playheadTime: 0,
    activeLevel: 'readerStep',
    layout: { nodes: { 'thesis-concept': { x: 10, y: 20 } } },
    viewport: { width: 800, height: 600 },
  });

  assert.deepEqual(renderState.activeNodeIds, ['thesis-concept']);
  assert.ok(renderState.visibleNodeIds.includes('thesis-concept'));
  assert.ok(renderState.cumulativeVisibleConceptIds.includes('thesis-concept'));
  assert.ok(renderState.cameraTarget, 'expected active source-step concept to produce a camera target');
});

function words(count) {
  return Array.from({ length: count }, (_, i) => `word${i}`).join(' ');
}

function timingDoc({ blocks, meta }) {
  return {
    kind: 'mindgraph.source-first',
    version: 1,
    title: 'Timing Fixture',
    sources: [{ id: 'article', type: 'article', title: 'Timing Fixture' }],
    sourceBlocks: blocks,
    readerSteps: [
      {
        id: 's001',
        sectionId: 'whole',
        sourceBlockIds: blocks.map((block) => block.id),
        summary: 'Whole document.',
        focusConcepts: [{ id: 'timing-concept', weight: 1, mode: 'explicit' }],
        focusRelations: [],
      },
    ],
    sections: [{ id: 'whole', title: 'Whole', summary: 'Whole.', readerStepIds: ['s001'] }],
    concepts: {
      atomic: [{ id: 'timing-concept', label: 'Timing Concept', parentIds: [], firstSeenBlockId: blocks[0].id }],
      clustered: [],
    },
    relations: [],
    intakes: [],
    revisions: [],
    ...(meta ? { meta } : {}),
  };
}

test('estimated source-first timing is word-proportional with a floor for short blocks', () => {
  // 220 wpm → seconds = words * 60/220. 44 words → 12 s; a 2-word heading
  // hits the 4 s floor instead of vanishing.
  const vm = buildMindgraphViewModel(timingDoc({
    blocks: [
      { id: 'b001', sourceId: 'article', kind: 'heading', text: 'Fast Systems', order: 0 },
      { id: 'b002', sourceId: 'article', kind: 'paragraph', text: words(44), order: 1 },
    ],
  }));

  assert.deepEqual(vm.transcript.segments.map((s) => [s.start, s.end]), [[0, 4], [4, 16]]);
  assert.deepEqual(vm.documentMeta.timing, { mode: 'estimated', totalSeconds: 16 });
  assert.equal(vm.documentMeta.durationSeconds, 16);
});

test('declared source-first duration is distributed proportionally to block word counts', () => {
  // Estimates: 66 words → 18 s, 22 words → 6 s (sum 24). Declared 96 s scales
  // both by 4 — not the old uniform 48/48 split.
  const vm = buildMindgraphViewModel(timingDoc({
    blocks: [
      { id: 'b001', sourceId: 'article', kind: 'paragraph', text: words(66), order: 0 },
      { id: 'b002', sourceId: 'article', kind: 'paragraph', text: words(22), order: 1 },
    ],
    meta: { durationSeconds: 96 },
  }));

  assert.deepEqual(vm.transcript.segments.map((s) => [s.start, s.end]), [[0, 72], [72, 96]]);
  assert.deepEqual(vm.documentMeta.timing, { mode: 'declared', totalSeconds: 96 });
  assert.equal(vm.documentMeta.durationSeconds, 96);
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

test('source-first active frame selection prefers latest overlapping start', () => {
  const doc = {
    kind: 'mindgraph.source-first',
    version: 1,
    title: 'Overlapping Source',
    sources: [{ id: 'lecture', type: 'transcript', title: 'Overlapping Source' }],
    sourceBlocks: [
      { id: 'b001', sourceId: 'lecture', kind: 'transcript', text: 'First.', order: 0 },
      { id: 'b002', sourceId: 'lecture', kind: 'transcript', text: 'Bridge.', order: 1 },
      { id: 'b003', sourceId: 'lecture', kind: 'transcript', text: 'Second.', order: 2 },
    ],
    readerSteps: [
      {
        id: 's001',
        sectionId: 'one',
        sourceBlockIds: ['b001', 'b002'],
        summary: 'First step.',
        focusConcepts: [{ id: 'first', weight: 1, mode: 'explicit' }],
        focusRelations: [],
      },
      {
        id: 's002',
        sectionId: 'two',
        sourceBlockIds: ['b002', 'b003'],
        summary: 'Second step.',
        focusConcepts: [{ id: 'second', weight: 1, mode: 'explicit' }],
        focusRelations: [],
      },
    ],
    sections: [
      { id: 'one', title: 'One', summary: 'One.', readerStepIds: ['s001'] },
      { id: 'two', title: 'Two', summary: 'Two.', readerStepIds: ['s002'] },
    ],
    concepts: {
      atomic: [
        { id: 'first', label: 'First', parentIds: [], firstSeenBlockId: 'b001' },
        { id: 'second', label: 'Second', parentIds: [], firstSeenBlockId: 'b003' },
      ],
      clustered: [],
    },
    relations: [],
    intakes: [],
    revisions: [],
    meta: { durationSeconds: 90 },
  };

  const vm = buildMindgraphViewModel(doc);
  const overlapTime = vm.sourceFlow.readerSteps[1].span.start;
  assert.equal(vm.selectors.getActiveFrameAtTime('readerStep', overlapTime).id, 's002');
  assert.equal(vm.selectors.getActiveFrameAtTime('section', overlapTime).id, 'two');
});

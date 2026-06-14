import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMindgraphViewModel } from '../src/view-model/buildMindgraphViewModel.js';
import { buildProseChunks } from '../src/view-model/buildProseChunks.js';

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
  assert.equal(vm.frames.micro.length, 2);
  assert.equal(vm.frames.meso.length, 2);
  assert.equal(vm.frames.macro.length, 1);
  assert.equal(vm.frames.micro[0].sourceSegmentIds[0], 'b001');
  assert.equal(vm.frames.meso[0].sourceFrameRefs[0].level, 'micro');
  assert.equal(vm.frames.macro[0].sourceFrameRefs[0].level, 'meso');
  assert.equal(vm.selectors.getActiveFrameAtTime('macro', 0).title, 'Policy on Fast Systems');
  assert.deepEqual(vm.selectors.getFrameTranscriptSegments({ level: 'micro', index: 0 }).map((s) => s.id), ['b001']);

  const chunks = buildProseChunks(vm);
  assert.equal(chunks[0].kind, 'chapter');
  assert.equal(chunks[0].title, 'Policy on Fast Systems');
  assert.equal(chunks.some((chunk) => chunk.kind === 'paragraph' && chunk.text.includes('Fast systems')), true);
});

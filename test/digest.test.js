import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyDocument, validateDocument } from '../src/core/schema.js';
import { applyDigestPlan, evaluateDigest } from '../src/core/digest.js';

function baseDoc() {
  return createEmptyDocument({
    transcript: {
      title: 'Digest Fixture',
      source: 'fixture.txt',
      speakers: ['Speaker'],
      segments: [
        { id: 'seg-1', start: 0, end: 10, speaker: 'Speaker', text: 'AI safety matters.' },
        { id: 'seg-2', start: 10, end: 20, speaker: 'Speaker', text: 'Sponsors sell things.' },
        { id: 'seg-3', start: 20, end: 30, speaker: 'Speaker', text: 'Scaling laws continue.' },
      ],
    },
    frames: {
      micro: [
        { id: 'micro-1', t: 0, span: { start: 0, end: 10 }, speakers: ['Speaker'], foregroundConcepts: [], backgroundConcepts: [], activeRelations: [], summary: 'AI safety matters.', sourceSegmentIds: ['seg-1'] },
        { id: 'micro-2', t: 10, span: { start: 10, end: 20 }, speakers: ['Speaker'], foregroundConcepts: [], backgroundConcepts: [], activeRelations: [], summary: 'Sponsors sell things.', sourceSegmentIds: ['seg-2'] },
        { id: 'micro-3', t: 20, span: { start: 20, end: 30 }, speakers: ['Speaker'], foregroundConcepts: [], backgroundConcepts: [], activeRelations: [], summary: 'Scaling laws continue.', sourceSegmentIds: ['seg-3'] },
      ],
      meso: [
        { id: 'meso-1', t: 0, span: { start: 0, end: 10 }, speakers: ['Speaker'], foregroundConcepts: [], backgroundConcepts: [], activeRelations: [], summary: 'Safety.' },
        { id: 'meso-2', t: 10, span: { start: 10, end: 20 }, speakers: ['Speaker'], foregroundConcepts: [], backgroundConcepts: [], activeRelations: [], summary: 'Sponsor.' },
        { id: 'meso-3', t: 20, span: { start: 20, end: 30 }, speakers: ['Speaker'], foregroundConcepts: [], backgroundConcepts: [], activeRelations: [], summary: 'Scaling.' },
      ],
      macro: [],
    },
  });
}

test('applyDigestPlan applies concepts, relations, frame activations, macro merges, ignored spans, backfill, and stats', () => {
  const doc = baseDoc();
  const result = applyDigestPlan(doc, {
    concepts: [
      { id: 'ai-safety', label: 'AI Safety', parentIds: ['alignment'] },
      { id: 'scaling-laws', label: 'Scaling Laws', parentIds: ['capability'] },
    ],
    clusters: [
      { id: 'alignment', label: 'Alignment' },
      { id: 'capability', label: 'Capability' },
    ],
    relations: [
      { id: 'safety-guides-scaling', from: 'ai-safety', to: 'scaling-laws', type: 'guides' },
    ],
    mesoActivations: [
      { index: 0, foreground: [{ id: 'ai-safety', weight: 1, mode: 'explicit' }] },
      { index: 2, foreground: [{ id: 'scaling-laws', weight: 0.9, mode: 'explicit' }], relations: [{ id: 'safety-guides-scaling', weight: 0.7 }] },
    ],
    macroFrames: [
      { startIndex: 0, endIndex: 2, title: 'Safety and Scaling', summary: 'Safety and scaling arc.', foreground: [{ id: 'alignment', weight: 1, mode: 'explicit' }, { id: 'capability', weight: 0.9, mode: 'explicit' }] },
    ],
    ignoredSpans: [
      { start: 10, end: 20, reason: 'sponsor' },
    ],
    backfill: { from: 'meso', to: 'micro' },
    recomputeStats: true,
  });

  assert.equal(result.conceptsUpserted, 2);
  assert.equal(result.clustersUpserted, 2);
  assert.equal(result.relationsUpserted, 1);
  assert.equal(result.mesoActivationsSet, 2);
  assert.equal(result.macroFramesCreated, 1);
  assert.equal(result.ignoredSpansSet, 1);
  assert.equal(result.backfilled?.updated, 3);
  assert.equal(validateDocument(doc).ok, true);
  assert.deepEqual(doc.meta.ignoredSpans, [{ start: 10, end: 20, reason: 'sponsor' }]);
  assert.equal(doc.frames.macro[0].title, 'Safety and Scaling');
  assert.equal(doc.frames.micro[0].foregroundConcepts[0].id, 'ai-safety');
  assert.equal(doc.concepts.atomic.find((c) => c.id === 'ai-safety').stats.recurrenceCount, 2);
});

test('evaluateDigest reports empty non-ignored frames, inactive relations, unused concepts, and ignored coverage', () => {
  const doc = baseDoc();
  applyDigestPlan(doc, {
    concepts: [
      { id: 'ai-safety', label: 'AI Safety' },
      { id: 'unused', label: 'Unused Concept' },
    ],
    relations: [
      { id: 'never-active', from: 'ai-safety', to: 'unused', type: 'related' },
    ],
    mesoActivations: [
      { index: 0, foreground: [{ id: 'ai-safety', weight: 1, mode: 'explicit' }] },
    ],
    ignoredSpans: [{ start: 10, end: 20, reason: 'sponsor' }],
    recomputeStats: true,
  });

  const report = evaluateDigest(doc);
  assert.equal(report.counts.atomicConcepts, 2);
  assert.deepEqual(report.emptyMesoFrameIndexes, [2]);
  assert.deepEqual(report.ignoredMesoFrameIndexes, [1]);
  assert.deepEqual(report.unusedConceptIds, ['unused']);
  assert.deepEqual(report.inactiveRelationIds, ['never-active']);
});

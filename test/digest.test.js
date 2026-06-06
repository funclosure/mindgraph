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
      { id: 'ai-safety', label: 'AI Safety', parentIds: ['alignment'], grounding: { kind: 'source', sourceSpan: { start: 0, end: 10 }, quote: 'AI safety matters.' } },
      { id: 'scaling-laws', label: 'Scaling Laws', parentIds: ['capability'], grounding: { kind: 'source', sourceSpan: { start: 20, end: 30 }, quote: 'Scaling laws continue.' } },
    ],
    clusters: [
      { id: 'alignment', label: 'Alignment' },
      { id: 'capability', label: 'Capability' },
    ],
    relations: [
      { id: 'safety-guides-scaling', from: 'ai-safety', to: 'scaling-laws', type: 'guides', grounding: { kind: 'source', sourceSpan: { start: 0, end: 30 }, quote: 'AI safety matters... Scaling laws continue.' } },
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
  assert.deepEqual(doc.relations[0].meta.grounding.kind, 'source');
  assert.deepEqual(doc.concepts.atomic.find((c) => c.id === 'ai-safety').meta.grounding.kind, 'source');
  assert.equal(doc.concepts.atomic.find((c) => c.id === 'ai-safety').stats.recurrenceCount, 2);
});

test('evaluateDigest reports empty non-ignored frames, inactive relations, unused concepts, and ignored coverage', () => {
  const doc = baseDoc();
  applyDigestPlan(doc, {
    concepts: [
      { id: 'ai-safety', label: 'AI Safety', grounding: { kind: 'source', sourceSpan: { start: 0, end: 10 }, quote: 'AI safety matters.' } },
      { id: 'unused', label: 'Unused Concept' },
    ],
    relations: [
      { id: 'never-active', from: 'ai-safety', to: 'unused', type: 'related' },
      { id: 'inferred-missing-validation', from: 'unused', to: 'ai-safety', type: 'supports', provenance: 'inferred', grounding: { kind: 'agent-inference', rationale: 'Unused supports AI safety.' } },
      { id: 'inferred-active', from: 'ai-safety', to: 'unused', type: 'supports', provenance: 'inferred', grounding: { kind: 'agent-inference', rationale: 'Active inferred relation.', validation: { status: 'not-validated', reason: 'fixture' } } },
      { id: 'bad-web-validated', from: 'unused', to: 'ai-safety', type: 'supports', provenance: 'inferred', grounding: { kind: 'agent-inference', rationale: 'Missing external source list.', validation: { status: 'web-validated', sources: [] } } },
    ],
    mesoActivations: [
      { index: 0, foreground: [{ id: 'ai-safety', weight: 1, mode: 'explicit' }], relations: [{ id: 'inferred-active', weight: 0.5 }] },
    ],
    ignoredSpans: [{ start: 10, end: 20, reason: 'sponsor' }],
    recomputeStats: true,
  });

  const report = evaluateDigest(doc);
  assert.equal(report.counts.atomicConcepts, 2);
  assert.deepEqual(report.emptyMesoFrameIndexes, [2]);
  assert.deepEqual(report.ignoredMesoFrameIndexes, [1]);
  assert.deepEqual(report.unusedConceptIds, ['unused']);
  assert.deepEqual(report.inactiveRelationIds, ['never-active', 'inferred-missing-validation', 'bad-web-validated']);
  assert.deepEqual(report.grounding.sourceConceptsWithoutGrounding, ['unused']);
  assert.deepEqual(report.grounding.sourceRelationsWithoutGrounding, ['never-active']);
  assert.deepEqual(report.grounding.inferredRelationsWithoutValidationStatus, ['inferred-missing-validation']);
  assert.deepEqual(report.grounding.webValidatedInferredRelationsMissingSources, ['bad-web-validated']);
  assert.deepEqual(report.grounding.inferredRelationsActiveInFrames, ['inferred-active']);
  assert.equal(report.grounding.inferredRelationRatio, 0.75);
});

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

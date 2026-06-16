import test from 'node:test';
import assert from 'node:assert/strict';
import { renderDigestInspector } from '../ui/panels/digest-inspector.js';

function digestVm() {
  return {
    sourceFlow: {
      readerSteps: [{
        span: { start: 0, end: 60 },
        key: 'readerStep:0',
        title: 'Step title',
        summary: 'Generated semantic understanding.',
        sourceSegmentIds: ['b001', 'b002'],
        foregroundConcepts: [{ id: 'meaning', label: 'Meaning', weight: 0.9 }],
        activeRelations: [{
          relation: { from: 'meaning', to: 'wisdom', type: 'supports' },
        }],
      }],
      sections: [{ span: { start: 0, end: 60 }, title: 'Current section' }],
    },
    concepts: {
      byId: {
        meaning: { label: 'Meaning' },
        wisdom: { label: 'Wisdom' },
      },
    },
  };
}

test('renderDigestInspector shows collapsed digest without concept chips', () => {
  const html = renderDigestInspector(digestVm(), {
    playheadTime: 10,
    graphRenderState: { activeNodeIds: ['meaning'] },
  });

  assert.match(html, /aria-label="Active digest"/);
  assert.match(html, /data-action="toggle-digest"/);
  assert.match(html, /data-expanded="false"/);
  assert.match(html, /Current section/);
  assert.match(html, /Generated semantic understanding\./);
  assert.match(html, /2 source blocks · 1 concept · 1 relation/);
  assert.doesNotMatch(html, /data-action="select-concept"/);
  assert.doesNotMatch(html, /supports/);
  assert.doesNotMatch(html, /mark-digest-review/);
  assert.doesNotMatch(html, /submit-digest-feedback/);
});

test('renderDigestInspector shows concept chips and relations when expanded', () => {
  const html = renderDigestInspector(digestVm(), {
    playheadTime: 10,
    digestExpanded: true,
    graphRenderState: { activeNodeIds: ['meaning'] },
  });

  assert.match(html, /data-expanded="true"/);
  assert.match(html, /data-action="select-concept"/);
  assert.match(html, /Meaning/);
  assert.match(html, /supports/);
  assert.match(html, /Wisdom/);
});

test('renderDigestInspector shows source-first overview when active level is overview', () => {
  const html = renderDigestInspector({
    sourceFlow: {
      overview: [{
        key: 'overview:0',
        span: { start: 0, end: 180 },
        title: 'Whole argument',
        summary: 'The entire article resolves into one policy timing problem.',
        sourceSegmentIds: ['b001', 'b002'],
        foregroundConcepts: [{ id: 'timing', label: 'Timing Crisis', weight: 1 }],
        activeRelations: [],
      }],
      readerSteps: [{
        key: 'readerStep:2',
        span: { start: 120, end: 180 },
        summary: 'Last section only.',
        sourceSegmentIds: ['b045'],
        foregroundConcepts: [{ id: 'ending', label: 'Ending', weight: 1 }],
        activeRelations: [],
      }],
      sections: [{ span: { start: 120, end: 180 }, title: 'Last section' }],
    },
    concepts: { byId: {} },
  }, {
    playheadTime: 179.999,
    activeLevel: 'overview',
    graphRenderState: { activeNodeIds: ['timing'] },
  });

  assert.match(html, /Whole argument/);
  assert.match(html, /The entire article resolves/);
  assert.doesNotMatch(html, /Timing Crisis/);
  assert.doesNotMatch(html, /Last section only/);
});

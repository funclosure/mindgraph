import test from 'node:test';
import assert from 'node:assert/strict';
import { renderProse } from '../ui/panels/prose.js';

test('renderProse keeps generated focus text out of the source stream', () => {
  const html = renderProse([
    {
      kind: 'paragraph',
      text: 'Original source text stays primary.',
      segmentIds: ['b001'],
      timeSpan: { start: 0, end: 60 },
      conceptMentions: [],
      focus: {
        timeLabel: '00:00',
        summary: 'The current semantic focus.',
        concepts: [
          { id: 'meaning-crisis', label: 'Meaning Crisis', weight: 0.9, mode: 'explicit' },
          { id: 'wisdom', label: 'Wisdom', weight: 0.8, mode: 'explicit' },
        ],
      },
    },
  ], { graphRenderState: { activeNodeIds: ['meaning-crisis'] } });

  assert.doesNotMatch(html, /class="prose-focus"/);
  assert.doesNotMatch(html, /The current semantic focus\./);
  assert.doesNotMatch(html, />00:00</);
  assert.doesNotMatch(html, /Meaning Crisis/);
  assert.doesNotMatch(html, /prose-focus__chip/);
  assert.match(html, /Original source text stays primary\./);
});

test('renderProse marks the paragraph at the current playhead', () => {
  const html = renderProse([
    {
      kind: 'paragraph',
      text: 'Current source text.',
      segmentIds: ['b001'],
      timeSpan: { start: 0, end: 60 },
      conceptMentions: [],
      focus: { timeLabel: '00:00', summary: 'Current focus.', concepts: [] },
    },
    {
      kind: 'paragraph',
      text: 'Later source text.',
      segmentIds: ['b002'],
      timeSpan: { start: 60, end: 120 },
      conceptMentions: [],
      focus: { timeLabel: '01:00', summary: 'Later focus.', concepts: [] },
    },
  ], { playheadTime: 30, graphRenderState: { activeNodeIds: [] } });

  assert.match(html, /class="prose-block is-current" data-time-start="0"/);
  assert.doesNotMatch(html, /class="prose-block is-current" data-time-start="60"/);
});

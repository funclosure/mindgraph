import test from 'node:test';
import assert from 'node:assert/strict';
import { applyScrollPlayheadState, computeScrollPlayhead } from '../ui/scroll-binding.js';

function fakeBlock({ top, start, end }) {
  return {
    getBoundingClientRect: () => ({ top }),
    getAttribute(name) {
      if (name === 'data-time-start') return String(start);
      if (name === 'data-time-end') return String(end);
      return null;
    },
  };
}

function fakeContainer({ scrollTop, clientHeight, scrollHeight, blocks }) {
  return {
    scrollTop,
    clientHeight,
    scrollHeight,
    getBoundingClientRect: () => ({ top: 0, height: clientHeight }),
    querySelectorAll(selector) {
      if (selector === '.prose-block[data-time-start]') return blocks;
      if (selector === '.prose-block[data-time-end]') return blocks;
      return [];
    },
  };
}

test('computeScrollPlayhead maps the bottom of prose to document overview end', () => {
  const container = fakeContainer({
    scrollTop: 800,
    clientHeight: 200,
    scrollHeight: 1000,
    blocks: [
      fakeBlock({ top: -500, start: 60, end: 120 }),
      fakeBlock({ top: -100, start: 120, end: 180 }),
    ],
  });

  assert.deepEqual(computeScrollPlayhead(container), { time: 179.999, atEnd: true, nearEnd: true });
});

test('computeScrollPlayhead treats the bottom reading zone as overview', () => {
  const container = fakeContainer({
    scrollTop: 760,
    clientHeight: 200,
    scrollHeight: 1000,
    blocks: [
      fakeBlock({ top: -500, start: 60, end: 120 }),
      fakeBlock({ top: -100, start: 120, end: 180 }),
    ],
  });

  assert.deepEqual(computeScrollPlayhead(container), { time: 179.999, atEnd: true, nearEnd: true });
});

test('computeScrollPlayhead uses centered block before the prose bottom', () => {
  const container = fakeContainer({
    scrollTop: 590,
    clientHeight: 200,
    scrollHeight: 1000,
    blocks: [
      fakeBlock({ top: -200, start: 60, end: 120 }),
      fakeBlock({ top: 80, start: 120, end: 180 }),
      fakeBlock({ top: 220, start: 180, end: 240 }),
    ],
  });

  assert.deepEqual(computeScrollPlayhead(container), { time: 120, atEnd: false, nearEnd: false });
});

test('applyScrollPlayheadState switches source-first scroll end to overview then restores reader step', () => {
  const state = {
    viewModel: { sourceFlow: {} },
    activeLevel: 'readerStep',
    playheadTime: 120,
    selectedConceptId: 'concept',
    selectedFrameRef: { level: 'readerStep', index: 3 },
    cameraMode: 'manual',
  };

  assert.equal(applyScrollPlayheadState(state, { time: 179.999, atEnd: true }), true);
  assert.equal(state.activeLevel, 'overview');
  assert.equal(state.scrollOverviewMode, true);
  assert.equal(state.playheadTime, 179.999);
  assert.equal(state.selectedConceptId, undefined);
  assert.equal(state.selectedFrameRef, undefined);
  assert.equal(state.cameraMode, 'auto');

  assert.equal(applyScrollPlayheadState(state, { time: 179.999, atEnd: false, nearEnd: true }), false);
  assert.equal(state.activeLevel, 'overview');
  assert.equal(state.scrollOverviewMode, true);
  assert.equal(state.playheadTime, 179.999);

  assert.equal(applyScrollPlayheadState(state, { time: 120, atEnd: false }), true);
  assert.equal(state.activeLevel, 'readerStep');
  assert.equal(state.scrollOverviewMode, false);
  assert.equal(state.playheadTime, 120);
});

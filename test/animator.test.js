import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnimator } from '../ui/animator.js';

test('animator exposes configurable timing values', () => {
  const animator = createAnimator({ config: { bloomDurationMs: 1200, cameraTimeConstantS: 0.6 } });

  assert.equal(animator.config.bloomDurationMs, 1200);
  assert.equal(animator.config.cameraTimeConstantS, 0.6);
});

test('animator updateConfig changes timing values', () => {
  const animator = createAnimator();

  animator.updateConfig({ fadeDurationMs: 500, highlightTimeConstantS: 0.45 });

  assert.equal(animator.config.fadeDurationMs, 500);
  assert.equal(animator.config.highlightTimeConstantS, 0.45);
});

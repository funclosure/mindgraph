import test from 'node:test';
import assert from 'node:assert/strict';
import { computeVisibleLabels } from '../ui/labels.js';

function ctx() {
  return {
    save() {},
    restore() {},
    set font(value) { this._font = value; },
    set textAlign(value) { this._textAlign = value; },
    set textBaseline(value) { this._textBaseline = value; },
    measureText(text) {
      return { width: String(text).length * 6 };
    },
  };
}

test('computeVisibleLabels clears rings for frame-selected nodes', () => {
  const labels = computeVisibleLabels({
    viewModel: {
      graph: {
        nodes: [{ id: 'mindsight', label: 'Mindsight', level: 'atomic', degree: 2 }],
        conceptImportance: { mindsight: 1 },
      },
      selectors: {
        getConceptNeighbors() {
          return [];
        },
      },
    },
    layout: { nodes: { mindsight: { x: 100, y: 100 } } },
    camera: { zoom: 3, pan: { x: 0, y: 0 } },
    viewport: { width: 800, height: 600 },
    renderState: {
      visibleNodeIds: ['mindsight'],
      selectedNodeIds: ['mindsight'],
      activeNodeIds: [],
    },
    ctx: ctx(),
  });

  assert.equal(labels.length, 1);
  const label = labels[0];
  const dotScreenY = 300;
  const radius = Math.max(2.5, Math.min(6, 2.5 + 2 * 0.4));
  const expectedY = dotScreenY - ((radius + 5) * 3) - 10;
  assert.equal(label.y, expectedY);
});

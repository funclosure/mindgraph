import test from 'node:test';
import assert from 'node:assert/strict';
import { renderOverviewStrip } from '../ui/panels/overview-strip.js';

test('renderOverviewStrip shows source progress with section markers', () => {
  const html = renderOverviewStrip({
    documentMeta: { durationSeconds: 100 },
    sourceFlow: {
      sections: [
        { ref: { level: 'section', index: 0 }, span: { start: 0, end: 40 }, title: 'Opening' },
        { ref: { level: 'section', index: 1 }, span: { start: 40, end: 100 }, title: 'Turn' },
      ],
    },
    selectors: {
      getActiveFrameAtTime(level, time) {
        assert.equal(level, 'section');
        return time >= 40
          ? { ref: { level: 'section', index: 1 } }
          : { ref: { level: 'section', index: 0 } };
      },
    },
  }, { playheadTime: 45 });

  assert.match(html, />source</);
  assert.match(html, /class="strip-progress" style="width:45%"/);
  assert.match(html, /class="strip-cursor" style="left:45%"/);
  assert.match(html, /class="strip-zone"/);
  assert.match(html, /class="strip-zone is-active"/);
  assert.match(html, /data-action="jump-source-section"/);
  assert.match(html, /data-section-index="0"/);
  assert.match(html, /data-section-index="1"/);
  assert.match(html, /title="Opening"/);
  assert.match(html, /class="strip-marker is-active"/);
  assert.match(html, /style="left:0%;width:40%"/);
  assert.match(html, /style="left:40%;width:60%"/);
  assert.doesNotMatch(html, /jump-overview/);
});

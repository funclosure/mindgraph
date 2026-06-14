// ---------------------------------------------------------------------------
// Overview strip — proportional source-flow overview segments.
// ---------------------------------------------------------------------------

import { escapeHtml } from '../util.js';

export function renderOverviewStrip(vm, state) {
  const overview = vm.sourceFlow?.overview ?? vm.frames?.macro ?? [];
  const total = Math.max(1, vm.documentMeta.durationSeconds);
  const overviewLevel = vm.sourceFlow ? 'overview' : 'macro';
  const activeOverview = vm.selectors.getActiveFrameAtTime(overviewLevel, state.playheadTime);
  const activeIdx = activeOverview?.ref.index ?? -1;

  const segments = overview
    .map((frame) => {
      const leftPct = (frame.span.start / total) * 100;
      const widthPct = ((frame.span.end - frame.span.start) / total) * 100;
      const isActive = frame.ref.index === activeIdx;
      const cls = ['strip-seg'];
      if (isActive) cls.push('is-active');
      const title = escapeHtml(frame.title || `Overview ${frame.ref.index + 1}`);
      return `<button type="button" class="${cls.join(' ')}" data-action="jump-overview" data-overview-index="${frame.ref.index}" title="${title}" style="left:${leftPct}%;width:${widthPct}%"></button>`;
    })
    .join('');

  return (
    `<span class="strip-label">overview</span>` +
    `<div class="strip-track">${segments}</div>`
  );
}

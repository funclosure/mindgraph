// ---------------------------------------------------------------------------
// Source strip — source progress with semantic section markers.
// ---------------------------------------------------------------------------

import { escapeHtml } from '../util.js';

export function renderOverviewStrip(vm, state) {
  const sections = vm.sourceFlow?.sections ?? vm.frames?.macro ?? [];
  const total = Math.max(1, vm.documentMeta.durationSeconds);
  const sectionLevel = vm.sourceFlow ? 'section' : 'macro';
  const activeSection = vm.sourceFlow
    ? getActiveSourceSection(sections, state.playheadTime)
    : vm.selectors.getActiveFrameAtTime(sectionLevel, state.playheadTime);
  const activeIdx = activeSection?.ref.index ?? -1;
  const progressPct = clamp(((state.playheadTime ?? 0) / total) * 100, 0, 100);

  const zones = sections
    .map((frame) => {
      const leftPct = (frame.span.start / total) * 100;
      const next = sections[frame.ref.index + 1];
      const rightPct = next ? (next.span.start / total) * 100 : 100;
      const widthPct = Math.max(0.5, rightPct - leftPct);
      const isActive = frame.ref.index === activeIdx;
      const cls = ['strip-zone'];
      if (isActive) cls.push('is-active');
      const title = escapeHtml(frame.title || `Section ${frame.ref.index + 1}`);
      return `<button type="button" class="${cls.join(' ')}" data-action="jump-source-section" data-section-index="${frame.ref.index}" title="${title}" aria-label="${title}" style="left:${leftPct}%;width:${widthPct}%"></button>`;
    })
    .join('');

  const markers = sections
    .map((frame) => {
      const leftPct = (frame.span.start / total) * 100;
      const isActive = frame.ref.index === activeIdx;
      const cls = ['strip-marker'];
      if (isActive) cls.push('is-active');
      return `<span class="${cls.join(' ')}" style="left:${leftPct}%"></span>`;
    })
    .join('');

  return (
    `<span class="strip-label">source</span>` +
    `<div class="strip-track">` +
      `<span class="strip-progress" style="width:${progressPct}%"></span>` +
      zones +
      `<span class="strip-cursor" style="left:${progressPct}%"></span>` +
      markers +
    `</div>`
  );
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getActiveSourceSection(sections, playheadTime) {
  const time = Number(playheadTime ?? 0);
  let active = sections[0];
  for (const section of sections) {
    if ((section.span?.start ?? 0) <= time) active = section;
    else break;
  }
  return active;
}

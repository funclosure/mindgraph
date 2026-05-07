// ---------------------------------------------------------------------------
// Chapter strip — proportional macro segments + drift-forward button.
// ---------------------------------------------------------------------------

import { escapeHtml } from '../util.js';
import { playIcon, pauseIcon } from '../icons.js';
import { isDriftActive } from '../drift.js';

export function renderChapterStrip(vm, state) {
  const macros = vm.frames.macro ?? [];
  const total = Math.max(1, vm.documentMeta.durationSeconds);
  const activeMacro = vm.selectors.getActiveFrameAtTime('macro', state.playheadTime);
  const activeIdx = activeMacro?.ref.index ?? -1;

  const segments = macros
    .map((frame) => {
      const leftPct = (frame.span.start / total) * 100;
      const widthPct = ((frame.span.end - frame.span.start) / total) * 100;
      const isActive = frame.ref.index === activeIdx;
      const cls = ['strip-seg'];
      if (isActive) cls.push('is-active');
      const title = escapeHtml(frame.title || `Chapter ${frame.ref.index + 1}`);
      return `<button type="button" class="${cls.join(' ')}" data-action="jump-chapter" data-macro-index="${frame.ref.index}" title="${title}" style="left:${leftPct}%;width:${widthPct}%"></button>`;
    })
    .join('');

  const driftOn = isDriftActive();
  const driftIcon = driftOn ? pauseIcon() : playIcon();
  const driftClass = driftOn ? 'strip-drift is-on' : 'strip-drift';
  const driftTitle = driftOn ? 'Stop auto-scroll' : 'Auto-scroll forward';

  return (
    `<span class="strip-label">chapters</span>` +
    `<div class="strip-track">${segments}</div>` +
    `<button type="button" class="${driftClass}" data-action="toggle-drift" title="${driftTitle}" aria-label="${driftTitle}">${driftIcon}</button>`
  );
}

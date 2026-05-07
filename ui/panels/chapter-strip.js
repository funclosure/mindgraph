// ---------------------------------------------------------------------------
// Chapter strip — proportional macro segments + drift-forward placeholder
// ---------------------------------------------------------------------------

import { escapeHtml } from '../util.js';

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
      const cls = ['chapter-seg'];
      if (isActive) cls.push('chapter-seg--active');
      const title = `${escapeHtml(frame.title || `Chapter ${frame.ref.index + 1}`)}`;
      return `<button type="button" class="${cls.join(' ')}" data-action="jump-chapter" data-macro-index="${frame.ref.index}" title="${title}" style="left:${leftPct}%;width:${widthPct}%"></button>`;
    })
    .join('');

  return `
    <div class="chapter-strip__label">chapters</div>
    <div class="chapter-strip__track">${segments}</div>
    <button type="button" class="chapter-strip__drift" data-action="toggle-drift" title="drift forward">▶</button>
    <button type="button" class="chapter-strip__collapse" data-action="toggle-chapter-strip" title="Hide chapter strip">⌄</button>
  `;
}

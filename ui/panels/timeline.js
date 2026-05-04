// ---------------------------------------------------------------------------
// Timeline panel renderer
// ---------------------------------------------------------------------------

import { escapeHtml, formatTime, frameLabel } from '../util.js';

export function renderTimeline(vm, activeFrames, graphRenderState, state) {
  const levels = getVisibleTimelineLevels(state.activeLevel);
  return `
    <div class="timeline-panel__header">
      <div class="timeline-heading">
        <h2>Timeline</h2>
        <div class="muted">${graphRenderState.viewportMode} · ${graphRenderState.focusMode}</div>
      </div>
      <div class="timeline-toolbar">
        <button type="button" class="playback-button ${state.isPlaying ? 'active' : ''}" data-action="toggle-play">${state.isPlaying ? 'Pause' : 'Play'}</button>
        <button type="button" class="playback-button" data-action="step-back">←</button>
        <button type="button" class="playback-button" data-action="step-forward">→</button>
        <input class="timeline-range" type="range" min="0" max="${Math.max(1, Math.round(vm.documentMeta.durationSeconds))}" value="${Math.round(state.playheadTime)}" data-action="scrub-playhead" />
        <div class="timeline-time muted">${formatTime(state.playheadTime)} / ${formatTime(vm.documentMeta.durationSeconds)}</div>
        <div class="level-toggle timeline-level-toggle" role="tablist" aria-label="Active frame level">
          ${['macro', 'meso', 'micro'].map((level) => `
            <button type="button" data-action="set-level" data-level="${level}" class="${state.activeLevel === level ? 'active' : ''}">${level}</button>
          `).join('')}
        </div>
      </div>
    </div>
    <div class="track-list track-list--${levels.length}">
      ${levels.map((level) => renderTrack(vm, level, activeFrames[level], state)).join('')}
    </div>
  `;
}

export function getVisibleTimelineLevels(activeLevel) {
  if (activeLevel === 'micro') return ['macro', 'meso', 'micro'];
  if (activeLevel === 'meso') return ['macro', 'meso'];
  return ['macro'];
}

export function renderTrack(vm, level, activeFrame, state) {
  const frames = vm.frames[level];
  const total = Math.max(1, vm.documentMeta.durationSeconds);
  const playheadPct = (state.playheadTime / total) * 100;
  return `
    <div class="track track--${level}">
      <div class="track__label">${level}</div>
      <div class="track__bar" data-level="${level}">
        ${frames.map((frame) => {
          const leftPct = (frame.span.start / total) * 100;
          const widthPct = (frame.duration / total) * 100;
          const isSelected = state.selectedFrameRef && state.selectedFrameRef.level === level && state.selectedFrameRef.index === frame.ref.index;
          const isActive = activeFrame?.ref.index === frame.ref.index;
          return `<button type="button" class="frame-segment ${isSelected ? 'selected-frame' : ''} ${isActive ? 'active-frame' : ''}" style="left:${leftPct}%;width:${widthPct}%" title="${escapeHtml(`${frameLabel(frame)} · ${formatTime(frame.span.start)} → ${formatTime(frame.span.end)}`)}" data-action="select-frame" data-level="${level}" data-index="${frame.ref.index}"></button>`;
        }).join('')}
        <div class="playhead" style="left: calc(${Math.min(100, Math.max(0, playheadPct))}% - 1px)"></div>
      </div>
    </div>
  `;
}

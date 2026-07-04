// ---------------------------------------------------------------------------
// Topbar — single thin header row: title, meta, action icons.
// ---------------------------------------------------------------------------

import { escapeHtml, formatTime } from '../util.js';
import { sourceIcon, chatIcon } from '../icons.js';

// Estimated (word-count-derived) timing renders as a reading-time hint; only
// declared durations (timed media) get the clock format, so the topbar never
// presents a fabricated duration as real.
function formatDuration(documentMeta) {
  if (documentMeta.timing?.mode === 'estimated') {
    const minutes = Math.max(1, Math.ceil((documentMeta.timing.totalSeconds ?? 0) / 60));
    return `~${minutes} min read`;
  }
  return formatTime(documentMeta.durationSeconds);
}

export function renderTopbar(vm, document_, state) {
  const speakers = (vm.documentMeta?.speakers ?? document_.transcript?.speakers ?? []).join(', ') || 'Unknown speaker';
  const srcActive = state.sourceOpen ? 'is-active' : '';
  const askActive = state.askOpen ? 'is-active' : '';
  return (
    `<img class="topbar-logo" src="/assets/mindgraph-icon.svg" alt="mindgraph" width="22" height="22" />` +
    `<h1>${escapeHtml(vm.documentMeta.title)}</h1>` +
    `<span class="topbar-meta">${escapeHtml(speakers)} · ${escapeHtml(formatDuration(vm.documentMeta))}</span>` +
    `<div class="topbar-actions panel-toggles">` +
      `<button type="button" data-action="toggle-source" class="panel-toggle ${srcActive}" title="Toggle the Source panel" aria-pressed="${state.sourceOpen}">${sourceIcon({ size: 15 })}<span>Source</span></button>` +
      `<button type="button" data-action="toggle-ask" class="panel-toggle ${askActive}" title="Toggle the Ask panel" aria-pressed="${state.askOpen}">${chatIcon({ size: 15 })}<span>Chat</span></button>` +
    `</div>`
  );
}

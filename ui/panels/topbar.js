// ---------------------------------------------------------------------------
// Topbar — small floating pill with title, speaker, duration
// ---------------------------------------------------------------------------

import { escapeHtml, formatTime } from '../util.js';

export function renderTopbar(vm, document_) {
  const speakers = (document_.transcript?.speakers ?? []).join(', ') || 'Unknown speaker';
  return (
    `<div class="topbar-title"><h1>${escapeHtml(vm.documentMeta.title)}</h1></div>` +
    `<div class="topbar-meta meta">${escapeHtml(speakers)} · ${formatTime(vm.documentMeta.durationSeconds)}</div>` +
    `<button type="button" class="topbar-collapse" data-action="toggle-topbar" title="Hide topbar">⌄</button>`
  );
}

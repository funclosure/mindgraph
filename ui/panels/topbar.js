// ---------------------------------------------------------------------------
// Topbar — single thin header row: title, meta, action icons.
// ---------------------------------------------------------------------------

import { escapeHtml, formatTime } from '../util.js';
import {
  chatIcon,
  panelRightCloseIcon,
  panelRightOpenIcon,
} from '../icons.js';

export function renderTopbar(vm, document_, state) {
  const speakers = (vm.documentMeta?.speakers ?? document_.transcript?.speakers ?? []).join(', ') || 'Unknown speaker';
  const proseIcon = state.prosCollapsed ? panelRightOpenIcon() : panelRightCloseIcon();
  const proseTitle = state.prosCollapsed ? 'Show reading panel' : 'Hide reading panel';
  const askActive = state.askOpen ? 'is-active' : '';
  const askTitle = state.askOpen ? 'Hide Ask panel' : 'Show Ask panel';
  return (
    `<img class="topbar-logo" src="/assets/mindgraph-icon.svg" alt="mindgraph" width="22" height="22" />` +
    `<h1>${escapeHtml(vm.documentMeta.title)}</h1>` +
    `<span class="topbar-meta">${escapeHtml(speakers)} · ${formatTime(vm.documentMeta.durationSeconds)}</span>` +
    `<div class="topbar-actions">` +
      `<button type="button" data-action="toggle-ask" class="${askActive}" title="${askTitle}" aria-label="${askTitle}">${chatIcon()}</button>` +
      `<button type="button" data-action="toggle-prose" title="${proseTitle}" aria-label="${proseTitle}">${proseIcon}</button>` +
    `</div>`
  );
}

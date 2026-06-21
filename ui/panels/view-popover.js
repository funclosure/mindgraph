// ---------------------------------------------------------------------------
// View popover — panel only. The trigger button lives in the topbar.
// ---------------------------------------------------------------------------

export function renderViewPopover(state) {
  if (!state.viewPopoverOpen) return '';
  const levels = state.document?.kind === 'mindgraph.source-first'
    ? [
        ['overview', 'Whole map'],
        ['section', 'Section'],
        ['readerStep', 'Current step'],
      ]
    : [
        ['macro', 'Whole map'],
        ['meso', 'Section'],
        ['micro', 'Current step'],
      ];
  const levelButtons = levels
    .map(([level, label]) => {
      const active = state.activeLevel === level;
      return `<button type="button" class="vp-level ${active ? 'is-active' : ''}" data-action="set-level" data-level="${level}">${label}</button>`;
    })
    .join('');
  return `
    <div class="view-popover__panel">
      <div class="view-popover__row">
        <div class="view-popover__label">Graph focus</div>
        <div class="view-popover__levels">${levelButtons}</div>
        <div class="view-popover__hint">How closely the graph follows where you're reading — the whole map, the current section, or just this step.</div>
      </div>
    </div>
  `;
}

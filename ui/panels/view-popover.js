// ---------------------------------------------------------------------------
// View popover — panel only. The trigger button lives in the topbar.
// ---------------------------------------------------------------------------

export function renderViewPopover(state) {
  if (!state.viewPopoverOpen) return '';
  const levels = state.document?.kind === 'mindgraph.source-first'
    ? [
        ['overview', 'overview'],
        ['section', 'section'],
        ['readerStep', 'reader step'],
      ]
    : [
        ['macro', 'macro'],
        ['meso', 'meso'],
        ['micro', 'micro'],
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
        <div class="view-popover__label">Camera level</div>
        <div class="view-popover__levels">${levelButtons}</div>
      </div>
    </div>
  `;
}

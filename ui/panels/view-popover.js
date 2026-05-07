// ---------------------------------------------------------------------------
// View popover — small icon + popover with macro/meso/micro level toggle
// ---------------------------------------------------------------------------
//
// Controls camera cadence (which level's foreground concepts drive the
// camera target). Default: macro. Most users will not open this.

export function renderViewPopover(state) {
  const isOpen = !!state.viewPopoverOpen;
  const levelButtons = ['macro', 'meso', 'micro']
    .map((level) => {
      const active = state.activeLevel === level;
      return `<button type="button" class="vp-level ${active ? 'is-active' : ''}" data-action="set-level" data-level="${level}">${level}</button>`;
    })
    .join('');

  return `
    <button type="button" class="view-popover__toggle" data-action="toggle-view-popover" aria-expanded="${isOpen}" title="View settings">⚙</button>
    ${isOpen ? `
      <div class="view-popover__panel">
        <div class="view-popover__row">
          <div class="view-popover__label">Camera level</div>
          <div class="view-popover__levels">${levelButtons}</div>
        </div>
      </div>
    ` : ''}
  `;
}

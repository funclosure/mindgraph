// ---------------------------------------------------------------------------
// Graph-focus control — an always-visible overlay on the graph that sets how
// closely the view follows where you're reading (whole map / section / step).
// ---------------------------------------------------------------------------

export function renderGraphFocus(state) {
  if (!state.viewModel) return '';
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
  const buttons = levels
    .map(([level, label]) => {
      const active = state.activeLevel === level ? ' is-active' : '';
      return `<button type="button" class="gf-level${active}" data-action="set-level" data-level="${level}">${label}</button>`;
    })
    .join('');
  return (
    `<span class="gf-title" title="How closely the graph follows where you're reading — the whole map, the current section, or just this step.">Focus</span>` +
    buttons
  );
}

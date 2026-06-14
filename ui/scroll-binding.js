// ---------------------------------------------------------------------------
// scroll-binding — reads the prose's centered paragraph and writes playhead
// ---------------------------------------------------------------------------
//
// Attach once during bootstrap. The listener is throttled to one update per
// animation frame to avoid spamming render() during fast scroll.

export function attachScrollBinding({ container, getState, onChange }) {
  if (!container || container.dataset.scrollBindingAttached) return;
  container.dataset.scrollBindingAttached = '1';

  let queued = false;
  container.addEventListener('scroll', () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      const t = computeCenteredPlayhead(container);
      if (t == null) return;
      const state = getState();
      // Only write if the playhead actually moves; avoids re-render storms.
      if (Math.abs((state.playheadTime ?? 0) - t) < 0.05) return;
      state.playheadTime = t;
      state.selectedConceptId = undefined;
      state.selectedFrameRef = undefined;
      state.cameraMode = 'auto';
      onChange();
    });
  });
}

// Find the prose block whose box overlaps the vertical center of the
// container's viewport. Falls back to the paragraph above if the center
// lands in a gap.
function computeCenteredPlayhead(container) {
  const containerRect = container.getBoundingClientRect();
  const centerY = containerRect.top + containerRect.height / 2;
  const blocks = container.querySelectorAll('.prose-block[data-time-start]');
  if (!blocks.length) return null;

  let chosen = blocks[0];
  for (const block of blocks) {
    const r = block.getBoundingClientRect();
    if (r.top > centerY) break; // paragraph starts below the center; stop — chosen is the one above.
    chosen = block;
  }
  const startStr = chosen.getAttribute('data-time-start');
  const start = Number(startStr);
  return Number.isFinite(start) ? start : null;
}

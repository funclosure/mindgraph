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
      onChange();
    });
  });
}

// Find the paragraph whose box overlaps the vertical center of the
// container's viewport. Falls back to the paragraph above if the center
// lands in a gap.
function computeCenteredPlayhead(container) {
  const containerRect = container.getBoundingClientRect();
  const centerY = containerRect.top + containerRect.height / 2;
  const paras = container.querySelectorAll('.prose-para[data-time-start]');
  if (!paras.length) return null;

  let chosen = paras[0];
  for (const p of paras) {
    const r = p.getBoundingClientRect();
    if (r.top > centerY) break; // paragraph starts below the center; stop — chosen is the one above.
    chosen = p;
  }
  const startStr = chosen.getAttribute('data-time-start');
  const start = Number(startStr);
  return Number.isFinite(start) ? start : null;
}

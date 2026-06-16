// ---------------------------------------------------------------------------
// scroll-binding — reads the prose's centered paragraph and writes playhead
// ---------------------------------------------------------------------------
//
// Attach once during bootstrap. The listener is throttled to one update per
// animation frame to avoid spamming render() during fast scroll.

const END_SNAP_MIN_PX = 48;
const END_SNAP_VIEWPORT_RATIO = 0.08;
const END_SNAP_MAX_PX = 96;
const END_HOLD_MIN_PX = 180;
const END_HOLD_VIEWPORT_RATIO = 0.24;
const END_HOLD_MAX_PX = 280;

export function attachScrollBinding({ container, getState, onChange }) {
  if (!container || container.dataset.scrollBindingAttached) return;
  container.dataset.scrollBindingAttached = '1';

  let queued = false;
  container.addEventListener('scroll', () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      const next = computeScrollPlayhead(container);
      if (!next) return;
      const changed = applyScrollPlayheadState(getState(), next);
      if (changed) onChange();
    });
  });
}

export function applyScrollPlayheadState(state, next) {
  const previousTime = state.playheadTime ?? 0;
  const previousLevel = state.activeLevel;
  const isSourceFirst = Boolean(state.viewModel?.sourceFlow);
  if (isSourceFirst && next.atEnd) {
    state.activeLevel = 'overview';
    state.scrollOverviewMode = true;
  } else if (isSourceFirst && state.scrollOverviewMode && next.nearEnd) {
    state.activeLevel = 'overview';
  } else if (state.scrollOverviewMode) {
    state.activeLevel = 'readerStep';
    state.scrollOverviewMode = false;
  }

  const timeChanged = Math.abs(previousTime - next.time) >= 0.05;
  const levelChanged = previousLevel !== state.activeLevel;
  if (!timeChanged && !levelChanged) return false;

  state.playheadTime = next.time;
  state.selectedConceptId = undefined;
  state.selectedFrameRef = undefined;
  state.cameraMode = 'auto';
  return true;
}

export function computeScrollPlayhead(container) {
  const endState = getEndScrollState(container);
  if (endState.atEnd) {
    const end = maxProseEndTime(container);
    if (end != null) return { time: Math.max(0, end - 0.001), atEnd: true, nearEnd: true };
  }
  const time = computeCenteredPlayhead(container);
  return time == null ? null : { time, atEnd: false, nearEnd: endState.nearEnd };
}

function getEndScrollState(container) {
  const remaining = container.scrollHeight - container.scrollTop - container.clientHeight;
  const snapZone = Math.min(
    END_SNAP_MAX_PX,
    Math.max(END_SNAP_MIN_PX, container.clientHeight * END_SNAP_VIEWPORT_RATIO),
  );
  const holdZone = Math.min(
    END_HOLD_MAX_PX,
    Math.max(END_HOLD_MIN_PX, container.clientHeight * END_HOLD_VIEWPORT_RATIO),
  );
  return {
    atEnd: remaining <= snapZone,
    nearEnd: remaining <= holdZone,
  };
}

function maxProseEndTime(container) {
  let end;
  for (const block of container.querySelectorAll('.prose-block[data-time-end]')) {
    const value = Number(block.getAttribute('data-time-end'));
    if (Number.isFinite(value)) end = Math.max(end ?? value, value);
  }
  return end;
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

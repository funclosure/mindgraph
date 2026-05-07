// ---------------------------------------------------------------------------
// Drift — auto-scroll the prose at the source's speech rate
// ---------------------------------------------------------------------------

let driftActive = false;
let driftRaf = null;
let lastT = 0;
let lastScrollTop = 0;
let lastContainer = null;
let pixelsPerSecond = 0;
let onCancelCb = null;
// Float accumulator: tracks the exact fractional pixel position independently
// of the browser's integer-rounded scrollTop property, so sub-pixel rates
// (e.g. 8 px/s at 60 fps = 0.13 px/frame) accumulate correctly.
let floatPosition = 0;

export function startDrift({ container, pixelsPerSecond: pps, onCancel }) {
  if (driftActive) return;
  driftActive = true;
  pixelsPerSecond = Math.max(8, pps);
  lastT = performance.now();
  lastScrollTop = container.scrollTop;
  floatPosition = container.scrollTop;
  lastContainer = container;
  onCancelCb = onCancel;

  // User-scroll cancel: any scroll event whose new scrollTop differs from
  // our expected scrollTop by more than 4 px is treated as user input.
  container.addEventListener('scroll', userScrollGuard, { passive: true });

  function tick(now) {
    if (!driftActive) return;
    const dt = Math.min(0.1, (now - lastT) / 1000);
    lastT = now;
    floatPosition += pixelsPerSecond * dt;
    const nextInt = Math.round(floatPosition);
    container.scrollTop = nextInt;
    lastScrollTop = container.scrollTop; // actual integer value after browser rounding
    if (container.scrollTop + container.clientHeight >= container.scrollHeight - 1) {
      stopDrift();
      return;
    }
    driftRaf = requestAnimationFrame(tick);
  }
  driftRaf = requestAnimationFrame(tick);
}

function userScrollGuard() {
  if (!driftActive || !lastContainer) return;
  const delta = Math.abs(lastContainer.scrollTop - lastScrollTop);
  if (delta > 4) {
    stopDrift();
  }
}

export function stopDrift() {
  if (!driftActive) return;
  driftActive = false;
  if (driftRaf != null) cancelAnimationFrame(driftRaf);
  driftRaf = null;
  floatPosition = 0;
  if (lastContainer) lastContainer.removeEventListener('scroll', userScrollGuard);
  lastContainer = null;
  if (onCancelCb) {
    const cb = onCancelCb;
    onCancelCb = null;
    cb();
  }
}

export function isDriftActive() {
  return driftActive;
}

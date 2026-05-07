// ---------------------------------------------------------------------------
// Animator — per-entity opacity/scale, live camera, rAF tick loop
// ---------------------------------------------------------------------------
//
// The animator is the only stateful piece of the canvas rendering. Every other
// layer is a pure function of the input state. Each rAF tick:
//   1. Read the latest pure render-state (cumulative sets, cameraTarget).
//   2. Update per-entity opacity/scale (snap for now; bloom/fade later).
//   3. Update the live camera (snap for now; lerp later).
//   4. Return whether anything is still animating, so app.js can stop the
//      loop when everything has settled.

export function createAnimator() {
  const entityStates = new Map(); // id -> { opacity, scale, blooming, fading, animStart }
  let prevConceptSet = null;
  let prevClusterSet = null;
  let prevEdgeSet = null;

  function getEntityState(id) {
    let s = entityStates.get(id);
    if (!s) {
      s = { opacity: 1, scale: 1, blooming: false, fading: false, animStart: 0 };
      entityStates.set(id, s);
    }
    return s;
  }

  function step(now, opts) {
    const {
      cumulativeVisibleConceptIds = [],
      cumulativeVisibleClusterIds = [],
      cumulativeVisibleEdgeIds = [],
      cameraTarget,
      cameraMode,
      camera,
    } = opts;

    const conceptSet = new Set(cumulativeVisibleConceptIds);
    const clusterSet = new Set(cumulativeVisibleClusterIds);
    const edgeSet = new Set(cumulativeVisibleEdgeIds);

    const isFirstStep = prevConceptSet === null;
    if (isFirstStep) {
      // On first tick, treat current visible set as already-resting state.
      for (const id of conceptSet) {
        const s = getEntityState(id);
        s.opacity = 1;
        s.scale = 1;
      }
    }
    prevConceptSet = conceptSet;
    prevClusterSet = clusterSet;
    prevEdgeSet = edgeSet;

    // Snap visible entities to opacity 1 / scale 1; hidden entities to opacity 0.
    // (Bloom and fade transitions come in later tasks.)
    for (const id of conceptSet) {
      const s = getEntityState(id);
      s.opacity = 1;
      s.scale = 1;
    }
    for (const [id, s] of entityStates) {
      if (!conceptSet.has(id) && !clusterSet.has(id) && !edgeSet.has(id)) {
        s.opacity = 0;
      }
    }

    // Camera snap (lerp comes later).
    if (cameraTarget && cameraMode === 'auto') {
      // No-op for now; camera stays where bootstrap put it.
    }

    return false; // never "still animating" until later tasks add real interp
  }

  return {
    step,
    getEntityState,
    isVisible(id) {
      return (entityStates.get(id)?.opacity ?? 0) > 0.001;
    },
  };
}

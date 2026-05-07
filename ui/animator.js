// ---------------------------------------------------------------------------
// Animator — per-entity opacity/scale, live camera, rAF tick loop
// ---------------------------------------------------------------------------
//
// The animator is the only stateful piece of the canvas rendering. Every other
// layer is a pure function of the input state. Each rAF tick:
//   1. Read the latest pure render-state (cumulative sets, cameraTarget).
//   2. Update per-entity opacity/scale (bloom on entry; snap for removal).
//   3. Update the live camera (snap for now; lerp later).
//   4. Return whether anything is still animating, so app.js can stop the
//      loop when everything has settled.

function easeOutCubic(t) {
  const x = Math.max(0, Math.min(1, t));
  return 1 - Math.pow(1 - x, 3);
}

const BLOOM_DURATION_MS = 600;
const FADE_DURATION_MS = 200;

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

  function startBloom(id, now) {
    const s = getEntityState(id);
    s.blooming = true;
    s.fading = false;
    s.animStart = now;
    s.opacity = 0;
    s.scale = 1.6;
  }

  function startFade(id, now) {
    const s = getEntityState(id);
    if (s.opacity <= 0.001) return; // already invisible
    s.fading = true;
    s.blooming = false;
    s.animStart = now;
    s.scale = 1;
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

    // Detect transitions on every step except the very first. On first
    // step, just record the current sets as "already resting".
    if (isFirstStep) {
      for (const id of conceptSet) {
        const s = getEntityState(id);
        s.opacity = 1;
        s.scale = 1;
      }
      for (const id of clusterSet) {
        const s = getEntityState(id);
        s.opacity = 1;
        s.scale = 1;
      }
      for (const id of edgeSet) {
        const s = getEntityState(id);
        s.opacity = 1;
        s.scale = 1;
      }
    } else {
      // Newly entering ids → schedule a bloom.
      for (const id of conceptSet) if (!prevConceptSet.has(id)) startBloom(id, now);
      for (const id of clusterSet) if (!prevClusterSet.has(id)) startBloom(id, now);
      for (const id of edgeSet) if (!prevEdgeSet.has(id)) startBloom(id, now);

      // Newly leaving ids → schedule a fade.
      for (const id of prevConceptSet) if (!conceptSet.has(id)) startFade(id, now);
      for (const id of prevClusterSet) if (!clusterSet.has(id)) startFade(id, now);
      for (const id of prevEdgeSet) if (!edgeSet.has(id)) startFade(id, now);
    }
    prevConceptSet = conceptSet;
    prevClusterSet = clusterSet;
    prevEdgeSet = edgeSet;

    // Advance bloom for any blooming entity.
    let stillAnimating = false;
    for (const [, s] of entityStates) {
      if (s.blooming) {
        const t = (now - s.animStart) * 1000 / BLOOM_DURATION_MS;
        if (t >= 1) {
          s.opacity = 1;
          s.scale = 1;
          s.blooming = false;
        } else {
          const e = easeOutCubic(t);
          s.opacity = e;
          s.scale = 1.6 - 0.6 * e;
          stillAnimating = true;
        }
      } else if (s.fading) {
        const t = (now - s.animStart) * 1000 / FADE_DURATION_MS;
        if (t >= 1) {
          s.opacity = 0;
          s.fading = false;
        } else {
          s.opacity = 1 - t;
          stillAnimating = true;
        }
      }
    }

    // Camera (lerp comes in Task 7 — leave a placeholder spot here).
    if (cameraTarget && cameraMode === 'auto') {
      // No-op for now; camera lerp added in Task 7.
    }

    return stillAnimating;
  }

  return {
    step,
    getEntityState,
    isVisible(id) {
      return (entityStates.get(id)?.opacity ?? 0) > 0.001;
    },
  };
}

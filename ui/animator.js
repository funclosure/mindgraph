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
const CAMERA_TIME_CONSTANT_S = 0.23; // ~700ms full convergence

export function createAnimator() {
  const entityStates = new Map(); // id -> { opacity, scale, blooming, fading, animStart }
  let prevConceptSet = null;
  let prevClusterSet = null;
  let prevEdgeSet = null;
  const microSmoothBuffer = []; // array of recent { cx, cy, zoom } at micro level
  const MICRO_SMOOTH_SIZE = 5;

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

    let effectiveTarget = cameraTarget;
    if (effectiveTarget) {
      if (opts.activeLevel === 'micro') {
        microSmoothBuffer.push({ ...effectiveTarget });
        while (microSmoothBuffer.length > MICRO_SMOOTH_SIZE) microSmoothBuffer.shift();
        let scx = 0, scy = 0, szoom = 0;
        for (const t of microSmoothBuffer) { scx += t.cx; scy += t.cy; szoom += t.zoom; }
        const n = microSmoothBuffer.length;
        effectiveTarget = { cx: scx / n, cy: scy / n, zoom: szoom / n };
      } else if (microSmoothBuffer.length) {
        microSmoothBuffer.length = 0; // clear when leaving micro
      }
    }

    if (effectiveTarget && (cameraMode === 'auto' || cameraMode === 'selection')) {
      const targetZoom = effectiveTarget.zoom;
      const targetPanX = (opts.viewport?.width ?? 0) / 2 - effectiveTarget.cx * targetZoom;
      const targetPanY = (opts.viewport?.height ?? 0) / 2 - effectiveTarget.cy * targetZoom;

      const factor = 1 - Math.exp(-(opts.dt ?? 0) / CAMERA_TIME_CONSTANT_S);
      camera.zoom += (targetZoom - camera.zoom) * factor;
      camera.pan.x += (targetPanX - camera.pan.x) * factor;
      camera.pan.y += (targetPanY - camera.pan.y) * factor;

      const dz = Math.abs(targetZoom - camera.zoom);
      const dx = Math.abs(targetPanX - camera.pan.x);
      const dy = Math.abs(targetPanY - camera.pan.y);
      if (dz > 0.0005 || dx > 0.5 || dy > 0.5) stillAnimating = true;
      else {
        camera.zoom = targetZoom;
        camera.pan.x = targetPanX;
        camera.pan.y = targetPanY;
      }
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

// ---------------------------------------------------------------------------
// Camera — DPR setup, coordinate transforms, fit/zoom helpers
// ---------------------------------------------------------------------------

// Canvas size is read from the element's CSS box. The CSS layout (.graph-
// canvas-wrap with width/height: 100%) drives the box size; this module just
// matches the internal pixel buffer to whatever the box turned out to be.
export function applyDpr(canvas, ctx) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { width, height };
}

export function screenToWorld(camera, point) {
  return {
    x: (point.x - camera.pan.x) / camera.zoom,
    y: (point.y - camera.pan.y) / camera.zoom,
  };
}

export function worldToScreen(camera, point) {
  return {
    x: point.x * camera.zoom + camera.pan.x,
    y: point.y * camera.zoom + camera.pan.y,
  };
}

export function fitCameraToLayout(camera, layout, viewport, padding = 48) {
  const clusters = layout.clusters;
  if (!clusters.length) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of clusters) {
    minX = Math.min(minX, c.x - c.radius);
    minY = Math.min(minY, c.y - c.radius);
    maxX = Math.max(maxX, c.x + c.radius);
    maxY = Math.max(maxY, c.y + c.radius);
  }
  const worldW = maxX - minX;
  const worldH = maxY - minY;
  const screenW = Math.max(1, viewport.width - padding * 2);
  const screenH = Math.max(1, viewport.height - padding * 2);
  const zoom = Math.min(screenW / worldW, screenH / worldH);
  camera.zoom = zoom;
  camera.pan.x = padding - minX * zoom + (screenW - worldW * zoom) / 2;
  camera.pan.y = padding - minY * zoom + (screenH - worldH * zoom) / 2;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

export function zoomAround(camera, screenPoint, factor) {
  const before = screenToWorld(camera, screenPoint);
  camera.zoom = clamp(camera.zoom * factor, 0.2, 4);
  const after = screenToWorld(camera, screenPoint);
  camera.pan.x += (after.x - before.x) * camera.zoom;
  camera.pan.y += (after.y - before.y) * camera.zoom;
}

export function zoomAroundCenter(camera, viewport, factor) {
  const cx = viewport.width / 2;
  const cy = viewport.height / 2;
  zoomAround(camera, { x: cx, y: cy }, factor);
}

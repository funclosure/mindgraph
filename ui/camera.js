// ---------------------------------------------------------------------------
// Camera — DPR setup, coordinate transforms, fit/zoom helpers
// ---------------------------------------------------------------------------

const CANVAS_W = 1280;
const CANVAS_H = 800;

export function applyDpr(canvas, ctx) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = CANVAS_W * dpr;
  canvas.height = CANVAS_H * dpr;
  canvas.style.width = `${CANVAS_W}px`;
  canvas.style.height = `${CANVAS_H}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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

export function fitCameraToLayout(camera, layout, padding = 60) {
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
  const screenW = CANVAS_W - padding * 2;
  const screenH = CANVAS_H - padding * 2;
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

export function zoomAroundCenter(camera, factor) {
  const cx = CANVAS_W / 2;
  const cy = CANVAS_H / 2;
  zoomAround(camera, { x: cx, y: cy }, factor);
}

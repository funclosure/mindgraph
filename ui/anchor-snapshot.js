// Capture a copy of an anchor concept's current layout position, or null.
// Used to hold the deepened concept in place across a graph rebuild so new
// nodes grow locally instead of the whole graph reshuffling.
export function captureAnchor(positions, anchorId) {
  if (!anchorId || !positions || !positions[anchorId]) return null;
  return { x: positions[anchorId].x, y: positions[anchorId].y };
}

// ---------------------------------------------------------------------------
// Labels — importance-driven, zoom-threshold-gated, collision-aware label
// placement in screen space.
//
// Pure function. Inputs: VM, layout, camera, viewport, render state, ctx
// (for measureText), hover/selection. Output: array of resolved labels with
// screen-space x/y/alpha, ready to draw.
//
// See docs/superpowers/specs/2026-05-10-graph-rendering-design.md § "Importance
// score & label collision" for the full rationale.
// ---------------------------------------------------------------------------

const FONT = "11px 'Inter', system-ui, sans-serif";
const LABEL_PADDING_X = 4;   // horizontal hit padding around each rect for collision
const LABEL_PADDING_Y = 2;
const VIEWPORT_PAD = 40;     // skip labels whose dot is more than this many px outside the viewport

export function computeVisibleLabels({
  viewModel,
  layout,
  camera,
  viewport,
  renderState,
  ctx,
  hoveredConceptId,
  selectedConceptId,
}) {
  if (!viewModel || !layout || !camera || !viewport || !ctx) return [];

  const conceptImportance = renderState?.conceptImportance ?? viewModel.graph.conceptImportance ?? {};
  const activeNodeIds = new Set(renderState?.activeNodeIds ?? []);
  // Labels can only appear for concepts whose dots are actually rendered.
  // visibleNodeIds is the dot-rendering set (cumulative-gated, capped by
  // viewport mode). Filtering on it instead of the broader cumulative set
  // prevents labels-floating-in-empty-space when the dot cap excludes a
  // bloomed-in concept.
  const renderedNodeIds = new Set(
    renderState?.visibleNodeIds
    ?? renderState?.cumulativeVisibleConceptIds
    ?? viewModel.graph.nodes.map((n) => n.id),
  );

  // Selection focus mode: if anything is selected, suppress non-neighbor labels entirely.
  const selectedNeighborIds = new Set();
  if (selectedConceptId) {
    const neighbors = viewModel.selectors.getConceptNeighbors(selectedConceptId);
    for (const concept of neighbors) selectedNeighborIds.add(concept.id);
  }
  const focusMode = !!selectedConceptId;

  // Build candidates: all bloomed-in atomic concepts.
  const z = camera.zoom;
  const cutoff = threshold(z);
  ctx.save();
  ctx.font = FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';

  const candidates = [];
  for (const node of viewModel.graph.nodes) {
    if (node.level !== 'atomic') continue;
    if (!renderedNodeIds.has(node.id)) continue;

    const isHovered = hoveredConceptId === node.id;
    const isSelected = selectedConceptId === node.id;
    const isNeighbor = selectedNeighborIds.has(node.id);
    const isActive = activeNodeIds.has(node.id);

    // Selection focus mode: drop everyone who isn't selected/neighbor, regardless of base importance.
    // Hover always survives — you explicitly summoned that label.
    if (focusMode && !isSelected && !isNeighbor && !isHovered) continue;

    const importance = importanceFor(node, {
      conceptImportance,
      hoveredConceptId,
      selectedConceptId,
      selectedNeighborIds,
      activeNodeIds,
    });

    if (importance < cutoff && !isHovered && !isSelected && !isNeighbor) continue;

    candidates.push({ node, importance, isHovered, isSelected, isActive });
  }

  candidates.sort((a, b) => b.importance - a.importance);

  // Greedy placement in screen space with collision check.
  const placed = [];
  for (const cand of candidates) {
    const worldPos = layout.nodes[cand.node.id];
    if (!worldPos) continue;
    const screenPos = worldToScreen(worldPos, camera);

    // Off-viewport (with padding): skip — never draw a label the user can't see.
    if (
      screenPos.x < -VIEWPORT_PAD ||
      screenPos.x > viewport.width + VIEWPORT_PAD ||
      screenPos.y < -VIEWPORT_PAD ||
      screenPos.y > viewport.height + VIEWPORT_PAD
    ) continue;

    const text = cand.node.label;
    const metrics = ctx.measureText(text);
    const w = metrics.width + LABEL_PADDING_X * 2;
    const h = 14 + LABEL_PADDING_Y * 2;
    // Outer visual radius — includes the selection / hover ring so the label
    // clears the ring at any zoom. ui/draw.js draws the selection ring at
    // (dotRadius + 4) world units with a 1.6 px stroke; ~5 covers it.
    const ringExtra = (cand.isSelected || cand.isHovered) ? 5 : 0;
    const dotR = (dotRadiusFor(cand.node) + ringExtra) * z;
    const left = screenPos.x - w / 2;
    const top = screenPos.y - dotR - 6 - h;
    const rect = {
      left,
      top,
      right: left + w,
      bottom: top + h,
    };

    // Collision check.
    let collidesWith = -1;
    for (let i = 0; i < placed.length; i += 1) {
      if (rectsIntersect(rect, placed[i].rect)) { collidesWith = i; break; }
    }
    if (collidesWith !== -1) {
      // Hover/selection bypass collision and EVICT the lower-importance occupant.
      if (cand.isHovered || cand.isSelected) {
        placed.splice(collidesWith, 1);
      } else {
        continue;
      }
    }

    const alpha = alphaFor({
      importance: cand.importance,
      zoom: z,
      isHovered: cand.isHovered,
      isSelected: cand.isSelected,
      isActive: cand.isActive,
    });

    placed.push({
      id: cand.node.id,
      text,
      x: screenPos.x,
      y: screenPos.y - dotR - 6,
      alpha,
      rect,
    });
  }

  ctx.restore();
  return placed;
}

function worldToScreen(point, camera) {
  return {
    x: point.x * camera.zoom + camera.pan.x,
    y: point.y * camera.zoom + camera.pan.y,
  };
}

function dotRadiusFor(node) {
  // Mirror the formula used by ui/draw.js so labels offset above the dot at
  // the dot's actual screen-space radius (dots themselves render in world
  // space; radius scales with camera zoom).
  return Math.max(2.5, Math.min(6, 2.5 + (node.degree ?? 0) * 0.4));
}

function rectsIntersect(a, b) {
  return !(a.right < b.left || b.right < a.left || a.bottom < b.top || b.bottom < a.top);
}

function threshold(zoom) {
  // Spec: clamp(0.85 − (zoom − 1.0) × 0.20, 0.05, 0.85)
  // zoom 1.0 → 0.85, zoom 2.0 → 0.65, zoom 4.0 → 0.25, zoom ≥ 5 → 0.05
  return Math.max(0.05, Math.min(0.85, 0.85 - (zoom - 1.0) * 0.20));
}

function alphaFor({ importance, zoom, isHovered, isSelected, isActive }) {
  if (isHovered || isSelected) return 1.0;
  const margin = importance - threshold(zoom);
  const base = Math.max(0.4, Math.min(1.0, margin * 4));
  if (isActive) return Math.max(base, 0.92);
  return base;
}

function importanceFor(node, {
  conceptImportance,
  hoveredConceptId,
  selectedConceptId,
  selectedNeighborIds,
  activeNodeIds,
}) {
  let score = conceptImportance[node.id] ?? 0;
  if (activeNodeIds.has(node.id)) score += 0.6;
  if (selectedConceptId === node.id) score += 0.8;
  else if (selectedNeighborIds.has(node.id)) score += 0.4;
  if (hoveredConceptId === node.id) score += 1.0;
  return score;
}

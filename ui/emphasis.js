// ---------------------------------------------------------------------------
// Graph emphasis — the single home for how nodes/edges are highlighted/dimmed.
// ---------------------------------------------------------------------------
//
// First-principles split:
//   • The view-model (buildGraphRenderState) decides WHICH emphasis tier each
//     visible node/edge is in — resolving the selection-vs-playhead priority
//     exactly once. It emits the membership sets (selectedNodeIds, activeNodeIds,
//     dimmedNodeIds, dimmedEdgeIds, …) and a single `mode` scalar.
//   • This module owns the PRESENTATION: tier → {alpha, tint, width, dash, ring}.
//
// Both the animator targets (app.js computeHighlightTargets) and the canvas
// renderer (draw.js) resolve style through the SAME functions here, so the eased
// value and the first-frame fallback can never diverge, the cascade lives in one
// place, and the tier precedence (which used to be a nested ternary duplicated in
// three spots) cannot fall out of order.

// A node's appearance is two ORTHOGONAL visual axes, resolved independently:
//
//   • PROMINENCE → alpha. One mutually-exclusive tier per node. Precedence:
//     selected > dimmed > active > revealed. `dimmed` deliberately beats `active`
//     so a selection spotlights even at Whole map, where the overview frame marks
//     nearly every node "active".
//
//   • ACTIVATION → tint (the warm "glow"). Lit when the playhead is reading this
//     concept and it isn't dimmed out of a spotlight — regardless of prominence.
//
// These coincide for most nodes but are genuinely different signals: a SELECTED
// node can also be the current reading focus, and shows BOTH the selection ring
// and the active glow. Collapsing them into a single tier (where `selected` would
// force tint 0) silently dropped that glow — so they stay two axes here.
export const NODE_ALPHA = Object.freeze({
  selected: 1.0,
  dimmed: 0.22,
  active: 0.95,
  revealed: 0.85,
});
export const ACTIVE_TINT = 1.0;

export const SELECTED_RADIUS_BOOST = 1.5;
export const SELECTED_RING = Object.freeze({ color: '#fff4db', width: 1.6, extraRadius: 4 });

// Prominence axis: which tier sets the node's alpha.
export function nodeTier(id, { selected, dimmed, active }) {
  if (selected.has(id)) return 'selected';
  if (dimmed.has(id)) return 'dimmed';
  if (active.has(id)) return 'active';
  return 'revealed';
}

// Activation axis: glow when the playhead is on this concept and it isn't dimmed.
// Independent of the prominence tier, so selected+active nodes still glow.
export function nodeTint(id, { dimmed, active }) {
  return active.has(id) && !dimmed.has(id) ? ACTIVE_TINT : 0.0;
}

export function nodeEmphasis(id, sets) {
  return { alpha: NODE_ALPHA[nodeTier(id, sets)], tint: nodeTint(id, sets) };
}

// Edge tiers → {alpha, width}. Precedence: onSelection > dimmed > active >
// inferred > passive. (`dimmedEdges` is the producer-owned set of visible edges
// that don't touch the selection while in spotlight mode.)
export const EDGE_STYLE = Object.freeze({
  onSelection: { alpha: 0.95, width: 1.4 },
  dimmed: { alpha: 0.06, width: 0.5 },
  active: { alpha: 0.95, width: 1.0 },
  inferred: { alpha: 0.22, width: 0.8 },
  passive: { alpha: 0.16, width: 0.6 },
});

const EDGE_STROKE_RGB = '218, 184, 116';

export function edgeTier(edge, { selectedNodes, dimmedEdges, activeEdges }) {
  if (selectedNodes.has(edge.from) || selectedNodes.has(edge.to)) return 'onSelection';
  if (dimmedEdges.has(edge.id)) return 'dimmed';
  if (activeEdges.has(edge.id)) return 'active';
  if (edge?.provenance === 'inferred') return 'inferred';
  return 'passive';
}

export function edgeStyle(edge, { selectedNodes, dimmedEdges, activeEdges, animOpacity = 1 }) {
  const tier = edgeTier(edge, { selectedNodes, dimmedEdges, activeEdges });
  const { alpha, width } = EDGE_STYLE[tier];
  // Inferred (agent-added) relations render dashed; the wider dash marks the ones
  // on the selection or the active reading path.
  const inferred = edge?.provenance === 'inferred';
  const onPath = tier === 'onSelection' || activeEdges.has(edge.id);
  const dash = inferred ? (onPath ? [7, 4] : [6, 4]) : [];
  return {
    alpha,
    strokeStyle: `rgba(${EDGE_STROKE_RGB}, ${alpha * animOpacity})`,
    lineWidth: width,
    dash,
  };
}

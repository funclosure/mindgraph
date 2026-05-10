// ---------------------------------------------------------------------------
// Layout — force-directed graph layout, hand-rolled.
//
// Pure function `computeLayout(viewModel) → { nodes, bounds, clusters }`.
//
// Atomic concepts: visible dots, participate in physics, returned in `nodes`.
// Clustered concepts: invisible physics anchors, used as gravitational centres
// for their atomic children. NOT returned in `nodes` (drawn nowhere). Their
// final positions ARE returned in `clusters` so legacy code paths that still
// expect a `clusters` array on the layout don't break — they are emitted with
// label/radius/color fields kept for backwards compat through the cluster
// rendering removal in Task 6.
//
// See docs/superpowers/specs/2026-05-10-graph-rendering-design.md § "Layout
// pipeline" for the full rationale and force constants.
// ---------------------------------------------------------------------------

const ITERATIONS = 300;
const ALPHA_DECAY = 0.9756;     // ≈ (1 − 0.0228)^(1/300) — d3-force-style cooldown
const VELOCITY_DECAY = 0.4;     // friction
const CHARGE_STRENGTH = 200;
const CHARGE_MIN_DISTANCE = 4;  // clamp r to avoid singularity in inverse-square
const LINK_DISTANCE_RELATION = 60;
const LINK_DISTANCE_MEMBERSHIP = 35;
const LINK_STIFFNESS_RELATION = 0.5;
const LINK_STIFFNESS_MEMBERSHIP = 1.5;
const CENTER_STRENGTH = 0.05;
const COLLISION_PADDING = 4;
const NODE_BASE_RADIUS = 4;     // used for collision; render-side radius is computed in draw.js

export function seededUnit(value) {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) {
    h = ((h << 5) - h + value.charCodeAt(i)) | 0;
  }
  return (Math.abs(h) % 1000) / 1000;
}

export function clusterColor(clusterId) {
  // Deterministic warm-tone hash: hue ∈ [25°, 55°], saturation 35%,
  // lightness 60%. Returned as #RRGGBB so consumers using hexToRgba()
  // work unchanged. Same id → same color across reloads.
  const hue = 25 + Math.floor(seededUnit(clusterId) * 30);
  return hslToHex(hue, 35, 60);
}

function hslToHex(h, s, l) {
  // Standard HSL → RGB → hex conversion. h in [0, 360), s/l in [0, 100].
  const sNorm = s / 100;
  const lNorm = l / 100;
  const a = sNorm * Math.min(lNorm, 1 - lNorm);
  const channel = (n) => {
    const k = (n + h / 30) % 12;
    const c = lNorm - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c).toString(16).padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

export function computeLayout(viewModel) {
  const atomic = viewModel.concepts.atomic;
  const clustered = viewModel.concepts.clustered;
  const allNodes = [...atomic, ...clustered];

  if (!allNodes.length) {
    return { nodes: {}, bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, clusters: [] };
  }

  // Initial placement: deterministic, seeded by concept id, scattered on a unit disk
  // scaled to ~600 px so the simulation has room to settle.
  const positions = {};
  const velocities = {};
  for (const node of allNodes) {
    const t = seededUnit(node.id) * Math.PI * 2;
    const r = 200 + seededUnit(`${node.id}:r`) * 200;
    positions[node.id] = { x: Math.cos(t) * r, y: Math.sin(t) * r };
    velocities[node.id] = { x: 0, y: 0 };
  }

  // Build edge list for the simulation: relations + membership links.
  const edges = [];
  for (const e of viewModel.graph.edges) {
    edges.push({
      from: e.from,
      to: e.to,
      distance: LINK_DISTANCE_RELATION,
      stiffness: LINK_STIFFNESS_RELATION,
    });
  }
  for (const concept of atomic) {
    for (const parentId of concept.parentIds ?? []) {
      // Only add membership link if the parent cluster exists in the VM.
      if (!viewModel.concepts.byId[parentId]) continue;
      edges.push({
        from: concept.id,
        to: parentId,
        distance: LINK_DISTANCE_MEMBERSHIP,
        stiffness: LINK_STIFFNESS_MEMBERSHIP,
      });
    }
  }

  // Run the simulation.
  let alpha = 1;
  for (let iter = 0; iter < ITERATIONS && alpha > 0.001; iter += 1) {
    applyChargeForce(allNodes, positions, velocities);
    applyLinkForce(edges, positions, velocities);
    applyCenterForce(allNodes, positions, velocities);
    applyCollisionForce(allNodes, positions, velocities);
    integrate(allNodes, positions, velocities, alpha);
    alpha *= ALPHA_DECAY;
  }

  // Output: only atomic positions are visible. Clustered positions are
  // emitted in `clusters` for backwards compat with code that still iterates
  // `layout.clusters` (removed in Task 6).
  const nodes = {};
  for (const node of atomic) {
    nodes[node.id] = positions[node.id];
  }
  // Cluster anchors aren't drawn but downstream code (camera fit, legacy
  // drawClusterBodies) reads them — emit until cluster rendering is removed.
  const clusters = clustered.map((concept) => ({
    id: concept.id,
    label: concept.label,
    x: positions[concept.id].x,
    y: positions[concept.id].y,
    radius: 80,                          // legacy field for cluster bodies; ignored after Task 6
    color: clusterColor(concept.id),
  }));

  // Bounds from atomic positions only — cluster anchors might be off-screen and we don't want camera-fit to chase them.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const id of Object.keys(nodes)) {
    const p = nodes[id];
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (!Number.isFinite(minX)) {
    minX = -100; minY = -100; maxX = 100; maxY = 100;
  }

  return { nodes, bounds: { minX, minY, maxX, maxY }, clusters };
}

function applyChargeForce(nodes, positions, velocities) {
  const k = CHARGE_STRENGTH;
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i].id;
      const b = nodes[j].id;
      const pa = positions[a];
      const pb = positions[b];
      let dx = pa.x - pb.x;
      let dy = pa.y - pb.y;
      let r2 = dx * dx + dy * dy;
      if (r2 < CHARGE_MIN_DISTANCE * CHARGE_MIN_DISTANCE) {
        // Apply a small jitter to avoid divide-by-zero stalls when two
        // concepts happen to seed to the same position.
        dx = (seededUnit(`${a}:${b}:x`) - 0.5) * 0.1;
        dy = (seededUnit(`${a}:${b}:y`) - 0.5) * 0.1;
        r2 = dx * dx + dy * dy + 1;
      }
      const f = k / r2;
      const r = Math.sqrt(r2);
      const fx = (dx / r) * f;
      const fy = (dy / r) * f;
      velocities[a].x += fx;
      velocities[a].y += fy;
      velocities[b].x -= fx;
      velocities[b].y -= fy;
    }
  }
}

function applyLinkForce(edges, positions, velocities) {
  for (const edge of edges) {
    const pa = positions[edge.from];
    const pb = positions[edge.to];
    if (!pa || !pb) continue;
    const dx = pb.x - pa.x;
    const dy = pb.y - pa.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const delta = (dist - edge.distance) * edge.stiffness;
    const fx = (dx / dist) * delta;
    const fy = (dy / dist) * delta;
    velocities[edge.from].x += fx;
    velocities[edge.from].y += fy;
    velocities[edge.to].x -= fx;
    velocities[edge.to].y -= fy;
  }
}

function applyCenterForce(nodes, positions, velocities) {
  for (const node of nodes) {
    const p = positions[node.id];
    velocities[node.id].x -= p.x * CENTER_STRENGTH;
    velocities[node.id].y -= p.y * CENTER_STRENGTH;
  }
}

function applyCollisionForce(nodes, positions, velocities) {
  const minGap = NODE_BASE_RADIUS * 2 + COLLISION_PADDING;
  const minGap2 = minGap * minGap;
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i].id;
      const b = nodes[j].id;
      const pa = positions[a];
      const pb = positions[b];
      const dx = pb.x - pa.x;
      const dy = pb.y - pa.y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= minGap2) continue;
      const dist = Math.sqrt(d2) || 0.01;
      const overlap = (minGap - dist) * 0.5;
      const fx = (dx / dist) * overlap;
      const fy = (dy / dist) * overlap;
      velocities[a].x -= fx;
      velocities[a].y -= fy;
      velocities[b].x += fx;
      velocities[b].y += fy;
    }
  }
}

function integrate(nodes, positions, velocities, alpha) {
  for (const node of nodes) {
    const p = positions[node.id];
    const v = velocities[node.id];
    p.x += v.x * alpha;
    p.y += v.y * alpha;
    v.x *= VELOCITY_DECAY;
    v.y *= VELOCITY_DECAY;
  }
}

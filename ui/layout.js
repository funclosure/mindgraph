// ---------------------------------------------------------------------------
// Layout — continuous force-directed simulator, hand-rolled.
//
// Exports:
//   createLayoutSimulator(viewModel) → sim   continuous-physics simulator
//   seededUnit(value)                         deterministic [0, 1) hash on a string
//   clusterColor(clusterId)                   deterministic warm-tone hex for a cluster id
//
// v3 uses a gravity-field elastic model: explicit relation springs define the
// topology, mass-based repulsion gives hubs territory, gentle center gravity
// keeps the cloud bounded, and resistance lets the graph relax smoothly.
// ---------------------------------------------------------------------------

// ───── v3 warm-start + force constants ─────────────────────────────────────
const WARM_START_ITERATIONS = 70;
const INITIAL_ALPHA_AFTER_WARM_START = 0.24;

const DEGREE_MASS = 0.45;
const IMPORTANCE_MASS = 0.75;
const MASS_MAX = 4.0;

const REPEL_K = 75;
const REPEL_MIN_DISTANCE = 6;
const REPEL_FORCE_CAP = 6;
const UNRELATED_MIN_DISTANCE = 88;
const UNRELATED_SEPARATION_STRENGTH = 0.045;

const BASE_LINK_DISTANCE = 95;
const HUB_RING_BONUS = 18;
const BASE_LINK_STRENGTH = 0.048;
const HUB_ATTRACTION = 0.18;
const LINK_STRENGTH_MAX = 0.16;
const SIBLING_RELATION_MULT = 1.08;
const COOCC_LINK_BOOST_MAX = 0.35;
const SCORE_REF_PERCENTILE = 0.9;

// Soft-boundary center gravity. Inside the comfort radius, the relation graph
// and repulsion field are allowed to organize themselves. Outside it, nodes get
// a gentle inward pull so disconnected components do not evaporate forever.
const CENTER_GRAVITY = 0.006;
const CENTER_MASS_EXP = 0.35;
const CENTER_COMFORT_RADIUS = 280;
const COMPONENT_COHESION_STRENGTH = 0.035;
const COMPONENT_COHESION_COMFORT_RADIUS = 150;
const COMPONENT_COHESION_MAX_COMPONENT_SIZE = 6;

const COLLISION_PADDING = 5;
const COLLISION_STRENGTH = 0.45;
const NODE_BASE_RADIUS = 4;
const MAX_VELOCITY_PER_ITER = 35;
const VELOCITY_DECAY = 0.70;
const SUBSTEPS = 4;
const SUBSTEP_DECAY = Math.pow(VELOCITY_DECAY, 1 / SUBSTEPS);

const ALPHA_HALF_LIFE_FRAMES = 95;
const ALPHA_DECAY_PER_FRAME = Math.pow(0.5, 1 / ALPHA_HALF_LIFE_FRAMES);
const SETTLED_ALPHA = 0.003;
const SETTLED_VEL = 0.12;

const BLOOM_NEIGHBOR_DISTANCE = 96;
const BLOOM_HUB_DISTANCE_BONUS = 16;
const BLOOM_JITTER = 22;

// ───── String hash helpers ─────────────────────────────────────────────────
export function seededUnit(value) {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) {
    h = ((h << 5) - h + value.charCodeAt(i)) | 0;
  }
  return (Math.abs(h) % 1000) / 1000;
}

export function clusterColor(clusterId) {
  // Deterministic warm-tone hash: hue ∈ [25°, 55°], saturation 35%, lightness 60%.
  // Returns #RRGGBB so consumers using hexToRgba() work unchanged.
  const hue = 25 + Math.floor(seededUnit(clusterId) * 30);
  return hslToHex(hue, 35, 60);
}

function hslToHex(h, s, l) {
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

// ───── Simulator factory ────────────────────────────────────────────────────
export function createLayoutSimulator(viewModel) {
  const atomic = viewModel.concepts.atomic;
  const nodes = atomic.map((c) => ({ id: c.id }));

  const positions = {};
  const velocities = {};
  for (const node of nodes) {
    const t = seededUnit(node.id) * Math.PI * 2;
    const r = 200 + seededUnit(`${node.id}:r`) * 200;
    positions[node.id] = { x: Math.cos(t) * r, y: Math.sin(t) * r };
    velocities[node.id] = { x: 0, y: 0 };
  }

  const pinState = new Map();

  const degree = {};
  for (const node of nodes) degree[node.id] = 0;
  for (const edge of viewModel.graph.edges ?? []) {
    if (degree[edge.from] !== undefined && degree[edge.to] !== undefined) {
      degree[edge.from] += 1;
      degree[edge.to] += 1;
    }
  }

  const mass = buildMass(viewModel, nodes, degree);
  const relationPairs = buildRelationPairs(viewModel, atomic, degree, mass);
  const relationNeighborIds = buildRelationNeighborIds(relationPairs);
  const layoutMeta = computeLayoutMeta(nodes, relationPairs, relationNeighborIds);

  function applyCharge() {
    for (let i = 0; i < nodes.length; i += 1) {
      const a = nodes[i].id;
      const aPinned = pinState.has(a);
      for (let j = i + 1; j < nodes.length; j += 1) {
        const b = nodes[j].id;
        const bPinned = pinState.has(b);
        if (aPinned && bPinned) continue;
        const pa = positions[a];
        const pb = positions[b];
        let dx = pa.x - pb.x;
        let dy = pa.y - pb.y;
        let r2 = dx * dx + dy * dy;
        if (r2 < REPEL_MIN_DISTANCE * REPEL_MIN_DISTANCE) {
          dx = (seededUnit(`${a}:${b}:x`) - 0.5) * REPEL_MIN_DISTANCE;
          dy = (seededUnit(`${a}:${b}:y`) - 0.5) * REPEL_MIN_DISTANCE;
          r2 = dx * dx + dy * dy + 1;
        }
        let f = (REPEL_K * (mass[a] ?? 1) * (mass[b] ?? 1)) / r2;
        if (f > REPEL_FORCE_CAP) f = REPEL_FORCE_CAP;
        const r = Math.sqrt(r2);
        const fx = (dx / r) * f;
        const fy = (dy / r) * f;
        if (!aPinned) {
          velocities[a].x += fx;
          velocities[a].y += fy;
        }
        if (!bPinned) {
          velocities[b].x -= fx;
          velocities[b].y -= fy;
        }
      }
    }
  }

  function areRelationNeighbors(a, b) {
    return relationNeighborIds.get(a)?.has(b) || false;
  }

  function applyUnrelatedSeparation() {
    for (let i = 0; i < nodes.length; i += 1) {
      const a = nodes[i].id;
      const aPinned = pinState.has(a);
      for (let j = i + 1; j < nodes.length; j += 1) {
        const b = nodes[j].id;
        if (areRelationNeighbors(a, b)) continue;
        const bPinned = pinState.has(b);
        if (aPinned && bPinned) continue;
        const pa = positions[a];
        const pb = positions[b];
        let dx = pa.x - pb.x;
        let dy = pa.y - pb.y;
        let dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= 0.001) {
          dx = (seededUnit(`${a}:${b}:unrelated-x`) - 0.5) * 0.1;
          dy = (seededUnit(`${a}:${b}:unrelated-y`) - 0.5) * 0.1;
          dist = Math.sqrt(dx * dx + dy * dy) || 1;
        }
        if (dist >= UNRELATED_MIN_DISTANCE) continue;
        const push = (UNRELATED_MIN_DISTANCE - dist) * UNRELATED_SEPARATION_STRENGTH;
        const fx = (dx / dist) * push;
        const fy = (dy / dist) * push;
        if (!aPinned) {
          velocities[a].x += fx;
          velocities[a].y += fy;
        }
        if (!bPinned) {
          velocities[b].x -= fx;
          velocities[b].y -= fy;
        }
      }
    }
  }

  function applySprings() {
    for (const pair of relationPairs) {
      const aPinned = pinState.has(pair.a);
      const bPinned = pinState.has(pair.b);
      if (aPinned && bPinned) continue;
      const pa = positions[pair.a];
      const pb = positions[pair.b];
      const dx = pb.x - pa.x;
      const dy = pb.y - pa.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const delta = (dist - pair.restLength) * pair.strength;
      const fx = (dx / dist) * delta;
      const fy = (dy / dist) * delta;
      if (!aPinned) {
        velocities[pair.a].x += fx;
        velocities[pair.a].y += fy;
      }
      if (!bPinned) {
        velocities[pair.b].x -= fx;
        velocities[pair.b].y -= fy;
      }
    }
  }

  function applyCenter() {
    for (const node of nodes) {
      if (pinState.has(node.id)) continue;
      const p = positions[node.id];
      const radius = Math.hypot(p.x, p.y);
      if (radius <= CENTER_COMFORT_RADIUS) continue;
      const m = Math.pow(mass[node.id] ?? 1, CENTER_MASS_EXP);
      const pull = CENTER_GRAVITY * m * ((radius - CENTER_COMFORT_RADIUS) / radius);
      velocities[node.id].x -= p.x * pull;
      velocities[node.id].y -= p.y * pull;
    }
  }

  function applyComponentCohesion() {
    if (!layoutMeta.fragmented) return;
    for (const component of layoutMeta.components) {
      if (component.length > COMPONENT_COHESION_MAX_COMPONENT_SIZE) continue;
      let cx = 0;
      let cy = 0;
      for (const id of component) {
        cx += positions[id].x;
        cy += positions[id].y;
      }
      cx /= component.length;
      cy /= component.length;
      const radius = Math.hypot(cx, cy);
      if (radius <= COMPONENT_COHESION_COMFORT_RADIUS) continue;
      const pull = COMPONENT_COHESION_STRENGTH * ((radius - COMPONENT_COHESION_COMFORT_RADIUS) / radius);
      for (const id of component) {
        if (pinState.has(id)) continue;
        velocities[id].x -= cx * pull;
        velocities[id].y -= cy * pull;
      }
    }
  }

  function applyCollision() {
    const minGap = NODE_BASE_RADIUS * 2 + COLLISION_PADDING;
    const minGap2 = minGap * minGap;
    for (let i = 0; i < nodes.length; i += 1) {
      const a = nodes[i].id;
      const aPinned = pinState.has(a);
      for (let j = i + 1; j < nodes.length; j += 1) {
        const b = nodes[j].id;
        const bPinned = pinState.has(b);
        if (aPinned && bPinned) continue;
        const pa = positions[a];
        const pb = positions[b];
        const dx = pb.x - pa.x;
        const dy = pb.y - pa.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= minGap2) continue;
        const dist = Math.sqrt(d2) || 0.01;
        const overlap = (minGap - dist) * COLLISION_STRENGTH;
        const fx = (dx / dist) * overlap;
        const fy = (dy / dist) * overlap;
        if (!aPinned) {
          velocities[a].x -= fx;
          velocities[a].y -= fy;
        }
        if (!bPinned) {
          velocities[b].x += fx;
          velocities[b].y += fy;
        }
      }
    }
  }

  function clampVelocity() {
    const max = MAX_VELOCITY_PER_ITER;
    const max2 = max * max;
    for (const node of nodes) {
      const v = velocities[node.id];
      const speed2 = v.x * v.x + v.y * v.y;
      if (speed2 > max2) {
        const scale = max / Math.sqrt(speed2);
        v.x *= scale;
        v.y *= scale;
      }
    }
  }

  function integrate(alpha, decay = VELOCITY_DECAY) {
    let maxV2 = 0;
    for (const node of nodes) {
      const anchor = pinState.get(node.id);
      if (anchor) {
        positions[node.id].x = anchor.x;
        positions[node.id].y = anchor.y;
        velocities[node.id].x = 0;
        velocities[node.id].y = 0;
        continue;
      }
      const p = positions[node.id];
      const v = velocities[node.id];
      p.x += v.x * alpha;
      p.y += v.y * alpha;
      v.x *= decay;
      v.y *= decay;
      const s2 = v.x * v.x + v.y * v.y;
      if (s2 > maxV2) maxV2 = s2;
    }
    sim._maxVelocity = Math.sqrt(maxV2);
  }

  function computeBounds() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const node of nodes) {
      const p = positions[node.id];
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    if (!Number.isFinite(minX)) {
      minX = -100; minY = -100; maxX = 100; maxY = 100;
    }
    return { minX, minY, maxX, maxY };
  }

  const sim = {
    positions,
    layoutMeta,
    get bounds() { return computeBounds(); },
    alpha: 1.0,
    _maxVelocity: 0,

    step(dt = 1 / 60) {
      const dtScale = Math.max(0.25, Math.min(2.0, dt * 60));
      const subAlpha = (this.alpha * dtScale) / SUBSTEPS;
      for (let i = 0; i < SUBSTEPS; i += 1) {
        applyCharge();
        applyUnrelatedSeparation();
        applySprings();
        applyCenter();
        applyComponentCohesion();
        applyCollision();
        clampVelocity();
        integrate(subAlpha, SUBSTEP_DECAY);
      }
      this.alpha *= Math.pow(ALPHA_DECAY_PER_FRAME, dtScale);
    },

    reheat(strength) {
      this.alpha = Math.min(1.0, this.alpha + strength);
    },

    pin(id, anchor) {
      pinState.set(id, { x: anchor.x, y: anchor.y });
    },

    unpin(id) {
      pinState.delete(id);
    },

    placeForBloom(id, visibleIds = new Set()) {
      if (!positions[id]) return false;
      const visible = visibleIds instanceof Set ? visibleIds : new Set(visibleIds ?? []);
      let bestNeighbor = null;
      const neighbors = relationNeighborIds.get(id) ?? new Set();
      for (const neighborId of neighbors) {
        if (!visible.has(neighborId) || !positions[neighborId]) continue;
        if (!bestNeighbor || (mass[neighborId] ?? 1) > (mass[bestNeighbor] ?? 1)) bestNeighbor = neighborId;
      }
      if (!bestNeighbor) return false;

      const anchor = positions[bestNeighbor];
      const hubMass = mass[bestNeighbor] ?? 1;
      const angle = seededUnit(`${id}:bloom-angle`) * Math.PI * 2;
      const radius = BLOOM_NEIGHBOR_DISTANCE + BLOOM_HUB_DISTANCE_BONUS * Math.max(0, hubMass - 1);
      const jitter = (seededUnit(`${id}:bloom-jitter`) - 0.5) * BLOOM_JITTER;
      positions[id].x = anchor.x + Math.cos(angle) * (radius + jitter);
      positions[id].y = anchor.y + Math.sin(angle) * (radius + jitter);
      velocities[id].x = 0;
      velocities[id].y = 0;
      return true;
    },

    isSettled() {
      return this.alpha < SETTLED_ALPHA && this._maxVelocity < SETTLED_VEL;
    },
  };

  // ───── Warm start — enough structure to avoid chaos, not a dead final solve ────
  for (let i = 0; i < WARM_START_ITERATIONS && sim.alpha > 0.001; i += 1) {
    sim.step(1 / 60);
  }

  // Pin every concept that is NOT initially visible at the document's
  // starting playhead time. Invisible concepts keep their warm-start position
  // until bloom placement moves them near a visible neighbor.
  const initialPlayheadTime =
    viewModel.frames.macro[0]?.span?.start ??
    viewModel.frames.meso[0]?.span?.start ??
    0;
  for (const concept of atomic) {
    const seen = concept.firstSeenAt;
    const visibleAtStart = typeof seen === 'number' && seen <= initialPlayheadTime;
    if (!visibleAtStart) sim.pin(concept.id, positions[concept.id]);
  }

  sim.alpha = INITIAL_ALPHA_AFTER_WARM_START;
  sim._maxVelocity = 0;

  return sim;
}

// ───── Pair-data precompute ─────────────────────────────────────────────────
function buildMass(viewModel, nodes, degree) {
  const importance = viewModel.graph.conceptImportance ?? {};
  const mass = {};
  for (const node of nodes) {
    const deg = degree[node.id] ?? 0;
    const score = importance[node.id] ?? 0;
    mass[node.id] = Math.min(
      MASS_MAX,
      1 + DEGREE_MASS * Math.sqrt(deg) + IMPORTANCE_MASS * score,
    );
  }
  return mass;
}

function buildRelationPairs(viewModel, atomic, degree, mass) {
  const atomicIds = new Set(atomic.map((c) => c.id));
  const conceptById = viewModel.concepts.byId;
  const coOccurrence = viewModel.graph.coOccurrence ?? {};
  const scoreRef = computeScoreRef(coOccurrence, atomicIds);
  const pairs = [];
  const seen = new Set();

  for (const edge of viewModel.graph.edges ?? []) {
    if (!atomicIds.has(edge.from) || !atomicIds.has(edge.to)) continue;
    const key = edge.from < edge.to ? `${edge.from}|${edge.to}` : `${edge.to}|${edge.from}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const a = edge.from;
    const b = edge.to;
    const hubMass = Math.max(mass[a] ?? 1, mass[b] ?? 1);
    const relationWeight = Number.isFinite(edge.weight) ? Math.max(0.2, Math.min(1.5, edge.weight)) : 1;
    const score = coOccurrence[a]?.[b] ?? coOccurrence[b]?.[a] ?? 0;
    const coBoost = score > 0
      ? 1 + COOCC_LINK_BOOST_MAX * Math.sqrt(Math.min(1, score / scoreRef))
      : 1;
    const siblingMult = haveSharedParent(conceptById[a], conceptById[b]) ? SIBLING_RELATION_MULT : 1;
    const restLength = BASE_LINK_DISTANCE + HUB_RING_BONUS * Math.max(0, hubMass - 1);
    const strength = Math.min(
      LINK_STRENGTH_MAX,
      BASE_LINK_STRENGTH
        * relationWeight
        * (1 + HUB_ATTRACTION * Math.max(0, hubMass - 1))
        * coBoost
        * siblingMult,
    );

    pairs.push({ a, b, restLength, strength });
  }

  return pairs;
}

function computeScoreRef(coOccurrence, atomicIds) {
  const positiveScores = [];
  for (const a of atomicIds) {
    const row = coOccurrence[a];
    if (!row) continue;
    for (const b of Object.keys(row)) {
      if (a < b && atomicIds.has(b) && row[b] > 0) positiveScores.push(row[b]);
    }
  }
  positiveScores.sort((x, y) => x - y);
  return positiveScores.length
    ? positiveScores[Math.min(positiveScores.length - 1, Math.floor(positiveScores.length * SCORE_REF_PERCENTILE))]
    : 1;
}

function buildRelationNeighborIds(relationPairs) {
  const map = new Map();
  for (const pair of relationPairs) {
    if (!map.has(pair.a)) map.set(pair.a, new Set());
    if (!map.has(pair.b)) map.set(pair.b, new Set());
    map.get(pair.a).add(pair.b);
    map.get(pair.b).add(pair.a);
  }
  return map;
}

function buildComponents(nodes, relationNeighborIds) {
  const unseen = new Set(nodes.map((node) => node.id));
  const components = [];
  while (unseen.size) {
    const start = unseen.values().next().value;
    const stack = [start];
    unseen.delete(start);
    const ids = [];
    while (stack.length) {
      const id = stack.pop();
      ids.push(id);
      for (const neighbor of relationNeighborIds.get(id) ?? []) {
        if (unseen.has(neighbor)) {
          unseen.delete(neighbor);
          stack.push(neighbor);
        }
      }
    }
    components.push(ids);
  }
  return components;
}

function computeLayoutMeta(nodes, relationPairs, relationNeighborIds) {
  const components = buildComponents(nodes, relationNeighborIds);
  const largest = components.reduce((max, component) => Math.max(max, component.length), 0);
  const nodeCount = nodes.length || 1;
  const relationDensity = relationPairs.length / Math.max(1, nodeCount);
  const largestComponentRatio = largest / nodeCount;
  const fragmented = nodeCount >= 8 && components.length >= 3 && largestComponentRatio < 0.75 && relationDensity < 1.2;
  return { components, componentCount: components.length, largestComponentRatio, relationDensity, fragmented };
}

function haveSharedParent(conceptA, conceptB) {
  const aParents = conceptA?.parentIds;
  const bParents = conceptB?.parentIds;
  if (!Array.isArray(aParents) || !Array.isArray(bParents)) return false;
  if (aParents.length === 0 || bParents.length === 0) return false;
  if (aParents.length === 1 && bParents.length === 1) return aParents[0] === bParents[0];
  const bSet = new Set(bParents);
  for (const p of aParents) {
    if (bSet.has(p)) return true;
  }
  return false;
}

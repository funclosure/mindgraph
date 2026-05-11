// ---------------------------------------------------------------------------
// Layout — continuous force-directed simulator, hand-rolled.
//
// Exports:
//   createLayoutSimulator(viewModel) → sim   continuous-physics simulator
//   seededUnit(value)                         deterministic [0, 1) hash on a string
//   clusterColor(clusterId)                   deterministic warm-tone hex for a cluster id
//
// The simulator is the only stateful module in the canvas pipeline. It owns
// per-pair spring metadata (ideal_d, stiffness) computed at construction
// time, positions/velocities arrays, and a single alpha scalar that drives
// the warm-when-disturbed lifecycle.
//
// See docs/superpowers/specs/2026-05-11-graph-rendering-v2-design.md for the
// full design rationale.
// ---------------------------------------------------------------------------

// ───── Cold-start sim constants ─────────────────────────────────────────────
const ITERATIONS = 300;                          // cold-start iter count (matches v1)
const CHARGE_STRENGTH = 200;
const CHARGE_MIN_DISTANCE = 4;
const CENTER_STRENGTH = 0.05;
const COLLISION_PADDING = 4;
const NODE_BASE_RADIUS = 4;
const MAX_VELOCITY_PER_ITER = 50;
const VELOCITY_DECAY = 0.4;

// Sub-stepping. Explicit Euler is unstable when total incident spring stiffness
// on a node × α exceeds ~2(1+d). With max k ≈ 15 observed on Episode 1 and
// VELOCITY_DECAY = 0.4, the stability threshold at α=1 is k ≈ 2.8 — well below
// our worst-case. Sub-stepping each step() into N integrations at α/N drops the
// effective threshold to k×(α/N) < 2(1+d_substep), where d_substep is the
// per-substep damping retained such that d_substep^N = VELOCITY_DECAY (preserves
// macro-frame retention semantics). N=6 covers the observed max with margin.
const SUBSTEPS = 6;
const SUBSTEP_DECAY = Math.pow(VELOCITY_DECAY, 1 / SUBSTEPS);

// ───── Distance & stiffness for the new pair-spring model ───────────────────
const D_MIN = 35;                                // strongest co-occurrence
const D_MAX = 180;                               // weakest co-occurrence (but spring exists)
const D_MID = 100;                               // fallback for relation/sibling pairs with score=0
const SCORE_REF_PERCENTILE = 0.9;                // strongest 10% of co-occurring pairs hit D_MIN

const BASE_STIFFNESS = 0.5;
const RELATION_STIFFNESS_MULT = 1.5;
const SIBLING_STIFFNESS_MULT = 1.3;

// ───── Live-phase alpha lifecycle ───────────────────────────────────────────
const HALF_LIFE_FRAMES = 30;                     // 0.5 s at 60 fps
const ALPHA_DECAY_PER_FRAME = Math.pow(0.5, 1 / HALF_LIFE_FRAMES);  // ≈ 0.9772
const SETTLED_ALPHA = 0.005;
const SETTLED_VEL = 0.5;

// ───── String hash helpers (unchanged from v1) ──────────────────────────────
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
  const nodes = atomic.map((c) => ({ id: c.id }));   // physics participants — atomic only in v2

  // Position + velocity storage.
  const positions = {};
  const velocities = {};
  for (const node of nodes) {
    const t = seededUnit(node.id) * Math.PI * 2;
    const r = 200 + seededUnit(`${node.id}:r`) * 200;
    positions[node.id] = { x: Math.cos(t) * r, y: Math.sin(t) * r };
    velocities[node.id] = { x: 0, y: 0 };
  }

  const pinState = new Map();                        // id → {x, y} | null

  // Build per-pair spring metadata.
  const pairs = buildPairs(viewModel, atomic);

  // ───── Force kernels (closed over `positions`, `velocities`, `pairs`, `pinState`) ─────

  function applyCharge() {
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

  function applySprings() {
    for (const pair of pairs) {
      const pa = positions[pair.a];
      const pb = positions[pair.b];
      const dx = pb.x - pa.x;
      const dy = pb.y - pa.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const delta = (dist - pair.idealD) * pair.stiffness;
      const fx = (dx / dist) * delta;
      const fy = (dy / dist) * delta;
      velocities[pair.a].x += fx;
      velocities[pair.a].y += fy;
      velocities[pair.b].x -= fx;
      velocities[pair.b].y -= fy;
    }
  }

  function applyCenter() {
    for (const node of nodes) {
      const p = positions[node.id];
      velocities[node.id].x -= p.x * CENTER_STRENGTH;
      velocities[node.id].y -= p.y * CENTER_STRENGTH;
    }
  }

  function applyCollision() {
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

  // ───── Public sim object ────────────────────────────────────────────────
  const sim = {
    positions,                                    // mutated in place each step
    get bounds() { return computeBounds(); },     // recomputed cheap on each access
    alpha: 1.0,
    _maxVelocity: 0,

    step(dt /* unused at v2 — sub-stepped */) {
      // Sub-step the integration to keep each pair's effective stiffness × α
      // below the explicit-Euler instability threshold. Forces and velocity-
      // clamp are recomputed each sub-iteration so the system is allowed to
      // settle between sub-steps rather than overshoot.
      const subAlpha = this.alpha / SUBSTEPS;
      for (let i = 0; i < SUBSTEPS; i += 1) {
        applyCharge();
        applySprings();
        applyCenter();
        applyCollision();
        clampVelocity();
        integrate(subAlpha, SUBSTEP_DECAY);
      }
      this.alpha *= ALPHA_DECAY_PER_FRAME;
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

    isSettled() {
      return this.alpha < SETTLED_ALPHA && this._maxVelocity < SETTLED_VEL;
    },
  };

  // ───── Cold start — run sim to convergence (~300 iters or alpha floor) ────
  for (let i = 0; i < ITERATIONS && sim.alpha > 0.001; i += 1) {
    sim.step(1);
  }

  // Pin every concept that is NOT initially visible at the document's
  // starting playhead time. "Initially visible" matches buildCumulativeVisibility's
  // rule in buildGraphRenderState.js: concept.firstSeenAt <= initialPlayheadTime.
  const initialPlayheadTime =
    viewModel.frames.macro[0]?.span?.start ??
    viewModel.frames.meso[0]?.span?.start ??
    0;
  for (const concept of atomic) {
    const seen = concept.firstSeenAt;
    const visibleAtStart = typeof seen === 'number' && seen <= initialPlayheadTime;
    if (!visibleAtStart) sim.pin(concept.id, positions[concept.id]);
  }

  // After cold-start + pinning: reset alpha and velocities so the rAF loop
  // (when wired in Task 3) sees a settled system, not residual cold-start motion.
  sim.alpha = 0;
  for (const node of nodes) {
    velocities[node.id].x = 0;
    velocities[node.id].y = 0;
  }
  sim._maxVelocity = 0;

  return sim;
}

// ───── Pair-data precompute ─────────────────────────────────────────────────
function buildPairs(viewModel, atomic) {
  const atomicIds = atomic.map((c) => c.id);
  const conceptById = viewModel.concepts.byId;
  const coOccurrence = viewModel.graph.coOccurrence ?? {};

  // 1) Compute SCORE_REF: 90th-percentile of positive co-occurrence scores.
  const positiveScores = [];
  for (const a of atomicIds) {
    const row = coOccurrence[a];
    if (!row) continue;
    for (const b of Object.keys(row)) {
      if (a < b) positiveScores.push(row[b]);    // avoid double-counting symmetric pairs
    }
  }
  positiveScores.sort((x, y) => x - y);
  const scoreRef = positiveScores.length
    ? positiveScores[Math.min(positiveScores.length - 1, Math.floor(positiveScores.length * SCORE_REF_PERCENTILE))]
    : 1; // no co-occurrence data → arbitrary positive; fallback springs do the work

  // 2) Build a quick relation lookup.
  const hasRelation = new Set();
  for (const edge of viewModel.graph.edges ?? []) {
    hasRelation.add(`${edge.from}|${edge.to}`);
    hasRelation.add(`${edge.to}|${edge.from}`);
  }

  // 3) Walk every unordered atomic pair, decide if a spring exists, build pair record.
  const pairs = [];
  for (let i = 0; i < atomicIds.length; i += 1) {
    for (let j = i + 1; j < atomicIds.length; j += 1) {
      const a = atomicIds[i];
      const b = atomicIds[j];

      const score = coOccurrence[a]?.[b] ?? 0;
      const conceptA = conceptById[a];
      const conceptB = conceptById[b];
      const sharesCluster =
        !!conceptA?.parentIds?.[0] &&
        conceptA.parentIds[0] === conceptB?.parentIds?.[0];
      const relation = hasRelation.has(`${a}|${b}`);

      let idealD;
      if (score > 0) {
        const normalized = Math.max(0, Math.min(1, score / scoreRef));
        idealD = D_MAX - (D_MAX - D_MIN) * normalized;
      } else if (relation || sharesCluster) {
        idealD = D_MID;
      } else {
        continue;                                 // no spring for this pair
      }

      const stiffness =
        BASE_STIFFNESS *
        (relation ? RELATION_STIFFNESS_MULT : 1.0) *
        (sharesCluster ? SIBLING_STIFFNESS_MULT : 1.0);

      pairs.push({ a, b, idealD, stiffness });
    }
  }

  return pairs;
}

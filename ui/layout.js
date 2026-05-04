// ---------------------------------------------------------------------------
// Layout — cluster anchors, colors, and position computation
// ---------------------------------------------------------------------------

// Hand-placed cluster anchors. Stable across renders; chosen to give each
// cluster room to breathe inside the 1280x800 logical canvas.
export const PROTOTYPE_CLUSTER_LAYOUT = {
  'cultural-convergences':          { x: 285,  y: 245, radius: 152 },
  'meaning-crisis-core':            { x: 640,  y: 400, radius: 142 },
  'transformative-consciousness':   { x: 1000, y: 245, radius: 138 },
  'expanded-epistemology':          { x: 295,  y: 590, radius: 142 },
  'evolutionary-cognitive-origins': { x: 1015, y: 590, radius: 145 },
  'cultural-pathologies':           { x: 705,  y: 110, radius: 42 },
  'wisdom-response':                { x: 540,  y: 615, radius: 32 },
};

// Mockup uses gold for most clusters and a single blue cluster as a different
// categorical state. Match that.
export const CLUSTER_COLORS = {
  'cultural-convergences':          '#b89461',
  'meaning-crisis-core':            '#c79f6a',
  'transformative-consciousness':   '#b89461',
  'expanded-epistemology':          '#7da0ad',
  'evolutionary-cognitive-origins': '#b89461',
  'cultural-pathologies':           '#8f7b61',
  'wisdom-response':                '#7da0ad',
};

export function deterministicAngle(value) {
  return seededUnit(value) * Math.PI * 2;
}

export function seededUnit(value) {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) {
    h = ((h << 5) - h + value.charCodeAt(i)) | 0;
  }
  return (Math.abs(h) % 1000) / 1000;
}

export function computeLayout(vm) {
  const clusters = vm.concepts.clustered.map((cluster) => {
    const proto = PROTOTYPE_CLUSTER_LAYOUT[cluster.id] ?? { x: 640, y: 400, radius: 80 };
    return {
      id: cluster.id,
      label: cluster.label,
      x: proto.x,
      y: proto.y,
      radius: proto.radius,
      color: CLUSTER_COLORS[cluster.id] ?? '#b89461',
    };
  });

  const nodes = {};
  for (const cluster of clusters) {
    nodes[cluster.id] = { x: cluster.x, y: cluster.y };
    const children = vm.selectors.getClusterChildren(cluster.id);
    if (!children.length) continue;
    const startAngle = deterministicAngle(cluster.id);
    const baseRing = Math.max(28, cluster.radius - 38);
    children.forEach((child, idx) => {
      const angle = startAngle + (Math.PI * 2 * idx) / children.length;
      const ringScale = 0.55 + seededUnit(`${cluster.id}:${child.id}`) * 0.32;
      nodes[child.id] = {
        x: cluster.x + Math.cos(angle) * baseRing * ringScale,
        y: cluster.y + Math.sin(angle) * baseRing * ringScale,
      };
    });
  }

  return { clusters, nodes };
}

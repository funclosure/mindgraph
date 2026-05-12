#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import {
  buildConceptInspectorVM,
  buildFrameInspectorVM,
  buildMindgraphViewModel,
} from './buildMindgraphViewModel.js';

const inputPath = process.argv[2] || path.resolve('examples/out/episode-1-built.mindgraph.json');
const raw = fs.readFileSync(inputPath, 'utf8');
const document = JSON.parse(raw);
const vm = buildMindgraphViewModel(document);

const conceptVm = buildConceptInspectorVM(vm, 'meaning-crisis');
const frameVm = buildFrameInspectorVM(vm, { level: 'macro', index: 1 });

// Exercise the coOccurrence matrix's shape so a regression in
// computeCoOccurrence surfaces here (vm:example is the documented
// verification for VM changes per CLAUDE.md). Pick a representative
// atomic concept and report its sparse row + a symmetry spot-check.
const coOcc = vm.graph.coOccurrence ?? {};
const coOccProbeId = vm.concepts.atomic[0]?.id;
const probeRow = coOcc[coOccProbeId] ?? {};
const probePartners = Object.keys(probeRow);
const firstPartner = probePartners[0];
const sampleCoOccurrence = {
  totalKeyedAtoms: Object.keys(coOcc).length,
  probeId: coOccProbeId,
  probePartnerCount: probePartners.length,
  probeMaxScore: probePartners.length
    ? Math.max(...probePartners.map((k) => probeRow[k]))
    : 0,
  // Symmetry check: coOcc[a][b] must equal coOcc[b][a] for any present pair.
  symmetryCheck: firstPartner
    ? {
        a: coOccProbeId,
        b: firstPartner,
        ab: probeRow[firstPartner],
        ba: coOcc[firstPartner]?.[coOccProbeId],
        equal: probeRow[firstPartner] === coOcc[firstPartner]?.[coOccProbeId],
      }
    : null,
};

console.log(JSON.stringify({
  documentMeta: vm.documentMeta,
  sampleGraph: {
    nodeCount: vm.graph.nodes.length,
    edgeCount: vm.graph.edges.length,
    firstCluster: vm.concepts.clustered[0],
    // Surface a sample edge so a regression in buildGraphVM's edge mapping
    // (including provenance threading) shows up in vm:example output.
    firstEdge: vm.graph.edges[0],
  },
  sampleCoOccurrence,
  sampleConceptInspector: conceptVm,
  sampleFrameInspector: frameVm,
}, null, 2));

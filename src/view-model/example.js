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

console.log(JSON.stringify({
  documentMeta: vm.documentMeta,
  sampleGraph: {
    nodeCount: vm.graph.nodes.length,
    edgeCount: vm.graph.edges.length,
    firstCluster: vm.concepts.clustered[0],
  },
  sampleConceptInspector: conceptVm,
  sampleFrameInspector: frameVm,
}, null, 2));

// ---------------------------------------------------------------------------
// Produce-state — is a freshly-produced document still a bare skeleton?
//
// The deterministic pipeline (ingest / build timeline / digest) emits a document
// with transcript segments and frames but ZERO concepts: the semantic pass
// (choosing concepts, grounding relations) is an LLM agent's job, not the CLI's.
// A human who runs the pipeline standalone would otherwise get a blank graph
// with no explanation. This helper detects that state and yields the guidance
// the CLI prints (and the same 0-concept signal the UI uses for its empty-state).
// ---------------------------------------------------------------------------

export function produceGuidanceLines(docPath = '<document>') {
  return [
    'This is a transcript skeleton — 0 concepts so far. Ingestion is deterministic;',
    'the semantic pass (choosing concepts, grounding relations, designing the reader',
    'journey) is done by an LLM agent. To turn this skeleton into a real graph:',
    '  • In Claude Code: load the mindgraph skill and say "digest this".',
    `  • One command (needs Claude credentials):  mindgraph author ${docPath}`,
    '  • By hand: author the .mindgraph.md, then  mindgraph authoring compile …',
  ];
}

export function describeProduceState(document, { docPath = '<document>' } = {}) {
  const conceptCount = document?.concepts?.atomic?.length ?? 0;
  const skeleton = conceptCount === 0;
  return {
    conceptCount,
    skeleton,
    guidance: skeleton ? produceGuidanceLines(docPath) : [],
  };
}

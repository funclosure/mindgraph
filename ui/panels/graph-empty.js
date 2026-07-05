// ---------------------------------------------------------------------------
// Graph empty-state — shown only when a document is a 0-concept skeleton, so a
// newcomer who opens an un-digested graph sees an explanation instead of a
// silent blank canvas. Returns '' (nothing to show) for any graph that has
// concepts, or for a missing/malformed view model.
// ---------------------------------------------------------------------------

export function renderGraphEmpty(vm) {
  const atomic = vm?.concepts?.atomic;
  if (!Array.isArray(atomic) || atomic.length > 0) return '';
  return (
    `<div class="graph-empty__card">` +
    `<div class="graph-empty__title">No concepts yet</div>` +
    `<p class="graph-empty__body">This is a transcript skeleton. The semantic map ` +
    `— concepts and their relations — is authored by an LLM agent. Digest it with ` +
    `the mindgraph skill in Claude Code, or <code>mindgraph author &lt;source&gt;</code>, ` +
    `then reopen to see the graph.</p>` +
    `</div>`
  );
}

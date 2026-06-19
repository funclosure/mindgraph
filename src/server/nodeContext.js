// Pure: from a compiled source-first document + a concept id, gather the source
// blocks that foreground the concept and its graph neighbors. Used to preload
// the answer prompt so a talk turn rarely needs to Read the file.
export function buildNodeContext(document, conceptId) {
  const atomic = document?.concepts?.atomic ?? [];
  const concept = atomic.find((c) => c.id === conceptId) ?? null;
  if (!concept) return { concept: null, blocks: [], neighbors: [] };

  const blockById = Object.fromEntries((document.sourceBlocks ?? []).map((b) => [b.id, b]));

  // Blocks from every reader step that foregrounds this concept.
  const blockIds = [];
  for (const step of document.readerSteps ?? []) {
    const foregrounds = (step.focusConcepts ?? []).some((f) => f.id === conceptId);
    if (foregrounds) {
      for (const id of step.sourceBlockIds ?? []) if (!blockIds.includes(id)) blockIds.push(id);
    }
  }
  // Fallback: the concept's first-seen block.
  if (blockIds.length === 0 && concept.firstSeenBlockId) blockIds.push(concept.firstSeenBlockId);

  const blocks = blockIds
    .map((id) => blockById[id])
    .filter(Boolean)
    .map((b) => ({ id: b.id, text: b.text ?? '' }));

  // Neighbors: the other endpoint of every relation touching this concept.
  const labelById = Object.fromEntries(atomic.map((c) => [c.id, c.label]));
  const neighbors = [];
  const seen = new Set();
  for (const r of document.relations ?? []) {
    let otherId = null;
    let direction = null;
    if (r.from === conceptId) { otherId = r.to; direction = 'out'; }
    else if (r.to === conceptId) { otherId = r.from; direction = 'in'; }
    if (!otherId || seen.has(otherId + r.type + direction)) continue;
    seen.add(otherId + r.type + direction);
    neighbors.push({ id: otherId, label: labelById[otherId] ?? otherId, type: r.type, direction });
  }

  return {
    concept: { id: concept.id, label: concept.label, aliases: concept.aliases ?? [] },
    blocks,
    neighbors,
  };
}

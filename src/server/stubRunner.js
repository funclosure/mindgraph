export async function stubRunner({ slug, conceptId, store, emit }) {
  emit({ type: 'progress', message: `stub: preparing ${conceptId}` });

  const entry = store.get(slug);
  const md = entry?.md;
  if (typeof md !== 'string') {
    emit({ type: 'progress', message: 'stub: no markdown' });
    return;
  }

  const id = `deepened-${conceptId}-${Date.now().toString(36)}`;
  // Add the new concept AND link it to the anchor, so the stub deepen produces
  // visible local growth (a disconnected node would never show in the anchor's
  // focused neighborhood). The real agent adds source-grounded, connected nodes.
  const addition =
    `\n\n@concept ${id}\nlabel: Deepened: ${conceptId}\n` +
    `\n@relation deepen-${id}\nfrom: ${conceptId}\nto: ${id}\ntype: deepens\n` +
    `provenance: inferred\nrationale: Stub deepen placeholder linking the new node to its anchor.\n`;
  store.put(slug, { md: md + addition });
  emit({ type: 'progress', message: `stub deepened ${conceptId}` });
}

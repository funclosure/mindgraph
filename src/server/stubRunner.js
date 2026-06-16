export async function stubRunner({ slug, conceptId, store, emit }) {
  emit({ type: 'progress', message: `stub: preparing ${conceptId}` });

  const entry = store.get(slug);
  const md = entry?.md;
  if (typeof md !== 'string') {
    emit({ type: 'progress', message: 'stub: no markdown' });
    return;
  }

  const id = `deepened-${conceptId}-${Date.now().toString(36)}`;
  const addition = `\n\n@concept ${id}\nlabel: Deepened: ${conceptId}\n`;
  store.put(slug, { md: md + addition });
  emit({ type: 'progress', message: `stub deepened ${conceptId}` });
}

import { registry } from '../operations/index.js';
import { buildNodeContext } from './nodeContext.js';

// Talk turn: compile the current markdown, preload the node's source context, run
// the (read-only) runner. Writes nothing — the graph never changes on an ask.
export async function askHandler({ slug, conceptId, messages, store, runner, emit }) {
  try {
    const entry = store.get(slug);
    const md = entry?.md;
    if (typeof md !== 'string') {
      emit({ type: 'error', message: `No markdown found for ${slug}` });
      return;
    }
    const compiled = registry.run('compile', { markdown: md });
    if (!compiled.ok || compiled.value.validation.ok === false) {
      emit({ type: 'error', message: 'Could not read the source for this graph.' });
      return;
    }
    const context = buildNodeContext(compiled.value.document, conceptId);
    await runner({ conceptId, context, messages, emit });
    emit({ type: 'done' });
  } catch (error) {
    emit({ type: 'error', message: error?.message ?? String(error) });
  }
}

import { registry } from '../operations/index.js';

// Backup -> runner (edits the .md) -> compile -> validate -> qa -> emit document.
// On any failure, returns before overwriting the stored document, so the consumer
// graph stays unchanged and Undo can restore the backup.
export async function crystallizeHandler({ slug, conceptId, messages, store, runner, emit }) {
  try {
    emit({ type: 'progress', message: 'crystallising' });

    const before = store.get(slug);
    if (before && typeof before.md === 'string') {
      store.put(`${slug}__backup`, { md: before.md });
    }

    await runner({ slug, conceptId, messages, store, emit });

    const entry = store.get(slug);
    if (!entry || typeof entry.md !== 'string') {
      emit({ type: 'error', message: `No markdown found for ${slug}` });
      return;
    }

    emit({ type: 'progress', message: 'compiling' });
    const compiled = registry.run('compile', { markdown: entry.md });
    if (!compiled.ok) {
      emit({ type: 'error', message: compiled.errors.map((error) => error.message).join('; ') });
      return;
    }
    if (compiled.value.validation.ok === false) {
      emit({ type: 'error', message: `compiled document invalid: ${compiled.value.validation.errors.join('; ')}` });
      return;
    }

    store.put(slug, { json: compiled.value.document });
    const qa = registry.run('qa', { document: compiled.value.document });
    emit({ type: 'document', document: compiled.value.document, qa: qa.ok ? qa.value : null });
  } catch (error) {
    emit({ type: 'error', message: error?.message ?? String(error) });
  }
}

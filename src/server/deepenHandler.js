import { registry } from '../operations/index.js';

export async function deepenHandler({ slug, conceptId, store, runner, emit }) {
  try {
    emit({ type: 'progress', message: 'deepening' });

    await runner({ slug, conceptId, store, emit });

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
      emit({
        type: 'error',
        message: `compiled document invalid: ${compiled.value.validation.errors.join('; ')}`,
      });
      return;
    }

    store.put(slug, { json: compiled.value.document });

    const qa = registry.run('qa', { document: compiled.value.document });
    emit({ type: 'document', document: compiled.value.document, qa: qa.ok ? qa.value : null });
  } catch (error) {
    emit({ type: 'error', message: error?.message ?? String(error) });
  }
}

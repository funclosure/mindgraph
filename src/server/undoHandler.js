import { registry } from "../operations/index.js";

export function undoHandler({ slug, store }) {
  try {
    const backup = store.get(`${slug}__backup`);
    if (!backup || typeof backup.md !== "string") {
      return { ok: false, message: "No deepen to undo" };
    }
    store.put(slug, { md: backup.md });
    const compiled = registry.run("compile", { markdown: backup.md });
    if (!compiled.ok) {
      return { ok: false, message: compiled.errors.map((e) => e.message).join("; ") };
    }
    if (compiled.value.validation.ok === false) {
      return { ok: false, message: `backup invalid: ${compiled.value.validation.errors.join("; ")}` };
    }
    store.put(slug, { json: compiled.value.document });
    return { ok: true, document: compiled.value.document };
  } catch (error) {
    return { ok: false, message: error?.message ?? String(error) };
  }
}

export function createMemoryStore(initial = {}) {
  const map = new Map(Object.entries(initial).map(([id, entry]) => [id, { ...entry }]));
  return {
    get(id) {
      return map.has(id) ? { ...map.get(id) } : null;
    },
    put(id, entry) {
      map.set(id, { ...(map.get(id) ?? {}), ...entry });
      return this.get(id);
    },
    list() {
      return [...map.keys()];
    },
  };
}

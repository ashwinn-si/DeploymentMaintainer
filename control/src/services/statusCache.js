const TTL_MS = 15_000;

// Per-app cache of server status; concurrent lookups for one server share a single probe.
export function createStatusCache({ ttlMs = TTL_MS } = {}) {
  const entries = new Map();
  const inflight = new Map();

  return {
    peek(id) {
      return entries.get(id)?.value ?? null;
    },
    set(id, value) {
      entries.set(id, { value, at: Date.now() });
    },
    delete(id) {
      entries.delete(id);
      inflight.delete(id);
    },
    async get(id, load) {
      const hit = entries.get(id);
      if (hit && Date.now() - hit.at < ttlMs) return hit.value;
      if (inflight.has(id)) return inflight.get(id);
      const promise = load()
        .then((value) => {
          if (inflight.get(id) === promise) entries.set(id, { value, at: Date.now() });
          return value;
        })
        .finally(() => {
          if (inflight.get(id) === promise) inflight.delete(id);
        });
      inflight.set(id, promise);
      return promise;
    },
    markUnauthorized(id) {
      const prev = entries.get(id)?.value;
      entries.set(id, { value: { ...prev, status: 'unauthorized' }, at: Date.now() });
      inflight.delete(id);
    },
  };
}

import { createHash } from "node:crypto";

/** Exact input/provider/model/dimension key. No normalization or stored query text. */
export function queryEmbeddingCacheKey({ baseUrl, model, dimensions, text }) {
  return createHash("sha256").update(JSON.stringify([
    baseUrl, model, dimensions, "query", "float", false, text,
  ])).digest("hex");
}

/** RAM-only TTL/LRU cache for successful query vectors, with in-flight deduplication. */
export function createQueryEmbeddingCache({ ttlMs = 3_600_000, maxEntries = 500,
  cleanupIntervalMs = 60_000, now = Date.now } = {}) {
  const ttl = Number.isFinite(ttlMs) && ttlMs >= 0 ? ttlMs : 3_600_000;
  const capacity = Number.isInteger(maxEntries) && maxEntries >= 0 ? maxEntries : 500;
  const enabled = ttl > 0 && capacity > 0;
  const entries = new Map();
  const inFlight = new Map();
  const stats = { hits: 0, misses: 0, coalesced: 0, expired: 0, evictions: 0 };

  function pruneExpired() {
    const timestamp = now();
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= timestamp) { entries.delete(key); stats.expired += 1; }
    }
  }

  const cleanup = enabled && cleanupIntervalMs > 0
    ? setInterval(pruneExpired, cleanupIntervalMs) : null;
  cleanup?.unref?.();

  async function getOrCreate(key, create, onOutcome) {
    const observe = outcome => { try { onOutcome?.(outcome); } catch { /* Logging cannot alter caching. */ } };
    const cached = entries.get(key);
    if (cached && cached.expiresAt > now()) {
      stats.hits += 1;
      entries.delete(key);
      entries.set(key, cached); // Touch LRU order without extending fixed TTL.
      observe("hit");
      return cached.vector.slice();
    }
    if (cached) { entries.delete(key); stats.expired += 1; }

    const existing = inFlight.get(key);
    if (existing) { stats.coalesced += 1; observe("coalesced"); return (await existing).slice(); }

    stats.misses += 1;
    observe("miss");
    const pending = Promise.resolve().then(create).then(vector => {
      if (!Array.isArray(vector) || !vector.length || vector.some(value => !Number.isFinite(value))) {
        throw new Error("Cannot cache an invalid embedding vector");
      }
      if (enabled) {
        pruneExpired();
        entries.set(key, { vector: vector.slice(), expiresAt: now() + ttl });
        while (entries.size > capacity) {
          entries.delete(entries.keys().next().value);
          stats.evictions += 1;
        }
      }
      return vector;
    });
    inFlight.set(key, pending);
    try { return (await pending).slice(); }
    finally { if (inFlight.get(key) === pending) inFlight.delete(key); }
  }

  return { getOrCreate, pruneExpired,
    getStats: () => ({ ...stats, enabled, entries: entries.size, inFlight: inFlight.size }),
    dispose: () => { if (cleanup) clearInterval(cleanup); entries.clear(); },
  };
}

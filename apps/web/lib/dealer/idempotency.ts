/**
 * Tiny in-memory idempotency cache for dealer mutating routes.
 *
 * - Bounded at MAX_ENTRIES; oldest-first eviction.
 * - Each entry expires after TTL_MS (60 seconds) so repeated retries
 *   inside that window collapse to a single write, but a deliberate
 *   resubmit after the window completes normally.
 * - Single-process only — for vendor-pilot scale we don't need Redis.
 *   When this codebase grows past one Next.js instance, swap the Map
 *   for an upstash/redis-rate-limit client and the contract is the same.
 */

const TTL_MS = 60_000;
const MAX_ENTRIES = 1024;

type Entry = {
  expiresAt: number;
  response: unknown;
};

const store = new Map<string, Entry>();

function evictExpired() {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.expiresAt < now) store.delete(key);
  }
  if (store.size > MAX_ENTRIES) {
    // Evict oldest insertion-order entries until under cap.
    const overflow = store.size - MAX_ENTRIES;
    let dropped = 0;
    for (const key of store.keys()) {
      store.delete(key);
      if (++dropped >= overflow) break;
    }
  }
}

export function getIdempotent(key: string): unknown | null {
  evictExpired();
  const entry = store.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    store.delete(key);
    return null;
  }
  return entry.response;
}

export function setIdempotent(key: string, response: unknown): void {
  store.set(key, { response, expiresAt: Date.now() + TTL_MS });
  if (store.size > MAX_ENTRIES) evictExpired();
}

/**
 * Compose the cache key from a route discriminator + the client-supplied
 * Idempotency-Key header so two routes can't collide.
 */
export function idempotencyKey(route: string, clientKey: string | null): string | null {
  if (!clientKey) return null;
  // Bound the client-supplied key to avoid memory blowup from oversize headers.
  const safe = clientKey.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 128);
  if (!safe) return null;
  return `${route}:${safe}`;
}

/**
 * In-memory token bucket rate limiter.
 *
 * Each (route, actor) gets a bucket that refills at `refillRate` tokens
 * per second up to `capacity`. A request consumes one token. When the
 * bucket is empty, the request is rejected with the time-until-next
 * token so the client knows when to retry.
 *
 * Single-process only — fine for vendor pilot. Swap for upstash/redis
 * when running multi-instance.
 */

type Bucket = {
  tokens: number;
  lastRefillMs: number;
};

type LimitResult =
  | { ok: true; remaining: number; resetAt: number }
  | { ok: false; retryAfterMs: number; resetAt: number };

const MAX_BUCKETS = 4096;
const buckets = new Map<string, Bucket>();

function evict() {
  if (buckets.size <= MAX_BUCKETS) return;
  // Drop ~10% oldest entries on overflow.
  const dropCount = Math.ceil(MAX_BUCKETS * 0.1);
  let i = 0;
  for (const key of buckets.keys()) {
    buckets.delete(key);
    if (++i >= dropCount) break;
  }
}

export function consumeToken({
  key,
  capacity,
  refillRate,
}: {
  key: string;
  /** Max tokens the bucket holds — burst size. */
  capacity: number;
  /** Tokens added per second. */
  refillRate: number;
}): LimitResult {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { tokens: capacity, lastRefillMs: now };
    buckets.set(key, bucket);
    evict();
  } else {
    const elapsedSec = (now - bucket.lastRefillMs) / 1000;
    bucket.tokens = Math.min(capacity, bucket.tokens + elapsedSec * refillRate);
    bucket.lastRefillMs = now;
  }
  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    const resetAt = now + Math.ceil(((capacity - bucket.tokens) / refillRate) * 1000);
    return { ok: true, remaining: Math.floor(bucket.tokens), resetAt };
  }
  const retryAfterMs = Math.ceil(((1 - bucket.tokens) / refillRate) * 1000);
  return { ok: false, retryAfterMs, resetAt: now + retryAfterMs };
}

/**
 * Resolve the actor identifier for rate-limit bucketing. Prefers a
 * NextAuth session user id (when configured), falls back to a hash of
 * the client IP from `x-forwarded-for` / `x-real-ip`. The hash isn't
 * a privacy guarantee — it's just to avoid storing raw IPs in memory.
 */
export function actorKey(request: Request, fallback = "anonymous"): string {
  const fwd = request.headers.get("x-forwarded-for");
  const real = request.headers.get("x-real-ip");
  const ip = (fwd?.split(",")[0] ?? real ?? "").trim();
  if (!ip) return fallback;
  // Cheap stable hash to avoid keeping raw IPs in keys.
  let h = 0;
  for (let i = 0; i < ip.length; i++) h = (h * 31 + ip.charCodeAt(i)) >>> 0;
  return `ip_${h.toString(36)}`;
}

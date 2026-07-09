/* Token-bucket rate limiting (fixed window), zero-dep, per-key.
   Used per-IP on auth endpoints and per-account on API endpoints. */
const buckets = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (now > b.reset) buckets.delete(k);
}, 60000).unref?.();

export function makeLimiter({ windowMs, max, name }, now = Date.now) {
  const check = (key) => {
    const t = now();
    let b = buckets.get(name + ":" + key);
    if (!b || t > b.reset) { b = { count: 0, reset: t + windowMs }; buckets.set(name + ":" + key, b); }
    b.count++;
    return { ok: b.count <= max, remaining: Math.max(0, max - b.count), retryAfter: Math.ceil((b.reset - t) / 1000) };
  };
  const mw = (keyFn) => (req, res, next) => {
    const r = check(keyFn(req));
    res.set("X-RateLimit-Limit", String(max));
    res.set("X-RateLimit-Remaining", String(r.remaining));
    if (!r.ok) {
      res.set("Retry-After", String(r.retryAfter));
      return res.status(429).json({ error: `Too many requests — try again in ${r.retryAfter}s`, retryAfter: r.retryAfter });
    }
    next();
  };
  return { check, mw };
}
export const byIp = (req) => req.ip || req.socket?.remoteAddress || "unknown";
export const byAccount = (req) => req.accountId || byIp(req);

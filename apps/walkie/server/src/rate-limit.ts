/**
 * Per-key limiter for talk requests: a minimum gap between requests plus a
 * sliding-window burst cap. In-process only — with several backend
 * instances each enforces its own budget (documented limitation).
 */
export class TalkRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly opts: { minIntervalMs: number; burst: number; windowMs: number }) {}

  /** Returns 0 when allowed (and records the hit), otherwise ms until retry. */
  check(key: string, now: number): number {
    const arr = (this.hits.get(key) ?? []).filter((t) => now - t < this.opts.windowMs);
    const last = arr[arr.length - 1];
    if (last !== undefined && now - last < this.opts.minIntervalMs) {
      this.hits.set(key, arr);
      return this.opts.minIntervalMs - (now - last);
    }
    if (arr.length >= this.opts.burst) {
      this.hits.set(key, arr);
      return this.opts.windowMs - (now - arr[0]!);
    }
    arr.push(now);
    this.hits.set(key, arr);
    return 0;
  }

  prune(now: number) {
    for (const [k, arr] of this.hits) if (!arr.some((t) => now - t < this.opts.windowMs)) this.hits.delete(k);
  }
}

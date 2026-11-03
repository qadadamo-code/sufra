/**
 * Token-bucket rate limiter, per key (restaurant id). In-memory: each warm serverless instance has its own
 * buckets, so this is a first line of defence only. With Supabase configured, api/whatsapp-send also calls
 * messaging_rate_take() (0007_messaging.sql), which counts across instances in a table.
 */
export interface Bucket {
  tokens: number;
  at: number;
}

export class RateLimiter {
  private buckets = new Map<string, Bucket>();
  constructor(
    /** burst size */
    readonly capacity = 20,
    /** tokens added per second */
    readonly refillPerSec = 1,
    private maxKeys = 5_000,
  ) {}

  /** Takes one token. ok=false → retry after `retryAfterSec`. */
  take(key: string, now: number = Date.now()): { ok: boolean; remaining: number; retryAfterSec: number } {
    let b = this.buckets.get(key);
    if (!b) {
      if (this.buckets.size >= this.maxKeys) this.buckets.delete(this.buckets.keys().next().value as string);
      b = { tokens: this.capacity, at: now };
      this.buckets.set(key, b);
    }
    const elapsed = Math.max(0, now - b.at) / 1000;
    b.tokens = Math.min(this.capacity, b.tokens + elapsed * this.refillPerSec);
    b.at = now;
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return { ok: true, remaining: Math.floor(b.tokens), retryAfterSec: 0 };
    }
    return { ok: false, remaining: 0, retryAfterSec: Math.ceil((1 - b.tokens) / this.refillPerSec) };
  }

  reset() {
    this.buckets.clear();
  }
}

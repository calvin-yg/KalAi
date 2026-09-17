/**
 * Request hardening shared by the API routes.
 *
 * Deliberately free of Next imports so it can be unit tested directly with
 * `node --test` — the response builders live in ./responses.ts.
 *
 * Two things a personal app on a public URL still needs: a ceiling on how much
 * it will read into memory, and a ceiling on how often. The analysis route
 * spends real money per call and the login route guards the front door, so
 * neither can be left unbounded just because the audience is two people.
 */

/** Thrown to short-circuit a handler with a specific status. */
export class RequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "RequestError";
    this.status = status;
  }
}

/**
 * Read a JSON body, refusing anything oversized.
 *
 * Content-Length is a claim, not a fact, so the body is also measured as it is
 * read — a lying or absent header can't slip a 500 MB payload through.
 */
export async function readJson(
  request: Request,
  maxBytes: number,
): Promise<Record<string, unknown>> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new RequestError("That request is too large.", 413);
  }

  const buffer = await request.arrayBuffer();
  if (buffer.byteLength > maxBytes) {
    throw new RequestError("That request is too large.", 413);
  }

  try {
    const parsed = JSON.parse(new TextDecoder().decode(buffer)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new RequestError("Expected a JSON object.", 400);
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError("Expected a JSON body.", 400);
  }
}

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Fixed-window rate limiter held in memory.
 *
 * Deliberately per-process: this app runs as a single machine with a single
 * volume, so there is nowhere else for the state to live. Behind more than one
 * instance the limits multiply by the instance count — which is one more reason
 * the deployment notes say to keep it to one machine.
 */
export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly limit: number;
  private readonly windowMs: number;

  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  /** Returns null when allowed, or seconds to wait when the caller is over. */
  check(key: string): number | null {
    const now = Date.now();
    const bucket = this.buckets.get(key);

    if (!bucket || now >= bucket.resetAt) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      this.sweep(now);
      return null;
    }

    if (bucket.count >= this.limit) {
      return Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    }

    bucket.count += 1;
    return null;
  }

  /** Drop expired buckets so a long uptime can't grow the map without bound. */
  private sweep(now: number): void {
    if (this.buckets.size < 500) return;
    for (const [key, bucket] of this.buckets) {
      if (now >= bucket.resetAt) this.buckets.delete(key);
    }
  }
}

/** Best-effort client identity for rate limiting, behind a proxy or not. */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("fly-client-ip") ?? "local";
}

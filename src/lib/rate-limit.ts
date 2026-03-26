import { Redis } from "ioredis";
import { NextResponse } from "next/server";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

let redis: Redis | null = null;

function getRedis(): Redis | null {
  if (!redis) {
    try {
      redis = new Redis(REDIS_URL, {
        maxRetriesPerRequest: 1,
        lazyConnect: true,
        retryStrategy: () => null, // Don't retry — fail open
      });
      redis.connect().catch(() => {});
    } catch {
      return null;
    }
  }
  return redis;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfter: number; // seconds
}

/**
 * Sliding window rate limiter using Redis.
 * Fails open (allows all) if Redis is unavailable.
 */
async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const client = getRedis();
  if (!client) {
    return { allowed: true, remaining: limit, retryAfter: 0 };
  }

  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const redisKey = `rl:${key}`;

  try {
    const pipe = client.pipeline();
    // Remove entries outside the window
    pipe.zremrangebyscore(redisKey, 0, now - windowMs);
    // Add the current request
    pipe.zadd(redisKey, now, `${now}:${Math.random()}`);
    // Count entries in window
    pipe.zcard(redisKey);
    // Set TTL to auto-cleanup
    pipe.expire(redisKey, windowSeconds + 1);

    const results = await pipe.exec();
    const count = (results?.[2]?.[1] as number) || 0;

    if (count > limit) {
      // Find the oldest entry to calculate retry-after
      const oldest = await client.zrange(redisKey, 0, 0, "WITHSCORES");
      const oldestTime = oldest.length >= 2 ? parseInt(oldest[1], 10) : now;
      const retryAfter = Math.ceil((oldestTime + windowMs - now) / 1000);

      return {
        allowed: false,
        remaining: 0,
        retryAfter: Math.max(1, retryAfter),
      };
    }

    return {
      allowed: true,
      remaining: Math.max(0, limit - count),
      retryAfter: 0,
    };
  } catch {
    // Fail open on Redis errors
    console.warn("[rate-limit] Redis error, failing open");
    return { allowed: true, remaining: limit, retryAfter: 0 };
  }
}

/**
 * Rate limit by authenticated user ID.
 * 120 requests per minute.
 */
export async function rateLimitUser(userId: string): Promise<RateLimitResult> {
  return checkRateLimit(`user:${userId}`, 120, 60);
}

/**
 * Rate limit manual sync triggers.
 * 1 per 30 seconds per user.
 */
export async function rateLimitSync(userId: string): Promise<RateLimitResult> {
  return checkRateLimit(`sync:${userId}`, 1, 30);
}

/**
 * Rate limit connection create/update.
 * 5 per minute per user.
 */
export async function rateLimitConnections(
  userId: string,
): Promise<RateLimitResult> {
  return checkRateLimit(`conn:${userId}`, 5, 60);
}

/**
 * Rate limit attachment uploads.
 * 30 per minute per user.
 */
export async function rateLimitUploads(
  userId: string,
): Promise<RateLimitResult> {
  return checkRateLimit(`upload:${userId}`, 30, 60);
}

/**
 * Rate limit registration attempts.
 * 3 per 10 minutes per IP.
 */
export async function rateLimitRegistration(
  ip: string,
): Promise<RateLimitResult> {
  return checkRateLimit(`reg:${ip}`, 3, 600);
}

/**
 * Return a 429 response with Retry-After header.
 */
export function tooManyRequests(retryAfter: number): NextResponse {
  return NextResponse.json(
    { error: "Too many requests" },
    {
      status: 429,
      headers: { "Retry-After": String(retryAfter) },
    },
  );
}

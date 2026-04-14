import "server-only";
import { Redis } from "@upstash/redis";

/**
 * Shared Upstash Redis client. Uses KV_REST_API_URL and KV_REST_API_TOKEN
 * provisioned by the Vercel Marketplace Upstash integration.
 *
 * Falls back gracefully if env vars are missing (dev without Redis).
 */
export function getRedisClient(): Redis | null {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    console.warn("[redis] KV_REST_API_URL or KV_REST_API_TOKEN not set — Redis unavailable");
    return null;
  }

  return new Redis({ url, token });
}

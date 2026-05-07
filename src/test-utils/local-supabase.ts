/**
 * Helpers for integration tests that talk to a real Supabase stack.
 *
 * Defaults assume the local stack started by `supabase start`
 * (URL `http://127.0.0.1:54321`); env vars override for CI or remote test
 * databases.
 *
 * Tests should call `integrationEnabled()` and short-circuit via
 * `describe.skipIf(!integrationEnabled())` so default `npm test` does not
 * attempt to connect to a stack that isn't running.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

const DEFAULT_URL = "http://127.0.0.1:54321";

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

export function getIntegrationUrl(): string {
  return readEnv("SUPABASE_INTEGRATION_URL") ?? DEFAULT_URL;
}

export function getIntegrationServiceKey(): string | undefined {
  return readEnv("SUPABASE_INTEGRATION_SERVICE_ROLE_KEY");
}

export function getIntegrationAnonKey(): string | undefined {
  return readEnv("SUPABASE_INTEGRATION_ANON_KEY");
}

/**
 * Returns true only when integration tests are explicitly enabled and have
 * the credentials needed to run. Tests must skip otherwise.
 */
export function integrationEnabled(): boolean {
  if (readEnv("RUN_INTEGRATION_TESTS") !== "1") {
    return false;
  }
  return Boolean(getIntegrationServiceKey()) && Boolean(getIntegrationAnonKey());
}

/**
 * Service-role client. Bypasses RLS — use for seeding fixtures and
 * asserting row counts after a test exercises the user-scoped path.
 */
export function getLocalAdminClient(): SupabaseClient<Database> {
  const serviceKey = getIntegrationServiceKey();
  if (!serviceKey) {
    throw new Error(
      "SUPABASE_INTEGRATION_SERVICE_ROLE_KEY is not set. " +
        "See docs/testing/integration.md for setup."
    );
  }
  return createClient<Database>(getIntegrationUrl(), serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

/**
 * Anon-key client with a user JWT in the Authorization header. Used to
 * exercise RLS and SECURITY DEFINER RPC behaviour as the test user.
 */
export function getLocalUserClient(jwt: string): SupabaseClient<Database> {
  const anonKey = getIntegrationAnonKey();
  if (!anonKey) {
    throw new Error(
      "SUPABASE_INTEGRATION_ANON_KEY is not set. " +
        "See docs/testing/integration.md for setup."
    );
  }
  return createClient<Database>(getIntegrationUrl(), anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } }
  });
}

/**
 * Helper for tests that need a fresh user JWT. The local stack ships with
 * a built-in JWT secret, so tests typically call admin.auth.admin.createUser
 * and then admin.auth.admin.generateLink (or sign in with password) to mint
 * a session. Centralising this signature lets the helper grow without each
 * test rewriting the dance.
 */
export type IntegrationUserSession = {
  userId: string;
  jwt: string;
};

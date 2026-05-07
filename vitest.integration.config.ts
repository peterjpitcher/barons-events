import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Integration test config for tests that exercise real Supabase (Postgres + RLS + auth).
 *
 * Tests opt-in via `RUN_INTEGRATION_TESTS=1` and skip cleanly when the env is not set,
 * so this file can sit alongside the unit-test config without breaking `npm test`.
 *
 * See docs/testing/integration.md for prerequisites and setup.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(path.dirname(fileURLToPath(import.meta.url)), "./src"),
      "server-only": path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "./src/test-utils/server-only-mock.ts"
      )
    }
  },
  test: {
    include: ["src/**/*.integration.test.ts"],
    testTimeout: 30000,
    environment: "node",
    globals: true,
    // Single fork keeps concurrency tests deterministic and avoids
    // contention on shared seed fixtures.
    pool: "forks"
  }
});

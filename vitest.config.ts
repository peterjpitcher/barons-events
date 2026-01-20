import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(path.dirname(fileURLToPath(import.meta.url)), "./src"),
      "server-only": path.resolve(path.dirname(fileURLToPath(import.meta.url)), "./src/test-utils/server-only-mock.ts")
    }
  },
  test: {
    environment: "node",
    globals: true,
    setupFiles: []
  }
});

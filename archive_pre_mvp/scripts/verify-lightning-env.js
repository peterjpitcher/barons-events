#!/usr/bin/env node

const value = process.env.TAILWIND_DISABLE_LIGHTNINGCSS;

if (value !== "1") {
  console.error(
    "TAILWIND_DISABLE_LIGHTNINGCSS must be set to 1 when running the build. " +
      "Set it via cross-env or your CI environment."
  );
  process.exitCode = 1;
} else {
  console.log("Verified: TAILWIND_DISABLE_LIGHTNINGCSS=1");
}

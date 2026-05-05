# Dependency Audit Response Runbook

## Scope

Production dependency audit response uses:

```bash
/usr/bin/env PATH=/bin:/usr/bin:/usr/local/bin:/opt/homebrew/bin:$PATH npm audit --omit=dev
```

Full `npm audit` may include dev-toolchain advisories; triage them separately unless they affect deployed runtime code.

## Response Steps

1. Capture the advisory package, severity, vulnerable range, and fixed range.
2. Prefer patch/minor updates within the current major.
3. If the stable release is still vulnerable but a same-major canary clears production audit, document the risk and run the full verification suite.
4. Use `overrides` only for transitive runtime advisories when the parent package has not released a fixed dependency range.
5. Refresh `package-lock.json`.
6. Run:
   ```bash
   npm run typecheck
   npm run lint
   npm run test
   npm run build
   npm audit --omit=dev
   ```

## Current Notes

- Next.js is intentionally pinned to the current major canary when the latest stable remains inside a production advisory range.
- Resend may require a transitive `svix` override until Resend publishes the fixed dependency line.
- Twilio pulls `axios` and `follow-redirects`; refresh the lockfile when those receive security releases.

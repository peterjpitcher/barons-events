# End-to-End Testing with Playwright

## Prerequisites

```bash
npm install @playwright/test --save-dev
npx playwright install chromium
```

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `E2E_BASE_URL` | App URL (default: `http://localhost:3000`) |
| `E2E_TEST_USER_EMAIL` | Test user email for login |
| `E2E_TEST_USER_PASSWORD` | Test user password for login |

## Running

```bash
npm run test:e2e          # Headless run
npm run test:e2e:ui       # Interactive UI mode
```

## CI

In CI, the deployer runs:

```bash
npm install
npx playwright install chromium
npm run test:e2e
```

## Writing Tests

- Test files live in `tests/e2e/`
- Use `page.route()` to intercept RPCs for edge-case scenarios
- Playwright config is at `playwright.config.ts` (chromium only)
- Reports go to `playwright-report/` (gitignored)

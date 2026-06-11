
## 2026-06-11 — "Fixed" means deployed and verified, not merged locally
Client retested the QR bug on production while the fix sat in an unmerged PR; the user had to come back with "it's not fixed yet".
**Rule:** when the user reports a production bug, the job is done only when the fix is verified live: merge → watch the production deployment succeed → smoke-test the affected path. State explicitly in the summary which environment the fix has reached. BaronsHub deploys to production from `main` via Vercel; a pushed branch deploys previews only.

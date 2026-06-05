# Mobile Redesign Implementation Notes

Date: 2026-06-04

## Scope Completed

- Implemented the mobile redesign across the authenticated shell, dashboard, events, event forms, event detail, bookings, planning, proposals, reviews, debriefs, customers, artists, users, venues, links, opening hours, settings, account, auth pages, status pages, and public booking/result flows.
- Mobile behavior is scoped to viewports below `md` / 768px. Desktop navigation, tables, boards, and page composition are preserved at `md+`.
- Backend behavior was kept intact. No Supabase schema, RLS, public REST API, validation, or server-action contract changes were made.
- Added the protected `/more` route as a mobile destination only. It is not exposed in the desktop sidebar.
- Extended `SheetContent` with `side="bottom"` for mobile filter and confirmation sheets.
- Preserved the existing dirty worktree changes and patched around them.

## Problems And Mismatches Found

- Planning mobile review correction: the first implementation left the desktop planning header, alert strip, filter controls, event/inspiration overlays, and vertical "MY TODO ITEMS" rail visible on mobile. This squeezed the `All open items` / search area and did not match template 08. The mobile planning page now hides those desktop elements below `md`, uses compact horizon chips plus Mine/Blocked chips, renders planning-item cards only, and keeps the todo rail desktop-only.
- Event detail mobile correction: the SOP drawer reservation also applied `padding-right: 3rem` below desktop widths, which left a blank strip on mobile event detail pages. The drawer now clears its body reservation below `lg` and keeps the desktop reservation behavior unchanged.
- Manager-screen correction: Users, Venues, Settings, Customers, and Artists were still showing desktop page headers or create/context panels before the mobile list/card surfaces because `.app-page-header` sets `display:flex` after Tailwind utilities. Those desktop blocks are now wrapped in `hidden md:block` containers, and mobile gets compact handoff-style headers.
- Artists mobile correction: the first mobile pass rendered the full Add Artist form before search and artist cards. The create flow is now a bottom sheet on mobile, while desktop keeps the original inline form.
- Public/status shell correction: authenticated visual validation initially showed app chrome on auth, status, and public booking routes. A shell route guard now renders those routes without the authenticated app shell even when an authenticated test context exists.
- Account preferences: the weekly digest is mandatory in the current backend/product model, so it is shown as locked/on. I did not add fake interactive toggles for unsupported communication settings. The existing todo digest preference remains wired to the existing action.
- Visual QA data limitation: the local seed/current data did not include pending reviews or outstanding debriefs for every queue state, so templates 15 and 16 were captured as their real empty states. The mobile card/form code paths are still implemented, but those data states should be manually checked with representative pending/outstanding records.
- Authenticated visual QA used a temporary administrator user and session created by the validation script, then cleaned up at the end of the run.
- Event detail actions: the mobile Share/Edit action row is rendered as a visible action row instead of an additional fixed sticky bar. This avoids overlapping the existing mobile form Save/Submit sticky bar on detail/edit pages.
- Browser plugin limitation: the in-app Browser plugin could not load `localhost` / `127.0.0.1` in this environment because navigation was blocked with `net::ERR_BLOCKED_BY_CLIENT`. I used local Playwright against the already-running dev server instead.
- Dev server console noise: Playwright captured Next.js dev HMR WebSocket handshake errors (`ERR_INVALID_HTTP_RESPONSE`) on some routes. These were dev-server transport errors, not page runtime errors.
- Next.js dev indicator: the black circular `N` visible in screenshots is the local Next.js dev indicator, not application UI.

## Verification Completed

- `npm run typecheck` passed.
- `npm run lint` passed.
- `npm run test` passed.
- Existing result: 73 test files passed, 5 skipped; 824 tests passed, 34 skipped.
- Playwright visual validation captured all 38 configured mobile templates at 390px, plus the 360px dashboard proof, against `http://localhost:3000`.
- The visual validation report completed with 38 captured, 0 failed, and no script-level findings.
- Contact sheets and raw screenshots were written to `temp/mobile-visual-validation/`.
- Earlier Playwright smoke checks also ran at 1440px against representative desktop routes and found no horizontal overflow on the exercised routes.

## Follow-Up QA Recommended

- Sign in locally as administrator, office worker, and executive and check mobile role-gated states for reviews, event actions, planning permissions, users, and venue-scoped records.
- Check paid, free, and pay-on-arrival public booking events to confirm copy, total display, Turnstile sizing, ticket stepper bounds, and sticky CTA behavior across all pricing modes.
- Seed or create representative pending reviews and outstanding debriefs before final visual approval so those non-empty queue templates can be compared directly.
- Manually compare the 29 handoff templates against live mobile screens at 390px and 360px with realistic data density.
- Re-check desktop at 1440px for Dashboard, Events, Event detail/edit, Planning, Bookings, Settings, and public booking before release.

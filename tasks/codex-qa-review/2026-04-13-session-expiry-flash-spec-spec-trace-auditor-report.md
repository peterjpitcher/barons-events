**Findings**
- `SPEC-001` Critical, `spec defect + implementation defect`: the spec misses the more severe app-session invalidation path. Middleware redirects `session_missing` / `session_expired` / `session_mismatch` to `/login` without `redirectedFrom` in [middleware.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts:216), [middleware.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts:230), and [middleware.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts:246), but `/login` is public in [middleware.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts:13) and both [src/app/login/page.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/login/page.tsx:41) and [src/app/layout.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/layout.tsx:157) use [getCurrentUser()](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/auth.ts:48), which ignores the custom app-session layer. Inference: if the Supabase session is still valid, `/login` can immediately redirect away again instead of being usable.
- `SPEC-002` High, `spec defect + architectural fit defect`: RC1/RC2 misframe the client problem. [src/lib/supabase/client.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/supabase/client.ts:9) exists, but repo search shows no runtime consumers; there is no mounted browser auth runtime at all. Adding listeners to dead code will not fix this.
- `SPEC-003` High, `spec defect`: RC3 is technically wrong for Next `16.1.5`. Middleware redirects here are `307`, not `302`, because [NextResponse.redirect()](/Users/peterpitcher/Cursor/BARONS-BaronsHub/node_modules/next/dist/server/web/spec-extension/response.js:98) defaults to `307`. During RSC fetch, Next follows/replays middleware redirects in [fetch-server-response.js](/Users/peterpitcher/Cursor/BARONS-BaronsHub/node_modules/next/dist/client/components/router-reducer/fetch-server-response.js:214); the stale current screen remains visible until the redirected response resolves.
- `SPEC-004` High, `spec defect`: RC4’s “refresh token lasts ~7 days” is not repo-verifiable and is likely wrong. The repo contains no Supabase auth config. Supabase’s docs say access-token lifetime is configurable and refresh tokens do not expire by default, though session lifetime/inactivity can be configured: https://supabase.com/docs/guides/auth/sessions
- `SPEC-005` High, `spec defect`: RC5 is incomplete. Action auth failure is inconsistent today: redirect in [artists.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/artists.ts:55), [debriefs.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/debriefs.ts:46), [users.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/users.ts:28); returned error in [bookings.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/bookings.ts:171), [customers.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/customers.ts:21), [links.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/links.ts:45); thrown error in [sop.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/sop.ts:22) and [planning.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/planning.ts:49).
- `SPEC-006` Medium, `implementation defect`: the supposed middleware optimization is broken. [middleware.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts:262) sets `x-user-id` after `NextResponse.next()` has already copied override headers in [response.js](/Users/peterpitcher/Cursor/BARONS-BaronsHub/node_modules/next/dist/server/web/spec-extension/response.js:24), so [getCurrentUser()](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/auth.ts:51) will still fall back to `supabase.auth.getUser()`.

**Requirements Coverage Matrix**
Grouped equivalent claims to avoid duplicating the same statement across problem/repro/root-cause/safeguard/success sections.

| ID | Claim / Requirement | Status | Trace |
|---|---|---|---|
| RC1.1 | No `onAuthStateChange` / `SIGNED_OUT` / `TOKEN_REFRESHED` / `INITIAL_SESSION` listeners exist | Verified | Repo search: zero runtime matches in `src` |
| RC1.2 | Browser client has `autoRefreshToken: true` | Verified | [client.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/supabase/client.ts:16) |
| RC1.3 | No client-side session awareness exists | Verified, but cause misstated | Browser client helper is unused; there is no mounted client auth layer |
| RC2.1 | No `visibilitychange` / `pageshow` listeners exist | Verified | Repo search: zero runtime matches in `src` |
| RC2.2 | Tab return is specifically caused by bfcache restoration | Unverified from code | Browser/runtime claim, not a repo fact |
| RC3.1 | In-app shell nav uses client `<Link>` | Verified | [nav-link.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/components/shell/nav-link.tsx:19) |
| RC3.2 | Middleware returns `302` on expiry | Contradicted | App uses `NextResponse.redirect()` with default `307` in [response.js](/Users/peterpitcher/Cursor/BARONS-BaronsHub/node_modules/next/dist/server/web/spec-extension/response.js:98) |
| RC3.3 | Next 16 commits partial next-route UI before redirect arrives | Contradicted / overstated | Next handles middleware RSC redirects in [fetch-server-response.js](/Users/peterpitcher/Cursor/BARONS-BaronsHub/node_modules/next/dist/client/components/router-reducer/fetch-server-response.js:214); the old page stays visible until resolution |
| RC4.1 | Custom `app-session-id` is 24h absolute and non-refreshing | Verified | [session.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/auth/session.ts:7), [session.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/auth/session.ts:43) |
| RC4.2 | Supabase access/refresh timing is `~1h / ~7d` | Contradicted / unverifiable | No repo config; Supabase docs say configurable access-token lifetime and non-expiring refresh tokens by default |
| RC4.3 | Supabase-only validity can disagree with middleware | Verified | [getCurrentUser()](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/auth.ts:48) does not check app-session; middleware does at [middleware.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts:214) |
| RC5.1 | Expired server actions redirect with no client feedback | Partial | True for redirect-style actions; false for returned-error and throw/catch actions |
| RC5.2 | `redirect("/login")` causes full-page nav | Contradicted / partial | Internal server-action redirects are SPA navigations in [server-action-reducer.js](/Users/peterpitcher/Cursor/BARONS-BaronsHub/node_modules/next/dist/client/components/router-reducer/reducers/server-action-reducer.js:189) |
| RC6.1 | Root layout conditionally renders `AppShell` vs bare children | Verified | [layout.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/layout.tsx:168) |
| RC6.2 | Redirect path briefly re-renders with `user = null`, causing shell “pop” | Partial / likely wrong for app-session expiry | On public `/login`, `getCurrentUser()` can still be truthy because it ignores app-session |
| SG1 | Middleware validates JWT + app-session + binding on protected requests | Verified | [middleware.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts:196), [middleware.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts:228), [middleware.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts:246) |
| SG2 | Login-page redirect protection prevents loops | Contradicted | [login/page.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/login/page.tsx:41) only checks Supabase/profile auth, not app-session |
| REQ1 | Redirects should preserve `redirectedFrom` | Not implemented for app-session invalidation | Only JWT-failure branch sets it in [middleware.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts:205) |
| REQ2 | Server actions should show user-friendly feedback on expiry | Partially implemented already | Some actions return messages today; others still redirect |
| SC1 | No visible flash on expired-session return | Not met | No client coordinator; stale authenticated DOM persists |
| SC2 | Redirect to `/login` within ~1s of tab refocus | Not met | No focus/visibility/session-check path exists |
| SC3 | No regression in middleware auth gate | Open requirement | Current gate works, but related UX around `/login` is broken |

**Spec Defects**
- The spec omits the `session_missing` path, even though the cookie itself expires at 24h in [session.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/auth/session.ts:27). Inference: after a normal 24h lapse, the common branch is likely `session_missing`, not `session_expired`.
- RC1/RC2 assume the fix is “add listeners,” but the repo has no mounted browser Supabase client. That is an architecture gap, not just a missing-listener gap.
- RC3 describes the wrong transport semantics: wrong status code, wrong Next 16 redirect model, and wrong failure shape.
- RC4 hard-codes Supabase timing that is not represented anywhere in-repo and may be false for this project.
- RC5 treats redirect-based actions as universal; they are not.
- RC6 likely diagnoses the wrong symptom. For app-session expiry, the more dangerous outcome is persistent authenticated shell / redirect bounce on `/login`, not a brief shell-to-bare-layout pop.
- “Smooth redirect within ~1 second” is too weak for a no-flash requirement. A full second still exposes stale authenticated UI.

**Implementation Defects**
- App-session invalid branches drop `redirectedFrom` in [middleware.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts:216), [middleware.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts:230), and [middleware.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts:246).
- `/login` only shows copy for `reason=session_expired` in [login/page.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/login/page.tsx:62); `session_missing` and `session_mismatch` get no feedback.
- `getCurrentUser()` on public routes ignores the app-session layer, while `/login` redirects any such user away in [login/page.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/login/page.tsx:41). Inference: this can make re-auth unusable after custom-session invalidation.
- The `x-user-id` optimization is ineffective because the forwarded request headers were already serialized before the later mutation.
- [createSupabaseReadonlyClient()](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/supabase/server.ts:6) cannot persist refreshed auth cookies; any refresh performed through `getCurrentUser()` on layouts/pages is request-local.
- The browser Supabase client is dead code: repo search finds only its definition.

**Architectural Fit Defects**
- A client-side fix needs a real coordinator mounted near the root. Nothing currently owns browser auth state.
- A dual-layer focus check has no source of truth today. There is no lightweight session-validation endpoint; checking only Supabase is insufficient.
- Because `/api/*` is excluded from middleware, any new auth-check endpoint would need explicit dual-layer validation, not just `getCurrentUser()`.
- Supabase’s browser client already manages foreground/background refresh behavior in browsers; the missing piece is coordination with the custom `app-session-id`, not manual JWT-refresh plumbing alone. Docs: https://supabase.com/docs/reference/javascript/auth-startautorefresh

**Unresolved Ambiguities**
- On app-session invalidation, should the app also clear Supabase auth cookies, or should `/login` deliberately ignore a still-valid Supabase session until a fresh app session is created?
- Should `session_missing`, `session_expired`, and `session_mismatch` all preserve `redirectedFrom` and all show user-facing feedback?
- What is the required client behavior while validity is unknown on refocus: hide the shell immediately, show an overlay, or allow stale UI until check completes?
- What should happen offline or if the session check fails closed on refocus?
- What is the standard server-action auth contract going forward: typed return error, typed thrown domain error, or redirect?

**Completeness Assessment**
- JWT access-token expiry: partially covered by RC1/RC4.
- Refresh-token expiry / rotation / server-side refresh failure: not fully covered; exact lifetime is not repo-known, and readonly cookie persistence is omitted.
- App-session absolute timeout: covered, but only as DB expiry; cookie-expiry `session_missing` is missing.
- Session mismatch: missing from the spec despite a dedicated middleware branch in [middleware.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts:246).
- Role-change revocation: missing; [updateUserAction()](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/users.ts:58) destroys all custom sessions.
- Password-reset revocation: missing; [auth.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/auth.ts:311) destroys all custom sessions during password reset.
- Adjacent auth invalidation path: missing profile / invalid role also becomes “unauthenticated” in [auth.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/auth.ts:82), even if middleware passed.

External sources used:
- Supabase sessions docs: https://supabase.com/docs/guides/auth/sessions
- Supabase JS auto-refresh docs: https://supabase.com/docs/reference/javascript/auth-startautorefresh
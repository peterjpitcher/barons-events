**Challenged Assumptions**
The spec overcounts. I don’t see six independent root causes; I see roughly three core causes plus a few symptoms/trigger variants.

1. `RC1`  
Classification: `Verified`  
There is no client-side session awareness in practice: the browser Supabase client exists in [src/lib/supabase/client.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/supabase/client.ts:1) and has no runtime consumers, and there are no auth-state listeners. But the spec frames this too narrowly around Supabase JWT events. The real expiry in this bug is often the custom 24h `app-session-id` enforced in [src/lib/auth/session.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/auth/session.ts:6) and [middleware.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts:212). An `onAuthStateChange` fix by itself would miss that.

2. `RC2`  
Classification: `Verified`  
There is no `visibilitychange`/`pageshow` handling anywhere, so a stale authenticated DOM can sit on screen until the next request. This is a real tab-return trigger. It is not really independent from RC1; it is the concrete “when does the missing client awareness matter?” path.

3. `RC3`  
Classification: `Verified`  
Medium severity is about right, but the spec’s mechanism is off. [src/components/shell/nav-link.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/components/shell/nav-link.tsx:1) does use client-side `<Link>`, and Next 16 keeps shared layouts/UI during client navigation. This repo also has route `loading.tsx` fallbacks, including [src/app/loading.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/loading.tsx:1), so the stale authenticated shell can remain visible or swap to a loading skeleton while middleware resolves the redirect. What I do not buy is the spec’s “302 race” story: `NextResponse.redirect` here is not explicitly `302`, and the important behavior is preserved shared UI while the redirect resolves, not target-page partial commit.

4. `RC4`  
Classification: `Verified`  
This is real and important. The custom app session expires absolutely at 24h, while Supabase auth can still be valid/refreshed. [middleware.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts:228) rejects on custom-session failure after JWT validation, so any client check that only asks Supabase whether the user is signed in will produce false positives.

5. `RC5`  
Classification: `Verified`  
The redirect-on-auth-failure pattern exists in many server actions, e.g. [src/actions/artists.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/artists.ts:55), [src/actions/debriefs.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/debriefs.ts:46), and [src/actions/users.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/users.ts:28). But the spec understates the real problem: auth failure handling is inconsistent across the codebase. [src/actions/bookings.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/bookings.ts:171), [src/actions/customers.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/customers.ts:21), and [src/actions/links.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/links.ts:47) return structured errors, while [src/actions/planning.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/planning.ts:49) and [src/actions/sop.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/sop.ts:22) throw normal `Error`s.

6. `RC6`  
Classification: `Unfounded`  
The conditional shell branch is real in [src/app/layout.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/layout.tsx:157), but the spec does not prove it is an independent flash cause. The primary visible problem is that stale protected UI is already on screen before the redirect resolves. The layout branch mostly affects the final destination render. Low severity is fine, and possibly still too high.

**Completeness Gaps**
- The spec misses a concrete bug: middleware preserves `redirectedFrom` only on JWT failure at [middleware.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts:202). It does not preserve it for `session_missing`, `session_expired`, or `session_mismatch` at [middleware.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts:216), [middleware.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts:230), and [middleware.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts:246).
- The spec focuses on `session_expired`, but after a real 24h timeout the browser may simply drop the cookie because `maxAge` is also 24h in [src/lib/auth/session.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/auth/session.ts:22). That means the common branch can be `session_missing`, not `session_expired`.
- The login page only shows an expiry banner for `reason === "session_expired"` in [src/app/login/page.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/login/page.tsx:62). `session_missing` gets no message.
- The spec missed existing `loading.tsx` boundaries. They matter for RC3 because they can show a skeleton inside the authenticated shell during navigation.
- The affected-files list is incomplete; the real action surface includes `events`, `venues`, `opening-hours`, `planning`, `sop`, `customers`, and `links`.

**Codebase Fit Issues**
- A fix centered on Supabase browser listeners is not drop-in. There is no mounted client auth coordinator today; [src/lib/supabase/client.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/supabase/client.ts:1) is just a factory.
- Any client-side fix must validate the app session too, but the client has no app-session expiry timestamp or lightweight validation endpoint today.
- [src/lib/supabase/server.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/supabase/server.ts:6) uses no-op `set()`/`remove()` in read contexts, so `getCurrentUser()` on public pages is not a durable token-refresh path.
- [src/app/login/page.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/login/page.tsx:41) correctly uses `getCurrentUser()` instead of `getSession()`, but that means any “just check cookies locally” fix would fight the current server-authoritative approach.

**Hidden Risks**
- RC1, RC2, and RC3 are overlapping manifestations of the same client-blindness problem. Treating them as independent can lead to over-fixing one trigger while leaving the core issue intact.
- Standardizing only the redirecting server actions will still leave inconsistent UX from the structured-error and thrown-error actions.
- The spec calls the middleware gate “working correctly,” but it already fails one stated requirement: preserving return location on app-session failures.
- Next’s own guidance says Proxy/Middleware is fine for optimistic redirects but not ideal as a full session-management layer. This repo already does DB-backed session validation there, so adding focus polling or frequent auth probes needs care.

**False Confidence Flags**
- `RC3` severity: `Medium` is reasonable. Next 16 client-side navigation keeps shared UI/layouts and can show loading fallbacks while the redirect resolves; that is a real contributor on in-app clicks.
- `RC6` severity: `Low` is correct, maybe generous. It is not the main cause of the flash.
- The success criteria are not testable enough as written. “No visible flash” and “smooth redirect” need browser-level assertions for four cases: tab refocus, nav click, server-action submit, and hard reload/back-forward restore.
- Criterion 4 already fails in current code for app-session failure branches.
- The constraints are mostly realistic, except “redirect within ~1s of refocus” is not guaranteed unless the client either knows the app-session expiry locally or performs an explicit server check on focus.

Framework refs: https://nextjs.org/docs/app/getting-started/linking-and-navigating, https://nextjs.org/docs/app/getting-started/layouts-and-pages, https://nextjs.org/docs/app/getting-started/proxy
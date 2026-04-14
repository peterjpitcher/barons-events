**Workflow & Failure-Path Report**

**Cross-Cutting**
- Protected page requests are dual-gated in middleware: Supabase `getUser()` first at [middleware.ts:196](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts:196), then `app-session-id` presence at [middleware.ts:214](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts:214), then DB validation at [middleware.ts:228](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts:228) via [session.ts:79](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/auth/session.ts:79).
- The stale authenticated UI persists because the shell is rendered server-side in [layout.tsx:157](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/layout.tsx:157) and [layout.tsx:168](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/layout.tsx:168), while there is no client-side session observer in the repo. The only browser Supabase client is the unused factory at [client.ts:9](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/supabase/client.ts:9).
- `/login` is public in middleware at [middleware.ts:158](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts:158), but the page itself calls `getCurrentUser()` and redirects any still-authenticated Supabase user away at [login/page.tsx:41](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/login/page.tsx:41). That is the key loop trigger when the custom session is gone but Supabase can still refresh.

1. **Scenario 1: Tab return after 24h+; app session + JWT expired, refresh token still valid**
- On tab switch back, no BaronsHub auth code runs. The user just sees the already-rendered authenticated shell/page that was mounted earlier from [layout.tsx:168](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/layout.tsx:168).
- The `app-session-id` cookie is set with a 24h max-age in [session.ts:27](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/auth/session.ts:27), so on the next request the likely branch is “cookie missing” at [middleware.ts:216](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts:216), not `validateSession()`. If the browser still sends it, the fallback branch is [middleware.ts:228](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts:228).
- On that next request, middleware calls Supabase `getUser()` at [middleware.ts:196](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts:196). Because the refresh token is still valid, Supabase can recover a user even though the 1h JWT expired.
- Middleware then redirects to `/login?reason=session_missing` at [middleware.ts:220](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts:220) or `/login?reason=session_expired` at [middleware.ts:232](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts:232). Neither branch preserves `redirectedFrom`.
- `/login` bypasses middleware auth checks, then `LoginPage` calls `getCurrentUser()` at [login/page.tsx:41](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/login/page.tsx:41). Because there is still a valid Supabase user, it redirects away at [login/page.tsx:43](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/login/page.tsx:43). With no `redirectedFrom`, `sanitizeRedirect()` falls back to `/` at [login/page.tsx:21](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/login/page.tsx:21).
- Result: the user first sees stale authenticated content, then on first interaction gets a redirect loop between protected routes and `/login`. The common cookie-expiry path is `session_missing`, and the login page only shows a banner for `session_expired` at [login/page.tsx:62](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/login/page.tsx:62), so even a non-looping path would usually show no expiry message.

2. **Scenario 2: Tab return after 24h+; app session + JWT + refresh token all expired**
- Tab switch still shows the stale authenticated DOM first, for the same reason as scenario 1.
- On the first real request, middleware hits Supabase `getUser()` at [middleware.ts:196](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts:196), but now `user` is null, so it exits early through [middleware.ts:202](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts:202).
- That branch redirects to `/login?redirectedFrom=<original path>` at [middleware.ts:203](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts:203), and does so before any app-session check.
- `/login` then calls `getCurrentUser()` at [login/page.tsx:41](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/login/page.tsx:41), gets `null`, and renders the form. Root layout also gets `user = null` and drops the shell at [layout.tsx:168](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/layout.tsx:168).
- The login form carries the original destination in the hidden `redirectTo` input at [login-form.tsx:27](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/login/login-form.tsx:27), and `signInAction()` sanitizes and redirects to it at [auth.ts:67](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/auth.ts:67) and [auth.ts:174](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/auth.ts:174).
- Difference from scenario 1: this path is recoverable. There is no loop because Supabase can no longer authenticate the user on `/login`.

3. **Scenario 3: Click nav link with expired session**
- The sidebar link is a client-side `<Link>` in [nav-link.tsx:19](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/components/shell/nav-link.tsx:19), instantiated for `/planning` in [app-shell.tsx:94](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/components/shell/app-shell.tsx:94).
- Clicking it starts a client-side transition. The shared shell stays in place; `/planning` also has a loading boundary at [planning/loading.tsx:1](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/planning/loading.tsx:1), so the main panel can swap to loading UI while the request is in flight.
- The navigation request to `/planning` passes through middleware because the matcher covers normal app routes at [middleware.ts:281](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts:281).
- If the refresh token is still valid, middleware authenticates the Supabase user at [middleware.ts:196](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts:196), then fails the custom session at [middleware.ts:216](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts:216) or [middleware.ts:228](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts:228), and redirects to `/login`.
- `/login` immediately redirects away again because `LoginPage` still sees a Supabase user at [login/page.tsx:41](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/login/page.tsx:41). So the user does not get a stable login form; they get shell-preserving client-nav behavior followed by redirect churn.
- If the refresh token is also dead, the same click lands cleanly on the login page with `redirectedFrom=/planning`.

4. **Scenario 4: Submit form with expired session**
- The edit form wires save through `useActionState(saveEventDraftAction, ...)` at [event-form.tsx:157](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/components/events/event-form.tsx:157), and the form submits with `action={draftAction}` at [event-form.tsx:1681](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/components/events/event-form.tsx:1681).
- In Next, that action is invoked over `POST`; the current route still goes through middleware before the action body. The repo’s matcher does not exempt server-action posts for app pages at [middleware.ts:281](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts:281).
- So middleware catches the expired session first. `saveEventDraftAction()` does not reach its own auth check at [events.ts:592](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/events.ts:592); no draft save code executes.
- The user may briefly see the client pending state “Saving...” from [event-form.tsx:1694](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/components/events/event-form.tsx:1694), but no `draftState` success/error payload comes back because the request is turned into a redirect before the action runs.
- Outcome: middleware catches it; the action does not execute. The follow-on redirect behavior is the same split as scenarios 1 and 2.

5. **Scenario 5: Browser back/forward after session expiry**
- `/events` and `/events/[id]` both call `getCurrentUser()` server-side at [events/page.tsx:8](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/events/page.tsx:8) and [events/[eventId]/page.tsx:70](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/events/[eventId]/page.tsx:70), so they are dynamic pages.
- The likely back-button path is Next’s client Router Cache, not a fresh request. Previously visited route segments are reused on back/forward, and Next explicitly distinguishes that cache from browser bfcache.
- So when the user clicks Back, `/events` likely reappears immediately from cached route state with the old AppShell still visible. Middleware does not run at that moment because no request is needed.
- The session expiry is only discovered on the next uncached request from that restored page: refresh, a new navigation, a form submit, etc.
- bfcache is not the primary mechanism here. It could matter on a whole-document restore, but for in-app history in this codebase the better fit is Next router-cache reuse of already visited pages.

6. **Scenario 6: Multiple tabs**
- Tab 1 and tab 2 share cookies, but they do not share live UI state. There is no auth listener or tab-focus validator in the repo.
- When tab 1 hits expiry and the user signs in again, `signInAction()` creates a fresh app session at [auth.ts:148](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/auth.ts:148), sets `app-session-id` at [auth.ts:149](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/auth.ts:149), and redirects at [auth.ts:174](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/auth.ts:174).
- Switching to tab 2 does not trigger any auth re-check. The user simply sees whatever stale `/planning` DOM was already on screen.
- Once tab 2 makes a new request, it sends the new shared cookies from tab 1. Middleware then succeeds, so a click or refresh in tab 2 works normally again.
- Result: tab 2 stays stale until interaction, but it recovers on the next request because the new cookies are global.

7. **Scenario 7: Role change mid-session**
- `updateUserAction()` updates the target user record at [users.ts:52](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/users.ts:52), then destroys all that user’s app sessions at [users.ts:61](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/users.ts:61) via [session.ts:136](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/auth/session.ts:136).
- The user’s browser still holds the old Supabase cookies and the old `app-session-id` cookie value.
- On the next link click, middleware still gets a Supabase user at [middleware.ts:196](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts:196), but `validateSession()` returns `null` because the DB row is gone at [session.ts:84](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/auth/session.ts:84). Middleware takes the expired-session branch at [middleware.ts:230](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts:230) and clears the cookie at [middleware.ts:236](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts:236).
- `/login` then calls `getCurrentUser()` again at [login/page.tsx:41](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/login/page.tsx:41). That helper loads the profile fresh from `users` at [auth.ts:76](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/auth.ts:76), so it will see the new role, but because the Supabase user still exists it redirects away before rendering the login form.
- Result: this behaves like the same custom-session-expiry loop as scenario 1, except the reason is reliably `session_expired` because the cookie is present but its DB row was deleted. If `destroyAllSessionsForUser()` fails, the behavior changes: the user keeps their session, but future requests still pick up the new role from [auth.ts:76](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/auth.ts:76).

**Verification**
Static code trace only; I did not run a live browser session. For framework behavior I relied on official Next.js docs for client navigation, server-action POST transport, and router-cache back/forward behavior:
- https://nextjs.org/docs/app/getting-started/linking-and-navigating
- https://nextjs.org/docs/app/getting-started/updating-data
- https://nextjs.org/docs/app/deep-dive/caching
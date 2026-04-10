Static review against the spec and repo map:

**WF-001 Critical: App-session validation failures do not produce a useful recovery path and can loop.** [middleware.ts:212](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts#L212) [middleware.ts:230](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts#L230) [login/page.tsx:41](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/login/page.tsx#L41) [auth.ts:48](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/auth.ts#L48)
1. A protected request with a valid Supabase JWT but missing/invalid `app-session-id` is redirected to `/login?reason=session_missing|session_expired|session_mismatch`.
2. Middleware clears only the app-session cookie; the Supabase JWT remains.
3. `/login` is public, and `LoginPage` calls `getCurrentUser()`, which still sees the JWT and redirects back into the app.
4. Result: no crash page, but not a useful error either; with a live JWT this can bounce between `/login` and `/`.

**WF-002 Critical: `createSession()` failure after successful Supabase auth leaves a JWT-only login that the app cannot use.** [auth.ts:183](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/auth.ts#L183) [auth.ts:194](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/auth.ts#L194) [middleware.ts:216](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts#L216) [login/page.tsx:31](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/login/page.tsx#L31)
1. `signInWithPassword()` succeeds and Supabase auth cookies are set.
2. `createSession()` throws or the app-session cookie is not set; the action logs it as non-fatal and still redirects.
3. The first protected route is rejected by middleware because `app-session-id` is absent.
4. Because the JWT is still valid, the user looks authenticated to `getCurrentUser()` on `/login`, so this falls into the same unusable loop instead of a clean “sign-in failed” error.

**WF-003 High: Role changes while a user is active do not cut over cleanly.** [users.ts:51](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/users.ts#L51) [users.ts:58](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/users.ts#L58) [auth.ts:76](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/auth.ts#L76) [middleware.ts:228](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts#L228)
1. Inferred from request-scoped auth: an in-flight request keeps the role it loaded at the start of that request.
2. `updateUserAction()` writes the new role, then only best-effort deletes app sessions.
3. If session deletion fails, later requests usually pick up the new DB role via `getCurrentUser()`, but the old session stays alive.
4. If session deletion succeeds, the next protected request hits the same JWT-without-app-session loop rather than a clean “your access changed, sign in again” path.

**WF-004 High: Password-reset request flow can be used to wipe lockout state before mailbox control is proven.** [auth.ts:257](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/auth.ts#L257) [auth.ts:280](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/auth.ts#L280) [session.ts:274](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/auth/session.ts#L274)
1. A user/IP pair hits the failed-login threshold and becomes locked out.
2. Anyone who can submit the forgot-password form for that email reaches `requestPasswordResetAction()`.
3. The code clears all lockout rows for that email immediately, before any reset token is redeemed.
4. Result: lockout becomes resettable on demand; CAPTCHA slows abuse, but the lockout barrier itself is bypassable.

**WF-005 High: Failed event submit can still mutate artist links and image state.** [events.ts:1144](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/events.ts#L1144) [events.ts:1165](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/events.ts#L1165) [events.ts:1192](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/events.ts#L1192) [artists.ts:678](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/artists.ts#L678)
1. For existing events, submit first runs `syncEventArtists()` via service role and may upload/update the event image.
2. Only after those side effects does it check whether the event status is actually submittable.
3. If the event is already approved/rejected/completed, the action returns error or “already approved.”
4. The artist RPC is atomic, so this is not a join-table orphan, but it is still a partial mutation: a failed submit can leave changed artists/image on an event whose status never moved.

**WF-006 High: Booking creation is not idempotent under double submit.** [BookingForm.tsx:47](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/l/[slug]/BookingForm.tsx#L47) [bookings.ts:34](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/bookings.ts#L34) [bookings.ts:36](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/bookings.ts#L36) [20260313000000_event_bookings.sql:79](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260313000000_event_bookings.sql#L79)
1. Two close clicks/retries can send two `createBookingAction()` calls; the client `loading` flag is advisory, not a backend guarantee.
2. Each request calls `create_booking`.
3. The RPC locks the event row to prevent oversell, but it always inserts a new booking row and returns a fresh `booking_id`; there is no idempotency key or duplicate-submission constraint.
4. Result: duplicate confirmed bookings, duplicate SMS sends, and double capacity consumption if seats remain.

**WF-007 Medium: Planning board loads can fail because the read path performs writes.** [planning/page.tsx:13](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/planning/page.tsx#L13) [planning/index.ts:462](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/planning/index.ts#L462) [planning/index.ts:383](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/planning/index.ts#L383) [planning/index.ts:327](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/planning/index.ts#L327) [planning/error.tsx:6](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/planning/error.tsx#L6)
1. `/planning` calls `listPlanningBoardData()`.
2. Before reading board data, that loader calls `ensurePlanningOccurrencesThrough()`, which may insert occurrences, create recurring tasks, and update generation cursors with the admin client.
3. If any of those writes fail, the error bubbles; only SOP generation failures are swallowed.
4. Result: a write-path defect takes down a read page and users get the generic planning error screen. Because the page only checks “authenticated,” any signed-in user can trigger this write-on-read path.

**WF-008 Medium: Audit-log insert failures are swallowed, and auth audit failures are likely fully silent.** [audit-log.ts:32](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/audit-log.ts#L32) [audit-log.ts:93](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/audit-log.ts#L93) [20250218000000_initial_mvp.sql:112](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20250218000000_initial_mvp.sql#L112) [20260408120004_extend_audit_schema.sql:12](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260408120004_extend_audit_schema.sql#L12) [bookings.ts:175](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/bookings.ts#L175)
1. `recordAuditLogEntry()` logs and continues on insert failure; `logAuthEvent()` is worse because it never checks Supabase’s returned `error` at all.
2. Current schema still requires `audit_log.entity_id uuid`, while `logAuthEvent()` writes `entity: "auth"` and sometimes `entity_id: "system"`.
3. The current entity/action checks also exclude auth entities and exclude `booking.cancelled`, so some inserts are likely rejected systematically.
4. Blast radius: core actions still succeed, but login failures, lockouts, session expiries, role changes, password resets, and booking cancellations can disappear from the audit trail, leaving security and incident review blind exactly where failure-path evidence is needed.
# Spec Trace Audit: Booking Security Hardening

Date: 2026-04-14

## Verdict

No. The spec covers the critical direct-insert issue, but it does not fully close every critical/high risk raised by the review set.

- `CR-1` is addressed by Change 1 in the spec ([design spec](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-14-booking-security-hardening-design.md:28), [adversarial review](/Users/peterpitcher/Cursor/BARONS-BaronsHub/tasks/codex-qa-review/2026-04-14-turnstile-nonce-fix-adversarial-review.md:47)).
- `ID-1` is only partially addressed. Change 2 fixes the booking intent, but its shared-helper design breaks the current auth fail-soft contract for missing-token / missing-secret paths ([design spec](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-14-booking-security-hardening-design.md:53), [src/actions/auth.ts:88](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/auth.ts:88), [src/actions/auth.ts:225](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/auth.ts:225), [src/lib/turnstile.ts:6](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/turnstile.ts:6)).
- `ID-3` is only partially addressed. Change 3 limits abuse, but an action-level pre-count is not atomic and does not eliminate rapid duplicate/race submissions ([design spec](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-14-booking-security-hardening-design.md:87), [workflow report](/Users/peterpitcher/Cursor/BARONS-BaronsHub/tasks/codex-qa-review/2026-04-14-turnstile-nonce-fix-workflow-failure-path-report.md:6)).

## Trace Matrix

| Review finding | Severity | Spec change | Assessment |
|---|---|---|---|
| `CR-1` anonymous direct insert bypass | Critical | Change 1 ([spec:28-51](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-14-booking-security-hardening-design.md:28)) | Addressed. The current booking path already uses `createSupabaseAdminClient()` and the `create_booking` RPC; revoking anon `INSERT` should not break it ([src/lib/bookings.ts:44](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/bookings.ts:44), [20260313000000_event_bookings.sql:79](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260313000000_event_bookings.sql:79), [20260410120000_harden_security_definer_rpcs.sql:23](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260410120000_harden_security_definer_rpcs.sql:23)). |
| `ID-1` Turnstile fail-open | High | Change 2 ([spec:53-85](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-14-booking-security-hardening-design.md:53)) | Partially addressed. Booking-side intent is right, but the shared `verifyTurnstile()` change is not safely specified for all callers. |
| `ID-2` max tickets only client-side | Medium | Change 4 ([spec:122-152](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-14-booking-security-hardening-design.md:122)) | Addressed in principle, but the spec does not name the privileged client/RPC path that must perform the lookup. |
| `ID-3` no double-booking protection | High | Change 3 ([spec:87-120](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-14-booking-security-hardening-design.md:87)) | Partially addressed. A count-before-insert cap reduces abuse, but it is not an idempotency guarantee and is race-prone. |
| `AI-1` in-memory limiter ineffective at scale | Medium | Out of Scope ([spec:173-178](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-14-booking-security-hardening-design.md:173)) | Not addressed. That becomes more serious because Change 2 relies on rate limiting during Turnstile fallback. |
| `WF-1` pre-Turnstile-load submission window | Low | Change 2 | Mostly addressed if booking truly rejects missing tokens. Today’s spec does not yet preserve auth fail-soft while doing that. |
| `WF-2` no expiry/error callbacks | Low | Out of Scope | Explicitly left out. Reasonable as a separate UX item. |
| `SD-1` public booking page lacks status gate | Medium in adversarial review, High in security/data report | Change 5 ([spec:154-171](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-14-booking-security-hardening-design.md:154)) | Only partially addressed. The page is gated, but the server action/RPC path is not. |

## Gaps

1. Change 2 does not safely handle all `verifyTurnstile()` callers.

The spec says auth should preserve fail-soft by treating `"fallback"` as truthy ([spec:77-85](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-14-booking-security-hardening-design.md:77)). That is insufficient. `src/actions/auth.ts` currently does only `if (!turnstileValid)` on the helper result ([src/actions/auth.ts:89](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/auth.ts:89), [src/actions/auth.ts:226](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/auth.ts:226)). If the helper is changed globally so “no token” and “no secret in production” return `false` ([spec:63-65](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-14-booking-security-hardening-design.md:63)), auth becomes fail-closed on those paths. The spec needs either:

- a booking-specific verifier wrapper, or
- a caller policy parameter such as `mode: "strict" | "fail_soft"`.

2. Change 3 is ambiguous about client choice and can fail under RLS if implemented literally.

The pseudocode uses an unspecified `supabase` client for `event_bookings` count reads ([spec:92-105](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-14-booking-security-hardening-design.md:92)). In the current codebase, the booking path uses `createSupabaseAdminClient()` and the `create_booking` RPC ([src/lib/bookings.ts:44](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/bookings.ts:44)). If someone wires that count query through the normal server anon/readonly client, RLS blocks `SELECT` on `event_bookings` for public callers ([20260313000000_event_bookings.sql:51](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260313000000_event_bookings.sql:51), [20260410120002_tighten_event_bookings_rls.sql:10](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260410120002_tighten_event_bookings_rls.sql:10)).

3. Change 5 closes the page leak, not the booking capability.

The security/data report explicitly noted that the looser public-status rule also exists in `create_booking` itself ([security/data report:21-25](/Users/peterpitcher/Cursor/BARONS-BaronsHub/tasks/codex-qa-review/2026-04-14-turnstile-nonce-fix-security-data-risk-report.md:21)). The spec only adds `notFound()` on `/l/[slug]` ([spec:159-166](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-14-booking-security-hardening-design.md:159)). If an attacker knows an event UUID and can call the public server action directly, the action/RPC path still needs a server-side `approved|completed` check.

4. Change 3 does not fully resolve the workflow report’s duplicate-booking race.

The workflow report’s high-severity issue is rapid repeated submits creating multiple confirmed rows ([workflow report:6](/Users/peterpitcher/Cursor/BARONS-BaronsHub/tasks/codex-qa-review/2026-04-14-turnstile-nonce-fix-workflow-failure-path-report.md:6)). An action-side `count >= 3` gate allows concurrent requests to pass the check before any insert commits. It also intentionally allows up to three same-mobile bookings, so it is not a true fix for “double-submit creates duplicate booking” behavior. If the intended control is “cap abuse at 3,” the spec should say that explicitly. If the intended control is “prevent duplicate rapid submits,” the check must move into the RPC/DB layer or use idempotency.

5. The fallback design depends on an out-of-scope control that is currently weak.

Change 2 says network failure should fall back to a stricter rate limit instead of blocking ([spec:71-75](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-14-booking-security-hardening-design.md:71)). But the only current limiter is the in-memory per-process limiter flagged as ineffective at scale ([adversarial review:81-86](/Users/peterpitcher/Cursor/BARONS-BaronsHub/tasks/codex-qa-review/2026-04-14-turnstile-nonce-fix-adversarial-review.md:81), [security/data report:33-37](/Users/peterpitcher/Cursor/BARONS-BaronsHub/tasks/codex-qa-review/2026-04-14-turnstile-nonce-fix-security-data-risk-report.md:33)). If fallback is part of this hardening plan, a shared limiter or DB-backed degraded-mode control should be in scope.

6. The spec does not address the low-severity internal-ID exposure finding.

The security/data report called out public exposure of `event.id` and the unused returned `bookingId` ([security/data report:45-49](/Users/peterpitcher/Cursor/BARONS-BaronsHub/tasks/codex-qa-review/2026-04-14-turnstile-nonce-fix-security-data-risk-report.md:45)). The spec only marks `bookingId` removal as cosmetic out of scope ([spec:178](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-14-booking-security-hardening-design.md:178)) and does not revisit `event.id`. That is acceptable as low severity after Change 1, but it is still a gap relative to the full reviewer set.

## Contradictions

1. The spec says auth-page fail-soft remains unchanged, while also changing shared helper semantics globally.

- “auth-page fail-soft remain unchanged” is a success criterion ([spec:26](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-14-booking-security-hardening-design.md:26)).
- Change 2 says `verifyTurnstile()` itself now returns `false` for missing token and for missing secret in production ([spec:63-65](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-14-booking-security-hardening-design.md:63)).
- Current auth callers do not distinguish those cases; they only reject falsy ([src/actions/auth.ts:89](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/auth.ts:89), [src/actions/auth.ts:226](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/auth.ts:226)).

2. “The change only affects the booking action’s interpretation of the result” is not true as written.

The helper signature and semantics are explicitly changed for every caller ([spec:69](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-14-booking-security-hardening-design.md:69)). That is a shared contract change, not just a booking-action interpretation change.

3. The spec’s pseudocode does not match the current public-booking data-access pattern.

The current booking flow is already privileged: it uses `createSupabaseAdminClient()` and a service-role-only RPC ([src/lib/bookings.ts:44](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/bookings.ts:44), [20260410120000_harden_security_definer_rpcs.sql:26](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260410120000_harden_security_definer_rpcs.sql:26)). The spec should not imply ordinary server anon reads where the codebase pattern is privileged server reads plus explicit public gating.

## Missing Requirements

1. The spec should require caller-scoped Turnstile behavior, not a single global helper behavior.
2. The spec should require `approved|completed` enforcement in the server action or `create_booking` RPC, not only in the page render.
3. The spec should require the duplicate-cap logic to be atomic if it is meant as a security control.
4. The spec should require privileged client usage for the new `event_bookings` and `events` reads, or move those checks into the RPC.
5. The spec should add tests for:
   - auth submit with missing token after the helper change;
   - direct server-action booking attempt against a non-public event;
   - concurrent duplicate submissions near the mobile cap;
   - degraded Turnstile fallback under multi-instance assumptions, or a replacement fallback control.

## Out of Scope Review

`Replacing the in-memory rate limiter with Redis/Upstash` should not stay out of scope if the product requirement is “graceful fallback during Cloudflare outages” ([spec:21](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-14-booking-security-hardening-design.md:21), [spec:175](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-14-booking-security-hardening-design.md:175)). Either:

- bring an authoritative fallback limiter into scope, or
- change the fallback design to fail closed instead of relying on a weak limiter.

The other out-of-scope items are acceptable as written:

- Turnstile `expired-callback` / `error-callback`: low-severity UX follow-up.
- CSP `strict-dynamic`: separate hardening track, not required to close the booking defects.
- Removing `bookingId`: cosmetic/cleanup.

## Specific Challenge Answers

1. Change 2 and `src/actions/auth.ts`: the spec does not fully handle the type/semantic change for all callers. Treating only `"fallback"` as truthy is not enough; auth also needs a policy for missing-token and missing-secret cases.
2. Change 3 and RLS: the count query must use `createSupabaseAdminClient()` or live inside the RPC. If it uses an anon/readonly server client, RLS will block `SELECT` on `event_bookings`.
3. Change 1 and `create_booking`: yes, `create_booking` is `SECURITY DEFINER`, and execution is further restricted to `service_role`. Revoking anon `INSERT` should not break the current booking flow because the flow already uses the privileged RPC path rather than direct anon inserts.

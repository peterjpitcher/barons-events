# Discovery — Weekly digest reports "0 to-dos" when users have many

**Date:** 2026-06-09 · **Reporter:** client (Harry Smith example) · **Status:** root cause confirmed, fix pending approval

## Symptom

Harry Smith's "Your weekly BaronsHub update" email (sent 09:01 BST, 09 Jun 2026) showed
**0 TOTAL SOP ITEMS** and *"No open to-dos. Nice work, you are all caught up."* — but the
planning view shows him with **39 open** (in fact 435 open in the database).

## Root cause (confirmed)

`sendMandatoryWeeklyUpdateEmail()` in [src/lib/notifications.ts:1882](src/lib/notifications.ts) fetches
**every** to-do for **every** user in two queries and then groups them by user in JavaScript:

- `planning_task_assignees` join — [notifications.ts:1936](src/lib/notifications.ts) — **no `.limit()`, no `.range()`, no `.order()`**
- legacy `planning_tasks` — [notifications.ts:1946](src/lib/notifications.ts) — same, plus `.eq("status","open")`

Supabase/PostgREST caps an un-ranged response at **1000 rows**. Live row counts right now:

| Query | Global rows | Distinct users | Harry's rows |
|---|---|---|---|
| assignee-join (Query A) | **11,068** | 14 | 706 (435 open) |
| legacy `planning_tasks` (Query B) | **3,707** | 9 | 435 open |

Both queries return an **arbitrary, unordered 1,000-row slice**. The code groups that slice by
user; any user whose rows fell outside the slice gets an empty to-do list and the "all caught up"
message. In my `LIMIT 1000` replay the assignee-join slice covered only **4 of 14 users and zero
of Harry's rows**.

### Proof it is truncation (independent of the cap value)
At send time Harry was eligible (he received the email; `skipped_assignees` = 0 in the run log) and
has **91 tasks** that pass every in-code filter (open, non-null `due_date`, due ≤ today+14, valid
`planning_item`). The only way his section renders empty is if those rows never arrived from the
query — i.e. the response was truncated server-side. Run log confirms today's send:
`audit_log` entity=`digest`, `2026-06-09T08:00:53Z`, `{sent:19, failed:0, skipped_assignees:0}`.

### The fix already exists in the same file
The **daily** to-do digest (`fetchDigestRows`, [notifications.ts:2200](src/lib/notifications.ts))
wraps the identical queries in a `.range()` pagination loop with `pageSize = 1000` — it pages until a
short page returns, so it never truncates. The **weekly** function simply does not use it; it calls
the queries raw inside `Promise.all`. This is an oversight introduced when the weekly function landed
(commit `662b8d5`, 04 Jun), not a regression in older code.

## Hypotheses ruled out
- **Date filter excluding overdue** — NO. Line 1998 only rejects `due_date > today+14`; overdue tasks pass. (This was my first hunch from the Apr/May dates; the code disproves it.)
- **Blocked tasks ("Waiting on: Setup Event")** — NO. `is_blocked` is never referenced; blocked tasks are included.
- **Role / venue scope** — NO. To-dos are purely per-assignee; no scope filter. (Harry's role is now `manager` after commit `217b692`, but the digest doesn't gate on role.)
- **Tuesday-only gate / weekly idempotency** — NO. Harry received the email, so neither gate blocked him.
- **Assignee mismatch (multi-assignee)** — NO. Both `assignee_id` and the `planning_task_assignees` join are used; Harry is linked via both.

## Blast radius
This is **not Harry-specific**. 9 of the 19 recipients have qualifying open to-dos; an unpredictable
subset of them receives empty or under-counted lists **every Tuesday**, and the victims change run to
run because the slice is unordered. The daily digest is unaffected.

## Recommended fix (minimal, matches existing pattern)
1. Hoist `fetchDigestRows` to module scope (or add the same `.range()` loop) and use it for the two
   task queries in `sendMandatoryWeeklyUpdateEmail` — mirrors the daily digest exactly.
2. Optional hardening: push `due_date <= todoDueLimit` (and the open-status filter on the join query)
   into the SQL so the paginated set is far smaller and cheaper.
3. Add a regression test that asserts a user with >1000 global sibling rows still gets their tasks
   (mock the admin client to require `.range()` / return a >1000-row dataset).

## Remediation for today's bad emails (needs explicit approval — outward-facing)
Re-sending corrected emails to the ~9 affected users requires resetting `weekly_digest_last_sent_on`
for them (the function skips anyone already sent this ISO week) and re-running the send. This emails
real staff, so do not do it without sign-off.

## Files
- Buggy: [src/lib/notifications.ts:1882-2160](src/lib/notifications.ts) (`sendMandatoryWeeklyUpdateEmail`), queries at 1936 & 1946.
- Working reference: `fetchDigestRows` at [src/lib/notifications.ts:2200](src/lib/notifications.ts).
- Cron entry: `src/app/api/cron/weekly-digest/route.ts`.

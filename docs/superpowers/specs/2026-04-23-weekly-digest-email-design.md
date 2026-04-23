# Weekly Digest Email

**Date:** 2026-04-23
**Complexity:** S (2) — 4-5 files, no schema changes, established patterns
**Replaces:** `sendWeeklyPipelineSummaryEmail` (dead code, no cron route, no consumers)
**Reviewed:** Codex adversarial review 2026-04-23 (3 reviewers, 6 revisions applied)

## Purpose

A twice-weekly operational email that drives action on open tasks and provides awareness of upcoming events. Sent every Monday and Thursday at 8am UTC (9am BST in summer, 8am GMT in winter) to anyone with at least one open, current planning task assigned to them.

## Requirements

### Recipients

- The recipient set is the **intersection** of task assignee IDs and active users: only users present in the `users` table with `deactivated_at IS NULL` and a valid email receive the digest
- Tasks assigned to deactivated or missing users are silently skipped; the skipped assignee count is logged
- No role filtering — the task assignment itself determines eligibility
- No opt-out mechanism — this is an operational email
- Users with zero qualifying tasks on a given send day receive no email

### Content — Primary: Open Tasks

All `planning_tasks` where:
- `status = 'open'` (the only non-terminal status; `done` is terminal; `not_required` is application-level and sets status to `done` with `completed_at`)
- `due_date <= todayLondon` (excludes future-dated tasks; `due_date` is `NOT NULL` in schema)
- `assignee_id` is not null

**Date computation:** `todayLondon` is computed using `getTodayIsoDate()` from `src/lib/datetime.ts`, which uses `Europe/London` timezone. This ensures correct due-date comparison across BST/GMT transitions.

**Task visibility is assignment-based, not venue-scoped.** A venue-linked office worker sees all tasks assigned to them, even if some tasks belong to events at other venues. Venue scoping only applies to the upcoming events section.

**Grouping:** Tasks grouped by their parent `planning_item_id`. Each group heading shows the planning item title. If the planning item is linked to an event, the event title is shown as additional context (e.g. "Planning Item Title — for Event Title"), but each planning item remains a separate group. Tasks from different planning items are never merged, even when linked to the same event.

**Sorting:** Groups ordered by earliest due date within the group. Within each group, overdue tasks (`due_date < today`) sorted first with a warning marker. Each task shows title and due date.

**Defensive cap:** Show a maximum of 50 tasks per recipient. If more exist, append "and X more — view in BaronsHub" with a link to the planning board.

### Content — Secondary: Upcoming Events

Events in the next 4 days from the time of send:
- `start_at >= NOW()` and `start_at < NOW() + 4 days`
- `status IN ('approved', 'submitted')`
- `deleted_at IS NULL`

Venue scoping (applied per recipient):
- Users with `venue_id` set on their profile: only events at that venue
- Users without `venue_id` (administrators, executives, unscoped office workers): all events across all venues

No cap on event count — show all that match. **If the recipient's venue-filtered event list is empty, omit the events section for that recipient.**

Events ordered by `start_at` ascending. Each shows: title, venue name, formatted date/time via `formatEventWindow`.

### Email Layout

```
Subject: Your BaronsHub digest — X open tasks

Headline: Your weekly digest
Intro: Here's what needs your attention this week.

--- Primary: Tasks ---

📋 [Planning Item Title] — for [Event Title]
  • Task title — due Mon 21 Apr
  • Task title — due Fri 18 Apr ⚠️ (overdue)

📋 [Planning Item Title]
  • Task title — due Wed 23 Apr

(if > 50 tasks: "and X more — view in BaronsHub")

--- Secondary: Events (if any for this recipient) ---

Coming up in the next 4 days:
  • Event Title — Venue Name, Mon 28 Apr 6:00 PM
  • Event Title — Venue Name, Tue 29 Apr 7:30 PM

--- Button ---
[Open BaronsHub] → planning board URL

--- Footer ---
Standard branded footer, no unsubscribe link.
```

Rendered via the existing `renderEmailTemplate({ headline, intro, body, button })`.

### Schedule

Two Vercel cron entries: `0 8 * * 1,4` (Monday + Thursday at 8am UTC = 9am BST / 8am GMT).

Single cron route serves both days — same content logic, no day-of-week variation.

### Idempotency

To prevent duplicate sends on Vercel cron retries or overlapping invocations:
- Before sending, check `audit_log` for `entity = 'digest'`, `entity_id = 'YYYY-MM-DD'` (today's date), `action = 'batch_sent'`
- If found, return early with `{ success: true, skipped: "already_sent" }`
- After all sends complete, log one audit row: `entity = 'digest'`, `entity_id = 'YYYY-MM-DD'`, `action = 'batch_sent'`, `meta = { sent: N, failed: M, skipped_assignees: K }`
- Requires adding `digest` to the `audit_log.entity` CHECK constraint via migration

## Architecture

### Approach: Batch query + fan-out

Three bulk queries upfront, then in-memory grouping per user.

**Query 1 — All open current tasks:**
```
supabase (service-role)
  .from("planning_tasks")
  .select("id, title, due_date, assignee_id, planning_item:planning_items(id, title, event:events(id, title, venue_id))")
  .eq("status", "open")
  .lte("due_date", todayLondon)
  .not("assignee_id", "is", null)
```

**Query 2 — Upcoming events (next 4 days):**
```
supabase (service-role)
  .from("events")
  .select("id, title, start_at, end_at, venue_id, venue:venues!events_venue_id_fkey(name)")
  .gte("start_at", nowIso)
  .lt("start_at", fourDaysFromNowIso)
  .in("status", ["approved", "submitted"])
  .is("deleted_at", null)
  .order("start_at", { ascending: true })
```

**Query 3 — All active users (for venue_id + email):**
```
supabase (service-role)
  .from("users")
  .select("id, email, full_name, venue_id")
  .is("deactivated_at", null)
```

### Preflight failure handling

If any of the three queries fail, abort the cron immediately with a non-2xx response. No partial sends on incomplete data. Return `{ success: false, error: "<query name> failed: <message>" }`.

### In-memory processing

1. Build active-user map from Query 3 (keyed by `id`)
2. Group tasks by `assignee_id` — filter to only assignees present in the active-user map (log skipped count)
3. For each recipient, group their tasks by `planning_item_id` — display heading is planning item title, with event title as context if linked
4. Sort groups by earliest due date; within groups sort overdue first
5. Cap at 50 tasks per recipient; if more, append overflow message
6. Filter events (Query 2) by user's `venue_id` (if set) or include all (if null)
7. If recipient has zero events after filtering, omit events section
8. Render email via `renderEmailTemplate`
9. Send via Resend

**Error handling:** Follow existing fire-and-audit pattern from SLT emails — log errors per recipient but don't abort the batch. After all sends, log the idempotency audit row. Return `{ success: true, sent: N, failed: M }` from the cron route.

## File Changes

| Action | File | Description |
|--------|------|-------------|
| Create | `src/app/api/cron/weekly-digest/route.ts` | GET handler, `verifyCronSecret` auth, calls `sendWeeklyDigestEmail()` |
| Edit | `src/lib/notifications.ts` | Add `sendWeeklyDigestEmail()`, delete `sendWeeklyPipelineSummaryEmail()` |
| Edit | `vercel.json` | Add `{ "path": "/api/cron/weekly-digest", "schedule": "0 8 * * 1,4" }` |
| Create | `src/lib/__tests__/weekly-digest.test.ts` | Tests for grouping logic, venue scoping, empty-state skipping |
| Create | `supabase/migrations/YYYYMMDD_audit_entity_digest.sql` | Add `digest` to `audit_log.entity` CHECK constraint |

## Testing Strategy

- **Unit tests** for the in-memory grouping/scoping logic (extracted as a pure function):
  - User with tasks + events at their venue → both sections rendered
  - User with tasks + no upcoming events at their venue → events section omitted
  - User with no tasks → not in recipient list (no email)
  - Venue-scoped user only sees their venue's events
  - Unscoped user sees all events
  - Overdue tasks sorted first with warning marker
  - Tasks grouped by planning_item_id, each as separate group even when sharing an event
  - Event title shown as context on event-linked planning item groups
  - Task assigned to deactivated user → skipped, not in recipient list
  - More than 50 tasks → capped with overflow message
  - Idempotency: second invocation same day → skipped with `already_sent`
- **Mock Resend + Supabase** — never hit real APIs
- **Cron route test** — verifies `verifyCronSecret` is called, returns correct response shape
- **Preflight failure test** — query failure returns non-2xx, no emails sent

## Out of Scope

- Notification preferences / opt-out infrastructure
- Email open/click tracking
- Different content for Monday vs Thursday
- Mobile push notifications
- Digest for customers (this is staff-only)
- Venue scoping on tasks (assignment is the source of truth)

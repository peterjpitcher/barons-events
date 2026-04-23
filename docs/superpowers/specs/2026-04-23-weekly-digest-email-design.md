# Weekly Digest Email

**Date:** 2026-04-23
**Complexity:** S (2) — 4-5 files, no schema changes, established patterns
**Replaces:** `sendWeeklyPipelineSummaryEmail` (dead code, no cron route)

## Purpose

A twice-weekly operational email that drives action on open tasks and provides awareness of upcoming events. Sent every Monday and Thursday at 8am UTC (9am BST in summer, 8am GMT in winter) to anyone with at least one open, current planning task assigned to them.

## Requirements

### Recipients

- Any active user (`deactivated_at IS NULL`) who has at least one qualifying open task
- No role filtering — the task assignment itself determines eligibility
- No opt-out mechanism — this is an operational email
- Users with zero qualifying tasks on a given send day receive no email

### Content — Primary: Open Tasks

All `planning_tasks` where:
- `status = 'open'` (excludes `done` and `not_required`)
- `due_date <= CURRENT_DATE` (excludes future-dated tasks)
- `assignee_id` is not null

Tasks grouped by their parent `planning_item` title. If the planning item is linked to an event, show the event title as the group heading instead. Within each group, overdue tasks (due_date < today) sorted first with a warning marker. Each task shows title and due date.

### Content — Secondary: Upcoming Events

Events in the next 4 days from the time of send:
- `start_at >= NOW()` and `start_at < NOW() + 4 days`
- `status IN ('approved', 'submitted')`
- `deleted_at IS NULL`

Venue scoping:
- Users with `venue_id` set on their profile: only events at that venue
- Users without `venue_id` (administrators, executives, unscoped office workers): all events across all venues

No cap on event count — show all that match. If no events match, omit the section entirely.

Events ordered by `start_at` ascending. Each shows: title, venue name, formatted date/time via `formatEventWindow`.

### Email Layout

```
Subject: Your BaronsHub digest — X open tasks

Headline: Your weekly digest
Intro: Here's what needs your attention this week.

--- Primary: Tasks ---

📋 [Planning Item Title] (or event title if event-linked)
  • Task title — due Mon 21 Apr
  • Task title — due Fri 18 Apr ⚠️ (overdue)

📋 [Another Planning Item]
  • Task title — due Wed 23 Apr

--- Secondary: Events (if any) ---

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

## Architecture

### Approach: Batch query + fan-out

Two bulk queries upfront, then in-memory grouping per user.

**Query 1 — All open current tasks:**
```
supabase (service-role)
  .from("planning_tasks")
  .select("id, title, due_date, assignee_id, planning_item:planning_items(id, title, event:events(id, title, venue_id))")
  .eq("status", "open")
  .lte("due_date", todayIso)
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

**In-memory processing:**
1. Group tasks by `assignee_id` → this gives the recipient set
2. For each recipient, further group their tasks by planning item (event title if event-linked, otherwise planning item title)
3. Sort groups by earliest due date; within groups sort overdue first
4. Filter events by user's `venue_id` (if set) or include all (if null)
5. Render email via `renderEmailTemplate`
6. Send via Resend

**Error handling:** Follow existing fire-and-audit pattern from SLT emails — log errors per recipient but don't abort the batch. Return `{ success: true, sent: N, failed: M }` from the cron route.

## File Changes

| Action | File | Description |
|--------|------|-------------|
| Create | `src/app/api/cron/weekly-digest/route.ts` | GET handler, `verifyCronSecret` auth, calls `sendWeeklyDigestEmail()` |
| Edit | `src/lib/notifications.ts` | Add `sendWeeklyDigestEmail()`, delete `sendWeeklyPipelineSummaryEmail()` |
| Edit | `vercel.json` | Add `{ "path": "/api/cron/weekly-digest", "schedule": "0 8 * * 1,4" }` |
| Create | `src/lib/__tests__/weekly-digest.test.ts` | Tests for grouping logic, venue scoping, empty-state skipping |

## Testing Strategy

- **Unit tests** for the in-memory grouping/scoping logic (extracted as a pure function):
  - User with tasks + events at their venue → both sections rendered
  - User with tasks + no upcoming events → events section omitted
  - User with no tasks → not in recipient list (no email)
  - Venue-scoped user only sees their venue's events
  - Unscoped user sees all events
  - Overdue tasks sorted first with warning marker
  - Tasks grouped correctly by planning item / event title
- **Mock Resend + Supabase** — never hit real APIs
- **Cron route test** — verifies `verifyCronSecret` is called, returns correct response shape

## Out of Scope

- Notification preferences / opt-out infrastructure
- Email open/click tracking
- Different content for Monday vs Thursday
- Mobile push notifications
- Digest for customers (this is staff-only)

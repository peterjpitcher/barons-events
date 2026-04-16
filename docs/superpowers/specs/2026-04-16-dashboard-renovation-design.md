# Dashboard Renovation Design Spec

**Date:** 2026-04-16
**Status:** Approved (revised after adversarial review)
**Scope:** Full renovation of `/` (dashboard) page with unified personal todo list as centrepiece

## Overview

Replace the current role-split dashboard with a command centre layout. The hero component is a unified todo list that aggregates actionable items from across the system (planning tasks, SOP tasks, review queue, events needing revisions, debriefs needed) into a single urgency-grouped checklist. Supporting context cards sit alongside in a 60/40 split.

No new database tables are required. All data comes from existing tables and queries.

## Layout

**Desktop (lg+):** 60/40 two-column command centre.
- **Header:** Role-specific greeting + date (left), compact alert badges with counts (right). Badges use icon + colour + text for colourblind accessibility: "▲ 3 overdue" (red + triangle), "● 7 due soon" (amber + circle).
- **Left column (60%):** `UnifiedTodoList` component — personal todo list grouped by urgency, with source filter tabs.
- **Right column (40%):** Stacked context cards. Content varies by role (see Context Panel Cards section).

**Mobile (<lg):** Single column. Todo list first, context cards stacked below.

## Todo List Component

### Component: `UnifiedTodoList`

New client component at `src/components/todos/unified-todo-list.tsx`. Replaces `planning-todos-by-person-view.tsx` across both dashboard and planning board. Shared todo components live in `src/components/todos/` (neutral namespace — avoids planning depending on dashboard). Dashboard-only context cards live in `src/components/dashboard/`.

### Data Sources

| Source | Condition | Title | Subtitle | Checkable? | Action |
|--------|-----------|-------|----------|------------|--------|
| Planning tasks | current user in `assignees[]` OR `assigneeId`, status = open | Task title | "Planning Task · {venue} · Due {date}" | Per-item `canToggle` | View → planning item |
| SOP tasks | current user in `assignees[]` OR `assigneeId`, status = open, has `sopSection` or `sopTemplateTaskId` | Task title | "SOP Task · {venue} · Due {date}" | Per-item `canToggle` | View → planning item |
| Review queue | assigned to me or admin sees all submitted/needs_revisions | Event title | "Review Queue · {venue} · {start_at date}" | No | View → event detail |
| My events needing revisions | created_by = me, status = needs_revisions | Event title | "Your Event · {venue} · Needs revisions" | No | View → event detail |
| Debriefs needed | approved events past end_at, no debrief record, scoped to user's created/assigned events (or venue for office_worker) | "Submit debrief for {event}" | "Debrief · {venue} · Ended {end_at date}" | No | View → debrief page |

**Note:** Planning tasks and SOP tasks are both stored in the `planning_tasks` table. SOP tasks are distinguished by having a non-null `sop_section` or `sop_template_task_id`. Assignment must check both the legacy `assigneeId` field AND the `planning_task_assignees` junction table (`assignees[]` array) to avoid silently missing multi-assigned tasks.

### Urgency Grouping

- **Overdue:**
  - Planning/SOP tasks: `dueDate < today`
  - Review queue: event `start_at < today` (review needed for event already started/passed)
  - Revisions: event `start_at < today` (event already started but still needs fixes)
  - Debriefs: event `end_at` more than 7 days ago with no debrief submitted
- **Due This Week:**
  - Planning/SOP tasks: `dueDate` between today and today + 7 days
  - Review queue: event `start_at` between today and today + 7 days
  - Revisions: event `start_at` between today and today + 7 days
  - Debriefs: event `end_at` within the last 7 days
- **Later:** everything else. Collapsed by default, expandable with "Show N more tasks..."

### Filter Tabs

Inline filter tabs at the top of the todo card: All (default), Planning, Reviews, Debriefs, SOP. Each shows a count. **Zero-count tabs are hidden.** Filtering is client-side — all data fetched once.

### Data Volume Caps

Each urgency section shows a maximum of 10 items, with a "Show N more" expander when exceeded. The Later section remains collapsed by default. Fetch limits per source: planning/SOP tasks capped at 50, review queue at 20, debriefs at 10, revisions at 10. Empty urgency sections do not render.

### Interactions

- **Checkbox** (planning/SOP tasks only where `canToggle` is true): calls `togglePlanningTaskStatusAction` with optimistic update. The client call must be wrapped in `try/catch/finally` — auth/permission throws can bypass `{ success: false }` returns. On failure, the checkbox reverts and a Sonner toast appears. On success, `router.refresh()` is called.
- **"View →" link:** navigates to the relevant page (event detail, debrief form, planning item). Links are constructed from validated UUIDs/path segments only — never from arbitrary user input.
- **Inline expand:** click a row to reveal context — parent planning item title, event name, due date reasoning (e.g. "T-minus 5 days from event on 22 Apr").

### Two Modes (Discriminated Union Props)

The component serves both dashboard and planning board via a discriminated union:

```typescript
type UnifiedTodoListProps =
  | {
      mode: "dashboard";
      items: TodoItem[];
      currentUserId: string;
    }
  | {
      mode: "planning";
      items: TodoItem[];
      currentUserId: string;
      users: PlanningPerson[];
      alertFilter?: TodoAlertFilter;
      onOpenPlanningItemId?: (planningItemId: string) => void;
    };
```

**`mode: "dashboard"`**
- Single user (current user) only
- Mixed sources (planning, SOP, reviews, debriefs, revisions)
- Urgency-grouped sections
- Source filter tabs with counts
- Inline expand for task context

**`mode: "planning"`**
- All users, grouped by person (current user first, alphabetical, "TBD" last)
- Planning and SOP tasks only
- Same urgency grouping within each person's section
- Collapsible person sections (current user expanded by default)
- Supports `alertFilter` prop for linking from alert strip badges
- "Show everyone" toggle
- `onOpenPlanningItemId` callback — PlanningBoard looks up the full PlanningItem from its data

### Shared Internals

- `TodoRow` — individual task row with conditional checkbox (rendered only when `canToggle` is true), title, subtitle, urgency badge, "View →" link, expandable detail. Mutation and routing policy passed via callbacks, not embedded in the row.
- `UrgencySection` — renders group header (Overdue/Due This Week/Later) and its rows, with "Show N more" expander
- `FilterTabs` — source filter tabs with counts (dashboard mode only), built on existing `Tabs` primitive

## Unified Todo Item Type

```typescript
type TodoSource = "planning" | "sop" | "review" | "revision" | "debrief";

type TodoItem = {
  id: string;
  source: TodoSource;
  title: string;
  subtitle: string;
  dueDate: string | null;         // YYYY-MM-DD (for reviews/revisions: derived from event start_at)
  urgency: "overdue" | "due_soon" | "later";
  canToggle: boolean;             // Computed server-side: admin OR parent item owner OR assigned user
  linkHref: string;               // Internal path only (e.g. /events/{id}, /planning)
  parentTitle?: string;           // For inline expand context
  venueName?: string;
  eventDate?: string;
  planningTaskId?: string;        // For checkable items — needed for toggle action
  planningItemId?: string;        // For planning mode — needed for open-item callback
  assigneeId?: string;            // For planning mode person grouping
  assigneeName?: string;          // For planning mode person grouping
};
```

## Data Fetching

### Server Component Architecture

`src/app/page.tsx` remains a server component. Fetches all data in parallel, passes to client components.

### New Function: `getDashboardTodoItems(user: AppUser)`

Location: `src/lib/dashboard.ts`

Aggregates all five sources into a unified `TodoItem[]` array. **Must NOT reuse `listPlanningBoardData`** — that function uses service-role client, loads broad data for the full planning window, and is too broad for a personal dashboard. Instead, `getDashboardTodoItems` runs narrow, user-scoped queries filtering by assignee in SQL (not client-side). Each source helper independently enforces role and venue permissions.

Internally isolates per-source failures: if the debrief query fails, planning/SOP/review todos still render. Returns `{ items: TodoItem[], errors: TodoSource[] }` so the UI can show partial results with an indication of which sources failed.

### Fetch Strategy

```typescript
const results = await Promise.allSettled([
  getDashboardTodoItems(user),
  listEventsForUser(user),
  ...getRoleSpecificFetches(user)
]);

// Each result is { status: 'fulfilled', value } or { status: 'rejected', reason }
// Context cards receive data | null and render inline error when null
```

`getRoleSpecificFetches` returns different promises per role:
- **Admin:** `getStatusCounts()`, `listReviewQueue(user)`, `findConflicts()`, `getDebriefsDue(user)`
- **Office Worker (with venueId):** venue-scoped booking stats, SOP progress for next event
- **Office Worker (without venueId):** upcoming events (all, no venue filter), no venue-specific cards
- **Executive:** `getExecutiveSummaryStats()`, `getRecentActivity()`

### New Queries Needed

All are Supabase queries against existing tables. No schema changes.

1. **`getDebriefsDue(user: AppUser)`** — Events where `status = 'approved' AND end_at < now()` with no matching debrief record. Scoped: admin sees all; office_worker with venueId sees venue events; office_worker without venueId sees events they created; executive excluded (read-only). Limit: 10.

2. **`getExecutiveSummaryStats()`** — Events this month count, total confirmed bookings this month, debrief completion % (approved-or-completed events with debrief / total), events approved this week.

3. **`getRecentActivity(limit?: number)`** — Uses service-role client with a strict allowlist of safe audit actions: `event.approved`, `event.completed`, `event.debrief_updated`. Returns only: actor display name (joined from users table), safe action description, timestamp. **All `meta` fields, IPs, email hashes, and user agents are stripped.** Never expose raw audit_log rows to non-admin roles. Default limit: 10.

### Mapping Function for Planning Mode

`planningBoardDataToTodoItems(data: PlanningBoardData, currentUserId: string): TodoItem[]` — pure function in `src/lib/planning/utils.ts` that maps PlanningItem[] tasks to TodoItem[] for the planning board's todo tab. Reuses shared urgency classification logic.

## Context Panel Cards (Right Column)

All cards are server-rendered. No client interactivity — purely informational with navigation links. Uses existing `Card`/`CardHeader`/`CardContent` components. Each card receives `data | null` and renders an inline error message ("Couldn't load {card name}. Try refreshing.") when data is null.

### Admin

1. **Upcoming Events** — Next 4 events: title, date, venue, ticket count. "View all →" links to `/events`.
2. **Pipeline** — 3-column grid: Draft, Submitted, Approved counts.
3. **Conflicts** — Warning-styled, one line per conflict pair. Links to event detail.
4. **Debriefs Outstanding** — Count badge + event name list. Links to `/debriefs`. **Hidden entirely when count = 0.**

### Office Worker (with venueId)

1. **Upcoming Events** — Venue-scoped. Shows ticket counts for booking-enabled events.
2. **Venue Booking Stats** — Confirmed bookings this week, total tickets, next event capacity %.
3. **SOP Progress** — For next upcoming event at their venue: checklist progress bar (e.g. "5/8 tasks done"), links to planning item.

### Office Worker (without venueId)

1. **Upcoming Events** — All events (no venue filter). No "New Event" button.
2. No venue-specific cards (no Venue Booking Stats, no SOP Progress).

### Executive

1. **Summary Stats** — 4-stat strip: events this month, total bookings, debrief completion %, events approved this week.
2. **Recent Activity** — Feed of last 10 safe actions: actor name, action description, timestamp. Secured via allowlisted audit actions with sensitive metadata stripped.
3. **Upcoming Events** — Same compact list as other roles.

## Revalidation

The `togglePlanningTaskStatusAction` must call `revalidatePath("/")` in addition to `revalidatePath("/planning")` so the dashboard refreshes after task completion. Other mutations that affect dashboard data must also add `revalidatePath("/")`:
- Debrief submission (`src/actions/debriefs.ts`)
- Event status changes — approve, reject, revert to draft (`src/actions/events.ts`)
- Booking creation/cancellation (`src/actions/bookings.ts`)

The dashboard accepts "stale until refresh" for cross-user changes (another user completes a task). No polling or real-time subscriptions.

## Checkbox Permission Model

Planning/SOP task checkboxes are governed by `canToggle`, computed server-side per item. A user can toggle a task if ANY of these conditions is true:
1. User is an administrator
2. User is the owner of the parent planning item (`planning_items.owner_id`)
3. User is assigned to the task (via `planning_task_assignees` junction OR legacy `planning_tasks.assignee_id`)

The `togglePlanningTaskStatusAction` server action must be updated to enforce this rule (currently only allows admin or parent item owner). The `canToggle` boolean is set during `getDashboardTodoItems` aggregation so the client never renders a checkbox that the server will reject.

## Error Handling, Loading & Empty States

### Loading

Existing `src/app/loading.tsx` for the page. Todo list and each context card render skeleton placeholders (pulsing grey bars matching layout shape).

### Empty States

| Component | Empty message |
|-----------|--------------|
| Todo list (zero items) | "You're all caught up. No tasks need your attention right now." (with checkmark icon). Suggest next action by role: admin → "Review the event pipeline", office_worker → "Create a new event", executive → "Check upcoming events". |
| Todo list (zero in filtered tab) | "No {source} tasks right now." with option to switch to All |
| Todo list (zero-count filter tabs) | Tabs with zero count are hidden, not shown as (0) |
| Empty urgency sections | Do not render — no empty Overdue/Due This Week/Later headers |
| Upcoming Events | "No upcoming events." + "New Event" button for admin/office_worker with venueId only |
| Conflicts | "No conflicts spotted." |
| Debriefs Outstanding | Card hidden entirely when count = 0 |
| Executive Activity feed | "No recent activity." |

### Error Handling

Top-level fetches use `Promise.allSettled`. Each context card receives `data | null` and renders an inline error message when null. `getDashboardTodoItems` internally catches per-source errors and returns partial results with a list of failed sources, so the todo list can render planning items even if the debrief query fails. A failed-source indicator appears at the bottom of the todo list (e.g. "Couldn't load debriefs. Try refreshing.").

Optimistic checkbox toggle is wrapped in `try/catch/finally`. On failure (including auth/permission throws), the checkbox reverts and a Sonner toast appears.

### Accessibility

- Urgency badges: icon + colour + text (▲ Overdue, ● Due Soon) — never colour alone
- Checkboxes: `aria-label` with task title
- Filter tabs: keyboard navigable
- "View →" links: `aria-label="View {task title}"`
- Urgency section headers: `role="heading"` for screen readers

## Files Created / Modified

### New Files
- `src/lib/dashboard.ts` — `getDashboardTodoItems()`, `getDebriefsDue()`, `getExecutiveSummaryStats()`, `getRecentActivity()`
- `src/components/todos/unified-todo-list.tsx` — Main component with both modes
- `src/components/todos/todo-row.tsx` — Individual task row
- `src/components/todos/urgency-section.tsx` — Urgency group rendering
- `src/components/todos/filter-tabs.tsx` — Source filter tabs
- `src/components/dashboard/context-cards/` — Right-column cards (upcoming-events, pipeline, conflicts, debriefs-outstanding, venue-booking-stats, sop-progress, summary-stats, recent-activity)

### Modified Files
- `src/app/page.tsx` — Full rewrite of dashboard page
- `src/app/planning/page.tsx` — No changes needed (PlanningBoard handles todo tab internally)
- `src/components/planning/planning-board.tsx` — Import `UnifiedTodoList` from `src/components/todos/`, map `PlanningItem[]` to `TodoItem[]` via new mapping function, pass `onOpenPlanningItemId` callback
- `src/lib/planning/utils.ts` — Add `planningBoardDataToTodoItems()` mapping function and shared `classifyTodoUrgency()` utility
- `src/actions/planning.ts` — Update `togglePlanningTaskStatusAction` to allow assigned users, add `revalidatePath("/")`
- `src/actions/debriefs.ts` — Add `revalidatePath("/")`
- `src/actions/events.ts` — Add `revalidatePath("/")` to approve/reject/revert actions

### Removed Files
- `src/components/planning/planning-todos-by-person-view.tsx` — Replaced by `UnifiedTodoList`

## Assumptions Requiring Confirmation

1. **Checkbox permission expansion:** The server action will be updated to allow assigned users to toggle their tasks (in addition to admin and parent item owner). If rejected, `canToggle` will be false for non-owner assignees and they'll see "View →" links instead of checkboxes.

2. **Debrief eligibility:** "Approved events past end_at without a debrief record" is the correct condition for debrief-due items. If the product wants a different lifecycle trigger, the query and urgency logic will need adjustment.

3. **Planning data visibility:** All roles can view planning (`canViewPlanning` returns true for all). In planning mode, all users' tasks are visible to everyone. This is treated as intentional operational visibility. If non-admins should only see their own tasks, the planning mode would need server-side filtering.

## Out of Scope

- Personal ad-hoc todos (no new database tables)
- Drag-and-drop reordering of todo items
- Real-time updates / polling (standard page refresh / revalidation)
- Dashboard customisation (widget arrangement, preferences)
- Pagination (caps + expanders are sufficient for expected data volumes)

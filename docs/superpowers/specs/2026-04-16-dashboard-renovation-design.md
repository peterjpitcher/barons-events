# Dashboard Renovation Design Spec

**Date:** 2026-04-16
**Status:** Approved
**Scope:** Full renovation of `/` (dashboard) page with unified personal todo list as centrepiece

## Overview

Replace the current role-split dashboard with a command centre layout. The hero component is a unified todo list that aggregates actionable items from across the system (planning tasks, SOP tasks, review queue, events needing revisions, debriefs needed) into a single urgency-grouped checklist. Supporting context cards sit alongside in a 60/40 split.

No new database tables are required. All data comes from existing tables and queries.

## Layout

**Desktop (lg+):** 60/40 two-column command centre.
- **Header:** Role-specific greeting + date (left), compact alert badges with counts (right). Badges use icon + colour + text for colourblind accessibility: "▲ 3 overdue" (red + triangle), "● 7 due soon" (amber + circle).
- **Left column (60%):** `UnifiedTodoList` component — personal todo list grouped by urgency, with source filter tabs.
- **Right column (40%):** Stacked context cards. Content varies by role (see Section 4).

**Mobile (<lg):** Single column. Todo list first, context cards stacked below.

## Todo List Component

### Component: `UnifiedTodoList`

New client component at `src/components/dashboard/unified-todo-list.tsx`. Replaces `planning-todos-by-person-view.tsx` across both dashboard and planning board.

### Data Sources

| Source | Condition | Title | Subtitle | Checkable? | Action |
|--------|-----------|-------|----------|------------|--------|
| Planning tasks | assignee = current user, status = open | Task title | "Planning Task · {venue} · Due {date}" | Yes | View → planning item |
| SOP tasks | assignee = current user, status = open | Task title | "SOP Task · {venue} · Due {date}" | Yes | View → planning item |
| Review queue | assigned to me or admin sees all submitted/needs_revisions | Event title | "Review Queue · {venue} · Due {date}" | No | View → event detail |
| My events needing revisions | created_by = me, status = needs_revisions | Event title | "Your Event · {venue} · Needs revisions" | No | View → event detail |
| Debriefs needed | my events or assigned, status = completed, no debrief record | "Submit debrief for {event}" | "Debrief · {venue} · Completed {date}" | No | View → debrief page |

### Urgency Grouping

- **Overdue:** task/event due date < today (for debriefs: event completed_at > 7 days ago with no debrief submitted)
- **Due This Week:** task/event due date between today and today + 7 days (for debriefs: event completed_at between 0 and 7 days ago)
- **Later:** everything else. Collapsed by default, expandable with "Show N more tasks..."

### Filter Tabs

Inline filter tabs at the top of the todo card: All (default), Planning, Reviews, Debriefs, SOP. Each shows a count. Filtering is client-side — all data fetched once.

### Interactions

- **Checkbox** (planning/SOP tasks only): calls `togglePlanningTaskStatus` with optimistic update + rollback on failure (toast notification via Sonner).
- **"View →" link:** navigates to the relevant page (event detail, debrief form, planning item).
- **Inline expand:** click a row to reveal context — parent planning item title, event name, due date reasoning (e.g. "T-minus 5 days from event on 22 Apr").

### Two Modes

The component serves both dashboard and planning board via a `mode` prop:

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

### Shared Internals

- `TodoRow` — individual task row with conditional checkbox, title, subtitle, urgency badge, "View →" link, expandable detail
- `UrgencySection` — renders group header (Overdue/Due This Week/Later) and its rows
- `FilterTabs` — source filter tabs with counts (dashboard mode only)

### Props

```typescript
interface UnifiedTodoListProps {
  mode: "dashboard" | "planning";
  items: TodoItem[];
  currentUserId: string;
  canEdit: boolean;
  alertFilter?: TodoAlertFilter;        // planning mode only
  onOpenPlanningItem?: (item: PlanningItem) => void; // planning mode only
}
```

## Unified Todo Item Type

```typescript
type TodoSource = "planning" | "sop" | "review" | "revision" | "debrief";

type TodoItem = {
  id: string;
  source: TodoSource;
  title: string;
  subtitle: string;
  dueDate: string | null;         // YYYY-MM-DD
  urgency: "overdue" | "due_soon" | "later";
  checkable: boolean;
  linkHref: string;
  parentTitle?: string;           // For inline expand context
  venueName?: string;
  eventDate?: string;
  planningTaskId?: string;        // For checkable items — needed for toggle action
};
```

## Data Fetching

### Server Component Architecture

`src/app/page.tsx` remains a server component. Fetches all data in parallel, passes to client components.

### New Function: `getDashboardTodoItems(user: AppUser)`

Location: `src/lib/dashboard.ts`

Aggregates all five sources into a unified `TodoItem[]` array. Calls existing query functions internally, maps results to `TodoItem` shape, computes urgency classification.

### Fetch Strategy

```typescript
const [todoItems, upcomingEvents, ...roleSpecificData] = await Promise.all([
  getDashboardTodoItems(user),
  listEventsForUser(user),
  ...getRoleSpecificFetches(user)
]);
```

`getRoleSpecificFetches` returns different promises per role:
- **Admin:** `getStatusCounts()`, `listReviewQueue(user)`, `findConflicts()`, `getDebriefsDue(user)`
- **Office Worker:** venue-scoped booking stats, SOP progress for next event
- **Executive:** `getExecutiveSummaryStats()`, `getRecentActivity()`

### New Queries Needed

All are simple Supabase queries against existing tables. No schema changes.

1. **`getDebriefsDue(user: AppUser)`** — Completed events without a debrief record, scoped to user's created/assigned events (or venue for office_worker).
2. **`getExecutiveSummaryStats()`** — Events this month count, total bookings this month, debrief completion %, events approved this week.
3. **`getRecentActivity(limit?: number)`** — Last N meaningful entries from audit_log (event.approved, event.completed, debrief submitted). Returns actor name, action description, timestamp.

## Context Panel Cards (Right Column)

All cards are server-rendered. No client interactivity — purely informational with navigation links. Uses existing `Card`/`CardHeader`/`CardContent` components.

### Admin

1. **Upcoming Events** — Next 4 events: title, date, venue, ticket count. "View all →" links to `/events`.
2. **Pipeline** — 3-column grid: Draft, Submitted, Approved counts.
3. **Conflicts** — Warning-styled, one line per conflict pair. Links to event detail.
4. **Debriefs Outstanding** — Count badge + event name list. Links to `/debriefs`.

### Office Worker

1. **Upcoming Events** — Venue-scoped. Shows ticket counts for booking-enabled events.
2. **Venue Booking Stats** — Confirmed bookings this week, total tickets, next event capacity %.
3. **SOP Progress** — For next upcoming event at their venue: checklist progress bar (e.g. "5/8 tasks done"), links to planning item.

### Executive

1. **Summary Stats** — 4-stat strip: events this month, total bookings, debrief completion %, events approved this week.
2. **Recent Activity** — Feed of last 10 actions: actor name, action, timestamp.
3. **Upcoming Events** — Same compact list as other roles.

## Error Handling, Loading & Empty States

### Loading

Existing `src/app/loading.tsx` for the page. Todo list and each context card render skeleton placeholders (pulsing grey bars matching layout shape).

### Empty States

| Component | Empty message |
|-----------|--------------|
| Todo list (zero items) | "You're all caught up. No tasks need your attention right now." (with checkmark icon) |
| Todo list (zero in filtered tab) | "No {source} tasks right now." with option to switch to All |
| Upcoming Events | "No upcoming events." + "New Event" button for admin/office_worker |
| Conflicts | "No conflicts spotted." |
| Debriefs Outstanding | Card hidden entirely when count = 0 |
| Executive Activity feed | "No recent activity." |

### Error Handling

Each data fetch in `Promise.all` is wrapped individually. A failed source shows an inline error message in its card/section ("Couldn't load pipeline data. Try refreshing.") rather than breaking the whole page.

Optimistic checkbox toggle uses existing rollback logic + Sonner toast on failure.

### Accessibility

- Urgency badges: icon + colour + text (▲ Overdue, ● Due Soon) — never colour alone
- Checkboxes: `aria-label` with task title
- Filter tabs: keyboard navigable
- "View →" links: `aria-label="View {task title}"`
- Urgency section headers: `role="heading"` for screen readers

## Files Created / Modified

### New Files
- `src/lib/dashboard.ts` — `getDashboardTodoItems()`, `getDebriefsDue()`, `getExecutiveSummaryStats()`, `getRecentActivity()`
- `src/components/dashboard/unified-todo-list.tsx` — Main component with both modes
- `src/components/dashboard/todo-row.tsx` — Individual task row
- `src/components/dashboard/urgency-section.tsx` — Urgency group rendering
- `src/components/dashboard/filter-tabs.tsx` — Source filter tabs
- `src/components/dashboard/context-cards/` — Right-column cards (upcoming-events, pipeline, conflicts, debriefs-outstanding, venue-booking-stats, sop-progress, summary-stats, recent-activity)

### Modified Files
- `src/app/page.tsx` — Full rewrite of dashboard page
- `src/app/planning/page.tsx` — Wire up `UnifiedTodoList` in planning mode (replacing `planning-todos-by-person-view`)
- `src/lib/events.ts` — Add `getDebriefsDue()` if co-located here
- `src/lib/planning/index.ts` — Add mapping function from `PlanningBoardData` to `TodoItem[]`

### Removed Files
- `src/components/planning/planning-todos-by-person-view.tsx` — Replaced by `UnifiedTodoList`

## Out of Scope

- Personal ad-hoc todos (no new database tables)
- Drag-and-drop reordering of todo items
- Real-time updates (standard page refresh / revalidation)
- Dashboard customisation (widget arrangement, preferences)

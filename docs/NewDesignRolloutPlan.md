# New Design Rollout Plan

## Source And Decisions

- Primary design source: `/Users/peterpitcher/Library/Mobile Documents/com~apple~CloudDocs/Downloads/baronshub/project/BaronsHub Prototype.html`.
- Token source: prototype token palette and spacing model, aligned into `src/app/globals.css`.
- Public pages: token aligned only. They keep the public booking layout and do not receive the authenticated app shell.
- Authenticated shell: desktop rail is collapsed by default and expands on hover/focus.
- Global search: real navigation and todo search, not placeholder.
- Notifications: real pending proposal, overdue todo, due soon todo, failed todo source, and current todo signals.
- Planning queue: sourced from existing unified dashboard todos.
- Planning horizon: keep the 90+ bucket.

## Implementation Phases

1. Foundations
   - Land tokens, typography, radii, shadows, shared table classes, and app page header classes.
   - Update UI primitives so buttons, badges, cards, inputs, selects, tabs, sheets, dialogs, dropdowns, and toasts inherit the new design.
   - Add reusable design helpers: avatar, avatar stack, keyboard key, progress ring, SLA chip, sparkline, page header, metric tile.

2. Shell
   - Replace the wide sidebar with a collapsed rail.
   - Add the production top bar with breadcrumb, real global search, real notifications, and account menu.
   - Keep mobile navigation available through the top bar.
   - Add live badges for planning todos, review todos, and pending proposals.

3. Planning Workspace
   - Rebuild `/planning` around the prototype: header, alert metrics, saved view/filter row, borderless horizon columns, compact cards, event overlays, inspiration cards, and right-side Your queue rail.
   - Keep Calendar, List, and Todos by person modes.
   - Wire queue completion to existing planning task actions.

4. Internal Page Sweep
   - Replace route-level one-off headers with `PageHeader`.
   - Move operational tables to `data-table` and `data-table-shell`.
   - Align dashboards, directories, settings, reviews, debriefs, bookings, customers, links, venues, users, artists, and opening hours with tokenized cards, chips, and controls.

5. Event Workflows
   - Align event board controls, status legend, month calendar, seven-day matrix, list table, event forms, detail summary, website listing, booking settings, proposal review, debrief form, SOP drawer, and floating action bar.
   - Keep workflow-specific affordances intact: review actions, proposal approval, draft/submission transitions, deletion controls, and SMS/booking settings.

6. Public Booking Pages
   - Replace hard-coded colors in `/l/[slug]`, `BookingForm`, checkout success, and checkout cancel with design tokens.
   - Preserve the current card layout, event image treatment, booking flow, Turnstile widget, Stripe redirect behavior, and mobile screenshot guidance.

7. Verification
   - Run `npm run typecheck`.
   - Run `npm run lint`.
   - Run `npm run test`.
   - Smoke-test authenticated desktop, authenticated mobile, public landing, public booking form, checkout success/cancel, planning board, planning calendar, event board, and admin settings.

## App Page Inventory

All visual route files are included in the rollout. API routes remain non-visual and are listed separately as out of scope except where their responses feed real search, notifications, booking, or public event data.

### Authenticated Workspace

| File | Treatment |
| --- | --- |
| `src/app/page.tsx` | App header, todo dashboard, context cards, live alert chips. |
| `src/app/account/page.tsx` | App header and tokenized preferences card. |
| `src/app/artists/page.tsx` | App header and tokenized artist directory surface. |
| `src/app/artists/[artistId]/page.tsx` | Detail page header alignment and artist editor token sweep. |
| `src/app/bookings/page.tsx` | App header with booking/ticket totals. |
| `src/app/bookings/BookingsView.tsx` | Tokenized filters, grouped headers, and data tables. |
| `src/app/customers/page.tsx` | App header with customer count. |
| `src/app/customers/CustomersView.tsx` | Tokenized filters and customer data table. |
| `src/app/customers/[id]/page.tsx` | Detail page header, booking history table, and PII-safe card treatments. |
| `src/app/debriefs/page.tsx` | App header, empty/error states, and debrief list cards. |
| `src/app/debriefs/[eventId]/page.tsx` | Debrief detail and form shell alignment. |
| `src/app/events/page.tsx` | Event board shell, filters, view switcher, and status legend alignment. |
| `src/app/events/new/page.tsx` | Event form page shell and step/form treatment. |
| `src/app/events/pending/page.tsx` | Pending proposal header, queue cards, and decision states. |
| `src/app/events/propose/page.tsx` | Proposal form shell and public-friendly form treatment. |
| `src/app/events/[eventId]/page.tsx` | Event detail header, summary cards, sections, and actions. |
| `src/app/events/[eventId]/bookings/page.tsx` | Event-specific booking table and action alignment. |
| `src/app/links/page.tsx` | App header and links manager surface. |
| `src/app/opening-hours/page.tsx` | Data loader for opening hours shell. |
| `src/app/planning/page.tsx` | Prototype planning board, queue rail, alert metrics, and alternate views. |
| `src/app/planning/[planningItemId]/page.tsx` | Planning detail header and editor shell alignment. |
| `src/app/reviews/page.tsx` | App header and review queue cards. |
| `src/app/settings/page.tsx` | App header and settings tab shell. |
| `src/app/settings/event-types/page.tsx` | Event type manager alignment. |
| `src/app/users/page.tsx` | App header, role model cards, and users manager. |
| `src/app/venues/page.tsx` | App header, venue routing card, and venues manager. |
| `src/app/venues/[venueId]/opening-hours/page.tsx` | Venue scoped opening hours detail alignment. |

### Auth And Account State

| File | Treatment |
| --- | --- |
| `src/app/login/page.tsx` | Auth layout token alignment. |
| `src/app/login/login-form.tsx` | Form controls inherit token primitives. |
| `src/app/forgot-password/page.tsx` | Auth layout token alignment. |
| `src/app/forgot-password/forgot-password-form.tsx` | Form controls inherit token primitives. |
| `src/app/reset-password/page.tsx` | Auth layout token alignment. |
| `src/app/reset-password/reset-password-card.tsx` | Card and form token alignment. |
| `src/app/auth/confirm/route.ts` | Non-visual redirect flow, no design work. |
| `src/app/deactivated/page.tsx` | System state card token alignment. |
| `src/app/unauthorized/page.tsx` | System state card token alignment. |

### Public Booking

| File | Treatment |
| --- | --- |
| `src/app/l/[slug]/page.tsx` | Public layout preserved, colors moved to design tokens. |
| `src/app/l/[slug]/BookingForm.tsx` | Public form preserved, colors moved to design tokens. |
| `src/app/l/checkout/success/page.tsx` | Checkout card preserved, colors moved to design tokens. |
| `src/app/l/checkout/cancel/page.tsx` | Checkout card preserved, colors moved to design tokens. |
| `src/app/[code]/route.ts` | Non-visual short-link redirect, no design work. |

### Loading, Error, And Empty States

| File | Treatment |
| --- | --- |
| `src/app/loading.tsx` | Skeleton token alignment. |
| `src/app/error.tsx` | System state card token alignment. |
| `src/app/not-found.tsx` | System state card token alignment. |
| `src/app/events/loading.tsx` | Events skeleton token alignment. |
| `src/app/events/error.tsx` | Events error card token alignment. |
| `src/app/events/not-found.tsx` | Event not-found card token alignment. |
| `src/app/events/[eventId]/loading.tsx` | Event detail skeleton token alignment. |
| `src/app/events/[eventId]/error.tsx` | Event detail error card token alignment. |
| `src/app/planning/loading.tsx` | Planning skeleton token alignment. |
| `src/app/planning/error.tsx` | Planning error card token alignment. |
| `src/app/reviews/loading.tsx` | Reviews skeleton token alignment. |
| `src/app/reviews/error.tsx` | Reviews error card token alignment. |
| `src/app/debriefs/[eventId]/error.tsx` | Debrief error card token alignment. |

### Non-Visual App Routes

The files under `src/app/api/**`, `src/app/api/**/__tests__/**`, `src/app/auth/confirm/route.ts`, and `src/app/[code]/route.ts` do not render UI. They are included only through data contracts and smoke tests where they support public booking, public events, shell notifications, or search results.

## Component Inventory

### Shell And Navigation

| Component | Treatment |
| --- | --- |
| `src/components/shell/app-shell.tsx` | Collapsed rail shell, role-aware nav, live badges. |
| `src/components/shell/app-topbar.tsx` | Production chip, breadcrumb, real search, real notifications, account menu. |
| `src/components/shell/mobile-nav.tsx` | Tokenized mobile drawer and nav badges. |
| `src/components/shell/nav-link.tsx` | Icon nav, active pip, collapsed labels, hover expansion. |
| `src/components/shell/session-monitor.tsx` | Tokenized modal state. |

### UI Primitives

| Component | Treatment |
| --- | --- |
| `src/components/ui/button.tsx` | New radius, density, tokenized variants. |
| `src/components/ui/badge.tsx` | Low-saturation token badges. |
| `src/components/ui/card.tsx` | Paper/hair/shadow-card treatment. |
| `src/components/ui/confirm-dialog.tsx` | Tokenized modal and backdrop. |
| `src/components/ui/design-primitives.tsx` | Shared prototype helpers. |
| `src/components/ui/dropdown-menu.tsx` | Tokenized menu surface. |
| `src/components/ui/field-error.tsx` | Error tone alignment. |
| `src/components/ui/input.tsx` | Tokenized input density and focus. |
| `src/components/ui/label.tsx` | Tokenized label text. |
| `src/components/ui/select.tsx` | Tokenized select density and focus. |
| `src/components/ui/sheet.tsx` | Tokenized drawer surface. |
| `src/components/ui/submit-button.tsx` | Button primitive inheritance. |
| `src/components/ui/tabs.tsx` | Segmented control treatment. |
| `src/components/ui/textarea.tsx` | Tokenized textarea density and focus. |
| `src/components/ui/toaster.tsx` | Tokenized toast surface. |

### Dashboard And Todos

| Component | Treatment |
| --- | --- |
| `src/components/todos/unified-todo-list.tsx` | Tokenized dashboard todos and person grouped todos. |
| `src/components/todos/todo-row.tsx` | Compact tokenized todo rows. |
| `src/components/todos/urgency-section.tsx` | Prototype urgency headings and show-more control. |
| `src/components/todos/filter-tabs.tsx` | Segmented source filter chips. |
| `src/components/dashboard/context-cards/upcoming-events-card.tsx` | Card primitive inheritance and density pass. |
| `src/components/dashboard/context-cards/pipeline-card.tsx` | Card primitive inheritance and status color pass. |
| `src/components/dashboard/context-cards/conflicts-card.tsx` | Card primitive inheritance and alert color pass. |
| `src/components/dashboard/context-cards/debriefs-outstanding-card.tsx` | Card primitive inheritance and list density pass. |
| `src/components/dashboard/context-cards/summary-stats-card.tsx` | Card primitive inheritance and metric pass. |
| `src/components/dashboard/context-cards/recent-activity-card.tsx` | Card primitive inheritance and activity row pass. |
| `src/components/dashboard/context-cards/sop-progress-card.tsx` | Card primitive inheritance and progress styling pass. |
| `src/components/dashboard/context-cards/venue-booking-stats-card.tsx` | Card primitive inheritance and metric styling pass. |

### Planning

| Component | Treatment |
| --- | --- |
| `src/components/planning/planning-board.tsx` | Prototype board layout, queue rail, filters, and view controls. |
| `src/components/planning/planning-alert-strip.tsx` | Metric tile treatment. |
| `src/components/planning/planning-item-card.tsx` | Compact planning, event overlay, and inspiration cards. |
| `src/components/planning/planning-calendar-view.tsx` | Tokenized calendar surface and drag/drop affordances. |
| `src/components/planning/planning-list-view.tsx` | Tokenized data table/list surface. |
| `src/components/planning/planning-modal.tsx` | Tokenized modal. |
| `src/components/planning/planning-item-editor.tsx` | Form primitive inheritance and section density pass. |
| `src/components/planning/planning-task-list.tsx` | Todo row density and action pass. |
| `src/components/planning/sop-checklist-view.tsx` | SOP checklist density and status pass. |
| `src/components/planning/sop-task-row.tsx` | Rich task row token pass. |

### Events

| Component | Treatment |
| --- | --- |
| `src/components/events/events-board.tsx` | App header, segmented view switcher, filters, and board/list/matrix styling. |
| `src/components/events/event-calendar.tsx` | Calendar grid token pass. |
| `src/components/events/event-form.tsx` | Form primitive inheritance and section density pass. |
| `src/components/events/event-form-actions.tsx` | Action bar token pass. |
| `src/components/events/event-form-context.tsx` | Non-visual context, no design work. |
| `src/components/events/event-page-header.tsx` | Header replacement or alignment with `PageHeader`. |
| `src/components/events/event-detail-summary.tsx` | Summary card and status chip pass. |
| `src/components/events/booking-settings-card.tsx` | Card and form token pass. |
| `src/components/events/website-listing-card.tsx` | Card and content token pass. |
| `src/components/events/propose-event-form.tsx` | Form primitive inheritance and public proposal state pass. |
| `src/components/events/pending-proposal-row.tsx` | Queue row token pass. |
| `src/components/events/proposal-decision-card.tsx` | Decision card token pass. |
| `src/components/events/approve-event-button.tsx` | Button primitive inheritance. |
| `src/components/events/revert-to-draft-button.tsx` | Button primitive inheritance. |
| `src/components/events/delete-event-button.tsx` | Button primitive inheritance and danger tone pass. |
| `src/components/events/event-overflow-menu.tsx` | Dropdown primitive inheritance. |
| `src/components/events/floating-action-bar.tsx` | Tokenized floating bar. |
| `src/components/events/sop-drawer.tsx` | Sheet primitive inheritance. |
| `src/components/events/sms-campaign-stats.tsx` | Metric/card token pass. |
| `src/components/events/debrief-form.tsx` | Form primitive inheritance and report sections. |

### Operations, Directories, And Admin

| Component | Treatment |
| --- | --- |
| `src/components/artists/artists-manager.tsx` | Data table and filter token pass. |
| `src/components/artists/artist-detail-editor.tsx` | Detail editor card/table token pass. |
| `src/components/attachments/attachments-panel.tsx` | Card, upload, and list token pass. |
| `src/components/attachments/attachment-list.tsx` | List row token pass. |
| `src/components/attachments/attachment-upload-button.tsx` | Button primitive inheritance. |
| `src/components/audit/audit-trail-panel.tsx` | Card/list token pass. |
| `src/components/bookings/cancel-booking-button.tsx` | Button primitive inheritance and danger tone pass. |
| `src/components/bookings/refund-booking-button.tsx` | Button primitive inheritance and warning tone pass. |
| `src/components/links/links-manager.tsx` | Card, form, row, and table token pass. |
| `src/components/links/link-form.tsx` | Form primitive inheritance. |
| `src/components/links/link-row.tsx` | Row token pass. |
| `src/components/links/variant-row.tsx` | Row token pass. |
| `src/components/links/utm-dropdown.tsx` | Dropdown token pass. |
| `src/components/opening-hours/opening-hours-page-shell.tsx` | App header and tokenized section cards. |
| `src/components/opening-hours/weekly-hours-grid.tsx` | Grid/table token pass. |
| `src/components/opening-hours/overrides-calendar.tsx` | Calendar grid, modal, and row token pass. |
| `src/components/opening-hours/opening-times-preview.tsx` | Preview table and chip token pass. |
| `src/components/opening-hours/opening-hours-manager.tsx` | Manager table/form token pass. |
| `src/components/reviews/decision-form.tsx` | Tokenized decision controls. |
| `src/components/settings/settings-tabs.tsx` | Segmented tab alignment. |
| `src/components/settings/business-settings-manager.tsx` | Form primitive inheritance. |
| `src/components/settings/event-types-manager.tsx` | Manager table/form token pass. |
| `src/components/settings/service-types-manager.tsx` | Manager table/form token pass. |
| `src/components/settings/slt-members-manager.tsx` | Manager table/form token pass. |
| `src/components/settings/sop-template-editor.tsx` | Dense editor token pass. |
| `src/components/settings/sop-backfill-button.tsx` | Button primitive inheritance. |
| `src/components/settings/archived-artists-manager.tsx` | Table/list token pass. |
| `src/components/users/users-manager.tsx` | User table/form token pass. |
| `src/components/users/user-actions-menu.tsx` | Dropdown primitive inheritance. |
| `src/components/users/deactivate-dialog.tsx` | Dialog token pass. |
| `src/components/users/delete-dialog.tsx` | Dialog token pass. |
| `src/components/users/reactivate-dialog.tsx` | Dialog token pass. |
| `src/components/users/resend-invite-button.tsx` | Button primitive inheritance. |
| `src/components/users/impact-summary.tsx` | Card/list token pass. |
| `src/components/venues/venues-manager.tsx` | Data table and form token pass. |
| `src/components/venues/venue-multi-select.tsx` | Selector token pass. |
| `src/components/account/communication-preferences-form.tsx` | Form primitive inheritance. |
| `src/components/auth/auth-layout.tsx` | Auth background/card token pass. |
| `src/components/turnstile-widget.tsx` | Non-styled third-party widget wrapper, no visual redesign beyond spacing. |

## Acceptance Checklist

- Every visual route renders with the new token palette or a documented public-page token alignment.
- No authenticated page keeps a one-off large header when `PageHeader` is appropriate.
- Navigation is collapsed by default on desktop and usable on mobile.
- Search returns real app routes and real todo rows.
- Notifications are derived from real pending proposals, todos, and source failures.
- Planning board keeps all modes and includes the queue rail from unified todos.
- Public booking pages keep their existing behavior and use tokens instead of hard-coded palette colors.
- `npm run typecheck`, `npm run lint`, and `npm run test` pass before merge.

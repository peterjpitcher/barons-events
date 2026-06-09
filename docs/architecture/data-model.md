---
generated: true
last_updated: 2026-06-09
source: session-setup
project: baronshub
---

# Data Model

See `session-context.md` for full schema. This file will be populated by the database agent.

## Tables discovered (from `supabase/migrations/`)

48 tables found via `CREATE TABLE` scan. Listed here for reference until the database agent populates columns, types, and relationships. Tables touched by mutations are mapped in [[server-actions]]; the auth/RLS chain is in [[relationships]].

**Events & content:** `events`, `event_types`, `event_artists`, `event_venues`, `event_versions`, `event_bookings`, `event_creation_batches`, `event_save_idempotency`, `artists`, `approvals`

**Planning & SOP:** `planning_items`, `planning_item_venues`, `planning_series`, `planning_series_task_templates`, `planning_tasks`, `planning_task_assignees`, `planning_task_dependencies`, `planning_inspiration_items`, `planning_inspiration_dismissals`, `sop_sections`, `sop_task_templates`, `sop_task_dependencies`, `debriefs`, `internal_notes`

**Venues & hours:** `venues`, `venue_areas`, `venue_services`, `venue_service_types`, `venue_opening_hours`, `venue_opening_overrides`, `venue_opening_override_venues`, `business_settings`, `pending_cascade_backfill`

**Customers & comms:** `customers`, `customer_consent_events`, `sms_campaign_sends`, `sms_inbound_messages`

**Payments:** `payment_transactions`, `payment_refunds`, `payment_webhooks`

**Auth, users & ops:** `users`, `app_sessions`, `login_attempts`, `audit_log`, `slt_members`, `short_links`

## RPC functions referenced by server actions

| RPC | Called from |
|-----|-------------|
| `set_event_venues` | `src/actions/events.ts` |
| `set_planning_item_venues` | `src/actions/planning.ts` |
| `create_multi_venue_event_proposals`, `pre_approve_event_proposal`, `reject_event_proposal` | `src/actions/pre-event.ts` |
| `reassign_and_deactivate_user`, `reassign_user_content` | `src/actions/users.ts` |

> When the database agent runs, replace the bare table list above with column-level schema, foreign keys, indexes, and RLS policies, and confirm each RPC's signature.

# Supabase Schema & RLS Plan

## Environment Setup
- Projects: `dev`, `staging`, `production` Supabase instances.
- Connection handled through environment variables (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` used server-side only).
- Migration tooling: Supabase CLI migrations versioned in repository (`supabase/migrations`).
- Local bootstrap: run `npm run supabase:reset` to apply migrations and seed reviewer/venue demo data (including overlapping events/venue spaces) before exercising timelines, conflict checks, or reviewer queues.

## Schema Overview

### users
| Column | Type | Notes |
| --- | --- | --- |
| id | uuid (PK) | Matches Supabase auth user ID. |
| email | text | Indexed for lookups; mirrors auth email. |
| full_name | text | Mirrors auth metadata; nullable. |
| role | text | Enum (`venue_manager`, `reviewer`, `hq_planner`, `executive`). |
| venue_id | uuid | Nullable; used when role is `venue_manager`. |
| region | text | Optional, supports reviewer routing. |
| created_at | timestamptz | Default `now()`. |
| updated_at | timestamptz | Trigger-based. |

> **Sync note**: Until the profile sync job ships, the application falls back to Supabase auth metadata if this table is empty. Build a trigger or background job to keep auth metadata and this table aligned once migrations are in place.

### venues
| Column | Type | Notes |
| --- | --- | --- |
| id | uuid (PK) | |
| name | text | |
| address | text | |
| timezone | text | Default `Europe/London` with ability to override. |
| region | text | |
| capacity | integer | Optional. |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### events
| Column | Type | Notes |
| --- | --- | --- |
| id | uuid (PK) | |
| venue_id | uuid (FK venues.id) | |
| status | text | Enum (`draft`, `submitted`, `needs_revisions`, `approved`, `rejected`, `published`, `completed`). |
| title | text | |
| event_type | text | FK to lookup or enum. |
| start_at | timestamptz | |
| end_at | timestamptz | |
| venue_space | text | |
| expected_headcount | integer | |
| estimated_takings_band | text | |
| goal_id | uuid (FK goals.id) | |
| promo_tags | jsonb | Structured references to wet/food promotions. |
| created_by | uuid (FK users.id) | |
| assigned_reviewer_id | uuid (FK users.id) | |
| priority_flag | boolean | |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### event_versions
| Column | Type | Notes |
| --- | --- | --- |
| id | uuid (PK) | |
| event_id | uuid (FK events.id) | |
| version | integer | Incremental; starts at 1. |
| payload | jsonb | Snapshot of submission/draft. |
| submitted_at | timestamptz | Nullable; set when moving to `submitted`. |
| submitted_by | uuid (FK users.id) | |

> Current implementation automatically creates `version = 1` for every new draft via the server action, adds new versions on submission/decisions, and surfaces simple payload diffs in the timeline UI. Future work: autosave versions and richer diff metadata.

### goals
| Column | Type | Notes |
| --- | --- | --- |
| id | uuid (PK) | |
| label | text | |
| description | text | |
| active | boolean | Default true. |

### feedback_templates
| Column | Type | Notes |
| --- | --- | --- |
| id | uuid (PK) | |
| name | text | |
| body | text | Markdown or HTML snippet. |
| created_by | uuid (FK users.id) | |

### approvals
| Column | Type | Notes |
| --- | --- | --- |
| id | uuid (PK) | |
| event_id | uuid (FK events.id) | |
| decision | text | Enum (`approved`, `needs_revisions`, `rejected`). |
| reviewer_id | uuid (FK users.id) | |
| feedback_template_id | uuid | Nullable. |
| feedback_text | text | |
| decided_at | timestamptz | |

### ai_content
| Column | Type | Notes |
| --- | --- | --- |
| id | uuid (PK) | |
| event_id | uuid (FK events.id) | |
| version | integer | |
| synopsis | text | |
| hero_copy | text | |
| seo_keywords | jsonb | Array of keyword strings. |
| audience_tags | jsonb | |
| talent_bios | jsonb | |
| generated_at | timestamptz | |
| generated_by | text | Identifier of model. |
| reviewed_by | uuid | Nullable (user who edits). |
| published_at | timestamptz | Nullable. |

### notifications
| Column | Type | Notes |
| --- | --- | --- |
| id | uuid (PK) | |
| user_id | uuid (FK users.id) | |
| type | text | Enum (submission_submitted, review_feedback, approval_granted, sla_warning, ai_ready, debrief_reminder, digest). |
| payload | jsonb | |
| status | text | Enum (`queued`, `sent`, `failed`). |
| sent_at | timestamptz | Nullable. |

> `payload.send_meta` captures Resend delivery metadata (`message_id`, `attempted_at`, `error`). Failed sends remain in the table with `status = failed` to allow retries.

### cron_alert_logs
| Column | Type | Notes |
| --- | --- | --- |
| id | uuid (PK) | |
| job | text | Identifier for the cron endpoint (e.g., `sla-reminders`). |
| severity | text | `error`, `info`, or `success`. |
| message | text | Human-readable summary of the alert. |
| detail | text | Optional extra context (e.g., Supabase error message). |
| response_status | integer | HTTP status returned by the webhook (if any). |
| response_body | text | Truncated response body (≤500 chars). |
| created_at | timestamptz | Timestamp of the alert entry. |

### cron_notification_failures (view)
| Column | Type | Notes |
| --- | --- | --- |
| id | uuid | Mirrors notification id. |
| status | text | `queued` or `failed`. |
| event_id | uuid | Parsed from payload; nullable if snapshot missing. |
| event_title | text | Title stored in notification payload. |
| venue_name | text | Venue from payload. |
| severity | text | `overdue` / `warning`. |
| error_message | text | Last error captured in `payload.send_meta`. |
| retry_after | timestamptz | When the next retry should occur (if queued). |
| attempted_at | timestamptz | Timestamp of the most recent send attempt. |
| retry_count | integer | Number of retries attempted so far. |
| reviewer_email | text | Email of the reviewer (`users.email`). |
| reviewer_name | text | Display name of reviewer. |
| user_id | uuid | Reviewer id from `notifications.user_id`. |
| created_at | timestamptz | Notification creation time. |

### ai_publish_queue
| Column | Type | Notes |
| --- | --- | --- |
| id | uuid (PK) | |
| event_id | uuid (FK events.id) | Linked event. |
| content_id | uuid (FK ai_content.id) | Unique per content version. |
| payload | jsonb | Snapshot handed to the downstream website queue (synopsis, hero, tags). |
| status | text | Enum (`pending`, `failed`, `cancelled`, `dispatched`). |
| dispatched_at | timestamptz | Nullable; set once downstream export completes. |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### debriefs
| Column | Type | Notes |
| --- | --- | --- |
| id | uuid (PK) | |
| event_id | uuid (FK events.id) | |
| submitted_by | uuid (FK users.id) | |
| submitted_at | timestamptz | |
| actual_attendance | integer | |
| wet_takings | numeric | |
| food_takings | numeric | |
| promo_effectiveness_rating | integer | 1–5 scale. |
| wins | text | |
| issues | text | |
| observations | text | |
| media | jsonb | References to Supabase Storage paths. |

### weekly_digest_logs
| Column | Type | Notes |
| --- | --- | --- |
| id | uuid (PK) | |
| payload | jsonb | Snapshot of metrics sent. |
| sent_at | timestamptz | |

### audit_log
| Column | Type | Notes |
| --- | --- | --- |
| id | uuid (PK) | |
| actor_id | uuid (FK users.id) | |
| action | text | e.g., `event.submitted`. |
| entity_type | text | |
| entity_id | uuid | |
| details | jsonb | |
| created_at | timestamptz | |

## Row-Level Security Policies

### users
- Venue managers can view/update their own profile only.
- Reviewers/HQ can list users within their domain (for assignment); requires RPC wrapper.

### venues
- Venue managers: `SELECT` on their assigned venue.
- Reviewers: `SELECT` venues within their region.
- HQ planners: full `SELECT/INSERT/UPDATE`.
- Executive viewers: `SELECT` all.

### events
- Venue managers: `SELECT/INSERT/UPDATE` where `created_by = auth.uid()` or `venue_id` matches assigned venue and status in (`draft`, `needs_revisions`); no delete.
- Reviewers: `SELECT` where `assigned_reviewer_id = auth.uid()` or venue region matches; `UPDATE` restricted to status changes via RPC.
- HQ planners: full `SELECT/UPDATE/DELETE` (soft delete) through server role.
- Executives: `SELECT` events with status ≥ `approved`.

### event_versions
- Tied to `events` policy using `EXISTS` check on parent event with same access constraints.

### approvals
- Reviewers can `INSERT` decisions for assigned events; `SELECT` for events they oversee.
- Venue managers can `SELECT` approvals linked to their venue events.
- HQ planners full access.

### ai_content
- Venue managers and reviewers have `SELECT` once event status is `approved`.
- HQ planners have full access, including `INSERT/UPDATE`.

### debriefs
- Venue managers: `INSERT/UPDATE` when `event.venue_id` matches assignment.
- Reviewers/HQ: `SELECT`.
- Executives: `SELECT` aggregated view via materialised view or server action.

### notifications
- Users can `SELECT` where `user_id = auth.uid()`.
- System jobs insert via service role.

### audit_log
- Readable by HQ planners and auditors; not exposed to venue managers by default (optional aggregated view).

## Stored Procedures & Helpers
- `assign_reviewer(event_id uuid, reviewer_id uuid)` – updates event assignment with validation.
- `set_event_status(event_id uuid, new_status text, payload jsonb)` – centralises status transitions and logs audit.
- `record_debrief(...)` – ensures only one debrief per event, updates event to `completed`.
- `get_reviewer_queue(user_id uuid)` – returns events pending review with SLA calculations.

> `assign_reviewer` is deployed as a security-definer function; authenticated users with the right role (reviewer/HQ) can call it, while the service role drives internal server actions.
> Event drafts are created via the `createEventDraftAction` server action, which inserts into `events`, records an audit entry, and creates version `1`. Submissions and reviewer decisions append new `event_versions` rows and write to the `approvals` table through server actions.

## Data Seeding
- Seed script for default goals, example venues, and template users (HQ profile sync still manual for now).
- Migration seeds stored in `/supabase/seed.sql` with environment-specific overrides.
- Local development command: `npm run supabase:reset` to drop/recreate schema and seed defaults.
- Seeds include example HQ planner (`hq.planner@barons.example`) and reviewer (`reviewer@barons.example`) accounts for local testing; replace with real Supabase auth IDs when available.

## Monitoring & Maintenance
- Supabase logs monitored for RLS violations.
- Scheduled job (Supabase task or Vercel Cron) to archive events older than retention window.
- Regular backups handled by Supabase automated backups; document restoration procedure.
- `cron_alert_logs` retains webhook responses and heartbeat pings; review it alongside the planner dashboard cron tile when troubleshooting automation. `cron_notification_failures` surfaces queued/failed SLA reminders with reviewer context for the monitoring panel.
> **Implementation status**: The current migrations (`20250217120000_initial_schema.sql`, `20250217123000_audit_log.sql`, `20250217124500_workflow_tables.sql`) cover users, venues, goals, events, event_versions, audit_log, feedback_templates, approvals, ai_content, notifications, debriefs, and weekly_digest_logs with baseline RLS (service-role managed and HQ read access where required). Next step is tightening per-role RLS and adding supporting RPCs.

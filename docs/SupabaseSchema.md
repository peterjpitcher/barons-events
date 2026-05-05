# Supabase Schema & RLS Plan

## Environment Setup
- Projects: `dev`, `staging`, `production` Supabase instances.
- Connection handled through environment variables (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` used server-side only).
- Migration tooling: Supabase CLI migrations versioned in repository (`supabase/migrations`).
- Local bootstrap: `npm run supabase:reset` resets the linked project configured in Supabase CLI. Use only against a disposable local/staging project, not shared data.

## Schema Overview

### users
| Column | Type | Notes |
| --- | --- | --- |
| id | uuid (PK) | Matches Supabase auth user ID. |
| email | text | Indexed for lookups; mirrors auth email. |
| full_name | text | Mirrors auth metadata; nullable. |
| role | text | Active values: `administrator`, `office_worker`, `executive`. |
| venue_id | uuid | Nullable; capability switch for `office_worker` venue scoping. |
| region | text | Optional legacy column; not surfaced in the current UI. |
| created_at | timestamptz | Default `now()`. |
| updated_at | timestamptz | Trigger-based. |

> **Sync note**: Until the profile sync job ships, the application falls back to Supabase auth metadata if this table is empty. Build a trigger or background job to keep auth metadata and this table aligned once migrations are in place.

### venues
| Column | Type | Notes |
| --- | --- | --- |
| id | uuid (PK) | |
| name | text | |
| address | text | |
| region | text | Optional legacy column; retained for compatibility. |
| capacity | integer | Optional top-level reference. |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### venue_areas
| Column | Type | Notes |
| --- | --- | --- |
| id | uuid (PK) | |
| venue_id | uuid (FK venues.id) | |
| name | text | |
| capacity | integer | Optional. |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### events
| Column | Type | Notes |
| --- | --- | --- |
| id | uuid (PK) | |
| venue_id | uuid (FK venues.id) | |
| status | text | Active workflow values include `proposed`, `pending_approval`, `draft`, `submitted`, `needs_revisions`, `approved`, `rejected`, `cancelled`, `completed`. |
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
| assignee_id | uuid (FK users.id) | |
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
- Administrators manage users.
- Users can load their own active profile.
- Deactivated users are rejected by application session validation.

### venues
- Administrators manage venues.
- Authenticated users can read active venue metadata needed by event/planning workflows.
- Venue deletes are soft deletes where supported by the table.

### events
- Administrators and executives can read all non-deleted events.
- Office workers without `venue_id` can read all non-deleted events and propose events for any venue.
- Office workers with `venue_id` can read non-deleted events linked to their venue through `event_venues`, falling back to `events.venue_id`.
- Office-worker event writes are server-action gated and RLS scoped to editable drafts/revisions they created or approved/cancelled events where they are responsible at their venue.

### event_versions
- Tied to `events` policy using `EXISTS` check on parent event with same access constraints.

### approvals
- Administrators record review decisions.
- Event-linked approval reads follow event visibility.

### ai_content
- Event-linked reads should follow event visibility.
- Administrators have full access, including `INSERT/UPDATE`.

### debriefs
- Venue-assigned office workers can create/edit their own debriefs for events they can manage.
- Administrators manage debriefs.
- Executives read debrief/reporting data.

### planning_items / planning_item_venues / planning_tasks
- Administrators and executives can read all planning.
- Office workers without `venue_id` can read all planning but cannot create/update planning items or tasks.
- Office workers with `venue_id` can read/write planning linked to their venue through `planning_item_venues`, falling back to `planning_items.venue_id`.

### attachments
- Attachment reads follow the parent event/planning visibility.
- Event attachment uploads/deletes follow event edit rights.
- Planning attachment uploads/deletes require administrator or venue-assigned office-worker rights on the parent planning item.

### notifications
- Users can `SELECT` where `user_id = auth.uid()`.
- System jobs insert via service role.

### audit_log
- Readable by administrators/auditors; not exposed broadly by default.

## Stored Procedures & Helpers
- `set_event_status(event_id uuid, new_status text, payload jsonb)` – centralises status transitions and logs audit.
- `record_debrief(...)` – ensures only one debrief per event, updates event to `completed`.

> Event drafts are created via server actions, which insert into `events`, record audit entries, and maintain event versions/approvals through administrator review workflows.

## Data Seeding
- Seed script for default goals, example venues, and template users.
- Migration seeds stored in `/supabase/seed.sql` with environment-specific overrides.
- Local development command: `npm run supabase:reset` to drop/recreate schema and seed defaults.
- Seeds should use current roles (`administrator`, `office_worker`, `executive`) and staging-safe data only.

## Monitoring & Maintenance
- Supabase logs monitored for RLS violations.
- Scheduled job (Supabase task or Vercel Cron) to archive events older than retention window.
- Regular backups handled by Supabase automated backups; document restoration procedure.
- Review cron route logs, provider dashboards, and affected tables when troubleshooting automation.
> **Implementation status**: Current migrations cover core schema, role/RLS hardening, multi-venue event/planning links, bookings/customers, attachments, SMS, and public API support. RLS integration tests are gated behind `RUN_SUPABASE_MIGRATION_TESTS=1`.

---
generated: true
last_updated: 2026-04-16T00:00:00Z
source: supabase-live-schema
project: barons-events-mvp
---

# Data Model

> Auto-generated from live Supabase schema. All 39 tables have RLS enabled.

## venues

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| name | text | NO | |
| capacity | integer | YES | |
| address | text | YES | |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |
| default_approver_id | uuid | YES | |
| google_review_url | text | YES | |
| default_manager_responsible_id | uuid | YES | |

FK: `default_approver_id` -> `users(id) ON DELETE SET NULL`, `default_manager_responsible_id` -> `users(id) ON DELETE SET NULL`
RLS: enabled, 3 policies (admin ALL, anon SELECT, authenticated SELECT)

## users

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | |
| email | text | NO | |
| full_name | text | YES | |
| role | text | NO | |
| venue_id | uuid | YES | |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |
| previous_role | text | YES | |
| deactivated_at | timestamptz | YES | |
| deactivated_by | uuid | YES | |

FK: `id` -> `auth.users(id) ON DELETE CASCADE`, `venue_id` -> `venues(id) ON DELETE SET NULL`, `deactivated_by` -> `users(id) ON DELETE SET NULL`
RLS: enabled, 2 policies (admin ALL, self SELECT)

## events

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| venue_id | uuid | NO | |
| created_by | uuid | YES | |
| title | text | NO | |
| event_type | text | NO | |
| status | text | NO | |
| start_at | timestamptz | NO | |
| end_at | timestamptz | NO | |
| venue_space | text | NO | |
| expected_headcount | integer | YES | |
| wet_promo | text | YES | |
| food_promo | text | YES | |
| goal_focus | text | YES | |
| notes | text | YES | |
| submitted_at | timestamptz | YES | |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |
| assignee_id | uuid | YES | |
| cost_total | numeric | YES | |
| cost_details | text | YES | |
| public_title | text | YES | |
| public_description | text | YES | |
| public_teaser | text | YES | |
| booking_url | text | YES | |
| seo_title | text | YES | |
| seo_description | text | YES | |
| seo_slug | text | YES | |
| booking_type | text | YES | |
| ticket_price | numeric | YES | |
| terms_and_conditions | text | YES | |
| public_highlights | text[] | YES | |
| check_in_cutoff_minutes | integer | YES | |
| age_policy | text | YES | |
| accessibility_notes | text | YES | |
| cancellation_window_hours | integer | YES | |
| event_image_path | text | YES | |
| deleted_at | timestamptz | YES | |
| deleted_by | uuid | YES | |
| booking_enabled | boolean | NO | false |
| total_capacity | integer | YES | |
| max_tickets_per_booking | integer | NO | 10 |
| manager_responsible_id | uuid | YES | |

FK: `venue_id` -> `venues(id) ON DELETE CASCADE`, `created_by` -> `users(id)`, `assignee_id` -> `users(id)`, `deleted_by` -> `users(id)`, `manager_responsible_id` -> `users(id) ON DELETE SET NULL`
RLS: enabled, 6 policies (admin ALL, anon SELECT approved/completed, assignee UPDATE, venue-scoped SELECT/UPDATE, creator INSERT)
Audit: created_at, updated_at, deleted_at/deleted_by (soft delete)

## event_versions

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| event_id | uuid | NO | |
| version | integer | NO | |
| payload | jsonb | NO | |
| submitted_at | timestamptz | YES | |
| submitted_by | uuid | YES | |
| created_at | timestamptz | NO | now() |

FK: `event_id` -> `events(id) ON DELETE CASCADE`, `submitted_by` -> `users(id)`
RLS: enabled, 2 policies (SELECT via event access, INSERT by editors)

## event_types

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| label | text | NO | |
| created_at | timestamptz | NO | now() |

RLS: enabled, 3 policies (admin ALL, anon SELECT, authenticated SELECT)

## event_bookings

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| event_id | uuid | NO | |
| first_name | text | NO | |
| last_name | text | YES | |
| mobile | text | NO | |
| email | text | YES | |
| ticket_count | integer | NO | |
| status | text | NO | 'confirmed' |
| created_at | timestamptz | NO | now() |
| sms_confirmation_sent_at | timestamptz | YES | |
| sms_reminder_sent_at | timestamptz | YES | |
| sms_post_event_sent_at | timestamptz | YES | |
| customer_id | uuid | YES | |

FK: `event_id` -> `events(id) ON DELETE CASCADE`, `customer_id` -> `customers(id) ON DELETE SET NULL`
RLS: enabled, 4 policies (admin SELECT/UPDATE, venue_worker SELECT/UPDATE scoped)

## customers

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| first_name | text | NO | |
| last_name | text | YES | |
| mobile | text | NO | |
| email | text | YES | |
| marketing_opt_in | boolean | NO | false |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |

RLS: enabled, 2 policies (admin SELECT, venue_worker SELECT via bookings)

## customer_consent_events

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| customer_id | uuid | NO | |
| event_type | text | NO | |
| consent_wording | text | NO | |
| booking_id | uuid | YES | |
| created_at | timestamptz | YES | now() |

FK: `customer_id` -> `customers(id) ON DELETE RESTRICT`, `booking_id` -> `event_bookings(id) ON DELETE SET NULL`
RLS: enabled, 1 policy (SELECT via customer access)

## approvals

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| event_id | uuid | NO | |
| reviewer_id | uuid | YES | |
| decision | text | NO | |
| feedback_text | text | YES | |
| decided_at | timestamptz | NO | now() |

FK: `event_id` -> `events(id) ON DELETE CASCADE`, `reviewer_id` -> `users(id)`
RLS: enabled, 3 policies (admin ALL/INSERT, event-scoped SELECT)

## debriefs

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| event_id | uuid | NO | |
| attendance | integer | YES | |
| wet_takings | numeric | YES | |
| food_takings | numeric | YES | |
| promo_effectiveness | smallint | YES | |
| highlights | text | YES | |
| issues | text | YES | |
| submitted_by | uuid | NO | |
| submitted_at | timestamptz | NO | now() |
| baseline_attendance | integer | YES | |
| baseline_wet_takings | numeric | YES | |
| baseline_food_takings | numeric | YES | |
| guest_sentiment_notes | text | YES | |
| operational_notes | text | YES | |
| would_book_again | boolean | YES | |
| next_time_actions | text | YES | |
| actual_total_takings | numeric | YES | |
| baseline_total_takings | numeric | YES | |
| sales_uplift_value | numeric | YES | |
| sales_uplift_percent | numeric | YES | |

FK: `event_id` -> `events(id) ON DELETE CASCADE`, `submitted_by` -> `users(id)`
RLS: enabled, 6 policies (admin ALL, event-scoped SELECT, office_worker INSERT/UPDATE own, manager UPDATE)

## artists

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| name | text | NO | |
| email | text | YES | |
| phone | text | YES | |
| artist_type | text | NO | 'artist' |
| description | text | YES | |
| created_by | uuid | YES | |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |
| is_curated | boolean | NO | false |
| is_archived | boolean | NO | false |

FK: `created_by` -> `users(id)`
RLS: enabled, 2 policies (admin/venue_worker ALL, public SELECT)

## event_artists

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| event_id | uuid | NO | |
| artist_id | uuid | NO | |
| billing_order | integer | NO | 1 |
| role_label | text | YES | |
| created_by | uuid | YES | |
| created_at | timestamptz | NO | now() |

FK: `event_id` -> `events(id) ON DELETE CASCADE`, `artist_id` -> `artists(id) ON DELETE CASCADE`, `created_by` -> `users(id)`
RLS: enabled, 2 policies (ALL by event editors, SELECT via event access)

## planning_series

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| title | text | NO | |
| description | text | YES | |
| type_label | text | NO | |
| venue_id | uuid | YES | |
| owner_id | uuid | YES | |
| created_by | uuid | YES | |
| recurrence_frequency | text | NO | |
| recurrence_interval | integer | NO | 1 |
| recurrence_weekdays | integer[] | YES | |
| recurrence_monthday | smallint | YES | |
| starts_on | date | NO | |
| ends_on | date | YES | |
| is_active | boolean | NO | true |
| generated_through | date | YES | |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |

FK: `venue_id` -> `venues(id)`, `owner_id` -> `users(id)`, `created_by` -> `users(id)`
RLS: enabled, 6 policies (admin DELETE/INSERT/UPDATE, office_worker INSERT/UPDATE own, authenticated SELECT)

## planning_items

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| series_id | uuid | YES | |
| occurrence_on | date | YES | |
| is_exception | boolean | NO | false |
| title | text | NO | |
| description | text | YES | |
| type_label | text | NO | |
| venue_id | uuid | YES | |
| owner_id | uuid | YES | |
| target_date | date | NO | |
| status | text | NO | |
| created_by | uuid | YES | |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |
| event_id | uuid | YES | |

FK: `series_id` -> `planning_series(id) ON DELETE CASCADE`, `venue_id` -> `venues(id)`, `owner_id` -> `users(id)`, `created_by` -> `users(id)`, `event_id` -> `events(id) ON DELETE CASCADE`
RLS: enabled, 4 policies (admin/owner DELETE/UPDATE, authenticated SELECT, admin INSERT)

## planning_tasks

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| planning_item_id | uuid | NO | |
| title | text | NO | |
| assignee_id | uuid | YES | |
| due_date | date | NO | |
| status | text | NO | 'open' |
| completed_at | timestamptz | YES | |
| sort_order | integer | NO | 0 |
| created_by | uuid | YES | |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |
| sop_section | text | YES | |
| sop_template_task_id | uuid | YES | |
| sop_t_minus_days | integer | YES | |
| due_date_manually_overridden | boolean | NO | false |
| is_blocked | boolean | NO | false |
| completed_by | uuid | YES | |

FK: `planning_item_id` -> `planning_items(id) ON DELETE CASCADE`, `assignee_id` -> `users(id)`, `sop_template_task_id` -> `sop_task_templates(id)`, `created_by` -> `users(id)`, `completed_by` -> `users(id)`
RLS: enabled, 5 policies (admin/owner DELETE/UPDATE/INSERT, authenticated SELECT, assignee UPDATE)

## planning_task_assignees

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| task_id | uuid | NO | |
| user_id | uuid | YES | |
| created_at | timestamptz | NO | now() |

FK: `task_id` -> `planning_tasks(id) ON DELETE CASCADE`, `user_id` -> `users(id)`
RLS: enabled, 4 policies (admin INSERT/DELETE/UPDATE, authenticated SELECT)

## planning_task_dependencies

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| task_id | uuid | NO | |
| depends_on_task_id | uuid | NO | |
| created_at | timestamptz | NO | now() |

FK: `task_id` -> `planning_tasks(id) ON DELETE CASCADE`, `depends_on_task_id` -> `planning_tasks(id) ON DELETE CASCADE`
RLS: enabled, 3 policies (admin DELETE/INSERT, authenticated SELECT)

## planning_series_task_templates

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| series_id | uuid | NO | |
| title | text | NO | |
| default_assignee_id | uuid | YES | |
| due_offset_days | integer | NO | 0 |
| sort_order | integer | NO | 0 |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |

FK: `series_id` -> `planning_series(id) ON DELETE CASCADE`, `default_assignee_id` -> `users(id)`
RLS: enabled, 5 policies (authenticated ALL/SELECT, admin DELETE/UPDATE, admin INSERT)

## planning_inspiration_items

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| event_name | text | NO | |
| event_date | date | NO | |
| category | text | NO | |
| description | text | YES | |
| source | text | NO | |
| generated_at | timestamptz | NO | |
| created_at | timestamptz | NO | now() |

RLS: enabled, 2 policies (authenticated SELECT, service_role ALL)

## planning_inspiration_dismissals

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| inspiration_item_id | uuid | NO | |
| dismissed_by | uuid | NO | |
| dismissed_at | timestamptz | NO | now() |
| reason | text | NO | |

FK: `dismissed_by` -> `auth.users(id) ON DELETE CASCADE`
RLS: enabled, 3 policies (authenticated INSERT/SELECT, service_role ALL)

## sop_sections

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| label | text | NO | |
| sort_order | integer | NO | 0 |
| default_assignee_ids | uuid[] | NO | '{}' |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |

RLS: enabled, 4 policies (admin INSERT/DELETE/UPDATE, admin/executive SELECT)

## sop_task_templates

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| section_id | uuid | NO | |
| title | text | NO | |
| sort_order | integer | NO | 0 |
| default_assignee_ids | uuid[] | NO | '{}' |
| t_minus_days | integer | NO | 14 |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |

FK: `section_id` -> `sop_sections(id) ON DELETE CASCADE`
RLS: enabled, 4 policies (admin INSERT/DELETE/UPDATE, admin/executive SELECT)

## sop_task_dependencies

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| task_template_id | uuid | NO | |
| depends_on_template_id | uuid | NO | |
| created_at | timestamptz | NO | now() |

FK: `task_template_id` -> `sop_task_templates(id) ON DELETE CASCADE`, `depends_on_template_id` -> `sop_task_templates(id) ON DELETE CASCADE`
RLS: enabled, 4 policies (admin INSERT/DELETE/UPDATE, admin/executive SELECT)

## ai_content

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| event_id | uuid | NO | |
| version | integer | NO | |
| synopsis | text | YES | |
| hero_copy | text | YES | |
| seo_keywords | jsonb | YES | |
| audience_tags | jsonb | YES | |
| talent_bios | jsonb | YES | |
| generated_at | timestamptz | NO | now() |
| generated_by | text | YES | |
| reviewed_by | uuid | YES | |
| published_at | timestamptz | YES | |
| created_at | timestamptz | NO | now() |

RLS: enabled, 1 policy (service_role ALL)

## ai_publish_queue

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| event_id | uuid | NO | |
| content_id | uuid | NO | |
| payload | jsonb | NO | |
| status | text | NO | 'pending' |
| dispatched_at | timestamptz | YES | |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |

FK: `content_id` -> `ai_content(id) ON DELETE CASCADE`
RLS: enabled, 1 policy (service_role ALL)

## app_sessions

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| session_id | uuid | NO | gen_random_uuid() |
| user_id | uuid | NO | |
| created_at | timestamptz | NO | now() |
| last_activity_at | timestamptz | NO | now() |
| expires_at | timestamptz | YES | |
| user_agent | text | YES | |
| ip_address | text | YES | |

FK: `user_id` -> `auth.users(id) ON DELETE CASCADE`
RLS: enabled, 0 policies

## audit_log

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| entity | text | NO | |
| entity_id | text | NO | |
| action | text | NO | |
| meta | jsonb | YES | |
| actor_id | uuid | YES | |
| created_at | timestamptz | NO | now() |

RLS: enabled, 2 policies (actor INSERT, admin SELECT)

## notifications

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| user_id | uuid | NO | |
| type | text | NO | |
| payload | jsonb | YES | |
| status | text | NO | 'queued' |
| sent_at | timestamptz | YES | |
| created_at | timestamptz | NO | now() |

RLS: enabled, 3 policies (service INSERT/ALL, user SELECT own)

## short_links

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| code | text | NO | |
| name | text | NO | |
| destination | text | NO | |
| link_type | text | NO | 'general' |
| clicks | integer | NO | 0 |
| expires_at | timestamptz | YES | |
| created_by | uuid | YES | |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |

FK: `created_by` -> `users(id) ON DELETE SET NULL`
RLS: enabled, 2 policies (admin ALL, authenticated SELECT)

## goals

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| label | text | NO | |
| description | text | YES | |
| active | boolean | NO | true |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |

RLS: enabled, 2 policies (authenticated/service SELECT, service ALL)

## feedback_templates

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| name | text | NO | |
| body | text | NO | |
| created_by | uuid | YES | |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |

RLS: enabled, 1 policy (service_role ALL)

## login_attempts

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| email_hash | text | NO | |
| ip_address | text | NO | |
| attempted_at | timestamptz | NO | now() |

RLS: enabled, 0 policies

## cron_alert_logs

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| job | text | NO | |
| severity | text | NO | 'error' |
| message | text | NO | |
| detail | text | YES | |
| response_status | integer | YES | |
| response_body | text | YES | |
| created_at | timestamptz | NO | now() |

RLS: enabled, 1 policy (service_role ALL)

## weekly_digest_logs

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| payload | jsonb | NO | |
| sent_at | timestamptz | NO | now() |

RLS: enabled, 1 policy (service_role ALL)

## venue_service_types

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| name | text | NO | |
| display_order | integer | NO | 0 |
| created_at | timestamptz | NO | now() |

RLS: enabled, 3 policies (admin ALL, public SELECT x2)

## venue_opening_hours

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| venue_id | uuid | NO | |
| service_type_id | uuid | NO | |
| day_of_week | integer | NO | |
| open_time | time | YES | |
| close_time | time | YES | |
| is_closed | boolean | NO | false |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |

FK: `venue_id` -> `venues(id) ON DELETE CASCADE`, `service_type_id` -> `venue_service_types(id) ON DELETE CASCADE`
RLS: enabled, 3 policies (admin ALL, public SELECT x2)

## venue_opening_overrides

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| override_date | date | NO | |
| service_type_id | uuid | NO | |
| open_time | time | YES | |
| close_time | time | YES | |
| is_closed | boolean | NO | false |
| note | text | YES | |
| created_by | uuid | YES | |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |

FK: `service_type_id` -> `venue_service_types(id) ON DELETE CASCADE`, `created_by` -> `users(id)`
RLS: enabled, 3 policies (admin ALL, public SELECT x2)

## venue_opening_override_venues

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| override_id | uuid | NO | |
| venue_id | uuid | NO | |

FK: `override_id` -> `venue_opening_overrides(id) ON DELETE CASCADE`, `venue_id` -> `venues(id) ON DELETE CASCADE`
RLS: enabled, 3 policies (admin ALL, public SELECT x2)

## venue_default_reviewers

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| venue_id | uuid | NO | |
| reviewer_id | uuid | NO | |
| created_at | timestamptz | NO | now() |

RLS: enabled, 1 policy (service_role ALL)

## Enum Types (public schema)

| Type | Values |
|------|--------|
| `event_status` | draft, submitted, needs_revisions, approved, rejected, published, completed |
| `user_role` | venue_manager, reviewer, central_planner, executive |

Note: `events.status` and `users.role` use `text` columns, not the enum types directly. The `user_role` enum appears to be legacy; current roles are `administrator`, `office_worker`, `executive` stored as text.

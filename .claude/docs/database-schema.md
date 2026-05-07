# BaronsHub Database Schema

50 tables in `public` schema. PostgreSQL 17 on Supabase.


## ai_content

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| event_id | uuid | NO |  |
| version | integer | NO |  |
| synopsis | text | YES |  |
| hero_copy | text | YES |  |
| seo_keywords | jsonb | YES |  |
| audience_tags | jsonb | YES |  |
| talent_bios | jsonb | YES |  |
| generated_at | timestamp with time zone | NO | timezone('utc'::text, now()) |
| generated_by | text | YES |  |
| reviewed_by | uuid | YES |  |
| published_at | timestamp with time zone | YES |  |
| created_at | timestamp with time zone | NO | timezone('utc'::text, now()) |

**RLS:** enabled, 1 policies | **Audit columns:** generated_at, created_at

## ai_publish_queue

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| event_id | uuid | NO |  |
| content_id | uuid | NO |  |
| payload | jsonb | NO |  |
| status | text | NO | 'pending'::text |
| dispatched_at | timestamp with time zone | YES |  |
| created_at | timestamp with time zone | NO | timezone('utc'::text, now()) |
| updated_at | timestamp with time zone | NO | timezone('utc'::text, now()) |

**Foreign keys:** content_id -> ai_content(id) ON DELETE CASCADE | **RLS:** enabled, 1 policies | **Audit columns:** created_at, updated_at

## app_sessions

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| session_id | uuid | NO | gen_random_uuid() |
| user_id | uuid | NO |  |
| created_at | timestamp with time zone | NO | now() |
| last_activity_at | timestamp with time zone | NO | now() |
| expires_at | timestamp with time zone | YES |  |
| user_agent | text | YES |  |
| ip_address | text | YES |  |

**Foreign keys:** user_id -> auth.users(id) ON DELETE CASCADE | **RLS:** enabled, 0 policies (check) | **Audit columns:** created_at

## approvals

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| event_id | uuid | NO |  |
| reviewer_id | uuid | YES |  |
| decision | text | NO |  |
| feedback_text | text | YES |  |
| decided_at | timestamp with time zone | NO | timezone('utc'::text, now()) |

**Foreign keys:** event_id -> events(id) ON DELETE CASCADE; reviewer_id -> users(id) ON DELETE SET NULL | **RLS:** enabled, 4 policies

## artists

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| name | text | NO |  |
| email | text | YES |  |
| phone | text | YES |  |
| artist_type | text | NO | 'artist'::text |
| description | text | YES |  |
| created_by | uuid | YES |  |
| created_at | timestamp with time zone | NO | timezone('utc'::text, now()) |
| updated_at | timestamp with time zone | NO | timezone('utc'::text, now()) |
| is_curated | boolean | NO | false |
| is_archived | boolean | NO | false |

**Foreign keys:** created_by -> users(id) ON DELETE SET NULL | **RLS:** enabled, 3 policies | **Audit columns:** created_at, updated_at

## attachments

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| event_id | uuid | YES |  |
| planning_item_id | uuid | YES |  |
| planning_task_id | uuid | YES |  |
| storage_path | text | NO |  |
| original_filename | text | NO |  |
| mime_type | text | NO |  |
| size_bytes | bigint | NO |  |
| upload_status | text | NO | 'pending'::text |
| uploaded_by | uuid | YES |  |
| created_at | timestamp with time zone | NO | timezone('utc'::text, now()) |
| uploaded_at | timestamp with time zone | YES |  |
| deleted_at | timestamp with time zone | YES |  |

**Foreign keys:** event_id -> events(id) ON DELETE CASCADE; planning_item_id -> planning_items(id) ON DELETE CASCADE; planning_task_id -> planning_tasks(id) ON DELETE CASCADE; uploaded_by -> users(id) ON DELETE SET NULL | **RLS:** enabled, 4 policies | **Audit columns:** created_at, deleted_at

## audit_log

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| entity | text | NO |  |
| entity_id | text | NO |  |
| action | text | NO |  |
| meta | jsonb | YES |  |
| actor_id | uuid | YES |  |
| created_at | timestamp with time zone | NO | timezone('utc'::text, now()) |

**RLS:** enabled, 2 policies | **Audit columns:** created_at

## business_settings

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | boolean | NO | true |
| labour_rate_gbp | numeric | NO | 12.71 |
| updated_by | uuid | YES |  |
| updated_at | timestamp with time zone | NO | timezone('utc'::text, now()) |

**Foreign keys:** updated_by -> users(id) ON DELETE SET NULL | **RLS:** enabled, 2 policies | **Audit columns:** updated_at

## cron_alert_logs

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| job | text | NO |  |
| severity | text | NO | 'error'::text |
| message | text | NO |  |
| detail | text | YES |  |
| response_status | integer | YES |  |
| response_body | text | YES |  |
| created_at | timestamp with time zone | NO | timezone('utc'::text, now()) |

**RLS:** enabled, 1 policies | **Audit columns:** created_at

## customer_consent_events

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| customer_id | uuid | NO |  |
| event_type | text | NO |  |
| consent_wording | text | NO |  |
| booking_id | uuid | YES |  |
| created_at | timestamp with time zone | YES | now() |

**Foreign keys:** customer_id -> customers(id) ON DELETE RESTRICT; booking_id -> event_bookings(id) ON DELETE SET NULL | **RLS:** enabled, 1 policies | **Audit columns:** created_at

## customers

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| first_name | text | NO |  |
| last_name | text | YES |  |
| mobile | text | NO |  |
| email | text | YES |  |
| marketing_opt_in | boolean | NO | false |
| created_at | timestamp with time zone | YES | now() |
| updated_at | timestamp with time zone | YES | now() |

**RLS:** enabled, 2 policies | **Audit columns:** created_at, updated_at

## debriefs

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| event_id | uuid | NO |  |
| attendance | integer | YES |  |
| wet_takings | numeric | YES |  |
| food_takings | numeric | YES |  |
| promo_effectiveness | smallint | YES |  |
| highlights | text | YES |  |
| issues | text | YES |  |
| submitted_by | uuid | NO |  |
| submitted_at | timestamp with time zone | NO | timezone('utc'::text, now()) |
| baseline_attendance | integer | YES |  |
| baseline_wet_takings | numeric | YES |  |
| baseline_food_takings | numeric | YES |  |
| guest_sentiment_notes | text | YES |  |
| operational_notes | text | YES |  |
| would_book_again | boolean | YES |  |
| next_time_actions | text | YES |  |
| actual_total_takings | numeric | YES |  |
| baseline_total_takings | numeric | YES |  |
| sales_uplift_value | numeric | YES |  |
| sales_uplift_percent | numeric | YES |  |
| labour_hours | numeric | YES |  |
| labour_rate_gbp_at_submit | numeric | YES |  |

**Foreign keys:** event_id -> events(id) ON DELETE CASCADE; submitted_by -> users(id) ON DELETE SET NULL | **RLS:** enabled, 7 policies | **Audit columns:** submitted_at

## event_artists

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| event_id | uuid | NO |  |
| artist_id | uuid | NO |  |
| billing_order | integer | NO | 1 |
| role_label | text | YES |  |
| created_by | uuid | YES |  |
| created_at | timestamp with time zone | NO | timezone('utc'::text, now()) |

**Foreign keys:** event_id -> events(id) ON DELETE CASCADE; artist_id -> artists(id) ON DELETE CASCADE; created_by -> users(id) ON DELETE SET NULL | **RLS:** enabled, 2 policies | **Audit columns:** created_at

## event_bookings

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| event_id | uuid | NO |  |
| first_name | text | NO |  |
| last_name | text | YES |  |
| mobile | text | NO |  |
| email | text | YES |  |
| ticket_count | integer | NO |  |
| status | text | NO | 'confirmed'::text |
| created_at | timestamp with time zone | NO | now() |
| sms_confirmation_sent_at | timestamp with time zone | YES |  |
| sms_reminder_sent_at | timestamp with time zone | YES |  |
| sms_post_event_sent_at | timestamp with time zone | YES |  |
| customer_id | uuid | YES |  |

**Foreign keys:** event_id -> events(id) ON DELETE CASCADE; customer_id -> customers(id) ON DELETE SET NULL | **RLS:** enabled, 4 policies | **Audit columns:** created_at

## event_creation_batches

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| idempotency_key | uuid | NO |  |
| created_by | uuid | NO |  |
| batch_payload | jsonb | NO |  |
| result | jsonb | YES |  |
| created_at | timestamp with time zone | NO | timezone('utc'::text, now()) |

**Foreign keys:** created_by -> users(id) | **RLS:** enabled, 1 policies | **Audit columns:** created_at

## event_save_idempotency

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| idempotency_key | uuid | NO |  |
| user_id | uuid | NO |  |
| event_id | uuid | YES |  |
| response | jsonb | NO |  |
| created_at | timestamp with time zone | NO | timezone('utc'::text, now()) |

**Foreign keys:** user_id -> users(id) ON DELETE CASCADE; event_id -> events(id) ON DELETE SET NULL | **RLS:** enabled, 1 policies | **Audit columns:** created_at

## event_types

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| label | text | NO |  |
| created_at | timestamp with time zone | NO | timezone('utc'::text, now()) |

**RLS:** enabled, 3 policies | **Audit columns:** created_at

## event_venues

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| event_id | uuid | NO |  |
| venue_id | uuid | NO |  |
| is_primary | boolean | NO | false |
| created_at | timestamp with time zone | NO | timezone('utc'::text, now()) |

**Foreign keys:** event_id -> events(id) ON DELETE CASCADE; venue_id -> venues(id) ON DELETE RESTRICT | **RLS:** enabled, 1 policies | **Audit columns:** created_at

## event_versions

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| event_id | uuid | NO |  |
| version | integer | NO |  |
| payload | jsonb | NO |  |
| submitted_at | timestamp with time zone | YES |  |
| submitted_by | uuid | YES |  |
| created_at | timestamp with time zone | NO | timezone('utc'::text, now()) |

**Foreign keys:** event_id -> events(id) ON DELETE CASCADE; submitted_by -> users(id) ON DELETE SET NULL | **RLS:** enabled, 2 policies | **Audit columns:** submitted_at, created_at

## events

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| venue_id | uuid | NO |  |
| created_by | uuid | YES |  |
| title | text | NO |  |
| event_type | text | YES |  |
| status | text | NO |  |
| start_at | timestamp with time zone | NO |  |
| end_at | timestamp with time zone | YES |  |
| venue_space | text | YES |  |
| expected_headcount | integer | YES |  |
| wet_promo | text | YES |  |
| food_promo | text | YES |  |
| goal_focus | text | YES |  |
| notes | text | YES |  |
| submitted_at | timestamp with time zone | YES |  |
| created_at | timestamp with time zone | NO | timezone('utc'::text, now()) |
| updated_at | timestamp with time zone | NO | timezone('utc'::text, now()) |
| assignee_id | uuid | YES |  |
| cost_total | numeric | YES |  |
| cost_details | text | YES |  |
| public_title | text | YES |  |
| public_description | text | YES |  |
| public_teaser | text | YES |  |
| booking_url | text | YES |  |
| seo_title | text | YES |  |
| seo_description | text | YES |  |
| seo_slug | text | YES |  |
| booking_type | text | YES |  |
| ticket_price | numeric | YES |  |
| terms_and_conditions | text | YES |  |
| public_highlights | ARRAY | YES |  |
| check_in_cutoff_minutes | integer | YES |  |
| age_policy | text | YES |  |
| accessibility_notes | text | YES |  |
| cancellation_window_hours | integer | YES |  |
| event_image_path | text | YES |  |
| deleted_at | timestamp with time zone | YES |  |
| deleted_by | uuid | YES |  |
| booking_enabled | boolean | NO | false |
| total_capacity | integer | YES |  |
| max_tickets_per_booking | integer | NO | 10 |
| manager_responsible_id | uuid | YES |  |
| sms_promo_enabled | boolean | NO | false |
| pending_image_attach | text | YES |  |

**Foreign keys:** assignee_id -> users(id) ON DELETE SET NULL; venue_id -> venues(id) ON DELETE CASCADE; deleted_by -> users(id) ON DELETE SET NULL; created_by -> users(id) ON DELETE SET NULL; manager_responsible_id -> users(id) ON DELETE SET NULL | **RLS:** enabled, 8 policies | **Audit columns:** submitted_at, created_at, updated_at, deleted_at

## feedback_templates

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| name | text | NO |  |
| body | text | NO |  |
| created_by | uuid | YES |  |
| created_at | timestamp with time zone | NO | timezone('utc'::text, now()) |
| updated_at | timestamp with time zone | NO | timezone('utc'::text, now()) |

**RLS:** enabled, 1 policies | **Audit columns:** created_at, updated_at

## goals

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| label | text | NO |  |
| description | text | YES |  |
| active | boolean | NO | true |
| created_at | timestamp with time zone | NO | timezone('utc'::text, now()) |
| updated_at | timestamp with time zone | NO | timezone('utc'::text, now()) |

**RLS:** enabled, 2 policies | **Audit columns:** created_at, updated_at

## login_attempts

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| email_hash | text | NO |  |
| ip_address | text | NO |  |
| attempted_at | timestamp with time zone | NO | now() |

**RLS:** enabled, 0 policies (check)

## notifications

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| user_id | uuid | NO |  |
| type | text | NO |  |
| payload | jsonb | YES |  |
| status | text | NO | 'queued'::text |
| sent_at | timestamp with time zone | YES |  |
| created_at | timestamp with time zone | NO | timezone('utc'::text, now()) |

**RLS:** enabled, 3 policies | **Audit columns:** created_at

## pending_cascade_backfill

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| venue_id | uuid | NO |  |
| queued_at | timestamp with time zone | NO | timezone('utc'::text, now()) |
| locked_at | timestamp with time zone | YES |  |
| locked_by | uuid | YES |  |
| attempt_count | integer | NO | 0 |
| last_attempt_at | timestamp with time zone | YES |  |
| next_attempt_at | timestamp with time zone | YES |  |
| processed_at | timestamp with time zone | YES |  |
| error | text | YES |  |
| is_dead_letter | boolean | NO | false |

**Foreign keys:** venue_id -> venues(id) ON DELETE CASCADE | **RLS:** enabled, 1 policies

## planning_inspiration_dismissals

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| inspiration_item_id | uuid | NO |  |
| dismissed_by | uuid | NO |  |
| dismissed_at | timestamp with time zone | NO | now() |
| reason | text | NO |  |

**Foreign keys:** dismissed_by -> auth.users(id) ON DELETE CASCADE | **RLS:** enabled, 3 policies

## planning_inspiration_items

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| event_name | text | NO |  |
| event_date | date | NO |  |
| category | text | NO |  |
| description | text | YES |  |
| source | text | NO |  |
| generated_at | timestamp with time zone | NO |  |
| created_at | timestamp with time zone | NO | now() |

**RLS:** enabled, 2 policies | **Audit columns:** generated_at, created_at

## planning_item_venues

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| planning_item_id | uuid | NO |  |
| venue_id | uuid | NO |  |
| is_primary | boolean | NO | false |
| created_at | timestamp with time zone | NO | timezone('utc'::text, now()) |

**Foreign keys:** venue_id -> venues(id) ON DELETE RESTRICT; planning_item_id -> planning_items(id) ON DELETE CASCADE | **RLS:** enabled, 1 policies | **Audit columns:** created_at

## planning_items

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| series_id | uuid | YES |  |
| occurrence_on | date | YES |  |
| is_exception | boolean | NO | false |
| title | text | NO |  |
| description | text | YES |  |
| type_label | text | NO |  |
| venue_id | uuid | YES |  |
| owner_id | uuid | YES |  |
| target_date | date | NO |  |
| status | text | NO |  |
| created_by | uuid | YES |  |
| created_at | timestamp with time zone | NO | timezone('utc'::text, now()) |
| updated_at | timestamp with time zone | NO | timezone('utc'::text, now()) |
| event_id | uuid | YES |  |

**Foreign keys:** series_id -> planning_series(id) ON DELETE CASCADE; venue_id -> venues(id) ON DELETE SET NULL; owner_id -> users(id) ON DELETE SET NULL; event_id -> events(id) ON DELETE CASCADE; created_by -> users(id) ON DELETE SET NULL | **RLS:** enabled, 4 policies | **Audit columns:** created_at, updated_at

## planning_series

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| title | text | NO |  |
| description | text | YES |  |
| type_label | text | NO |  |
| venue_id | uuid | YES |  |
| owner_id | uuid | YES |  |
| created_by | uuid | YES |  |
| recurrence_frequency | text | NO |  |
| recurrence_interval | integer | NO | 1 |
| recurrence_weekdays | ARRAY | YES |  |
| recurrence_monthday | smallint | YES |  |
| starts_on | date | NO |  |
| ends_on | date | YES |  |
| is_active | boolean | NO | true |
| generated_through | date | YES |  |
| created_at | timestamp with time zone | NO | timezone('utc'::text, now()) |
| updated_at | timestamp with time zone | NO | timezone('utc'::text, now()) |

**Foreign keys:** venue_id -> venues(id) ON DELETE SET NULL; owner_id -> users(id) ON DELETE SET NULL; created_by -> users(id) ON DELETE SET NULL | **RLS:** enabled, 6 policies | **Audit columns:** created_at, updated_at

## planning_series_task_templates

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| series_id | uuid | NO |  |
| title | text | NO |  |
| default_assignee_id | uuid | YES |  |
| due_offset_days | integer | NO | 0 |
| sort_order | integer | NO | 0 |
| created_at | timestamp with time zone | NO | timezone('utc'::text, now()) |
| updated_at | timestamp with time zone | NO | timezone('utc'::text, now()) |

**Foreign keys:** series_id -> planning_series(id) ON DELETE CASCADE; default_assignee_id -> users(id) ON DELETE SET NULL | **RLS:** enabled, 5 policies | **Audit columns:** created_at, updated_at

## planning_task_assignees

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| task_id | uuid | NO |  |
| user_id | uuid | YES |  |
| created_at | timestamp with time zone | NO | now() |

**Foreign keys:** task_id -> planning_tasks(id) ON DELETE CASCADE; user_id -> users(id) ON DELETE SET NULL | **RLS:** enabled, 4 policies | **Audit columns:** created_at

## planning_task_dependencies

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| task_id | uuid | NO |  |
| depends_on_task_id | uuid | NO |  |
| created_at | timestamp with time zone | NO | now() |

**Foreign keys:** task_id -> planning_tasks(id) ON DELETE CASCADE; depends_on_task_id -> planning_tasks(id) ON DELETE CASCADE | **RLS:** enabled, 3 policies | **Audit columns:** created_at

## planning_tasks

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| planning_item_id | uuid | NO |  |
| title | text | NO |  |
| assignee_id | uuid | YES |  |
| due_date | date | NO |  |
| status | text | NO | 'open'::text |
| completed_at | timestamp with time zone | YES |  |
| sort_order | integer | NO | 0 |
| created_by | uuid | YES |  |
| created_at | timestamp with time zone | NO | timezone('utc'::text, now()) |
| updated_at | timestamp with time zone | NO | timezone('utc'::text, now()) |
| sop_section | text | YES |  |
| sop_template_task_id | uuid | YES |  |
| sop_t_minus_days | integer | YES |  |
| due_date_manually_overridden | boolean | NO | false |
| is_blocked | boolean | NO | false |
| completed_by | uuid | YES |  |
| notes | text | YES |  |
| parent_task_id | uuid | YES |  |
| cascade_venue_id | uuid | YES |  |
| cascade_sop_template_id | uuid | YES |  |
| auto_completed_by_cascade_at | timestamp with time zone | YES |  |
| manually_assigned | boolean | NO | false |

**Foreign keys:** assignee_id -> users(id) ON DELETE SET NULL; planning_item_id -> planning_items(id) ON DELETE CASCADE; sop_template_task_id -> sop_task_templates(id) ON DELETE SET NULL; completed_by -> users(id) ON DELETE SET NULL; parent_task_id -> planning_tasks(id) ON DELETE CASCADE; cascade_venue_id -> venues(id) ON DELETE SET NULL; cascade_sop_template_id -> sop_task_templates(id) ON DELETE SET NULL; created_by -> users(id) ON DELETE SET NULL | **RLS:** enabled, 6 policies | **Audit columns:** created_at, updated_at

## short_links

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| code | text | NO |  |
| name | text | NO |  |
| destination | text | NO |  |
| link_type | text | NO | 'general'::text |
| clicks | integer | NO | 0 |
| expires_at | timestamp with time zone | YES |  |
| created_by | uuid | YES |  |
| created_at | timestamp with time zone | NO | timezone('utc'::text, now()) |
| updated_at | timestamp with time zone | NO | timezone('utc'::text, now()) |

**Foreign keys:** created_by -> users(id) ON DELETE SET NULL | **RLS:** enabled, 2 policies | **Audit columns:** created_at, updated_at

## slt_members

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| user_id | uuid | NO |  |
| added_by | uuid | YES |  |
| added_at | timestamp with time zone | NO | timezone('utc'::text, now()) |

**Foreign keys:** user_id -> users(id) ON DELETE CASCADE; added_by -> users(id) ON DELETE SET NULL | **RLS:** enabled, 2 policies

## sms_campaign_sends

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| event_id | uuid | NO |  |
| customer_id | uuid | NO |  |
| wave | smallint | NO |  |
| status | text | NO | 'claimed'::text |
| reply_code | text | YES |  |
| claimed_at | timestamp with time zone | NO | now() |
| sent_at | timestamp with time zone | YES |  |
| failed_at | timestamp with time zone | YES |  |
| attempt_count | smallint | NO | 0 |
| last_error | text | YES |  |
| next_retry_at | timestamp with time zone | YES |  |
| twilio_sid | text | YES |  |
| converted_at | timestamp with time zone | YES |  |

**Foreign keys:** event_id -> events(id) ON DELETE CASCADE; customer_id -> customers(id) ON DELETE CASCADE | **RLS:** enabled, 1 policies

## sms_inbound_messages

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| twilio_message_sid | text | NO |  |
| from_number | text | NO |  |
| body | text | NO |  |
| processed_at | timestamp with time zone | NO | now() |
| result | text | NO | 'processing'::text |
| booking_id | uuid | YES |  |

**Foreign keys:** booking_id -> event_bookings(id) ON DELETE SET NULL | **RLS:** enabled, 1 policies

## sop_sections

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| label | text | NO |  |
| sort_order | integer | NO | 0 |
| default_assignee_ids | ARRAY | NO | '{}'::uuid[] |
| created_at | timestamp with time zone | NO | now() |
| updated_at | timestamp with time zone | NO | now() |

**RLS:** enabled, 4 policies | **Audit columns:** created_at, updated_at

## sop_task_dependencies

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| task_template_id | uuid | NO |  |
| depends_on_template_id | uuid | NO |  |
| created_at | timestamp with time zone | NO | now() |

**Foreign keys:** task_template_id -> sop_task_templates(id) ON DELETE CASCADE; depends_on_template_id -> sop_task_templates(id) ON DELETE CASCADE | **RLS:** enabled, 4 policies | **Audit columns:** created_at

## sop_task_templates

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| section_id | uuid | NO |  |
| title | text | NO |  |
| sort_order | integer | NO | 0 |
| default_assignee_ids | ARRAY | NO | '{}'::uuid[] |
| t_minus_days | integer | NO | 14 |
| created_at | timestamp with time zone | NO | now() |
| updated_at | timestamp with time zone | NO | now() |
| expansion_strategy | text | NO | 'single'::text |
| venue_filter | text | YES |  |

**Foreign keys:** section_id -> sop_sections(id) ON DELETE CASCADE | **RLS:** enabled, 4 policies | **Audit columns:** created_at, updated_at

## users

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO |  |
| email | text | NO |  |
| full_name | text | YES |  |
| role | text | NO |  |
| venue_id | uuid | YES |  |
| created_at | timestamp with time zone | NO | timezone('utc'::text, now()) |
| updated_at | timestamp with time zone | NO | timezone('utc'::text, now()) |
| previous_role | text | YES |  |
| deactivated_at | timestamp with time zone | YES |  |
| deactivated_by | uuid | YES |  |

**Foreign keys:** id -> auth.users(id) ON DELETE CASCADE; venue_id -> venues(id) ON DELETE SET NULL; deactivated_by -> users(id) ON DELETE SET NULL | **RLS:** enabled, 2 policies | **Audit columns:** created_at, updated_at, deactivated_at

## venue_default_reviewers

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| venue_id | uuid | NO |  |
| reviewer_id | uuid | NO |  |
| created_at | timestamp with time zone | NO | timezone('utc'::text, now()) |

**RLS:** enabled, 1 policies | **Audit columns:** created_at

## venue_opening_hours

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| venue_id | uuid | NO |  |
| service_type_id | uuid | NO |  |
| day_of_week | integer | NO |  |
| open_time | time without time zone | YES |  |
| close_time | time without time zone | YES |  |
| is_closed | boolean | NO | false |
| created_at | timestamp with time zone | NO | timezone('utc'::text, now()) |
| updated_at | timestamp with time zone | NO | timezone('utc'::text, now()) |
| availability | text | NO | 'open'::text |

**Foreign keys:** venue_id -> venues(id) ON DELETE CASCADE; service_type_id -> venue_service_types(id) ON DELETE CASCADE | **RLS:** enabled, 3 policies | **Audit columns:** created_at, updated_at

## venue_opening_override_venues

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| override_id | uuid | NO |  |
| venue_id | uuid | NO |  |

**Foreign keys:** override_id -> venue_opening_overrides(id) ON DELETE CASCADE; venue_id -> venues(id) ON DELETE CASCADE | **RLS:** enabled, 3 policies

## venue_opening_overrides

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| override_date | date | NO |  |
| service_type_id | uuid | NO |  |
| open_time | time without time zone | YES |  |
| close_time | time without time zone | YES |  |
| is_closed | boolean | NO | false |
| note | text | YES |  |
| created_by | uuid | YES |  |
| created_at | timestamp with time zone | NO | timezone('utc'::text, now()) |
| updated_at | timestamp with time zone | NO | timezone('utc'::text, now()) |
| availability | text | NO | 'open'::text |

**Foreign keys:** service_type_id -> venue_service_types(id) ON DELETE CASCADE; created_by -> users(id) ON DELETE SET NULL | **RLS:** enabled, 3 policies | **Audit columns:** created_at, updated_at

## venue_service_types

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| name | text | NO |  |
| display_order | integer | NO | 0 |
| created_at | timestamp with time zone | NO | timezone('utc'::text, now()) |

**RLS:** enabled, 3 policies | **Audit columns:** created_at

## venue_services

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| venue_id | uuid | NO |  |
| service_type_id | uuid | NO |  |
| created_at | timestamp with time zone | NO | timezone('utc'::text, now()) |
| updated_at | timestamp with time zone | NO | timezone('utc'::text, now()) |

**Foreign keys:** venue_id -> venues(id) ON DELETE CASCADE; service_type_id -> venue_service_types(id) ON DELETE CASCADE | **RLS:** enabled, 3 policies | **Audit columns:** created_at, updated_at

## venues

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| name | text | NO |  |
| capacity | integer | YES |  |
| address | text | YES |  |
| created_at | timestamp with time zone | NO | timezone('utc'::text, now()) |
| updated_at | timestamp with time zone | NO | timezone('utc'::text, now()) |
| default_approver_id | uuid | YES |  |
| google_review_url | text | YES |  |
| default_manager_responsible_id | uuid | YES |  |
| category | text | NO | 'pub'::text |

**Foreign keys:** default_approver_id -> users(id) ON DELETE SET NULL; default_manager_responsible_id -> users(id) ON DELETE SET NULL | **RLS:** enabled, 3 policies | **Audit columns:** created_at, updated_at

## weekly_digest_logs

| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| payload | jsonb | NO |  |
| sent_at | timestamp with time zone | NO | timezone('utc'::text, now()) |

**RLS:** enabled, 1 policies

---

## Enum Types (public schema)

| Type | Values |
|------|--------|
| event_status | draft, submitted, needs_revisions, approved, rejected, published, completed |
| user_role | venue_manager, reviewer, central_planner, executive |
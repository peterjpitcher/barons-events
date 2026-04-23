# BaronsHub Database Schema

> Auto-generated from live Supabase database on 2026-04-23.

---

## Tables

### ai_content
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| event_id | uuid | NO | - |
| version | integer | NO | - |
| synopsis | text | YES | - |
| hero_copy | text | YES | - |
| seo_keywords | jsonb | YES | - |
| audience_tags | jsonb | YES | - |
| talent_bios | jsonb | YES | - |
| generated_at | timestamptz | NO | now() |
| generated_by | text | YES | - |
| reviewed_by | uuid | YES | - |
| published_at | timestamptz | YES | - |
| created_at | timestamptz | NO | now() |

**RLS:** service_role ALL only. **FK:** event_id -> events(id).

### ai_publish_queue
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| event_id | uuid | NO | - |
| content_id | uuid | NO | - |
| payload | jsonb | NO | - |
| status | text | NO | 'pending' |
| dispatched_at | timestamptz | YES | - |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |

**RLS:** service_role ALL only. **FK:** content_id -> ai_content(id) CASCADE.

### app_sessions
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| session_id | uuid | NO | gen_random_uuid() |
| user_id | uuid | NO | - |
| created_at | timestamptz | NO | now() |
| last_activity_at | timestamptz | NO | now() |
| expires_at | timestamptz | YES | - |
| user_agent | text | YES | - |
| ip_address | text | YES | - |

**FK:** user_id -> auth.users(id) CASCADE.

### approvals
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| event_id | uuid | NO | - |
| reviewer_id | uuid | YES | - |
| decision | text | NO | - |
| feedback_text | text | YES | - |
| decided_at | timestamptz | NO | now() |

**RLS:** admin ALL; SELECT for event creator/assignee. **FK:** event_id -> events(id) CASCADE, reviewer_id -> users(id).

### artists
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| name | text | NO | - |
| email | text | YES | - |
| phone | text | YES | - |
| artist_type | text | NO | 'artist' |
| description | text | YES | - |
| created_by | uuid | YES | - |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |
| is_curated | boolean | NO | false |
| is_archived | boolean | NO | false |

**RLS:** SELECT true (public); ALL for admin + venue workers. **FK:** created_by -> users(id).

### attachments
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| event_id | uuid | YES | - |
| planning_item_id | uuid | YES | - |
| planning_task_id | uuid | YES | - |
| storage_path | text | NO | - |
| original_filename | text | NO | - |
| mime_type | text | NO | - |
| size_bytes | bigint | NO | - |
| upload_status | text | NO | 'pending' |
| uploaded_by | uuid | YES | - |
| created_at | timestamptz | NO | now() |
| uploaded_at | timestamptz | YES | - |
| deleted_at | timestamptz | YES | - |

**RLS:** INSERT auth; SELECT scoped by role/venue; UPDATE/DELETE admin. **FK:** event_id -> events(id) CASCADE, planning_item_id -> planning_items(id) CASCADE, planning_task_id -> planning_tasks(id) CASCADE, uploaded_by -> users(id).

### audit_log
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| entity | text | NO | - |
| entity_id | text | NO | - |
| action | text | NO | - |
| meta | jsonb | YES | - |
| actor_id | uuid | YES | - |
| created_at | timestamptz | NO | now() |

**RLS:** INSERT by authenticated actor; SELECT admin only. Immutable (no UPDATE/DELETE).

### business_settings
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | boolean | NO | true |
| labour_rate_gbp | numeric | NO | 12.71 |
| updated_by | uuid | YES | - |
| updated_at | timestamptz | NO | now() |

**RLS:** SELECT all auth; UPDATE admin only. **FK:** updated_by -> users(id).

### cron_alert_logs
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| job | text | NO | - |
| severity | text | NO | 'error' |
| message | text | NO | - |
| detail | text | YES | - |
| response_status | integer | YES | - |
| response_body | text | YES | - |
| created_at | timestamptz | NO | now() |

**RLS:** service_role ALL only.

### customers
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| first_name | text | NO | - |
| last_name | text | YES | - |
| mobile | text | NO | - |
| email | text | YES | - |
| marketing_opt_in | boolean | NO | false |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |

**RLS:** SELECT admin; SELECT venue worker (via event_bookings join).

### customer_consent_events
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| customer_id | uuid | NO | - |
| event_type | text | NO | - |
| consent_wording | text | NO | - |
| booking_id | uuid | YES | - |
| created_at | timestamptz | YES | now() |

**RLS:** SELECT if customer visible. **FK:** customer_id -> customers(id) RESTRICT, booking_id -> event_bookings(id).

### debriefs
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| event_id | uuid | NO | - |
| attendance | integer | YES | - |
| wet_takings | numeric | YES | - |
| food_takings | numeric | YES | - |
| promo_effectiveness | smallint | YES | - |
| highlights | text | YES | - |
| issues | text | YES | - |
| submitted_by | uuid | NO | - |
| submitted_at | timestamptz | NO | now() |
| baseline_attendance | integer | YES | - |
| baseline_wet_takings | numeric | YES | - |
| baseline_food_takings | numeric | YES | - |
| guest_sentiment_notes | text | YES | - |
| operational_notes | text | YES | - |
| would_book_again | boolean | YES | - |
| next_time_actions | text | YES | - |
| actual_total_takings | numeric | YES | - |
| baseline_total_takings | numeric | YES | - |
| sales_uplift_value | numeric | YES | - |
| sales_uplift_percent | numeric | YES | - |
| labour_hours | numeric | YES | - |
| labour_rate_gbp_at_submit | numeric | YES | - |

**RLS:** admin ALL; SELECT for event creator/assignee; INSERT/UPDATE for office_worker (own). **FK:** event_id -> events(id) CASCADE, submitted_by -> users(id).

### event_artists
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| event_id | uuid | NO | - |
| artist_id | uuid | NO | - |
| billing_order | integer | NO | 1 |
| role_label | text | YES | - |
| created_by | uuid | YES | - |
| created_at | timestamptz | NO | now() |

**RLS:** ALL/SELECT scoped by event edit/view permission. **FK:** event_id -> events(id) CASCADE, artist_id -> artists(id) CASCADE.

### event_bookings
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| event_id | uuid | NO | - |
| first_name | text | NO | - |
| last_name | text | YES | - |
| mobile | text | NO | - |
| email | text | YES | - |
| ticket_count | integer | NO | - |
| status | text | NO | 'confirmed' |
| created_at | timestamptz | NO | now() |
| sms_confirmation_sent_at | timestamptz | YES | - |
| sms_reminder_sent_at | timestamptz | YES | - |
| sms_post_event_sent_at | timestamptz | YES | - |
| customer_id | uuid | YES | - |

**RLS:** SELECT/UPDATE admin; SELECT/UPDATE venue worker (own venue). **FK:** event_id -> events(id) CASCADE, customer_id -> customers(id).

### event_creation_batches
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| idempotency_key | uuid | NO | - |
| created_by | uuid | NO | - |
| batch_payload | jsonb | NO | - |
| result | jsonb | YES | - |
| created_at | timestamptz | NO | now() |

**RLS:** ALL for admin or own batches. **FK:** created_by -> users(id).

### event_types
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| label | text | NO | - |
| created_at | timestamptz | NO | now() |

**RLS:** SELECT true (public + anon); ALL admin.

### event_venues (junction)
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| event_id | uuid | NO | - |
| venue_id | uuid | NO | - |
| is_primary | boolean | NO | false |
| created_at | timestamptz | NO | now() |

**RLS:** SELECT if event visible. **FK:** event_id -> events(id) CASCADE, venue_id -> venues(id) RESTRICT.

### event_versions
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| event_id | uuid | NO | - |
| version | integer | NO | - |
| payload | jsonb | NO | - |
| submitted_at | timestamptz | YES | - |
| submitted_by | uuid | YES | - |
| created_at | timestamptz | NO | now() |

**RLS:** SELECT for admin/creator/assignee; INSERT by event editors. **FK:** event_id -> events(id) CASCADE, submitted_by -> users(id).

### events
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| venue_id | uuid | NO | - |
| created_by | uuid | YES | - |
| title | text | NO | - |
| event_type | text | YES | - |
| status | text | NO | - |
| start_at | timestamptz | NO | - |
| end_at | timestamptz | YES | - |
| venue_space | text | YES | - |
| expected_headcount | integer | YES | - |
| wet_promo | text | YES | - |
| food_promo | text | YES | - |
| goal_focus | text | YES | - |
| notes | text | YES | - |
| submitted_at | timestamptz | YES | - |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |
| assignee_id | uuid | YES | - |
| cost_total | numeric | YES | - |
| cost_details | text | YES | - |
| public_title | text | YES | - |
| public_description | text | YES | - |
| public_teaser | text | YES | - |
| booking_url | text | YES | - |
| seo_title | text | YES | - |
| seo_description | text | YES | - |
| seo_slug | text | YES | - |
| booking_type | text | YES | - |
| ticket_price | numeric | YES | - |
| terms_and_conditions | text | YES | - |
| public_highlights | text[] | YES | - |
| check_in_cutoff_minutes | integer | YES | - |
| age_policy | text | YES | - |
| accessibility_notes | text | YES | - |
| cancellation_window_hours | integer | YES | - |
| event_image_path | text | YES | - |
| deleted_at | timestamptz | YES | - |
| deleted_by | uuid | YES | - |
| booking_enabled | boolean | NO | false |
| total_capacity | integer | YES | - |
| max_tickets_per_booking | integer | NO | 10 |
| manager_responsible_id | uuid | YES | - |
| sms_promo_enabled | boolean | NO | false |

**RLS:** admin ALL; anon SELECT (approved/completed, not deleted); auth SELECT (admin/exec/office_worker, not deleted); UPDATE by assignee; INSERT/UPDATE by office_worker (scoped). **FK:** venue_id -> venues(id) CASCADE, created_by/assignee_id/deleted_by/manager_responsible_id -> users(id).

### feedback_templates
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| name | text | NO | - |
| body | text | NO | - |
| created_by | uuid | YES | - |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |

**RLS:** service_role ALL only.

### goals
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| label | text | NO | - |
| description | text | YES | - |
| active | boolean | NO | true |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |

**RLS:** SELECT auth + service_role; ALL service_role.

### login_attempts
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| email_hash | text | NO | - |
| ip_address | text | NO | - |
| attempted_at | timestamptz | NO | now() |

**RLS:** No policies listed (likely service_role only).

### notifications
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| user_id | uuid | NO | - |
| type | text | NO | - |
| payload | jsonb | YES | - |
| status | text | NO | 'queued' |
| sent_at | timestamptz | YES | - |
| created_at | timestamptz | NO | now() |

**RLS:** INSERT auth; SELECT own; ALL service_role.

### planning_inspiration_items
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| event_name | text | NO | - |
| event_date | date | NO | - |
| category | text | NO | - |
| description | text | YES | - |
| source | text | NO | - |
| generated_at | timestamptz | NO | - |
| created_at | timestamptz | NO | now() |

**RLS:** SELECT auth; ALL service_role.

### planning_inspiration_dismissals
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| inspiration_item_id | uuid | NO | - |
| dismissed_by | uuid | NO | - |
| dismissed_at | timestamptz | NO | now() |
| reason | text | NO | - |

**RLS:** INSERT/SELECT auth; ALL service_role. **FK:** dismissed_by -> auth.users(id) CASCADE.

### planning_items
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| series_id | uuid | YES | - |
| occurrence_on | date | YES | - |
| is_exception | boolean | NO | false |
| title | text | NO | - |
| description | text | YES | - |
| type_label | text | NO | - |
| venue_id | uuid | YES | - |
| owner_id | uuid | YES | - |
| target_date | date | NO | - |
| status | text | NO | - |
| created_by | uuid | YES | - |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |
| event_id | uuid | YES | - |

**RLS:** SELECT auth; INSERT admin; UPDATE/DELETE admin or owner (office_worker). **FK:** series_id -> planning_series(id) CASCADE, venue_id -> venues(id), owner_id/created_by -> users(id), event_id -> events(id) CASCADE.

### planning_item_venues (junction)
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| planning_item_id | uuid | NO | - |
| venue_id | uuid | NO | - |
| is_primary | boolean | NO | false |
| created_at | timestamptz | NO | now() |

**RLS:** SELECT if planning_item visible. **FK:** planning_item_id -> planning_items(id) CASCADE, venue_id -> venues(id) RESTRICT.

### planning_series
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| title | text | NO | - |
| description | text | YES | - |
| type_label | text | NO | - |
| venue_id | uuid | YES | - |
| owner_id | uuid | YES | - |
| created_by | uuid | YES | - |
| recurrence_frequency | text | NO | - |
| recurrence_interval | integer | NO | 1 |
| recurrence_weekdays | integer[] | YES | - |
| recurrence_monthday | smallint | YES | - |
| starts_on | date | NO | - |
| ends_on | date | YES | - |
| is_active | boolean | NO | true |
| generated_through | date | YES | - |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |

**RLS:** SELECT auth; INSERT admin + office_worker; UPDATE admin (or own for office_worker); DELETE admin. **FK:** venue_id -> venues(id), owner_id/created_by -> users(id).

### planning_series_task_templates
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| series_id | uuid | NO | - |
| title | text | NO | - |
| default_assignee_id | uuid | YES | - |
| due_offset_days | integer | NO | 0 |
| sort_order | integer | NO | 0 |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |

**RLS:** SELECT auth; INSERT/UPDATE/DELETE admin. **FK:** series_id -> planning_series(id) CASCADE, default_assignee_id -> users(id).

### planning_tasks
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| planning_item_id | uuid | NO | - |
| title | text | NO | - |
| assignee_id | uuid | YES | - |
| due_date | date | NO | - |
| status | text | NO | 'open' |
| completed_at | timestamptz | YES | - |
| sort_order | integer | NO | 0 |
| created_by | uuid | YES | - |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |
| sop_section | text | YES | - |
| sop_template_task_id | uuid | YES | - |
| sop_t_minus_days | integer | YES | - |
| due_date_manually_overridden | boolean | NO | false |
| is_blocked | boolean | NO | false |
| completed_by | uuid | YES | - |
| notes | text | YES | - |
| parent_task_id | uuid | YES | - |
| cascade_venue_id | uuid | YES | - |
| cascade_sop_template_id | uuid | YES | - |
| auto_completed_by_cascade_at | timestamptz | YES | - |

**RLS:** SELECT auth; INSERT admin/owner; UPDATE admin/owner + assignees; DELETE admin/owner. **FK:** planning_item_id -> planning_items(id) CASCADE, assignee_id/created_by/completed_by -> users(id), sop_template_task_id/cascade_sop_template_id -> sop_task_templates(id), parent_task_id -> planning_tasks(id) CASCADE, cascade_venue_id -> venues(id).

### planning_task_assignees (junction)
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| task_id | uuid | NO | - |
| user_id | uuid | YES | - |
| created_at | timestamptz | NO | now() |

**RLS:** SELECT auth; INSERT/UPDATE/DELETE admin. **FK:** task_id -> planning_tasks(id) CASCADE, user_id -> users(id).

### planning_task_dependencies (junction)
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| task_id | uuid | NO | - |
| depends_on_task_id | uuid | NO | - |
| created_at | timestamptz | NO | now() |

**RLS:** SELECT auth; INSERT/DELETE admin. **FK:** both -> planning_tasks(id) CASCADE.

### pending_cascade_backfill
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| venue_id | uuid | NO | - |
| queued_at | timestamptz | NO | now() |
| locked_at | timestamptz | YES | - |
| locked_by | uuid | YES | - |
| attempt_count | integer | NO | 0 |
| last_attempt_at | timestamptz | YES | - |
| next_attempt_at | timestamptz | YES | - |
| processed_at | timestamptz | YES | - |
| error | text | YES | - |
| is_dead_letter | boolean | NO | false |

**RLS:** ALL admin. **FK:** venue_id -> venues(id) CASCADE.

### short_links
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| code | text | NO | - |
| name | text | NO | - |
| destination | text | NO | - |
| link_type | text | NO | 'general' |
| clicks | integer | NO | 0 |
| expires_at | timestamptz | YES | - |
| created_by | uuid | YES | - |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |

**RLS:** ALL admin; SELECT auth. **FK:** created_by -> users(id).

### slt_members
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| user_id | uuid | NO | - |
| added_by | uuid | YES | - |
| added_at | timestamptz | NO | now() |

**RLS:** SELECT/ALL admin. **FK:** user_id/added_by -> users(id).

### sms_campaign_sends
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| event_id | uuid | NO | - |
| customer_id | uuid | NO | - |
| wave | smallint | NO | - |
| status | text | NO | 'claimed' |
| reply_code | text | YES | - |
| claimed_at | timestamptz | NO | now() |
| sent_at | timestamptz | YES | - |
| failed_at | timestamptz | YES | - |
| attempt_count | smallint | NO | 0 |
| last_error | text | YES | - |
| next_retry_at | timestamptz | YES | - |
| twilio_sid | text | YES | - |
| converted_at | timestamptz | YES | - |

**RLS:** ALL true (service_role context). **FK:** event_id -> events(id) CASCADE, customer_id -> customers(id) CASCADE.

### sms_inbound_messages
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| twilio_message_sid | text | NO | - |
| from_number | text | NO | - |
| body | text | NO | - |
| processed_at | timestamptz | NO | now() |
| result | text | NO | 'processing' |
| booking_id | uuid | YES | - |

**RLS:** ALL true (service_role context). **FK:** booking_id -> event_bookings(id).

### sop_sections
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| label | text | NO | - |
| sort_order | integer | NO | 0 |
| default_assignee_ids | uuid[] | NO | '{}' |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |

**RLS:** SELECT admin/executive; INSERT/UPDATE/DELETE admin.

### sop_task_templates
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| section_id | uuid | NO | - |
| title | text | NO | - |
| sort_order | integer | NO | 0 |
| default_assignee_ids | uuid[] | NO | '{}' |
| t_minus_days | integer | NO | 14 |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |
| expansion_strategy | text | NO | 'single' |
| venue_filter | text | YES | - |

**RLS:** SELECT admin/executive; INSERT/UPDATE/DELETE admin. **FK:** section_id -> sop_sections(id) CASCADE.

### sop_task_dependencies (junction)
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| task_template_id | uuid | NO | - |
| depends_on_template_id | uuid | NO | - |
| created_at | timestamptz | NO | now() |

**RLS:** SELECT admin/executive; INSERT/UPDATE/DELETE admin. **FK:** both -> sop_task_templates(id) CASCADE.

### users
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | - |
| email | text | NO | - |
| full_name | text | YES | - |
| role | text | NO | - |
| venue_id | uuid | YES | - |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |
| previous_role | text | YES | - |
| deactivated_at | timestamptz | YES | - |
| deactivated_by | uuid | YES | - |

**RLS:** admin ALL; SELECT own row. **FK:** id -> auth.users(id) CASCADE, venue_id -> venues(id), deactivated_by -> users(id).

### venues
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| name | text | NO | - |
| capacity | integer | YES | - |
| address | text | YES | - |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |
| default_approver_id | uuid | YES | - |
| google_review_url | text | YES | - |
| default_manager_responsible_id | uuid | YES | - |
| category | text | NO | 'pub' |

**RLS:** SELECT true (public + anon); ALL admin. **FK:** default_approver_id/default_manager_responsible_id -> users(id).

### venue_default_reviewers
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| venue_id | uuid | NO | - |
| reviewer_id | uuid | NO | - |
| created_at | timestamptz | NO | now() |

**RLS:** ALL service_role only.

### venue_service_types
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| name | text | NO | - |
| display_order | integer | NO | 0 |
| created_at | timestamptz | NO | now() |

**RLS:** SELECT true (public); ALL admin.

### venue_opening_hours
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| venue_id | uuid | NO | - |
| service_type_id | uuid | NO | - |
| day_of_week | integer | NO | - |
| open_time | time | YES | - |
| close_time | time | YES | - |
| is_closed | boolean | NO | false |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |

**RLS:** SELECT true (public); ALL admin. **FK:** venue_id -> venues(id) CASCADE, service_type_id -> venue_service_types(id) CASCADE.

### venue_opening_overrides
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| override_date | date | NO | - |
| service_type_id | uuid | NO | - |
| open_time | time | YES | - |
| close_time | time | YES | - |
| is_closed | boolean | NO | false |
| note | text | YES | - |
| created_by | uuid | YES | - |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |

**RLS:** SELECT true (public); ALL admin. **FK:** service_type_id -> venue_service_types(id) CASCADE, created_by -> users(id).

### venue_opening_override_venues (junction)
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| override_id | uuid | NO | - |
| venue_id | uuid | NO | - |

**RLS:** SELECT true (public); ALL admin. **FK:** override_id -> venue_opening_overrides(id) CASCADE, venue_id -> venues(id) CASCADE.

### weekly_digest_logs
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| payload | jsonb | NO | - |
| sent_at | timestamptz | NO | now() |

**RLS:** service_role ALL only.

---

## Enums (public schema)

| Enum | Values |
|------|--------|
| `event_status` | draft, submitted, needs_revisions, approved, rejected, published, completed |
| `user_role` | venue_manager, reviewer, central_planner, executive |

> Note: `user_role` enum exists in the DB but the application uses text column `users.role` with values `administrator`, `office_worker`, `executive` instead. The enum appears to be a legacy artifact.

---

## Key Relationships Summary

- **events** is the central entity, linked to venues, users (creator/assignee/manager), artists (via event_artists), bookings, versions, approvals, debriefs, and attachments.
- **planning_series** -> **planning_items** -> **planning_tasks** forms the planning hierarchy, with optional link to events via `planning_items.event_id`.
- **SOP** (sop_sections -> sop_task_templates -> sop_task_dependencies) provides task templates that generate planning_tasks.
- **customers** are linked to event_bookings and consent_events, with SMS campaign tracking via sms_campaign_sends.
- **venues** have opening hours (venue_opening_hours), overrides, service types, and default reviewers/managers.

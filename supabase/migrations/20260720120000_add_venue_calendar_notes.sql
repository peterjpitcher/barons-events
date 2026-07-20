-- Venue calendar notes: lightweight date-marked venue occupancy (weddings,
-- private hires) handled outside BaronsHub. No planning, no publishing.
begin;

create table if not exists public.venue_calendar_notes (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  start_date date not null,
  end_date date null,
  title text not null,
  detail text null,
  created_by uuid null references public.users(id) on delete set null,
  deleted_by uuid null references public.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  deleted_at timestamptz null,
  constraint venue_calendar_notes_end_after_start
    check (end_date is null or (end_date >= start_date and end_date <= start_date + 31)),
  constraint venue_calendar_notes_title_length
    check (char_length(btrim(title)) between 1 and 200),
  constraint venue_calendar_notes_detail_length
    check (detail is null or char_length(detail) <= 2000)
);

create index if not exists idx_venue_calendar_notes_venue_dates
  on public.venue_calendar_notes (venue_id, start_date, end_date)
  where deleted_at is null;

drop trigger if exists trg_venue_calendar_notes_updated on public.venue_calendar_notes;
create trigger trg_venue_calendar_notes_updated
  before update on public.venue_calendar_notes
  for each row execute procedure public.set_updated_at();

-- RLS: read = any app role; INSERT/UPDATE = admin anywhere, manager only for
-- own venue; no client DELETE (deletion is a soft-delete UPDATE).
alter table public.venue_calendar_notes enable row level security;

drop policy if exists "venue calendar notes read scoped" on public.venue_calendar_notes;
create policy "venue calendar notes read scoped"
  on public.venue_calendar_notes
  for select to authenticated
  using (
    public.current_user_role() in ('administrator', 'manager')
    and deleted_at is null
  );

drop policy if exists "venue calendar notes insert scoped" on public.venue_calendar_notes;
create policy "venue calendar notes insert scoped"
  on public.venue_calendar_notes
  for insert to authenticated
  with check (
    public.current_user_role() = 'administrator'
    or (
      public.current_user_role() = 'manager'
      and public.current_user_venue_id() is not null
      and venue_id = public.current_user_venue_id()
      and created_by = auth.uid()
    )
  );

drop policy if exists "venue calendar notes update scoped" on public.venue_calendar_notes;
create policy "venue calendar notes update scoped"
  on public.venue_calendar_notes
  for update to authenticated
  using (
    public.current_user_role() = 'administrator'
    or (
      public.current_user_role() = 'manager'
      and public.current_user_venue_id() is not null
      and venue_id = public.current_user_venue_id()
    )
  )
  with check (
    public.current_user_role() = 'administrator'
    or (
      public.current_user_role() = 'manager'
      and public.current_user_venue_id() is not null
      and venue_id = public.current_user_venue_id()
    )
  );

-- Audit allow-lists.
-- Entity list: newest definition is 20260604120000 (no later migration changed
-- it); recreated verbatim plus the new calendar_note entity.
alter table public.audit_log drop constraint if exists audit_log_entity_check;
alter table public.audit_log
  add constraint audit_log_entity_check
  check (entity in (
    'event', 'sop_template', 'planning_task', 'auth',
    'customer', 'booking', 'user',
    'venue', 'artist', 'event_type', 'link', 'opening_hours', 'planning',
    'slt_member', 'business_settings', 'attachment', 'digest', 'payment',
    'sales_report', 'note',
    'calendar_note'  -- NEW
  )) not valid;

-- Action list: newest definition is 20260625200000_fix_audit_action_allowlist
-- (later than the plan's 20260604120000 baseline). Recreated verbatim from that
-- migration plus the three new calendar_note actions.
alter table public.audit_log drop constraint if exists audit_log_action_check;
alter table public.audit_log
  add constraint audit_log_action_check check (action = any (array[
    'event.created', 'event.updated', 'event.artists_updated', 'event.submitted',
    'event.approved', 'event.needs_revisions', 'event.rejected', 'event.cancelled',
    'event.completed', 'event.assignee_changed', 'event.deleted', 'event.status_changed',
    'event.website_copy_generated', 'event.debrief_updated', 'event.terms_generated',
    'event.draft_saved', 'event.booking_settings_updated',
    'sop_section.created', 'sop_section.updated', 'sop_section.deleted',
    'sop_section.assignees_propagated',
    'sop_task_template.created', 'sop_task_template.updated', 'sop_task_template.deleted',
    'sop_task_template.assignees_propagated',
    'sop_dependency.created', 'sop_dependency.deleted', 'sop_checklist.generated',
    'sop_checklist.dates_recalculated', 'sop_backfill_completed',
    'planning.item_created', 'planning.item_updated', 'planning.item_deleted',
    'planning.series_created', 'planning.series_updated', 'planning.series_paused',
    'planning.task_created', 'planning.task_updated', 'planning.task_deleted',
    'planning_task.status_changed', 'planning_task.reassigned',
    'planning_task.dependency_added', 'planning_task.dependency_removed',
    'planning_task.notes_updated', 'planning_task.cascade_spawn',
    'planning_task.cascade_autocompleted', 'planning_task.cascade_reopened',
    'planning_task.debrief_created', 'planning_task.debrief_autocompleted',
    'planning_task.auto_not_required',
    'auth.login.success', 'auth.login.failure', 'auth.login.service_error',
    'auth.lockout', 'auth.logout', 'auth.password_reset.requested',
    'auth.password_updated', 'auth.invite.sent', 'auth.invite.accepted',
    'auth.invite.resent', 'auth.role.changed', 'auth.session.expired.idle',
    'auth.session.expired.absolute',
    'customer.erased',
    'booking.created', 'booking.updated', 'booking.cancelled',
    'user.deactivated', 'user.reactivated', 'user.deleted',
    'user.sensitive_column_changed', 'user.updated', 'user.central_lead_set',
    'user.preference_updated',
    'venue.created', 'venue.updated', 'venue.deleted',
    'artist.created', 'artist.updated', 'artist.archived', 'artist.restored',
    'event_type.created', 'event_type.updated', 'event_type.deleted',
    'link.created', 'link.updated', 'link.deleted', 'link.variant_created',
    'opening_hours.service_type_created', 'opening_hours.service_type_updated',
    'opening_hours.service_type_deleted', 'opening_hours.hours_saved',
    'opening_hours.multi_venue_hours_saved', 'opening_hours.override_created',
    'opening_hours.override_updated', 'opening_hours.override_deleted',
    'slt_member.added', 'slt_member.removed', 'slt_email.delivery_failed',
    'business_settings.updated',
    'attachment.uploaded', 'attachment.upload_failed', 'attachment.deleted',
    'attachment.version_added', 'attachment.renamed',
    'event.proposed', 'event.pre_approved', 'event.pre_rejected', 'event.pre_expired',
    'venue.category_changed', 'sop_task_template.expansion_changed',
    'planning.inspiration_dismissed', 'planning.inspiration_refreshed',
    'digest.batch_sent',
    'payment.order_created', 'payment.order_creation_failed', 'payment.captured',
    'payment.capture_failed', 'payment.capture_local_update_failed',
    'payment.refund_requested', 'payment.refund_completed',
    'payment.webhook_received', 'payment.webhook_processed',
    'sales_report.sent',
    'note.created', 'note.deleted',
    'booking.transfer_requested', 'booking.transferred', 'booking.transfer_email_failed',
    'event.cancellation_requested', 'event.cancelled_with_cascade', 'event.cancellation_failed',
    'event.rescheduled',
    'calendar_note.created',  -- NEW
    'calendar_note.updated',  -- NEW
    'calendar_note.deleted'   -- NEW
  ])) not valid;

commit;

notify pgrst, 'reload schema';

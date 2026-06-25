-- Paid booking transfer + safe event cancellation cascade.
-- Adds a 'transferred' payment status, an immutable booking_transfers audit table,
-- widens the audit_log action CHECK for transfer/cancellation actions, and a
-- security-definer transfer_booking RPC that moves a paid booking to another event
-- while keeping payment_transactions.event_id on the original sale event (finance
-- attribution is preserved; only booking_id moves to the new active booking).
--
-- This migration is NOT purely additive: it replaces two CHECK constraints.
-- It performs no destructive data operations (no DROP COLUMN / DROP TABLE).

-- 1. Allow 'transferred' on event_bookings.payment_status -------------------------
alter table public.event_bookings
  drop constraint if exists event_bookings_payment_status_check;
alter table public.event_bookings
  add constraint event_bookings_payment_status_check
  check (payment_status in (
    'not_required',
    'pending',
    'completed',
    'failed',
    'refunded',
    'partially_refunded',
    'transferred'
  ));

-- 2. Immutable transfer audit trail -----------------------------------------------
-- All references use ON DELETE SET NULL (not RESTRICT) so deleting an
-- event/transaction/booking does NOT block — the audit ROW survives with its
-- denormalised columns (from_event_title, to_event_title, ticket_count,
-- amount_pence, reason, admin_user_id, created_at, idempotency_key) intact. This
-- preserves transfer history without breaking the existing event hard-delete path
-- (events/payment_transactions/event_bookings are ON DELETE CASCADE elsewhere).
create table if not exists public.booking_transfers (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid references public.payment_transactions(id) on delete set null,
  from_booking_id uuid references public.event_bookings(id) on delete set null,
  to_booking_id uuid references public.event_bookings(id) on delete set null,
  from_event_id uuid references public.events(id) on delete set null,
  to_event_id uuid references public.events(id) on delete set null,
  from_event_title text not null,
  to_event_title text not null,
  from_event_start_at timestamptz,
  to_event_start_at timestamptz,
  ticket_count int not null check (ticket_count >= 1),
  amount_pence int not null check (amount_pence > 0),
  reason text,
  admin_user_id uuid references public.users(id) on delete set null,
  transfer_email_sent_at timestamptz,
  transfer_email_failed_at timestamptz,
  manual_contact_required boolean not null default false,
  idempotency_key text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists idx_booking_transfers_transaction
  on public.booking_transfers(transaction_id);
create index if not exists idx_booking_transfers_from_event
  on public.booking_transfers(from_event_id);
create index if not exists idx_booking_transfers_to_event
  on public.booking_transfers(to_event_id);

-- 3. RLS — mirror payment_refunds: service-role writes, staff read ----------------
alter table public.booking_transfers enable row level security;

drop policy if exists "Service role manages booking transfers" on public.booking_transfers;
create policy "Service role manages booking transfers"
  on public.booking_transfers for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "Staff can view booking transfers" on public.booking_transfers;
create policy "Staff can view booking transfers"
  on public.booking_transfers for select
  to authenticated
  using (current_user_role() = any (array['administrator'::text, 'manager'::text]));

-- 4. Widen audit_log action CHECK -------------------------------------------------
-- Reproduces the full existing list (NOT VALID, matching the existing constraint
-- so historical rows are not re-validated) plus six new transfer/cancellation actions.
alter table public.audit_log
  drop constraint if exists audit_log_action_check;
alter table public.audit_log
  add constraint audit_log_action_check check (action = any (array[
    'event.created', 'event.updated', 'event.artists_updated', 'event.submitted',
    'event.approved', 'event.needs_revisions', 'event.rejected', 'event.cancelled',
    'event.completed', 'event.assignee_changed', 'event.deleted', 'event.status_changed',
    'event.website_copy_generated', 'event.debrief_updated', 'event.terms_generated',
    'event.draft_saved', 'event.booking_settings_updated',
    'sop_section.created', 'sop_section.updated', 'sop_section.deleted',
    'sop_task_template.created', 'sop_task_template.updated', 'sop_task_template.deleted',
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
    'link.created', 'link.updated', 'link.deleted',
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
    -- New (booking transfer + safe cancellation cascade + reschedule wizard):
    'booking.transfer_requested', 'booking.transferred', 'booking.transfer_email_failed',
    'event.cancellation_requested', 'event.cancelled_with_cascade', 'event.cancellation_failed',
    'event.rescheduled'
  ])) not valid;

-- 5. transfer_booking RPC ---------------------------------------------------------
-- Atomic, idempotent (keyed on booking_transfers.idempotency_key). Keeps
-- payment_transactions.event_id on the ORIGINAL event (finance attribution) and
-- moves only booking_id to the new active booking. Returns jsonb so the caller can
-- tell a fresh transfer (created=true → send email) from an idempotent replay
-- (created=false → do not resend email).
create or replace function public.transfer_booking(
  p_source_booking_id uuid,
  p_target_event_id uuid,
  p_admin_user_id uuid,
  p_reason text,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_src public.event_bookings;
  v_tx public.payment_transactions;
  v_tgt public.events;
  v_src_event public.events;
  v_booked int;
  v_expected_pence int;
  v_new_booking_id uuid;
  v_existing public.booking_transfers;
begin
  select * into v_existing
  from public.booking_transfers
  where idempotency_key = p_idempotency_key;

  if found then
    return jsonb_build_object(
      'booking_id', v_existing.to_booking_id,
      'transfer_id', v_existing.id,
      'created', false
    );
  end if;

  select * into v_src
  from public.event_bookings
  where id = p_source_booking_id
  for update;

  if not found then raise exception 'source_booking_not_found'; end if;
  if v_src.status <> 'confirmed' or v_src.payment_status <> 'completed' then
    raise exception 'source_not_transferable';
  end if;
  if v_src.event_id = p_target_event_id then
    raise exception 'same_event_transfer_not_allowed';
  end if;

  select * into v_tx
  from public.payment_transactions
  where id = v_src.payment_transaction_id
  for update;

  if not found
     or v_tx.status <> 'completed'
     or v_tx.refunded_amount_pence <> 0
     or v_tx.booking_id <> v_src.id
     or v_tx.event_id <> v_src.event_id then
    raise exception 'transaction_not_transferable';
  end if;

  select * into v_src_event
  from public.events
  where id = v_src.event_id;

  select * into v_tgt
  from public.events
  where id = p_target_event_id
  for update;

  if not found or v_tgt.deleted_at is not null then
    raise exception 'target_not_found';
  end if;

  if v_tgt.status <> 'approved'
     or v_tgt.booking_enabled is not true
     or v_tgt.booking_type not in ('paid_seated', 'paid_standing', 'paid_standing_unreserved')
     or v_tgt.booking_url is not null
     or v_tgt.ticket_price is null
     or v_tgt.start_at <= now() then
    raise exception 'target_not_eligible';
  end if;

  v_expected_pence := round(v_tgt.ticket_price * 100)::int * v_src.ticket_count;
  if v_expected_pence <> v_tx.amount_pence then
    raise exception 'price_mismatch';
  end if;

  if v_tgt.total_capacity is not null then
    select coalesce(sum(ticket_count), 0) into v_booked
    from public.event_bookings
    where event_id = p_target_event_id
      and status = 'confirmed';

    if v_booked + v_src.ticket_count > v_tgt.total_capacity then
      raise exception 'target_capacity_exceeded';
    end if;
  end if;

  insert into public.event_bookings (
    event_id,
    first_name,
    last_name,
    mobile,
    email,
    ticket_count,
    status,
    payment_status,
    payment_transaction_id,
    payment_completed_at,
    customer_id,
    customer_notes
  ) values (
    p_target_event_id,
    v_src.first_name,
    v_src.last_name,
    v_src.mobile,
    v_src.email,
    v_src.ticket_count,
    'confirmed',
    'completed',
    v_tx.id,
    v_tx.completed_at,
    v_src.customer_id,
    v_src.customer_notes
  )
  returning id into v_new_booking_id;

  -- Move only booking_id; event_id stays on the original sale event (D1).
  update public.payment_transactions
  set
    booking_id = v_new_booking_id,
    updated_at = now(),
    metadata = metadata || jsonb_build_object(
      'transfers',
      coalesce(metadata->'transfers', '[]'::jsonb) ||
      jsonb_build_array(jsonb_build_object(
        'from_event_id', v_src.event_id,
        'to_event_id', p_target_event_id,
        'from_booking_id', v_src.id,
        'to_booking_id', v_new_booking_id,
        'at', now()
      ))
    )
  where id = v_tx.id;

  update public.event_bookings
  set
    status = 'cancelled',
    payment_status = 'transferred',
    payment_transaction_id = null
  where id = v_src.id;

  insert into public.booking_transfers (
    transaction_id,
    from_booking_id,
    to_booking_id,
    from_event_id,
    to_event_id,
    from_event_title,
    to_event_title,
    from_event_start_at,
    to_event_start_at,
    ticket_count,
    amount_pence,
    reason,
    admin_user_id,
    manual_contact_required,
    idempotency_key
  ) values (
    v_tx.id,
    v_src.id,
    v_new_booking_id,
    v_src.event_id,
    p_target_event_id,
    coalesce(v_src_event.title, 'Original event'),
    coalesce(v_tgt.title, 'Target event'),
    v_src_event.start_at,
    v_tgt.start_at,
    v_src.ticket_count,
    v_tx.amount_pence,
    p_reason,
    p_admin_user_id,
    v_src.email is null,
    p_idempotency_key
  );

  return jsonb_build_object(
    'booking_id', v_new_booking_id,
    'transaction_id', v_tx.id,
    'from_event_id', v_src.event_id,
    'to_event_id', p_target_event_id,
    'amount_pence', v_tx.amount_pence,
    'created', true,
    'manual_contact_required', v_src.email is null
  );
end;
$$;

-- Lock the security-definer function down to the service role only. It must never
-- be callable directly by an authenticated user via PostgREST — all access goes
-- through the administrator-gated server action using the service-role client.
-- Supabase grants EXECUTE to anon + authenticated by default on function creation,
-- so revoke from all of public/anon/authenticated, then grant only to service_role.
revoke all on function public.transfer_booking(uuid, uuid, uuid, text, text) from public;
revoke all on function public.transfer_booking(uuid, uuid, uuid, text, text) from anon;
revoke all on function public.transfer_booking(uuid, uuid, uuid, text, text) from authenticated;
grant execute on function public.transfer_booking(uuid, uuid, uuid, text, text) to service_role;

notify pgrst, 'reload schema';

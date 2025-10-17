drop view if exists public.cron_notification_failures;
create view public.cron_notification_failures as
select
  n.id,
  n.created_at,
  n.status,
  n.user_id,
  u.email as reviewer_email,
  u.full_name as reviewer_name,
  (n.payload ->> 'event_id')::uuid as event_id,
  n.payload ->> 'title' as event_title,
  coalesce(n.payload ->> 'venue', n.payload ->> 'venue_name') as venue_name,
  n.payload ->> 'severity' as severity,
  n.payload -> 'send_meta' ->> 'error' as error_message,
  n.payload -> 'send_meta' ->> 'retry_after' as retry_after,
  n.payload -> 'send_meta' ->> 'attempted_at' as attempted_at,
  coalesce((n.payload -> 'send_meta' ->> 'retry_count')::int, 0) as retry_count
from public.notifications n
left join public.users u on u.id = n.user_id
where n.type = 'sla_warning'
  and n.status in ('queued', 'failed');

grant select on public.cron_notification_failures to authenticated;

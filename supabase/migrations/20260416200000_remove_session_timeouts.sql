-- Remove session timeout infrastructure.
-- Sessions now persist until explicit sign-out, deactivation, or 90-day staleness.

-- 1. Make expires_at nullable (new code inserts NULL)
ALTER TABLE public.app_sessions ALTER COLUMN expires_at DROP DEFAULT;
ALTER TABLE public.app_sessions ALTER COLUMN expires_at DROP NOT NULL;

-- 2. Clear expiry on all existing sessions
UPDATE public.app_sessions SET expires_at = NULL;

-- 3. Drop the now-unused expires_at index (all values will be NULL)
DROP INDEX IF EXISTS idx_app_sessions_expires_at;

-- 4. Replace cleanup_auth_records() to use 90-day staleness
CREATE OR REPLACE FUNCTION public.cleanup_auth_records()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Delete stale sessions (no activity for 90+ days)
  DELETE FROM public.app_sessions
  WHERE last_activity_at < now() - interval '90 days';

  -- Login attempt cleanup (30-min lockout window)
  DELETE FROM public.login_attempts
  WHERE attempted_at < now() - interval '30 minutes'
    AND ip_address NOT IN ('password_reset', 'password_reset_ip');

  -- Password reset attempt cleanup (60-min reset window)
  DELETE FROM public.login_attempts
  WHERE attempted_at < now() - interval '60 minutes'
    AND ip_address IN ('password_reset', 'password_reset_ip');
END;
$$;

-- Preserve service_role-only access
REVOKE ALL ON FUNCTION public.cleanup_auth_records() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_auth_records() TO service_role;

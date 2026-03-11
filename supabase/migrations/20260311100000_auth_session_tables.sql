-- Auth session layer: app_sessions table
-- Stores custom session records for idle timeout (30min), absolute timeout (24h), and server-side revocation.
-- Accessed exclusively via service-role client (no RLS policies needed — no user can access directly).

CREATE TABLE IF NOT EXISTS public.app_sessions (
  session_id   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '24 hours',
  user_agent   TEXT,
  ip_address   TEXT
);

CREATE INDEX IF NOT EXISTS idx_app_sessions_user_id ON public.app_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_app_sessions_expires_at ON public.app_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_app_sessions_last_activity ON public.app_sessions(last_activity_at);

ALTER TABLE public.app_sessions ENABLE ROW LEVEL SECURITY;
-- No RLS policies: only service-role client accesses this table.

-- Login attempts table for account lockout (per email+IP) and rate limiting.
-- Accessed exclusively via service-role client.

CREATE TABLE IF NOT EXISTS public.login_attempts (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email_hash   TEXT        NOT NULL,  -- SHA-256 of lowercased email
  ip_address   TEXT        NOT NULL,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_lookup ON public.login_attempts(email_hash, ip_address, attempted_at);
CREATE INDEX IF NOT EXISTS idx_login_attempts_cleanup ON public.login_attempts(attempted_at);

ALTER TABLE public.login_attempts ENABLE ROW LEVEL SECURITY;
-- No RLS policies: only service-role client accesses this table.

-- Cleanup function: removes sessions older than 24h or idle >30min, and login attempts older than 24h.
CREATE OR REPLACE FUNCTION public.cleanup_auth_records()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Remove absolutely expired sessions
  DELETE FROM public.app_sessions WHERE expires_at < now();
  -- Remove idle-expired sessions (no activity for 30+ minutes)
  DELETE FROM public.app_sessions WHERE last_activity_at < now() - INTERVAL '30 minutes';
  -- Remove old login attempt records (older than 24h — keep for audit, but lockout only uses 15min window)
  DELETE FROM public.login_attempts WHERE attempted_at < now() - INTERVAL '24 hours';
END;
$$;

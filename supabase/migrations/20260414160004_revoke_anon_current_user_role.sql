-- Auth Hardening — Gap 2.2: Revoke Anon from current_user_role()
--
-- The current_user_role() function was previously granted to anon
-- (in 20250301000000_secure_current_user_role.sql). Anonymous users
-- should never need to resolve a role — revoke to reduce attack surface.

revoke execute on function public.current_user_role() from anon;
revoke execute on function public.current_user_role() from public;

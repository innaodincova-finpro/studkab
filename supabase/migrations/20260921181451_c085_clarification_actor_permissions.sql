-- C085: C084 invoker functions need only actor identity, never Auth secrets.
-- Edge authenticates the caller; SQL independently checks the configured executor.
-- Keep SECURITY INVOKER and all existing RPC/row ownership restrictions.
grant select (id, email) on auth.users to service_role;

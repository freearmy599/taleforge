revoke execute on function public.taleforge_refresh_system_health() from anon, authenticated;
grant execute on function public.taleforge_refresh_system_health() to service_role;

alter view public.taleforge_system_health_snapshot set (security_invoker = true);

select public.taleforge_refresh_system_health();

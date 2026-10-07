delete from public.taleforge_system_dependencies
where system_key = 'verification'
  and depends_on_system_key = 'autonomous_series';

select public.taleforge_refresh_system_health();

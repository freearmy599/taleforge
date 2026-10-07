-- Integrate canonical Narrative Memory into the existing Generation Context Engine.
alter function public.taleforge_build_generation_context(uuid) rename to taleforge_build_generation_context_base;

create or replace function public.taleforge_build_generation_context(p_blueprint_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare base jsonb; memory jsonb; final_context jsonb; snapshot_id uuid; final_hash text;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role required'; end if;
  base := public.taleforge_build_generation_context_base(p_blueprint_id);
  memory := public.taleforge_build_narrative_memory(p_blueprint_id);
  final_context := jsonb_set(base->'context','{narrative_memory}',coalesce(memory->'payload','{}'::jsonb),true);
  final_context := jsonb_set(final_context,'{context_version}',to_jsonb('generation-context-v2'::text),true);
  final_hash := md5(final_context::text);
  update public.taleforge_generation_context_snapshots
  set context_hash=final_hash,payload=final_context
  where id=(base->>'snapshot_id')::uuid
  returning id into snapshot_id;
  return jsonb_build_object('snapshot_id',snapshot_id,'context_hash',final_hash,'context',final_context,'narrative_memory_snapshot_id',memory->>'snapshot_id','narrative_memory_hash',memory->>'memory_hash','context_version','generation-context-v2');
end; $$;

revoke all on function public.taleforge_build_generation_context(uuid) from public,anon,authenticated;
grant execute on function public.taleforge_build_generation_context(uuid) to service_role;
-- Fix narrative memory snapshot builder ordering and bounded chapter history.
create or replace function public.taleforge_build_narrative_memory(p_blueprint_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare b record; payload jsonb; memory_hash text; snapshot_id uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role required'; end if;
  select cb.id,cb.series_id,cb.chapter_number into b from public.chapter_blueprints cb where cb.id=p_blueprint_id limit 1;
  if b.id is null then raise exception 'chapter blueprint not found'; end if;
  select jsonb_build_object(
    'memory_version','narrative-memory-v1','series_id',b.series_id,
    'through_chapter',coalesce((select current_chapter_number from public.story_continuity_state where series_id=b.series_id),b.chapter_number-1),
    'continuity_state',(select to_jsonb(cs) from public.story_continuity_state cs where cs.series_id=b.series_id),
    'characters',coalesce((select jsonb_agg(to_jsonb(c) order by c.last_seen_chapter desc nulls last,c.name) from public.story_characters c where c.series_id=b.series_id),'[]'::jsonb),
    'relationships',coalesce((select jsonb_agg(to_jsonb(r) order by r.last_changed_chapter desc nulls last) from public.character_relationships r where r.series_id=b.series_id),'[]'::jsonb),
    'world_elements',coalesce((select jsonb_agg(to_jsonb(w) order by w.last_referenced_chapter desc nulls last,w.name) from public.story_world_elements w where w.series_id=b.series_id),'[]'::jsonb),
    'character_events',coalesce((select jsonb_agg(to_jsonb(e) order by e.chapter_number desc,e.created_at desc) from public.character_continuity_events e where e.series_id=b.series_id and e.chapter_number < b.chapter_number),'[]'::jsonb),
    'world_events',coalesce((select jsonb_agg(to_jsonb(e) order by e.chapter_number desc,e.created_at desc) from public.world_continuity_events e where e.series_id=b.series_id and e.chapter_number < b.chapter_number),'[]'::jsonb),
    'chapter_snapshots',coalesce((select jsonb_agg(to_jsonb(x) order by x.chapter_number desc) from (select s.* from public.chapter_continuity_snapshots s where s.series_id=b.series_id and s.chapter_number < b.chapter_number order by s.chapter_number desc limit 12) x),'[]'::jsonb),
    'arc_plan',(select to_jsonb(a) from public.story_arc_plan a where a.series_id=b.series_id and a.status='active' order by a.version desc limit 1)
  ) into payload;
  if payload is null then payload=jsonb_build_object('memory_version','narrative-memory-v1','series_id',b.series_id,'through_chapter',b.chapter_number-1,'characters','[]'::jsonb,'relationships','[]'::jsonb,'world_elements','[]'::jsonb,'character_events','[]'::jsonb,'world_events','[]'::jsonb,'chapter_snapshots','[]'::jsonb); end if;
  memory_hash=md5(payload::text);
  insert into public.taleforge_narrative_memory_snapshots(series_id,chapter_number,source_blueprint_id,memory_version,memory_hash,payload)
  values(b.series_id,b.chapter_number,b.id,'narrative-memory-v1',memory_hash,payload) returning id into snapshot_id;
  return jsonb_build_object('snapshot_id',snapshot_id,'memory_hash',memory_hash,'memory_version','narrative-memory-v1','payload',payload);
end; $$;

-- TaleForge Plot Thread Lifecycle Intelligence
-- Adds deterministic chapter-level thread events without invoking an AI provider.
create table if not exists public.taleforge_narrative_thread_events (
 id uuid primary key default gen_random_uuid(),
 thread_id uuid not null references public.taleforge_narrative_threads(id) on delete cascade,
 series_id uuid not null references public.series(id) on delete cascade,
 chapter_number integer not null,
 event_type text not null check (event_type in ('introduced','advanced','clue','foreshadowed','targeted','paid_off','resolved','stale','reopened')),
 evidence jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(),
 unique(thread_id,chapter_number,event_type)
);
create index if not exists idx_thread_events_thread on public.taleforge_narrative_thread_events(thread_id,chapter_number desc);
alter table public.taleforge_narrative_thread_events enable row level security;
drop policy if exists "thread events are publicly readable" on public.taleforge_narrative_thread_events;
create policy "thread events are publicly readable" on public.taleforge_narrative_thread_events for select to anon,authenticated using (true);

create or replace function public.taleforge_refresh_thread_intelligence(p_series_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public
as $function$
declare t record; latest_ch int; touched int:=0;
begin
 if current_user not in ('postgres','service_role') and coalesce(current_setting('request.jwt.claim.role',true))<>'service_role' then raise exception 'service_role required'; end if;
 for t in select * from public.taleforge_narrative_threads where (p_series_id is null or series_id=p_series_id) loop
  select coalesce(max(c.chapter_number),0) into latest_ch from public.chapters c where c.series_id=t.series_id and c.status='published';
  if t.introduced_chapter is not null then
   insert into public.taleforge_narrative_thread_events(thread_id,series_id,chapter_number,event_type,evidence)
   values(t.id,t.series_id,t.introduced_chapter,'introduced',jsonb_build_object('source',t.source_system,'source_path',t.source_path)) on conflict do nothing;
  end if;
  if t.target_payoff_chapter is not null then
   insert into public.taleforge_narrative_thread_events(thread_id,series_id,chapter_number,event_type,evidence)
   values(t.id,t.series_id,t.target_payoff_chapter,'targeted',jsonb_build_object('target_payoff_chapter',t.target_payoff_chapter)) on conflict do nothing;
  end if;
  if t.thread_type='clue' and latest_ch>=coalesce(t.introduced_chapter,1)+2 and t.status in ('planned','open') then
   update public.taleforge_narrative_threads
   set status='progressing',metadata=metadata||jsonb_build_object('stale_after_chapter',latest_ch,'intelligence','clue_unadvanced'),updated_at=now()
   where id=t.id;
   insert into public.taleforge_narrative_thread_events(thread_id,series_id,chapter_number,event_type,evidence)
   values(t.id,t.series_id,latest_ch,'stale',jsonb_build_object('reason','clue_has_no_recorded_progress','latest_published_chapter',latest_ch)) on conflict do nothing;
  end if;
  touched:=touched+1;
 end loop;
 return jsonb_build_object('status','pass','series_id',p_series_id,'threads_evaluated',touched,'refreshed_at',now());
end;$function$;
revoke execute on function public.taleforge_refresh_thread_intelligence(uuid) from public,anon,authenticated;
grant execute on function public.taleforge_refresh_thread_intelligence(uuid) to service_role;
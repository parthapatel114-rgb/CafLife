-- Apply once in a Supabase project's SQL editor. All personal writes go through
-- validated RPCs. No browser receives a service-role key.
create table if not exists public.records (
 owner_id uuid not null references auth.users(id) on delete cascade,
 id uuid not null,
 kind text not null check (kind in ('profile','caffeine','energy','favorite')),
 data jsonb not null,
 revision bigint not null,
 deleted boolean not null default false,
 updated_at timestamptz not null default now(),
 primary key (owner_id,id)
);
create sequence if not exists public.record_revision;
create unique index if not exists one_profile_per_user on public.records(owner_id) where kind='profile' and not deleted;
create index if not exists records_owner_revision on public.records(owner_id,revision);
create table if not exists public.mutation_receipts (
 owner_id uuid not null references auth.users(id) on delete cascade,
 mutation_id uuid not null,
 result jsonb not null,
 primary key(owner_id,mutation_id)
);
alter table public.records enable row level security;
alter table public.mutation_receipts enable row level security;
drop policy if exists own_records on public.records;
create policy own_records on public.records for select to authenticated using (owner_id=auth.uid());
revoke all on public.records,public.mutation_receipts from anon,authenticated;
grant select on public.records to authenticated;
revoke all on sequence public.record_revision from anon,authenticated;

create or replace function public.valid_record(k text,d jsonb) returns boolean
language plpgsql set search_path='' as $$
declare v text; n numeric; at_time timestamptz;
begin
 if jsonb_typeof(d) is distinct from 'object' or octet_length(d::text)>16384 then return false; end if;
 if k='profile' then
  if not (d ?& array['units','age','height','weight','timezone','bedtime','peakTime','dailyMax','activeMin','activeMax','bedtimeMax','halfLife','modelVersion','onboarded','theme']) then return false; end if;
  if jsonb_typeof(d->'units')<>'string' or jsonb_typeof(d->'theme')<>'string' or jsonb_typeof(d->'timezone')<>'string' or jsonb_typeof(d->'bedtime')<>'string' or jsonb_typeof(d->'peakTime')<>'string' then return false; end if;
  if d->>'units' not in ('metric','imperial') or d->>'theme' not in ('system','light','dark') then return false; end if;
  if not exists(select 1 from pg_timezone_names where name=d->>'timezone') then return false; end if;
  if (d->>'bedtime') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or (d->>'peakTime') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then return false; end if;
  foreach v in array array['age','height','weight','dailyMax','activeMin','activeMax','bedtimeMax'] loop
   if d->v <> 'null'::jsonb then
    if jsonb_typeof(d->v)<>'number' then return false; end if;
    n=(d->>v)::numeric; if n<0 or n>100000 then return false;end if;
   end if;
  end loop;
  if jsonb_typeof(d->'halfLife')<>'number' or (d->>'halfLife')::numeric not between 1 and 24 then return false; end if;
  if d->'activeMin'<>'null'::jsonb and d->'activeMax'<>'null'::jsonb and (d->>'activeMin')::numeric>(d->>'activeMax')::numeric then return false; end if;
  if jsonb_typeof(d->'onboarded')<>'boolean' or jsonb_typeof(d->'modelVersion')<>'number' or (d->>'modelVersion')::numeric<>1 then return false; end if;
  return true;
 elsif k='energy' then
  if not(d ?& array['rating','note','at']) or jsonb_typeof(d->'rating')<>'number' or (d->>'rating')::numeric<>trunc((d->>'rating')::numeric) or (d->>'rating')::numeric not between 1 and 5 or jsonb_typeof(d->'note')<>'string' or length(d->>'note')>1000 then return false; end if;
 elsif k in ('caffeine','favorite') then
  if not(d ?& array['name','perServing','serving']) or jsonb_typeof(d->'name')<>'string' or length(trim(d->>'name')) not between 1 and 120 or jsonb_typeof(d->'serving')<>'string' or length(d->>'serving')>120 or jsonb_typeof(d->'perServing')<>'number' or (d->>'perServing')::numeric not between 0 and 10000 then return false; end if;
  if k='favorite' then return true;end if;
  if not(d ?& array['quantity','at']) or jsonb_typeof(d->'quantity')<>'number' or (d->>'quantity')::numeric<=0 or (d->>'quantity')::numeric>100 then return false;end if;
 else return false;
 end if;
 if jsonb_typeof(d->'at')<>'string' then return false;end if;
 at_time=(d->>'at')::timestamptz;
 return isfinite(at_time) and at_time<=now()+interval '1 minute';
exception when others then return false;
end;
$$;

create or replace function public.mutate_record(
 mutation_id uuid,record_id uuid,record_kind text,record_data jsonb,
 expected_revision bigint,is_deleted boolean default false
) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid=auth.uid(); old public.records; saved public.records; receipt jsonb; result jsonb;
begin
 if uid is null then raise exception 'Authentication required' using errcode='42501';end if;
 if mutation_id is null or record_id is null or expected_revision is null or expected_revision<0 or is_deleted is null then raise exception 'Invalid mutation';end if;
 -- Serialize writes per user so cursor ordering is also commit ordering.
 perform pg_advisory_xact_lock(hashtextextended(uid::text,0));
 select m.result into receipt from public.mutation_receipts m where m.owner_id=uid and m.mutation_id=mutate_record.mutation_id;
 if found then return receipt;end if;
 if public.valid_record(record_kind,record_data) is distinct from true then raise exception 'Invalid record';end if;
 select * into old from public.records r where r.owner_id=uid and r.id=record_id for update;
 if coalesce(old.revision,0)<>expected_revision then
  return jsonb_build_object('conflict',true,'record',case when old.id is null then null else to_jsonb(old)-'owner_id'-'updated_at' end);
 end if;
 if old.id is not null and old.kind<>record_kind then raise exception 'Record type cannot change';end if;
 -- Use a canonical existing profile when two devices first onboard concurrently.
 if record_kind='profile' and old.id is null then
  select * into old from public.records r where r.owner_id=uid and r.kind='profile' and not r.deleted;
  if found then return jsonb_build_object('conflict',true,'record',to_jsonb(old)-'owner_id'-'updated_at');end if;
 end if;
 insert into public.records(owner_id,id,kind,data,revision,deleted,updated_at)
 values(uid,record_id,record_kind,record_data,nextval('public.record_revision'),is_deleted,now())
 on conflict(owner_id,id) do update set data=excluded.data,revision=excluded.revision,deleted=excluded.deleted,updated_at=excluded.updated_at
 returning * into saved;
 result=jsonb_build_object('conflict',false,'record',to_jsonb(saved)-'owner_id'-'updated_at');
 insert into public.mutation_receipts(owner_id,mutation_id,result) values(uid,mutation_id,result);
 return result;
end;
$$;
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path='' as $$
declare uid uuid=auth.uid();
begin
 if uid is null then raise exception 'Authentication required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text,0));
 delete from auth.users where id=uid;
end;
$$;
revoke all on function public.valid_record(text,jsonb) from public,anon,authenticated;
revoke all on function public.mutate_record(uuid,uuid,text,jsonb,bigint,boolean) from public,anon;
grant execute on function public.mutate_record(uuid,uuid,text,jsonb,bigint,boolean) to authenticated;
revoke all on function public.delete_my_account() from public,anon;
grant execute on function public.delete_my_account() to authenticated;

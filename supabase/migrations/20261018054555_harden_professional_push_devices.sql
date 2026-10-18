begin;
create table if not exists app_private.professional_push_devices (
  subscription_id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references auth.sessions(id) on delete cascade,
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  updated_at timestamptz not null default now()
);
create index if not exists professional_push_tenant on app_private.professional_push_devices(tenant_id);
alter table app_private.professional_push_devices enable row level security;
revoke all on app_private.professional_push_devices from public,anon,authenticated;
grant all on app_private.professional_push_devices to service_role;

-- Called only by the authenticated server after proof of the browser's push token.
create or replace function public.professional_push_device(p_action text,p_tenant_id uuid,p_subscription_id uuid,p_user_id uuid,p_session_id uuid,p_token_hash text default null)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if p_action='unregister' then
    delete from app_private.professional_push_devices where subscription_id=p_subscription_id and tenant_id=p_tenant_id and user_id=p_user_id and session_id=p_session_id;
    return true;
  end if;
  if not exists(select 1 from auth.sessions s where s.id=p_session_id and s.user_id=p_user_id and (s.not_after is null or s.not_after>now()))
    or not exists(select 1 from public.tenants t where t.id=p_tenant_id and t.is_active is not false and
      (exists(select 1 from app_private.platform_admins a where a.user_id=p_user_id) or exists(select 1 from app_private.tenant_memberships m where m.tenant_id=t.id and m.user_id=p_user_id)))
  then return false; end if;
  if p_action='register' then
    insert into app_private.professional_push_devices(subscription_id,tenant_id,user_id,session_id,token_hash)
    values(p_subscription_id,p_tenant_id,p_user_id,p_session_id,p_token_hash)
    on conflict(subscription_id) do update set tenant_id=excluded.tenant_id,user_id=excluded.user_id,session_id=excluded.session_id,token_hash=excluded.token_hash,updated_at=now();
    return true;
  elsif p_action='status' then
    return exists(select 1 from app_private.professional_push_devices where subscription_id=p_subscription_id and tenant_id=p_tenant_id and user_id=p_user_id and session_id=p_session_id);
  end if;
  raise exception 'Invalid device action';
end $$;

create or replace function public.professional_push_targets(p_tenant_id uuid)
returns uuid[] language sql stable security definer set search_path='' as $$
  select coalesce(array_agg(d.subscription_id order by d.subscription_id),'{}'::uuid[])
  from app_private.professional_push_devices d
  join auth.sessions s on s.id=d.session_id and s.user_id=d.user_id
  join public.tenants t on t.id=d.tenant_id
  where d.tenant_id=p_tenant_id and t.is_active is not false and (s.not_after is null or s.not_after>now())
    and (exists(select 1 from app_private.platform_admins a where a.user_id=d.user_id) or exists(select 1 from app_private.tenant_memberships m where m.tenant_id=t.id and m.user_id=d.user_id));
$$;
revoke all on function public.professional_push_device(text,uuid,uuid,uuid,uuid,text),public.professional_push_targets(uuid) from public,anon,authenticated;
grant execute on function public.professional_push_device(text,uuid,uuid,uuid,uuid,text),public.professional_push_targets(uuid) to service_role;
notify pgrst,'reload schema';
commit;

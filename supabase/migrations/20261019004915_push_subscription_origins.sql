begin;
-- Unknown/legacy subscriptions are deliberately excluded until verified again
-- by the server on the canonical origin. No subscription or user is deleted.
create table app_private.push_subscription_origins (
  subscription_id uuid not null,
  app_id text not null check (length(app_id) between 1 and 200),
  origin text not null check (origin ~ '^https?://[^/]+$'),
  verified_at timestamptz not null default now(),
  primary key (app_id, subscription_id)
);
alter table app_private.push_subscription_origins enable row level security;
revoke all on app_private.push_subscription_origins from public,anon,authenticated;
grant select,insert,update on app_private.push_subscription_origins to service_role;

create function public.register_push_subscription_origin(p_subscription_id uuid,p_app_id text,p_origin text)
returns boolean language sql security invoker set search_path='' as $$
  insert into app_private.push_subscription_origins(subscription_id,app_id,origin)
  values(p_subscription_id,p_app_id,p_origin)
  on conflict(app_id,subscription_id) do update set verified_at=now()
    where app_private.push_subscription_origins.origin=excluded.origin
  returning true;
$$;
create function public.push_targets_for_origin(p_subscription_ids uuid[],p_app_id text,p_origin text)
returns uuid[] language sql stable security invoker set search_path='' as $$
  select coalesce(array_agg(o.subscription_id order by o.subscription_id),'{}'::uuid[])
  from app_private.push_subscription_origins o
  where o.app_id=p_app_id and o.origin=p_origin and o.subscription_id=any(p_subscription_ids);
$$;
revoke all on function public.register_push_subscription_origin(uuid,text,text),public.push_targets_for_origin(uuid[],text,text) from public,anon,authenticated;
grant execute on function public.register_push_subscription_origin(uuid,text,text),public.push_targets_for_origin(uuid[],text,text) to service_role;
notify pgrst,'reload schema';
commit;

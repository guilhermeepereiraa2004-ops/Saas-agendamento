-- Apply as postgres. Accounts are provisioned through Supabase Auth, never plaintext passwords.
begin;
create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;
grant usage on schema app_private to authenticated, service_role;

create table if not exists app_private.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
create table if not exists app_private.tenant_memberships (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade
);
alter table app_private.platform_admins enable row level security;
alter table app_private.tenant_memberships enable row level security;
revoke all on all tables in schema app_private from public, anon, authenticated;
grant all on all tables in schema app_private to service_role;

create or replace function app_private.is_master() returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (select 1 from app_private.platform_admins where user_id = auth.uid());
$$;
create or replace function app_private.can_manage(p_tenant_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (app_private.is_master() or exists (
    select 1 from app_private.tenant_memberships m join public.tenants t on t.id = m.tenant_id
    where m.tenant_id = p_tenant_id and m.user_id = auth.uid() and t.is_active is not false
  ));
$$;
revoke all on function app_private.is_master(), app_private.can_manage(uuid) from public, anon;
grant execute on function app_private.is_master(), app_private.can_manage(uuid) to authenticated, service_role;

-- Never migrate exposed passwords into new accounts. All existing users must receive fresh credentials.
alter table public.tenants drop column if exists login_password;
alter table public.queue_items add column if not exists customer_token_hash text;
alter table public.financial_records add column if not exists source_queue_item_id uuid;
create unique index if not exists financial_records_one_per_service on public.financial_records(source_queue_item_id) where source_queue_item_id is not null;
alter table public.tenant_expenses add column if not exists request_id uuid;
create unique index if not exists tenant_expenses_one_per_request on public.tenant_expenses(tenant_id,request_id) where request_id is not null;

-- Remove every legacy open policy, including policies created under older names.
do $$ declare r record; begin
  for r in select schemaname,tablename,policyname from pg_policies
    where schemaname = 'public' and tablename in ('tenants','queue_items','financial_records','tenant_expenses','tenant_tasks','tenant_products','platform_settings')
  loop execute format('drop policy %I on %I.%I',r.policyname,r.schemaname,r.tablename); end loop;
end $$;
revoke all on public.tenants, public.queue_items, public.financial_records, public.tenant_expenses, public.tenant_tasks, public.tenant_products, public.platform_settings from public, anon, authenticated;
grant select,insert,update,delete on public.tenants, public.queue_items, public.tenant_tasks, public.tenant_products, public.platform_settings to authenticated;
grant select on public.financial_records to authenticated;
grant select,delete on public.tenant_expenses to authenticated;
grant all on public.tenants, public.queue_items, public.financial_records, public.tenant_expenses, public.tenant_tasks, public.tenant_products, public.platform_settings to service_role;
alter table public.tenants enable row level security;
alter table public.queue_items enable row level security;
alter table public.financial_records enable row level security;
alter table public.tenant_expenses enable row level security;
alter table public.tenant_tasks enable row level security;
alter table public.tenant_products enable row level security;
alter table public.platform_settings enable row level security;

create policy tenants_read on public.tenants for select to authenticated using (app_private.can_manage(id));
create policy tenants_update on public.tenants for update to authenticated using (app_private.can_manage(id)) with check (app_private.can_manage(id));
create policy tenants_insert on public.tenants for insert to authenticated with check (app_private.is_master());
create policy tenants_delete on public.tenants for delete to authenticated using (app_private.is_master());
do $$ declare table_name text; begin
  foreach table_name in array array['queue_items','tenant_tasks','tenant_products'] loop
    execute format('create policy staff_only on public.%I for all to authenticated using (app_private.can_manage(tenant_id)) with check (app_private.can_manage(tenant_id))',table_name);
  end loop;
end $$;
create policy financial_read on public.financial_records for select to authenticated using (app_private.can_manage(tenant_id));
create policy expense_read on public.tenant_expenses for select to authenticated using (app_private.can_manage(tenant_id));
create policy expense_delete on public.tenant_expenses for delete to authenticated using (app_private.can_manage(tenant_id));
create or replace function app_private.is_staff() returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and (app_private.is_master() or exists(select 1 from app_private.tenant_memberships m join public.tenants t on t.id=m.tenant_id where m.user_id=auth.uid() and t.is_active is not false));
$$;
revoke all on function app_private.is_staff() from public, anon;
grant execute on function app_private.is_staff() to authenticated, service_role;
create policy settings_read on public.platform_settings for select to authenticated using (app_private.is_staff());
create policy settings_master on public.platform_settings for all to authenticated using (app_private.is_master()) with check (app_private.is_master());

create or replace function public.staff_access() returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('is_master',app_private.is_master(),'tenant_ids',coalesce((select jsonb_agg(m.tenant_id) from app_private.tenant_memberships m join public.tenants t on t.id=m.tenant_id where m.user_id=auth.uid() and t.is_active is not false),'[]'::jsonb)) where auth.uid() is not null;
$$;

create or replace function public.get_public_tenant(p_slug text) returns setof jsonb language sql stable security definer set search_path='' as $$
  select to_jsonb(t)-array['login_email','login_password','admin_push_id','subscription_status','monthly_fee','payment_day','next_payment_at','completed_today']
  from public.tenants t where t.slug=p_slug limit 1;
$$;
create or replace function public.get_public_products(p_tenant_id uuid) returns setof jsonb language sql stable security definer set search_path='' as $$
  select to_jsonb(p) from public.tenant_products p join public.tenants t on t.id=p.tenant_id
  where p.tenant_id=p_tenant_id and t.is_active is not false order by p.created_at desc;
$$;
create or replace function public.get_public_queue(p_tenant_id uuid,p_tokens jsonb default '{}'::jsonb) returns setof jsonb language sql stable security definer set search_path='' as $$
  select (to_jsonb(q)-'customer_token_hash') || case
    when length(coalesce(p_tokens->>q.id::text,''))>=32 and q.customer_token_hash=encode(sha256(convert_to(p_tokens->>q.id::text,'UTF8')),'hex') then '{}'::jsonb
    else jsonb_build_object('whatsapp','','push_id',null,'name',case when q.appointment_time is not null then 'Horário reservado' else split_part(q.name,' ',1) end)
  end from public.queue_items q join public.tenants t on t.id=q.tenant_id
  where q.tenant_id=p_tenant_id and t.is_active is not false and q.status in ('waiting','ready','serving','pending') order by q.joined_at;
$$;

create or replace function app_private.validate_tenant() returns trigger language plpgsql security definer set search_path='' as $$
declare h jsonb; s jsonb; day_count integer; begin
  if new.monthly_fee is not null and (new.monthly_fee < 0 or new.monthly_fee::text in ('NaN','Infinity','-Infinity')) then raise exception 'Mensalidade inválida'; end if;
  if new.payment_day is not null and new.payment_day not between 1 and 31 then raise exception 'Dia de pagamento inválido'; end if;
  if coalesce(new.lunch_start,'12:00') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or coalesce(new.lunch_end,'13:00') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or coalesce(new.lunch_start,'12:00')>=coalesce(new.lunch_end,'13:00') then raise exception 'Intervalo de almoço inválido'; end if;
  if coalesce(new.appointment_interval,30) not between 5 and 240 then raise exception 'Intervalo inválido'; end if;
  if jsonb_typeof(coalesce(new.working_hours,'[]'::jsonb)) <> 'array' then raise exception 'Expediente inválido'; end if;
  select count(distinct x->>'day') into day_count from jsonb_array_elements(coalesce(new.working_hours,'[]'::jsonb)) x;
  if day_count <> jsonb_array_length(coalesce(new.working_hours,'[]'::jsonb)) then raise exception 'Dias duplicados'; end if;
  for h in select * from jsonb_array_elements(coalesce(new.working_hours,'[]'::jsonb)) loop
    if (h->>'day')::integer not between 0 and 6 or coalesce(h->>'start','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or coalesce(h->>'end','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or h->>'start'>=h->>'end' then raise exception 'A abertura deve ser antes do fechamento'; end if;
  end loop;
  if jsonb_typeof(coalesce(new.services,'[]'::jsonb)) <> 'array' then raise exception 'Serviços inválidos'; end if;
  select count(distinct x->>'id') into day_count from jsonb_array_elements(coalesce(new.services,'[]'::jsonb)) x;
  if day_count <> jsonb_array_length(coalesce(new.services,'[]'::jsonb)) then raise exception 'Identificadores de serviços inválidos'; end if;
  for s in select * from jsonb_array_elements(coalesce(new.services,'[]'::jsonb)) loop
    if length(btrim(coalesce(s->>'id','')))=0 or length(btrim(coalesce(s->>'name','')))=0 or s->>'price' is null or (s->>'price')::numeric < 0 or s->>'price' in ('NaN','Infinity','-Infinity') or coalesce((s->>'duration')::integer,30) not between 5 and 600 then raise exception 'Serviço inválido'; end if;
  end loop;
  if tg_op='UPDATE' and auth.uid() is not null and not app_private.is_master() and
    (new.id is distinct from old.id or new.slug is distinct from old.slug or new.login_email is distinct from old.login_email or new.is_active is distinct from old.is_active or new.monthly_fee is distinct from old.monthly_fee or new.payment_day is distinct from old.payment_day or new.next_payment_at is distinct from old.next_payment_at or new.subscription_status is distinct from old.subscription_status)
  then raise exception 'Somente a administração pode alterar assinatura e acesso' using errcode='42501'; end if;
  return new;
end $$;
drop trigger if exists validate_tenant on public.tenants;
create trigger validate_tenant before insert or update on public.tenants for each row execute function app_private.validate_tenant();

create or replace function app_private.validate_booking() returns trigger language plpgsql security definer set search_path='' as $$
declare t public.tenants; svc jsonb; h jsonb; local_start timestamp; local_end timestamp; begin
  if tg_op='UPDATE' and new.status in ('cancelled','completed') then return new; end if;
  if tg_op='UPDATE' and new.appointment_time is not distinct from old.appointment_time and new.service_id is not distinct from old.service_id then return new; end if;
  select * into t from public.tenants where id=new.tenant_id for update;
  if not found or t.is_active is false then raise exception 'Estabelecimento indisponível'; end if;
  select s into svc from jsonb_array_elements(t.services) s where s->>'id'=new.service_id;
  if svc is null then raise exception 'Serviço indisponível'; end if;
  new.service_name=svc->>'name'; new.price=(svc->>'price')::numeric; new.duration=coalesce((svc->>'duration')::integer,30);
  if t.booking_type='queue' then
    if not t.is_online then raise exception 'Fila fechada'; end if;
    if new.appointment_time is not null then raise exception 'Este estabelecimento atende por fila'; end if;
  else
    if new.appointment_time is null or new.appointment_time < now() then raise exception 'Escolha um horário futuro'; end if;
    local_start=new.appointment_time at time zone 'America/Bahia';
    local_end=local_start+new.duration*interval '1 minute';
    select x into h from jsonb_array_elements(t.working_hours) x where (x->>'day')::integer=extract(dow from local_start)::integer;
    if h is null or local_start::time<(h->>'start')::time or local_end::date<>local_start::date or local_end::time>(h->>'end')::time then raise exception 'Horário fora do expediente'; end if;
    if local_start::time < coalesce(t.lunch_end,'13:00')::time and local_end::time > coalesce(t.lunch_start,'12:00')::time then raise exception 'Horário indisponível no almoço'; end if;
    if mod((extract(epoch from (local_start::time-(h->>'start')::time))/60)::integer,coalesce(t.appointment_interval,30))<>0 then raise exception 'Horário inválido'; end if;
    if exists(select 1 from public.queue_items q where q.tenant_id=new.tenant_id and q.id<>new.id and q.status not in ('cancelled','completed') and q.appointment_time < new.appointment_time+new.duration*interval '1 minute' and q.appointment_time+coalesce(q.duration,30)*interval '1 minute'>new.appointment_time) then raise exception 'Este horário já foi reservado'; end if;
  end if;
  return new;
end $$;
drop trigger if exists validate_booking on public.queue_items;
create trigger validate_booking before insert or update on public.queue_items for each row execute function app_private.validate_booking();

create or replace function public.join_queue(p_tenant_id uuid,p_service_id text,p_name text,p_whatsapp text,p_token text,p_appointment_time timestamptz default null,p_push_id text default null) returns setof jsonb language plpgsql security definer set search_path='' as $$
declare q public.queue_items; begin
  if length(btrim(coalesce(p_name,''))) not between 1 and 120 or length(regexp_replace(coalesce(p_whatsapp,''),'[^0-9]','','g')) not between 10 and 13 or length(coalesce(p_token,'')) not between 32 and 128 then raise exception 'Dados inválidos'; end if;
  insert into public.queue_items(tenant_id,name,whatsapp,service_id,service_name,price,duration,status,appointment_time,push_id,customer_token_hash)
  select t.id,btrim(p_name),p_whatsapp,p_service_id,'',0,30,case when t.booking_type='appointment' then 'pending' else 'waiting' end,p_appointment_time,p_push_id,encode(sha256(convert_to(p_token,'UTF8')),'hex') from public.tenants t where t.id=p_tenant_id returning * into q;
  if q.id is null then raise exception 'Estabelecimento indisponível'; end if;
  return next to_jsonb(q)-'customer_token_hash';
end $$;

create or replace function public.customer_queue_action(p_queue_id uuid,p_token text,p_action text,p_push_id text default null) returns boolean language plpgsql security definer set search_path='' as $$
declare q public.queue_items; begin
  select * into q from public.queue_items where id=p_queue_id for update;
  if not found or length(coalesce(p_token,''))<32 or q.customer_token_hash is distinct from encode(sha256(convert_to(p_token,'UTF8')),'hex') then raise exception 'Acesso negado' using errcode='42501'; end if;
  if p_action='cancel' then update public.queue_items set status='cancelled' where id=p_queue_id and status in ('waiting','ready','pending');
  elsif p_action='on_way' then update public.queue_items set is_on_way=true where id=p_queue_id and status in ('waiting','ready');
  elsif p_action='subscribe' then update public.queue_items set push_id=p_push_id where id=p_queue_id;
  else raise exception 'Ação inválida'; end if;
  return true;
end $$;

create or replace function public.complete_service(p_tenant_id uuid,p_queue_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare q public.queue_items; receipt uuid; begin
  if not app_private.can_manage(p_tenant_id) then raise exception 'Acesso negado' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_queue_id::text,0));
  select id into receipt from public.financial_records where source_queue_item_id=p_queue_id and tenant_id=p_tenant_id;
  if found then return jsonb_build_object('record_id',receipt,'already_completed',true); end if;
  select * into q from public.queue_items where id=p_queue_id and tenant_id=p_tenant_id for update;
  if not found or q.status<>'serving' then raise exception 'Atendimento não está em andamento'; end if;
  insert into public.financial_records(tenant_id,price,source_queue_item_id) values(q.tenant_id,q.price,q.id) returning id into receipt;
  delete from public.queue_items where id=q.id;
  return jsonb_build_object('record_id',receipt,'already_completed',false);
end $$;
create or replace function public.record_expense(p_tenant_id uuid,p_description text,p_amount numeric,p_request_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare receipt public.tenant_expenses; begin
  if not app_private.can_manage(p_tenant_id) then raise exception 'Acesso negado' using errcode='42501'; end if;
  if length(btrim(coalesce(p_description,''))) not between 1 and 250 or p_amount is null or p_amount<=0 or p_amount::text in ('NaN','Infinity','-Infinity') or p_request_id is null then raise exception 'Despesa inválida'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text||p_request_id::text,0));
  select * into receipt from public.tenant_expenses where tenant_id=p_tenant_id and request_id=p_request_id;
  if found then
    if receipt.amount<>p_amount or receipt.description<>btrim(p_description) then raise exception 'Identificador já utilizado em outra despesa'; end if;
    return receipt.id;
  end if;
  insert into public.tenant_expenses(tenant_id,description,amount,request_id) values(p_tenant_id,btrim(p_description),p_amount,p_request_id) returning * into receipt;
  return receipt.id;
end $$;

create or replace function app_private.validate_product() returns trigger language plpgsql set search_path='' as $$ begin
  new.name=btrim(new.name);
  if coalesce(length(new.name),0)=0 or new.price is null or new.price<=0 or new.price::text in ('NaN','Infinity','-Infinity') then raise exception 'Produto inválido'; end if;
  return new;
end $$;
drop trigger if exists validate_product on public.tenant_products;
create trigger validate_product before insert or update on public.tenant_products for each row execute function app_private.validate_product();

-- Account changes are accepted only from the server's Auth Admin API integration.
create or replace function public.assign_tenant_account(p_tenant_id uuid,p_user_id uuid) returns void language sql security definer set search_path='' as $$
  insert into app_private.tenant_memberships(tenant_id,user_id) values(p_tenant_id,p_user_id) on conflict(tenant_id) do update set user_id=excluded.user_id;
$$;
revoke all on function public.assign_tenant_account(uuid,uuid) from public, anon, authenticated;
grant execute on function public.assign_tenant_account(uuid,uuid) to service_role;
create or replace function public.get_tenant_account(p_tenant_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('user_id',user_id) from app_private.tenant_memberships where tenant_id=p_tenant_id;
$$;
create or replace function public.verify_customer_queue_access(p_queue_id uuid,p_tenant_id uuid,p_token text) returns boolean language sql stable security definer set search_path='' as $$
  select length(coalesce(p_token,'')) between 32 and 128 and exists(select 1 from public.queue_items q where q.id=p_queue_id and q.tenant_id=p_tenant_id and q.customer_token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex'));
$$;
revoke all on function public.get_tenant_account(uuid),public.verify_customer_queue_access(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.get_tenant_account(uuid),public.verify_customer_queue_access(uuid,uuid,text) to service_role;

revoke all on function public.staff_access(), public.complete_service(uuid,uuid), public.record_expense(uuid,text,numeric,uuid) from public,anon;
grant execute on function public.staff_access(), public.complete_service(uuid,uuid), public.record_expense(uuid,text,numeric,uuid) to authenticated,service_role;
revoke all on function public.get_public_tenant(text),public.get_public_queue(uuid,jsonb),public.get_public_products(uuid),public.join_queue(uuid,text,text,text,text,timestamptz,text),public.customer_queue_action(uuid,text,text,text) from public;
grant execute on function public.get_public_tenant(text),public.get_public_queue(uuid,jsonb),public.get_public_products(uuid),public.join_queue(uuid,text,text,text,text,timestamptz,text),public.customer_queue_action(uuid,text,text,text) to anon,authenticated,service_role;

-- Product images: public read, scoped writes. Do not remove unrelated bucket policies.
do $$ declare r record; begin
  if to_regclass('storage.objects') is not null then
    for r in select policyname from pg_policies where schemaname='storage' and tablename='objects' and (coalesce(qual,'')||coalesce(with_check,'')) like '%product-images%' loop execute format('drop policy %I on storage.objects',r.policyname); end loop;
    execute $p$create policy product_images_read on storage.objects for select to anon,authenticated using(bucket_id='product-images')$p$;
    execute $p$create policy product_images_staff on storage.objects for all to authenticated using(bucket_id='product-images' and app_private.can_manage(((storage.foldername(name))[2])::uuid)) with check(bucket_id='product-images' and (storage.foldername(name))[1]='products' and app_private.can_manage(((storage.foldername(name))[2])::uuid))$p$;
  end if;
end $$;
notify pgrst,'reload schema';
commit;

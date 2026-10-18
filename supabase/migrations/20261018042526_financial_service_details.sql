-- Preserve the booked service and customer as they were at completion.
-- Existing receipts remain unchanged when their original queue item no longer exists.
begin;

alter table public.financial_records
  add column if not exists customer_name text,
  add column if not exists service_name text,
  add column if not exists service_id text,
  add column if not exists appointment_time timestamptz,
  add column if not exists started_at timestamptz,
  add column if not exists duration integer;

create or replace function public.complete_service(p_tenant_id uuid, p_queue_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare q public.queue_items; receipt uuid;
begin
  if not app_private.can_manage(p_tenant_id) then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_queue_id::text, 0));
  select id into receipt from public.financial_records
    where source_queue_item_id = p_queue_id and tenant_id = p_tenant_id;
  if found then
    return jsonb_build_object('record_id', receipt, 'already_completed', true);
  end if;
  select * into q from public.queue_items
    where id = p_queue_id and tenant_id = p_tenant_id for update;
  if not found or q.status <> 'serving' then
    raise exception 'Atendimento não está em andamento';
  end if;
  insert into public.financial_records (
    tenant_id, price, source_queue_item_id, customer_name, service_name,
    service_id, appointment_time, started_at, duration
  ) values (
    q.tenant_id, q.price, q.id, q.name, q.service_name,
    q.service_id, q.appointment_time, q.started_at, q.duration
  ) returning id into receipt;
  delete from public.queue_items where id = q.id;
  return jsonb_build_object('record_id', receipt, 'already_completed', false);
end $$;

revoke all on function public.complete_service(uuid, uuid) from public, anon;
grant execute on function public.complete_service(uuid, uuid) to authenticated, service_role;

commit;

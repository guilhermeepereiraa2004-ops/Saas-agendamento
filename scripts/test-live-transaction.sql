-- Run only after the security migration. All fixture data is rolled back.
begin;
select set_config('qa.tenant_id',gen_random_uuid()::text,true);
select set_config('qa.slug','qa-verificacao-'||replace(current_setting('qa.tenant_id'),'-',''),true);
select set_config('qa.expense_request',gen_random_uuid()::text,true);
select set_config('qa.customer_token',repeat('q',64),true);
select set_config('qa.master_id',(select user_id::text from app_private.platform_admins order by user_id limit 1),true);
select set_config('request.jwt.claim.sub',current_setting('qa.master_id'),true);
do $$ begin
  if not app_private.is_master() then raise exception 'Administrador não configurado'; end if;
end $$;
insert into public.tenants(id,name,slug,is_active,is_online,booking_type,services,working_hours,monthly_fee,payment_day)
values(current_setting('qa.tenant_id')::uuid,'QA transacional',current_setting('qa.slug'),true,true,'queue','[{"id":"qa-cut","name":"Serviço QA","price":35,"duration":30}]','[]',0,10);

select set_config('request.jwt.claim.sub','',true);
set local role anon;
do $$ declare item jsonb; begin
  begin perform id from public.tenants limit 0; raise exception 'Tabela privada exposta'; exception when insufficient_privilege then null; end;
  begin perform id from public.financial_records limit 0; raise exception 'Financeiro exposto'; exception when insufficient_privilege then null; end;
  begin perform id from public.tenant_expenses limit 0; raise exception 'Despesas expostas'; exception when insufficient_privilege then null; end;
  select * into item from public.get_public_tenant(current_setting('qa.slug'));
  if item ? 'login_email' or item ? 'login_password' or item ? 'monthly_fee' then raise exception 'Dados privados na página pública'; end if;
  select * into item from public.join_queue(current_setting('qa.tenant_id')::uuid,'qa-cut','Cliente QA','00000000000',current_setting('qa.customer_token'));
  if (item->>'price')::numeric<>35 or (item->>'duration')::int<>30 then raise exception 'Dados do serviço incorretos'; end if;
  perform set_config('qa.queue_id',item->>'id',true);
  begin perform public.customer_queue_action(current_setting('qa.queue_id')::uuid,repeat('x',64),'cancel'); raise exception 'Token falso aceito'; exception when insufficient_privilege then null; end;
  perform public.customer_queue_action(current_setting('qa.queue_id')::uuid,current_setting('qa.customer_token'),'on_way');
end $$;

select set_config('request.jwt.claim.sub',current_setting('qa.master_id'),true);
set local role authenticated;
do $$ declare first_result jsonb; second_result jsonb; expense_a uuid; expense_b uuid; begin
  if not (public.staff_access()->>'is_master')::boolean then raise exception 'Acesso master não reconhecido'; end if;
  update public.queue_items set status='serving' where id=current_setting('qa.queue_id')::uuid;
  first_result=public.complete_service(current_setting('qa.tenant_id')::uuid,current_setting('qa.queue_id')::uuid);
  second_result=public.complete_service(current_setting('qa.tenant_id')::uuid,current_setting('qa.queue_id')::uuid);
  if first_result->>'record_id' is distinct from second_result->>'record_id' or not (second_result->>'already_completed')::boolean then raise exception 'Conclusão repetida incorreta'; end if;
  if (select count(*) from public.financial_records where tenant_id=current_setting('qa.tenant_id')::uuid)<>1 then raise exception 'Receita duplicada'; end if;
  if not exists(select 1 from public.financial_records where tenant_id=current_setting('qa.tenant_id')::uuid and customer_name='Cliente QA' and service_name='Serviço QA' and service_id='qa-cut' and duration=30 and price=35) then raise exception 'Detalhes financeiros não preservados'; end if;
  if exists(select 1 from public.queue_items where id=current_setting('qa.queue_id')::uuid) then raise exception 'Atendimento não removido'; end if;
  expense_a=public.record_expense(current_setting('qa.tenant_id')::uuid,'Material QA',50,current_setting('qa.expense_request')::uuid);
  expense_b=public.record_expense(current_setting('qa.tenant_id')::uuid,'Material QA',50,current_setting('qa.expense_request')::uuid);
  if expense_a<>expense_b or (select count(*) from public.tenant_expenses where tenant_id=current_setting('qa.tenant_id')::uuid)<>1 then raise exception 'Despesa duplicada'; end if;
end $$;

select set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
do $$ begin
  if exists(select 1 from public.tenants where id=current_setting('qa.tenant_id')::uuid) then raise exception 'Outro usuário lê estabelecimento alheio'; end if;
  if exists(select 1 from public.financial_records where tenant_id=current_setting('qa.tenant_id')::uuid) then raise exception 'Outro usuário lê detalhes financeiros alheios'; end if;
  begin perform public.record_expense(current_setting('qa.tenant_id')::uuid,'Acesso negado QA',50,gen_random_uuid()); raise exception 'Outro usuário lança despesa'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select jsonb_build_object('real_database_checks_passed',true,'private_tables_protected',true,'public_booking_validated',true,'customer_token_validated',true,'completion_idempotent',true,'expense_idempotent',true,'cross_tenant_denied',true,'fixture_rolled_back',true) as verification;
rollback;

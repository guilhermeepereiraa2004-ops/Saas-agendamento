import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const db = new PGlite();
const admin = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const owner = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const other = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const tenant = '11111111-1111-4111-8111-111111111111';
const second = '22222222-2222-4222-8222-222222222222';
await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create table auth.users(id uuid primary key,email text);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id),not_after timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema auth to anon,authenticated,service_role; grant execute on function auth.uid() to public;
create table tenants(id uuid primary key default gen_random_uuid(),name text,slug text unique,whatsapp text,primary_color text,secondary_color text,has_logo boolean default false,logo_url text,login_email text,login_password text,profession text,booking_type text default 'queue',working_hours jsonb default '[]',services jsonb default '[]',is_online boolean default true,is_active boolean default true,subscription_status text default 'active',monthly_fee numeric default 0,payment_day int default 10,next_payment_at timestamptz,appointment_interval int default 30,lunch_start text default '12:00',lunch_end text default '13:00',admin_push_id text,created_at timestamptz default now());
create table queue_items(id uuid primary key default gen_random_uuid(),tenant_id uuid references tenants(id) on delete cascade,name text,whatsapp text,service_id text,service_name text,price numeric,status text,joined_at timestamptz default now(),appointment_time timestamptz,is_on_way boolean default false,push_id text,started_at timestamptz,duration int);
create table financial_records(id uuid primary key default gen_random_uuid(),tenant_id uuid references tenants(id),price numeric,completed_at timestamptz default now());
create table tenant_expenses(id uuid primary key default gen_random_uuid(),tenant_id uuid references tenants(id),description text,amount numeric,created_at timestamptz default now());
create table tenant_tasks(id uuid primary key default gen_random_uuid(),tenant_id uuid references tenants(id),title text,is_completed boolean default false,created_at timestamptz default now());
create table tenant_products(id uuid primary key default gen_random_uuid(),tenant_id uuid references tenants(id),name text,price numeric,image_url text,created_at timestamptz default now());
create table platform_settings(id uuid primary key default gen_random_uuid(),pix_key text,pix_name text);
create schema storage; create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
grant usage on schema storage to anon,authenticated;
grant all on storage.objects to anon,authenticated;
alter table storage.objects enable row level security;
create policy "Public read product-images" on storage.objects for select using(bucket_id='product-images');
create policy "Anyone can upload product-images" on storage.objects for insert with check(bucket_id='product-images');
grant all on all tables in schema public to anon,authenticated;
alter table tenants enable row level security; create policy legacy_open on tenants for all using(true) with check(true);
insert into auth.users values('${admin}','master@example.invalid'),('${owner}','owner@example.invalid'),('${other}','other@example.invalid');
insert into tenants(id,name,slug,login_password,login_email,services) values('${tenant}','QA','qa','exposed-old-password','owner@example.invalid','[{"id":"cut","name":"Corte","price":35,"duration":30}]'),('${second}','Other','other',null,'other@example.invalid','[]');
`);
const migrations = (await readdir(new URL('../supabase/migrations/', import.meta.url))).filter(name => name.endsWith('.sql')).sort();
for (const migration of migrations) await db.exec(await readFile(new URL(`../supabase/migrations/${migration}`, import.meta.url), 'utf8'));
await db.exec(`insert into app_private.platform_admins values('${admin}'); insert into app_private.tenant_memberships values('${tenant}','${owner}'),('${second}','${other}');`);
let count = 0;
async function as(role, userId, sql, params = []) {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role};`);
    await tx.query(`select set_config('request.jwt.claim.sub',$1,true)`, [userId || '']);
    return tx.query(sql, params);
  });
}
async function test(name, callback) { await callback(); count++; console.log(`PASS ${name}`); }
async function denied(role, user, sql, params) { await assert.rejects(() => as(role,user,sql,params)); }
try {
  await test('Migration removes plaintext passwords and open policies', async () => {
    assert.equal((await db.query("select count(*)::int n from information_schema.columns where table_name='tenants' and column_name='login_password'")).rows[0].n,0);
    assert.equal((await db.query("select count(*)::int n from pg_policies where policyname='legacy_open'")).rows[0].n,0);
  });
  await test('Anonymous users cannot read any private table', async () => {
    for (const table of ['tenants','queue_items','financial_records','tenant_expenses','tenant_tasks','tenant_products','platform_settings']) await denied('anon',null,`select * from ${table}`);
  });
  await test('Public page has no credentials or billing details', async () => {
    const result = await as('anon',null,"select * from get_public_tenant('qa')"); const row = result.rows[0].get_public_tenant;
    assert.equal(row.name,'QA'); for(const key of ['login_email','login_password','admin_push_id','monthly_fee']) assert.ok(!(key in row));
  });
  await test('Professional reads only their tenant; master reads both', async () => {
    assert.equal((await as('authenticated',owner,'select * from tenants')).rows.length,1);
    assert.equal((await as('authenticated',admin,'select * from tenants')).rows.length,2);
    assert.equal((await as('authenticated',owner,`select * from tenants where id=$1`,[second])).rows.length,0);
  });
  await test('Forged local role is irrelevant without verified auth user', async () => {
    assert.equal((await as('authenticated',null,'select staff_access() access')).rows[0].access,null);
    await denied('anon',null,'select staff_access()');
  });
  await test('Professional cannot change subscription or assign another owner', async () => {
    await denied('authenticated',owner,'update tenants set monthly_fee=99 where id=$1',[tenant]);
    await denied('authenticated',owner,'select assign_tenant_account($1,$2)',[tenant,other]);
  });
  await test('Invalid hours, fees, billing day and product names are rejected by database', async () => {
    await denied('authenticated',admin,'update tenants set payment_day=45 where id=$1',[tenant]);
    await denied('authenticated',admin,'update tenants set monthly_fee=-1 where id=$1',[tenant]);
    await denied('authenticated',owner,`update tenants set working_hours='[{"day":1,"start":"19:00","end":"18:00"}]' where id=$1`,[tenant]);
    await denied('authenticated',owner,`insert into tenant_products(tenant_id,name,price) values($1,'   ',5)`,[tenant]);
  });
  await test('Storage allows public read and only owner uploads, replacements and deletion',async()=>{
    const path=`products/${tenant}/fixture.jpg`;
    await denied('anon',null,'insert into storage.objects(bucket_id,name) values($1,$2)',['product-images',path]);
    await denied('authenticated',other,'insert into storage.objects(bucket_id,name) values($1,$2)',['product-images',path]);
    await as('authenticated',owner,'insert into storage.objects(bucket_id,name) values($1,$2)',['product-images',path]);
    assert.equal((await as('anon',null,'select * from storage.objects')).rows.length,1);
    await as('authenticated',owner,'update storage.objects set name=$1 where name=$2',[`products/${tenant}/updated.jpg`,path]);
    assert.equal((await as('authenticated',other,'delete from storage.objects returning id')).rows.length,0);
    assert.equal((await as('authenticated',owner,'delete from storage.objects returning id')).rows.length,1);
  });
  await test('Logo persists atomically in the own tenant and stays public without widening write access',async()=>{
    const path=`products/${tenant}/branding/logo-fixture.png`;
    const url=`https://example.invalid/storage/v1/object/public/product-images/${path}`;
    await denied('anon',null,'insert into storage.objects(bucket_id,name) values($1,$2)',['product-images',path]);
    await denied('authenticated',other,'insert into storage.objects(bucket_id,name) values($1,$2)',['product-images',path]);
    await as('authenticated',owner,'insert into storage.objects(bucket_id,name) values($1,$2)',['product-images',path]);
    const saved=await as('authenticated',owner,'update tenants set has_logo=true,logo_url=$1 where id=$2 returning has_logo,logo_url',[url,tenant]);
    assert.deepEqual(saved.rows,[{has_logo:true,logo_url:url}]);
    assert.equal((await as('authenticated',other,'update tenants set logo_url=$1 where id=$2 returning id',['https://example.invalid/other.png',tenant])).rows.length,0);
    const publicTenant=(await as('anon',null,"select * from get_public_tenant('qa')")).rows[0].get_public_tenant;
    assert.equal(publicTenant.has_logo,true);assert.equal(publicTenant.logo_url,url);
    await as('authenticated',owner,"update tenants set has_logo=false,logo_url='' where id=$1",[tenant]);
    await as('authenticated',owner,'delete from storage.objects where name=$1',[path]);
  });
  await test('Invalid service values cannot break booking or introduce nonfinite prices',async()=>{
    for(const services of [[{id:'x',name:'Corte',price:'NaN',duration:30}],[{id:'x',name:'Corte',duration:30}],[{id:'x',name:'A',price:1},{id:'x',name:'B',price:1}]]) await denied('authenticated',owner,'update tenants set services=$1 where id=$2',[JSON.stringify(services),tenant]);
  });
  const token = 'a'.repeat(64); let queueId;
  await test('Public booking derives service, price and duration on server', async () => {
    const result = await as('anon',null,'select * from join_queue($1,$2,$3,$4,$5)',[tenant,'cut','Cliente Completo','71999999999',token]);
    const row = result.rows[0].join_queue; queueId=row.id; assert.equal(Number(row.price),35); assert.equal(row.duration,30); assert.ok(!('customer_token_hash' in row));
  });
  await test('Queue masks personal details unless client proves ownership', async () => {
    let row = (await as('anon',null,'select * from get_public_queue($1)',[tenant])).rows[0].get_public_queue;
    assert.equal(row.name,'Cliente'); assert.equal(row.whatsapp,''); assert.equal(row.push_id,null);
    row = (await as('anon',null,'select * from get_public_queue($1,$2)',[tenant,JSON.stringify({ [queueId]:token })])).rows[0].get_public_queue;
    assert.equal(row.name,'Cliente Completo'); assert.equal(row.whatsapp,'71999999999');
  });
  await test('Customer cannot mutate another booking by knowing its UUID', async () => {
    await denied('anon',null,"select customer_queue_action($1,$2,'on_way')",[queueId,'x'.repeat(64)]);
    await as('anon',null,"select customer_queue_action($1,$2,'on_way')",[queueId,token]);
    assert.equal((await as('authenticated',owner,'select is_on_way from queue_items where id=$1',[queueId])).rows[0].is_on_way,true);
  });
  await test('Financial table bypass and cross-tenant RPC are denied', async () => {
    await denied('authenticated',owner,'insert into financial_records(tenant_id,price) values($1,35)',[tenant]);
    await denied('authenticated',other,'select complete_service($1,$2)',[tenant,queueId]);
  });
  await test('Push registration and recipient lists cannot be read or written by public or staff roles',async()=>{
    for(const role of ['anon','authenticated']) {
      await denied(role,owner,'select * from app_private.professional_push_devices');
      await denied(role,owner,'select professional_push_targets($1)',[tenant]);
      await denied(role,owner,'select professional_push_device($1,$2,$3,$4,$5,$6)',['register',tenant,crypto.randomUUID(),owner,crypto.randomUUID(),'a'.repeat(64)]);
    }
  });
  await test('Push recipients require token proof registration, a live session and current tenant access across devices',async()=>{
    const session=crypto.randomUUID(),session2=crypto.randomUUID(),a=crypto.randomUUID(),b=crypto.randomUUID();
    await db.query('insert into auth.sessions(id,user_id) values($1,$2),($3,$2)',[session,owner,session2]);
    const register=(device,sessionId,user=owner,tenantId=tenant)=>as('service_role',null,'select professional_push_device($1,$2,$3,$4,$5,$6) ok',['register',tenantId,device,user,sessionId,'a'.repeat(64)]);
    assert.equal((await register(a,session,other)).rows[0].ok,false);
    assert.equal((await register(a,session,owner,second)).rows[0].ok,false);
    assert.equal((await register(a,crypto.randomUUID())).rows[0].ok,false);
    assert.equal((await register(a,session)).rows[0].ok,true); assert.equal((await register(b,session2)).rows[0].ok,true);
    const targets=async()=> (await as('service_role',null,'select professional_push_targets($1) targets',[tenant])).rows[0].targets;
    assert.deepEqual(new Set(await targets()),new Set([a,b]));
    await db.query('update auth.sessions set not_after=now()-interval \'1 second\' where id=$1',[session]);
    assert.deepEqual(await targets(),[b]);
    await db.query('delete from auth.sessions where id=$1',[session2]);
    assert.deepEqual(await targets(),[]);
    assert.equal((await db.query('select count(*)::int n from app_private.professional_push_devices where subscription_id=$1',[b])).rows[0].n,0);
    await db.query('delete from auth.sessions where id=$1',[session]);
  });
  await test('Push origin filtering excludes legacy, unknown and other-app subscriptions without deleting them',async()=>{
    const a=crypto.randomUUID(),b=crypto.randomUUID(),unknown=crypto.randomUUID();
    const register=(id,app,origin)=>as('service_role',null,'select register_push_subscription_origin($1,$2,$3) ok',[id,app,origin]);
    const targets=async(app,origin,ids=[a,b,b,unknown])=>(await as('service_role',null,'select push_targets_for_origin($1,$2,$3) ids',[ids,app,origin])).rows[0].ids;
    await register(a,'app-one','https://old.vercel.app');await register(b,'app-one','https://www.current.invalid');
    assert.deepEqual(await targets('app-one','https://www.current.invalid'),[b]);
    assert.deepEqual(await targets('app-two','https://www.current.invalid'),[]);
    assert.deepEqual(await targets('app-one','https://current.invalid'),[]);
    assert.deepEqual(await targets('app-one','https://www.current.invalid',[]),[]);
    assert.equal((await register(a,'app-one','https://www.current.invalid')).rows[0].ok,null);
    assert.deepEqual(await targets('app-one','https://www.current.invalid'),[b]);
    assert.equal((await db.query('select count(*)::int n from app_private.push_subscription_origins')).rows[0].n,2);
    for(const role of ['anon','authenticated']){
      await denied(role,owner,'select * from app_private.push_subscription_origins');
      await denied(role,owner,'select register_push_subscription_origin($1,$2,$3)',[unknown,'app-one','https://www.current.invalid']);
      await denied(role,owner,'select push_targets_for_origin($1,$2,$3)',[[a,b],'app-one','https://www.current.invalid']);
    }
  });
  await test('Completion is idempotent and records exactly one receipt', async () => {
    await as('authenticated',owner,"update queue_items set status='serving',started_at='2026-10-18T10:00:00-03:00' where id=$1",[queueId]);
    const first=(await as('authenticated',owner,'select complete_service($1,$2) result',[tenant,queueId])).rows[0].result;
    const again=(await as('authenticated',owner,'select complete_service($1,$2) result',[tenant,queueId])).rows[0].result;
    assert.equal(first.already_completed,false); assert.equal(again.already_completed,true); assert.equal(first.record_id,again.record_id);
    assert.equal((await db.query('select count(*)::int n from financial_records')).rows[0].n,1);
    assert.equal((await db.query('select count(*)::int n from queue_items')).rows[0].n,0);
  });
  await test('Receipt preserves customer, booked service and times after queue removal and catalog edits', async () => {
    await as('authenticated',owner,`update tenants set services='[{"id":"cut","name":"Novo nome","price":99,"duration":45}]' where id=$1`,[tenant]);
    const receipt=(await as('authenticated',owner,'select * from financial_records where source_queue_item_id=$1',[queueId])).rows[0];
    assert.equal(receipt.customer_name,'Cliente Completo'); assert.equal(receipt.service_name,'Corte');
    assert.equal(receipt.service_id,'cut'); assert.equal(Number(receipt.price),35); assert.equal(receipt.duration,30);
    assert.equal(new Date(receipt.started_at).toISOString(),'2026-10-18T13:00:00.000Z');
    assert.equal(receipt.appointment_time,null);
    for(const key of ['whatsapp','push_id','customer_token_hash']) assert.equal(key in receipt,false);
    assert.equal((await as('authenticated',other,'select customer_name,service_name from financial_records')).rows.length,0);
    await denied('anon',null,'select customer_name,service_name from financial_records');
    await denied('authenticated',owner,"update financial_records set customer_name='Forged' where id=$1",[receipt.id]);
    await as('authenticated',owner,`update tenants set services='[{"id":"cut","name":"Corte","price":35,"duration":30}]' where id=$1`,[tenant]);
  });
  await test('Failure deleting queue rolls back revenue in the same transaction', async () => {
    const q=(await as('anon',null,'select * from join_queue($1,$2,$3,$4,$5)',[tenant,'cut','Rollback QA','71999999999','b'.repeat(64)])).rows[0].join_queue;
    await as('authenticated',owner,"update queue_items set status='serving' where id=$1",[q.id]);
    await db.exec(`create function app_private.force_test_failure() returns trigger language plpgsql as $$begin raise exception 'test failure'; end$$; create trigger force_test_failure before delete on queue_items for each row execute function app_private.force_test_failure();`);
    await denied('authenticated',owner,'select complete_service($1,$2)',[tenant,q.id]);
    assert.equal((await db.query('select count(*)::int n from financial_records')).rows[0].n,1);
    assert.equal((await db.query('select count(*)::int n from queue_items')).rows[0].n,1);
    await db.exec('drop trigger force_test_failure on queue_items;');
  });
  await test('Expense requests are idempotent, scoped and validate replay payload', async () => {
    const request='33333333-3333-4333-8333-333333333333';
    const call=()=>as('authenticated',owner,'select record_expense($1,$2,$3,$4) id',[tenant,'Material',50,request]);
    const a=await call(); const b=await call(); assert.equal(a.rows[0].id,b.rows[0].id);
    await denied('authenticated',owner,'select record_expense($1,$2,$3,$4)',[tenant,'Outro',55,request]);
    await denied('authenticated',other,'select record_expense($1,$2,$3,$4)',[tenant,'Material',50,request]);
    await denied('authenticated',owner,'insert into tenant_expenses(tenant_id,description,amount) values($1,$2,$3)',[tenant,'Bypass',50]);
    assert.equal((await db.query('select count(*)::int n from tenant_expenses')).rows[0].n,1);
  });
  await test('Staff cancellation retains the subscription, leaves no revenue and cannot be completed',async()=>{
    const q=(await as('anon',null,'select * from join_queue($1,$2,$3,$4,$5)',[tenant,'cut','Cancelamento QA','71999999999','c'.repeat(64)])).rows[0].join_queue;
    await as('anon',null,"select customer_queue_action($1,$2,'subscribe',$3)",[q.id,'c'.repeat(64),'qa-client-device']);
    assert.equal((await as('authenticated',other,"update queue_items set status='cancelled' where id=$1 returning id",[q.id])).rows.length,0);
    await denied('anon',null,"update queue_items set status='cancelled' where id=$1",[q.id]);
    const before=(await db.query('select count(*)::int n from financial_records')).rows[0].n;
    await as('authenticated',owner,"update queue_items set status='serving' where id=$1",[q.id]);
    const cancelled=await as('authenticated',owner,"update queue_items set status='cancelled',is_on_way=false where tenant_id=$1 and id=$2 and status in ('waiting','ready','pending','serving') returning id,push_id",[tenant,q.id]);
    assert.equal(cancelled.rows[0].push_id,'qa-client-device');
    assert.equal((await as('anon',null,'select * from get_public_queue($1)',[tenant])).rows.some(row=>row.get_public_queue.id===q.id),false);
    await denied('authenticated',owner,'select complete_service($1,$2)',[tenant,q.id]);
    assert.equal((await db.query('select count(*)::int n from financial_records')).rows[0].n,before);
    assert.equal((await as('authenticated',owner,"update queue_items set status='cancelled' where id=$1 and status in ('waiting','ready','pending','serving') returning id",[q.id])).rows.length,0);
  });
  await test('Customer proof for push is not callable by public or professional roles', async () => {
    await denied('anon',null,'select verify_customer_queue_access($1,$2,$3)',[queueId,tenant,token]);
    await denied('authenticated',owner,'select get_tenant_account($1)',[tenant]);
  });
  await test('Booking enforces working hours, lunch, overlap and current service prices',async()=>{
    const date=new Date(Date.now()+86400000*2).toISOString().slice(0,10);
    await as('authenticated',owner,`update tenants set booking_type='appointment', working_hours=$1 where id=$2`,[JSON.stringify(Array.from({length:7},(_,day)=>({day,start:'08:00',end:'18:00'}))),tenant]);
    const join=(time)=>as('anon',null,'select * from join_queue($1,$2,$3,$4,$5,$6)',[tenant,'cut','Reserva QA','71999999999','z'.repeat(64),`${date}T${time}:00-03:00`]);
    for(const time of ['07:30','12:00','18:00','09:15']) await assert.rejects(()=>join(time));
    const q=(await join('09:00')).rows[0].join_queue;
    assert.equal(q.status,'pending');assert.equal(Number(q.price),35);
    await assert.rejects(()=>join('09:00'));
    await as('authenticated',owner,"update queue_items set status='cancelled' where id=$1",[q.id]);
    const scheduled=(await join('09:00')).rows[0].join_queue;
    await as('authenticated',owner,"update queue_items set status='serving',started_at=appointment_time where id=$1",[scheduled.id]);
    await as('authenticated',owner,'select complete_service($1,$2)',[tenant,scheduled.id]);
    const receipt=(await as('authenticated',owner,'select * from financial_records where source_queue_item_id=$1',[scheduled.id])).rows[0];
    assert.equal(new Date(receipt.appointment_time).toISOString(),new Date(`${date}T09:00:00-03:00`).toISOString());
    assert.equal(new Date(receipt.started_at).toISOString(),new Date(receipt.appointment_time).toISOString());
    assert.equal(receipt.customer_name,'Reserva QA');
  });
  await test('Suspended tenant cannot receive bookings or access private data',async()=>{
    await as('authenticated',admin,'update tenants set is_active=false where id=$1',[tenant]);
    assert.equal((await as('authenticated',owner,'select * from tenants')).rows.length,0);
    await denied('anon',null,'select * from join_queue($1,$2,$3,$4,$5)',[tenant,'cut','Blocked QA','71999999999','d'.repeat(64)]);
    await denied('authenticated',owner,'select record_expense($1,$2,$3,$4)',[tenant,'Blocked',50,'44444444-4444-4444-8444-444444444444']);
  });
  await test('Remote verification script is valid and rolls back its fixtures',async()=>{
    const before=(await db.query('select count(*)::int n from tenants')).rows[0].n;
    await db.exec(await readFile(new URL('./test-live-transaction.sql',import.meta.url),'utf8'));
    assert.equal((await db.query('select count(*)::int n from tenants')).rows[0].n,before);
    assert.equal((await db.query("select count(*)::int n from tenants where slug like 'qa-verificacao-%'")).rows[0].n,0);
  });
  console.log(`Database: ${count} tests passed.`);
} finally { await db.close(); }

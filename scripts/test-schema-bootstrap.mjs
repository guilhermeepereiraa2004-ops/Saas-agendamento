import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();
try {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create table auth.users(id uuid primary key,email text);
    create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id),not_after timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to anon,authenticated,service_role;`);
  for(const file of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile(`supabase/migrations/${file}`,'utf8'));
  assert.equal((await db.query("select count(*)::int n from pg_tables where schemaname='public' and rowsecurity")).rows[0].n,7);
  assert.equal((await db.query("select count(*)::int n from information_schema.columns where table_schema='public' and column_name='login_password'")).rows[0].n,0);
  for(const name of ['tenants','queue_items','financial_records','tenant_expenses','tenant_tasks','tenant_products','platform_settings'])await assert.rejects(()=>db.transaction(async tx=>{await tx.exec('set local role anon');await tx.query(`select * from public.${name}`);}));
  assert.equal((await db.query("select has_function_privilege('anon','public.professional_push_targets(uuid)','execute') allowed")).rows[0].allowed,false);
  console.log('PASS Bootstrap: all versioned migrations create a fresh, protected schema without legacy scripts or plaintext passwords');
} finally {await db.close();}

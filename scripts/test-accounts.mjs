import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const compile = source => ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const auth = compile(await readFile(new URL('../api/_lib/auth.ts',import.meta.url),'utf8'));
const source = compile(await readFile(new URL('../api/tenant-account.ts',import.meta.url),'utf8')).replace("'./_lib/auth.js'",JSON.stringify(`data:text/javascript;base64,${Buffer.from(auth).toString('base64')}`));
const {default:handler} = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
Object.assign(process.env,{SUPABASE_URL:'https://database.invalid',SUPABASE_ANON_KEY:'fixture-public-key',SUPABASE_SERVICE_ROLE_KEY:'fixture-server-key'});
const id='11111111-1111-4111-8111-111111111111';
const profile={name:'Studio QA',slug:'studio-qa',login_email:'owner@example.invalid',monthly_fee:0,payment_day:10};
const password='Fixture-only-password';
let master,validUser,existing,linked,fail,calls,stored;
const reset=()=>{master=true;validUser=true;existing=true;linked=true;fail='';calls=[];stored={...profile,id};};
globalThis.fetch=async(url,options={})=>{
  const path=new URL(url).pathname+new URL(url).search;
  const method=options.method||'GET';
  const body=options.body?JSON.parse(options.body):undefined;
  calls.push({path,method,body,headers:options.headers});
  if(path==='/auth/v1/user') return Response.json({id:'master-id'},{status:validUser?200:401});
  if(path.endsWith('/rpc/staff_access')) return Response.json({is_master:master,tenant_ids:[id]});
  if(path.startsWith('/rest/v1/tenants')){
    if(method==='GET') return Response.json(existing?[stored]:[],{status:fail==='read'?401:200});
    if(method==='PATCH') {if(fail==='save') return Response.json({}, {status:409}); Object.assign(stored,body);return Response.json([stored]);}
    if(method==='POST') {if(fail==='save') return Response.json({}, {status:409});return Response.json([{id,...body[0]}]);}
    if(method==='DELETE') return Response.json({});
  }
  if(path.endsWith('/rpc/get_tenant_account')) return Response.json(linked?{user_id:'owner-id'}:null);
  if(path.endsWith('/rpc/assign_tenant_account')) return Response.json({}, {status:fail==='link'?500:200});
  if(path.startsWith('/auth/v1/admin/users')) {
    if(method==='POST') return Response.json({id:'new-owner-id'},{status:fail==='create'?422:200});
    if(method==='PUT') return Response.json({}, {status:fail==='auth'?422:200});
    if(method==='DELETE') return Response.json({});
  }
  throw new Error(`Unexpected request: ${path}`);
};
const request=(body={tenant:profile,password},headers={},method='POST')=>new Request('https://qa.invalid/api/tenant-account',{method,headers:{origin:'https://qa.invalid',authorization:'Bearer fixture-token',...headers},...(method==='GET'?{}:{body:typeof body==='string'?body:JSON.stringify(body)})});
let count=0;
async function test(name,fn){reset();await fn();count++;console.log(`PASS ${name}`);}
try{
  await test('Accounts rejects unsupported method',async()=>assert.equal((await handler.fetch(request({}, {},'GET'))).status,405));
  await test('Accounts rejects external origin',async()=>assert.equal((await handler.fetch(request(undefined,{origin:'https://external.invalid'}))).status,403));
  await test('Accounts requires a server-verified session',async()=>{assert.equal((await handler.fetch(request(undefined,{authorization:''}))).status,401);assert.equal(calls.length,0);});
  await test('Professional cannot manage platform accounts',async()=>{master=false;assert.equal((await handler.fetch(request())).status,401);assert.equal(calls.filter(c=>c.path.includes('/admin/')).length,0);});
  await test('Invalid session is rejected',async()=>{validUser=false;assert.equal((await handler.fetch(request())).status,401);});
  await test('Missing server secret fails closed',async()=>{delete process.env.SUPABASE_SERVICE_ROLE_KEY;try{assert.equal((await handler.fetch(request())).status,503);}finally{process.env.SUPABASE_SERVICE_ROLE_KEY='fixture-server-key';}});
  await test('Invalid JSON is rejected',async()=>assert.equal((await handler.fetch(request('{'))).status,400));
  await test('Oversized payload is rejected',async()=>assert.equal((await handler.fetch(request('x'.repeat(2_000_001)))).status,413));
  await test('Invalid fee, payment day and password are rejected',async()=>{
    for(const slug of ['admin','recuperar-acesso','api']) assert.equal((await handler.fetch(request({tenant:{...profile,slug},password}))).status,400);
    for(const patch of [{monthly_fee:-1},{payment_day:45},{slug:'bad?slug'},{login_email:'invalid'}]) assert.equal((await handler.fetch(request({tenant:{...profile,...patch},password}))).status,400);
    for(const invalid of ['short',{},['invalid'],null]) assert.equal((await handler.fetch(request({tenant:profile,password:invalid}))).status,400);
    assert.equal(calls.filter(c=>c.path.includes('/admin/')).length,0);
  });
  await test('New account uses Auth Admin API and never stores plaintext in tenant',async()=>{
    assert.equal((await handler.fetch(request({tenant:{...profile,login_password:'injected',is_active:false},password}))).status,200);
    const created=calls.find(c=>c.path==='/rest/v1/tenants'&&c.method==='POST');
    assert.equal(created.body[0].monthly_fee,0);assert.ok(!('login_password'in created.body[0]));assert.ok(!('is_active'in created.body[0]));
    assert.equal(calls.filter(c=>c.path.endsWith('/rpc/assign_tenant_account')).length,1);
    assert.equal(created.headers.apikey,'fixture-server-key');
  });
  await test('Rejected legacy server key reports setup error without exposing credentials or changing data',async()=>{
    fail='read';const logs=[];const previousError=console.error;console.error=(...parts)=>logs.push(parts);
    try{
      const response=await handler.fetch(request({id,tenant:profile}));const body=await response.json();
      assert.equal(response.status,502);assert.match(body.error,/desatualizada/);
      assert.ok(!JSON.stringify(logs).includes(process.env.SUPABASE_SERVICE_ROLE_KEY));
      assert.deepEqual(stored,{...profile,id});assert.equal(calls.filter(call=>['PATCH','DELETE'].includes(call.method)||call.path.includes('/admin/')).length,0);
    }finally{console.error=previousError;}
  });
  await test('Auth creation failure leaves no tenant',async()=>{fail='create';assert.equal((await handler.fetch(request())).status,400);assert.equal(calls.filter(c=>c.path==='/rest/v1/tenants'&&c.method==='POST').length,0);});
  await test('Tenant creation failure cleans up only the newly created Auth account',async()=>{fail='save';assert.equal((await handler.fetch(request())).status,400);assert.deepEqual(calls.filter(c=>c.method==='DELETE').map(c=>c.path),['/auth/v1/admin/users/new-owner-id']);});
  await test('Link failure compensates new records',async()=>{fail='link';assert.equal((await handler.fetch(request())).status,502);assert.equal(calls.filter(c=>c.method==='DELETE').length,2);});
  await test('Editing profile preserves existing password when omitted',async()=>{assert.equal((await handler.fetch(request({id,tenant:profile}))).status,200);assert.equal(calls.filter(c=>c.path.startsWith('/auth/v1/admin/')).length,0);});
  await test('Missing tenant is reported',async()=>{existing=false;assert.equal((await handler.fetch(request({id,tenant:profile}))).status,404);});
  await test('Failed credential update restores previous profile',async()=>{fail='auth';assert.equal((await handler.fetch(request({id,tenant:{...profile,name:'Changed'},password}))).status,400);assert.equal(stored.name,profile.name);});
  await test('Legacy account requires a fresh password to migrate',async()=>{linked=false;assert.equal((await handler.fetch(request({id,tenant:profile}))).status,409);assert.equal(calls.filter(c=>c.method==='PATCH').length,0);});
  await test('Legacy account is linked to newly created Auth user with fresh password',async()=>{linked=false;assert.equal((await handler.fetch(request({id,tenant:profile,password}))).status,200);assert.equal(calls.filter(c=>c.method==='POST'&&c.path==='/auth/v1/admin/users').length,1);assert.equal(calls.filter(c=>c.path==='/rest/v1/tenants'&&c.method==='POST').length,0);});
  console.log(`Accounts: ${count} tests passed.`);
}catch(error){console.error(error);process.exitCode=1;}

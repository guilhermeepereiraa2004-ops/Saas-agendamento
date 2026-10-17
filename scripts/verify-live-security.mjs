import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
const env=await readFile(new URL('../.env',import.meta.url),'utf8');
const value=name=>env.match(new RegExp(`^${name}\\s*=\\s*(.*)$`,'m'))?.[1].trim().replace(/^['"]|['"]$/g,'');
const url=value('VITE_SUPABASE_URL');
const key=value('VITE_SUPABASE_ANON_KEY');
assert.ok(url&&key,'Configuração pública ausente');
const headers={apikey:key,'Content-Type':'application/json',...(!key.startsWith('sb_publishable_')?{Authorization:`Bearer ${key}`}:{})};
const results=[];
for(const table of ['tenants','queue_items','financial_records','tenant_expenses','tenant_tasks','tenant_products','platform_settings']){
  const response=await fetch(`${url}/rest/v1/${table}?select=id&limit=0`,{headers,signal:AbortSignal.timeout(15000)});
  const denial=await response.json();
  assert.ok([401,403].includes(response.status)&&denial.code==='42501',`${table}: leitura anônima não foi bloqueada por permissões do banco (${response.status}, ${denial.code})`);
  results.push({check:`anonymous_${table}_denied`,status:response.status,passed:true});
}
for(const rpc of ['staff_access','complete_service','record_expense','assign_tenant_account','get_tenant_account','verify_customer_queue_access']){
  const args=rpc==='staff_access'?{}:rpc==='complete_service'?{p_tenant_id:'00000000-0000-4000-8000-000000000000',p_queue_id:'00000000-0000-4000-8000-000000000000'}:rpc==='record_expense'?{p_tenant_id:'00000000-0000-4000-8000-000000000000',p_description:'QA',p_amount:1,p_request_id:'00000000-0000-4000-8000-000000000000'}:rpc==='assign_tenant_account'?{p_tenant_id:'00000000-0000-4000-8000-000000000000',p_user_id:'00000000-0000-4000-8000-000000000000'}:rpc==='get_tenant_account'?{p_tenant_id:'00000000-0000-4000-8000-000000000000'}:{p_queue_id:'00000000-0000-4000-8000-000000000000',p_tenant_id:'00000000-0000-4000-8000-000000000000',p_token:'q'.repeat(64)};
  const response=await fetch(`${url}/rest/v1/rpc/${rpc}`,{method:'POST',headers,body:JSON.stringify(args),signal:AbortSignal.timeout(15000)});
  const denial=await response.json();
  assert.ok([401,403].includes(response.status)&&denial.code==='42501',`${rpc}: chamada anônima não foi bloqueada por permissões do banco (${response.status}, ${denial.code})`);
  results.push({check:`anonymous_${rpc}_denied`,status:response.status,passed:true});
}
const missing=await fetch(`${url}/rest/v1/rpc/get_public_tenant`,{method:'POST',headers,body:JSON.stringify({p_slug:'qa-nao-existe-'+crypto.randomUUID()}),signal:AbortSignal.timeout(15000)});
assert.equal(missing.status,200); assert.deepEqual(await missing.json(),[]);
results.push({check:'public_lookup_available',status:200,passed:true});
for(const slug of process.argv.slice(2)){
  const tenantResponse=await fetch(`${url}/rest/v1/rpc/get_public_tenant`,{method:'POST',headers,body:JSON.stringify({p_slug:slug}),signal:AbortSignal.timeout(15000)});
  assert.equal(tenantResponse.status,200);
  const [tenant]=await tenantResponse.json(); assert.ok(tenant?.id&&tenant.name);
  for(const field of ['login_email','login_password','admin_push_id','monthly_fee','payment_day','next_payment_at']) assert.ok(!(field in tenant),`Campo privado em ${slug}: ${field}`);
  for(const rpc of ['get_public_queue','get_public_products']){
    const response=await fetch(`${url}/rest/v1/rpc/${rpc}`,{method:'POST',headers,body:JSON.stringify({p_tenant_id:tenant.id}),signal:AbortSignal.timeout(15000)});
    assert.equal(response.status,200); const rows=await response.json(); assert.ok(Array.isArray(rows));
    if(rpc==='get_public_queue') for(const row of rows){assert.equal(row.whatsapp,'');assert.equal(row.push_id,null);assert.ok(!('customer_token_hash'in row));}
  }
  const services=typeof tenant.services==='string'?JSON.parse(tenant.services):(tenant.services||[]);
  assert.ok(Array.isArray(services));
  const hours=typeof tenant.working_hours==='string'?JSON.parse(tenant.working_hours):(tenant.working_hours||[]);
  results.push({check:`public_${slug}_tenant_queue_products`,status:200,passed:true,serviceCount:services.length,workingDays:hours.map(h=>h.day)});
}
await writeFile(new URL('../scratch/admin-audit/live-security-results.json',import.meta.url),JSON.stringify({checkedAt:new Date().toISOString(),results},null,2));
console.log(JSON.stringify({passed:results.length,failed:0,results},null,2));

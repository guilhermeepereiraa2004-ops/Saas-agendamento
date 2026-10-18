import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const compile=source=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const moduleURL=source=>`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const auth=moduleURL(compile(await readFile('api/_lib/auth.ts','utf8')));
const pwa=moduleURL(compile(await readFile('src/lib/pwa.ts','utf8')));
const source=compile(await readFile('api/push-device.ts','utf8')).replace("'./_lib/auth.js'",JSON.stringify(auth)).replace("'../src/lib/pwa.js'",JSON.stringify(pwa));
const {default:handler}=await import(moduleURL(source));
Object.assign(process.env,{SUPABASE_URL:'https://db.qa.invalid',SUPABASE_ANON_KEY:'qa-public',ONESIGNAL_APP_ID:'qa-app',ONESIGNAL_REST_API_KEY:'qa-private'});
const tenantId='11111111-1111-4111-8111-111111111111';
const deviceId='22222222-2222-4222-8222-222222222222';
let subscriptions, access, providerStatus, sent, authStatus, calls;
globalThis.fetch=async(url,options)=>{
  calls.push(url);
  if(url.endsWith('/auth/v1/user')) return Response.json({id:'qa-user'},{status:authStatus});
  if(url.endsWith('/rpc/staff_access'))return Response.json(access);
  if(url.includes('/users/by/external_id/')) {
    assert.equal(url,`https://api.onesignal.com/apps/qa-app/users/by/external_id/admin_${tenantId}`);
    assert.equal(options.headers.Authorization,'Key qa-private');
    return Response.json({subscriptions},{status:providerStatus});
  }
  if(url.includes('/rest/v1/tenants?')) return Response.json([{slug:'qa'}]);
  if(url.startsWith('https://api.onesignal.com/notifications')) {sent.push(JSON.parse(options.body));return Response.json({id:'qa-message'});}
  throw new Error('Unexpected real network request');
};
const request=(extra={},options={})=>new Request('https://app.qa.invalid/api/push-device',{
  method:options.method||'POST',headers:{origin:options.origin||'https://app.qa.invalid',authorization:'Bearer qa-token',...options.headers},
  ...(options.method==='GET'?{}:{body:typeof extra==='string'?extra:JSON.stringify({tenantId,subscriptionId:deviceId,action:'status',...extra})}),
});
let passed=0;
async function test(name,fn){
  subscriptions=[{id:deviceId,enabled:true,notification_types:1,type:'ChromePush',token:'private-push-token'},{id:'other-device',enabled:true}];
  access={is_master:false,tenant_ids:[tenantId]};providerStatus=200;sent=[];calls=[];authStatus=200;
  await fn();passed++;console.log('PASS',name);
}
await test('Rejeita método, origem, JSON, IDs e ação inválidos',async()=>{
  assert.equal((await handler.fetch(request({},{method:'GET'}))).status,405);
  assert.equal((await handler.fetch(request({},{origin:'https://outside.invalid'}))).status,403);
  for(const body of ['null','[1]','{', {tenantId:'bad'}, {subscriptionId:'bad'}, {action:'delete'}]) assert.equal((await handler.fetch(request(body))).status,400);
  assert.equal((await handler.fetch(request('x'.repeat(1025)))).status,413);
  assert.equal(calls.length,0);
});
await test('Conta sem sessão e profissional de outro estabelecimento não consultam nem enviam',async()=>{
  authStatus=401;assert.equal((await handler.fetch(request())).status,401);
  authStatus=200;access.tenant_ids=[];assert.equal((await handler.fetch(request({action:'test'}))).status,401);
  assert.equal(calls.some(url=>url.includes('onesignal')),false);
});
await test('Verifica o aparelho no usuário profissional sem expor outros aparelhos, tokens ou chave',async()=>{
  const response=await handler.fetch(request());assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{registered:true});assert.equal(sent.length,0);
  assert.equal(response.headers.get('cache-control'),'no-store');
});
await test('Permissão local não basta quando o aparelho está vinculado a outro usuário',async()=>{
  subscriptions=subscriptions.filter(s=>s.id!==deviceId);
  assert.deepEqual(await (await handler.fetch(request({action:'test'}))).json(),{registered:false,reason:'not-linked'});
  assert.equal(sent.length,0);
});
await test('Usuário remoto inexistente é informado como vínculo ausente',async()=>{
  providerStatus=404;assert.deepEqual(await (await handler.fetch(request())).json(),{registered:false,reason:'not-linked'});
});
await test('Inscrição desativada, inválida ou que não seja push não recebe teste',async()=>{
  for(const extra of [{enabled:false},{notification_types:-2},{type:'Email'}]) {
    subscriptions=[{id:deviceId,enabled:true,notification_types:1,type:'ChromePush',...extra}];
    assert.deepEqual(await (await handler.fetch(request({action:'test'}))).json(),{registered:false,reason:'not-subscribed'});
  }
  assert.equal(sent.length,0);
});
await test('Falha do provedor não anuncia vínculo confirmado',async()=>{
  providerStatus=503;assert.equal((await handler.fetch(request())).status,502);assert.equal(sent.length,0);
});
await test('Teste explícito envia somente ao próprio aparelho e respeita intervalo',async()=>{
  const response=await handler.fetch(request({action:'test'}));assert.deepEqual(await response.json(),{registered:true,sent:true});
  assert.equal(sent.length,1);assert.deepEqual(sent[0].include_subscription_ids,[deviceId]);
  assert.equal(sent[0].include_aliases,undefined);assert.equal(sent[0].included_segments,undefined);
  assert.equal(sent[0].web_url,'https://app.qa.invalid/qa/profissional/');
  assert.equal((await handler.fetch(request({action:'test'}))).status,429);assert.equal(sent.length,1);
});
console.log(`${passed} testes de aparelho passaram.`);

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const compile = source => ts.transpileModule(source, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const moduleURL = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const routes = moduleURL(compile(await readFile(new URL('../src/lib/pwa.ts',import.meta.url),'utf8')));
const source = compile(await readFile(new URL('../api/pwa-manifest.ts',import.meta.url),'utf8')).replace("'../src/lib/pwa.js'",JSON.stringify(routes));
const {default:handler} = await import(moduleURL(source));
Object.assign(process.env,{SUPABASE_URL:'https://qa-db.invalid',SUPABASE_ANON_KEY:'qa-publishable-key',SUPABASE_SECRET_KEY:'qa-must-not-be-used'});
const tenantId = '11111111-1111-4111-8111-111111111111';
let tenant, upstreamStatus, calls;
globalThis.fetch = async (url, options) => {
  calls.push({url,options});
  assert.equal(url,'https://qa-db.invalid/rest/v1/rpc/get_public_tenant');
  assert.equal(options.method,'POST');
  assert.equal(options.headers.apikey,'qa-publishable-key');
  assert.equal(options.headers.Authorization,undefined);
  return Response.json(tenant ? [tenant] : [],{status:upstreamStatus});
};
const request = (slug='qa',audience='customer',method='GET') => new Request(`https://qa.invalid/api/pwa-manifest?slug=${encodeURIComponent(slug)}&audience=${encodeURIComponent(audience)}`,{method});
const result = async (slug,audience) => {const response=await handler.fetch(request(slug,audience));assert.equal(response.status,200);return response.json();};
let passed=0;
async function test(name,fn) {
  tenant={id:tenantId,name:'Barbearia QA',is_active:true,login_email:'private@qa.invalid',admin_push_id:'private-device'};upstreamStatus=200;calls=[];
  await fn();passed++;console.log('PASS',name);
}
await test('Manifestos: cliente e profissional possuem identidades e escopos distintos',async()=>{
  const customer=await result('qa','customer');const professional=await result('qa','professional');
  assert.notEqual(customer.id,professional.id);assert.equal(customer.start_url,'/qa/cliente/');assert.equal(professional.start_url,'/qa/profissional/');
  assert.equal(customer.scope,customer.start_url);assert.equal(professional.scope,professional.start_url);
  assert.match(professional.name,/Profissional/);assert.match(professional.short_name,/QA Pro/);
});
await test('Manifestos: identidade permanece estável ao renomear ou trocar slug',async()=>{
  const before=await result('qa','professional');tenant.name='Novo nome';
  const after=await result('novo-slug','professional');assert.equal(before.id,after.id);assert.equal(after.start_url,'/novo-slug/profissional/');
});
await test('Manifestos: metadados públicos não expõem acesso, contato ou notificações',async()=>{
  const response=await handler.fetch(request());const text=await response.text();
  assert.doesNotMatch(text,/private|login_email|admin_push_id|qa-publishable-key|qa-must-not-be-used/);
  assert.match(response.headers.get('content-type'),/application\/manifest\+json/);
});
await test('Manifestos: usam a logo do site em 192 e 512 pixels e ícones maskable',async()=>{
  const manifest=await result('qa','customer');assert.equal(manifest.icons.length,4);
  assert.deepEqual(manifest.icons.filter(i=>i.purpose==='any').map(i=>i.sizes),['192x192','512x512']);
  assert.equal(manifest.icons.filter(i=>i.purpose==='maskable').length,2);
  assert.ok(manifest.icons.every(i=>i.src.startsWith('/icons/suavez-v2-')&&i.type==='image/png'));
});
await test('Manifestos: rejeitam escrita e caminhos inválidos antes de consultar o banco',async()=>{
  assert.equal((await handler.fetch(request('qa','customer','POST'))).status,405);
  for(const [slug,audience] of [['../admin','customer'],['qa/x','customer'],['qa','master'],['','customer']]) assert.equal((await handler.fetch(request(slug,audience))).status,400);
  assert.equal(calls.length,0);
});
await test('Manifestos: estabelecimento inexistente ou suspenso não é instalável',async()=>{
  tenant=null;assert.equal((await handler.fetch(request())).status,404);
  tenant={id:tenantId,name:'Suspenso',is_active:false};assert.equal((await handler.fetch(request())).status,404);
});
await test('Manifestos: falha do serviço retorna erro sem cachear um manifesto incorreto',async()=>{
  upstreamStatus=503;const response=await handler.fetch(request());assert.equal(response.status,502);assert.equal(response.headers.get('cache-control'),'no-store');
});
console.log(`${passed} testes de manifesto passaram.`);

import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('../api/send-push.ts', import.meta.url), 'utf8');
const authSource = await readFile(new URL('../api/_lib/auth.ts', import.meta.url), 'utf8');
const authModule = ts.transpileModule(authSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const pwaModule = ts.transpileModule(await readFile(new URL('../src/lib/pwa.ts',import.meta.url),'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText.replace("'./_lib/auth.js'",JSON.stringify(`data:text/javascript;base64,${Buffer.from(authModule).toString('base64')}`)).replace("'../src/lib/pwa.js'",JSON.stringify(`data:text/javascript;base64,${Buffer.from(pwaModule).toString('base64')}`));
const { default: handler } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
Object.assign(process.env, { APP_ORIGIN: 'https://qa.example.invalid', SUPABASE_URL: 'https://db.example.invalid', SUPABASE_ANON_KEY: 'qa-public-key', SUPABASE_SERVICE_ROLE_KEY:'qa-server-key', ONESIGNAL_APP_ID: 'qa-app', ONESIGNAL_REST_API_KEY: 'qa-private-key' });
const tenantId = '11111111-1111-4111-8111-111111111111';
const queueItemId = '22222222-2222-4222-8222-222222222222';
const baseline = { id: queueItemId, name: 'Cliente QA', service_name: 'Corte', status: 'ready', is_on_way: false, push_id: 'qa-subscription', appointment_time: null };
let item = { ...baseline }; let providerStatus = 200; let providerBody = { id: 'qa-message' }; let lookupRows = true; let sent = [];
let access = {is_master:false,tenant_ids:[tenantId]}; let validProof=true; let authStatus=200; let proofThrows=false;
let databaseHeaders=[];let authorizedTargets=['authorized-device-one','authorized-device-two'];let targetsFail=false;
globalThis.fetch = async (url, options) => {
  if(url.startsWith('https://db.example.invalid/')) databaseHeaders.push(options.headers);
  if (url.endsWith('/auth/v1/user')) return Response.json({id:'qa-user'},{status:authStatus});
  if (url.endsWith('/rpc/staff_access')) return Response.json(access);
  if (url.endsWith('/rpc/professional_push_targets')) return Response.json(authorizedTargets,{status:targetsFail?503:200});
  if (url.endsWith('/rpc/verify_customer_queue_access')) { if(proofThrows) throw new Error('QA timeout');return Response.json(validProof); }
  if (url.startsWith('https://db.example.invalid/rest/v1/queue_items')) return Response.json(lookupRows ? [item] : []);
  if (url.startsWith('https://db.example.invalid/rest/v1/tenants')) return Response.json([{ id: tenantId, name: 'QA', slug: 'qa' }]);
  if (url.startsWith('https://api.onesignal.com/notifications')) { sent.push(JSON.parse(options.body)); return Response.json(providerBody, { status: providerStatus }); }
  throw new Error('Unexpected real network request in isolated test');
};
let ip = 0;
const request = (body = { event: 'client_called', tenantId, queueItemId }, options = {}) => new Request('https://qa.example.invalid/api/send-push', { method: options.method || 'POST', headers: { origin: options.origin || 'https://qa.example.invalid', 'content-type': 'application/json', authorization:'Bearer qa-verified-token', 'x-forwarded-for': options.ip || `qa-${++ip}`, ...options.headers }, ...((options.method || 'POST') !== 'GET' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) });
const results = [];
async function test(name, callback) {
  item = { ...baseline }; sent = []; providerStatus = 200; providerBody = { id: 'qa-message' }; lookupRows = true;
  access={is_master:false,tenant_ids:[tenantId]};validProof=true;authStatus=200;proofThrows=false;
  authorizedTargets=['authorized-device-one','authorized-device-two'];targetsFail=false;
  try { await callback(); results.push({ name, status: 'passed' }); }
  catch (error) { results.push({ name, status: 'failed', error: error.message }); }
}
await test('Push API: rejeita GET', async () => assert.equal((await handler.fetch(request({}, { method: 'GET' }))).status, 405));
await test('Push API: rejeita origem externa', async () => assert.equal((await handler.fetch(request({}, { origin: 'https://outsider.invalid' }))).status, 403));
await test('Push API: rejeita JSON inválido', async () => assert.equal((await handler.fetch(request('{'))).status, 400));
await test('Push API: rejeita payload grande', async () => assert.equal((await handler.fetch(request('x'.repeat(4097)))).status, 413));
await test('Push API: valida UUIDs e evento', async () => assert.equal((await handler.fetch(request({ event: 'anything', tenantId: 'invalid', queueItemId }))).status, 400));
await test('Push API: registro não encontrado', async () => { lookupRows = false; assert.equal((await handler.fetch(request())).status, 404); });
await test('Push API: evento incompatível com estado não envia', async () => { item.status = 'waiting'; assert.equal((await handler.fetch(request())).status, 202); assert.equal(sent.length, 0); });
await test('Push API: sem assinatura não envia para cliente', async () => { item.push_id = null; assert.equal((await handler.fetch(request())).status, 202); assert.equal(sent.length, 0); });
for (const [event, status, appointment, target] of [
  ['client_called', 'ready', null, 'client'], ['appointment_cancelled', 'cancelled', null, 'client'], ['appointment_approved', 'waiting', now(), 'client'], ['appointment_rejected', 'cancelled', now(), 'client'], ['client_joined', 'waiting', null, 'admin'], ['client_on_way', 'ready', null, 'admin'],
]) await test(`Push API: ${event} usa destinatário e conteúdo esperados`, async () => {
  Object.assign(item, { status, appointment_time: appointment, is_on_way: event === 'client_on_way' });
  const response = await handler.fetch(request({ event, tenantId, queueItemId,customerToken:'a'.repeat(64) }));
  assert.equal(response.status, 200); assert.equal((await response.json()).sent, true); assert.equal(sent.length, 1);
  if (target === 'client') assert.deepEqual(sent[0].include_subscription_ids, ['qa-subscription']);
  else { assert.deepEqual(sent[0].include_subscription_ids,['authorized-device-one','authorized-device-two']); assert.equal(sent[0].include_aliases,undefined); }
  const destination=`https://qa.example.invalid/qa/${target==='client'?'cliente':'profissional'}/`;
  assert.equal(sent[0].web_url,destination);assert.equal(sent[0].web_buttons[0].url,destination);assert.ok(sent[0].idempotency_key);
});
await test('Push API: chave de idempotência estável para mesma ação', async () => { await handler.fetch(request()); await handler.fetch(request()); assert.equal(sent[0].idempotency_key, sent[1].idempotency_key); });
await test('Segurança: nenhum aparelho autorizado impede envio mesmo se houver alias OneSignal forjado',async()=>{
  item.status='waiting';authorizedTargets=[];
  assert.equal((await handler.fetch(request({event:'client_joined',tenantId,queueItemId,customerToken:'a'.repeat(64)}))).status,202);assert.equal(sent.length,0);
});
await test('Segurança: falha na lista privada não usa alias público nem destinatários alternativos',async()=>{
  item.status='waiting';targetsFail=true;
  assert.equal((await handler.fetch(request({event:'client_joined',tenantId,queueItemId,customerToken:'a'.repeat(64)}))).status,500);assert.equal(sent.length,0);
});
await test('Cancelamento push: informa cancelamento de horário e evita duplicar aviso',async()=>{
  Object.assign(item,{status:'cancelled',appointment_time:now()});
  const payload={event:'appointment_cancelled',tenantId,queueItemId};
  await handler.fetch(request(payload));await handler.fetch(request(payload));
  assert.equal(sent[0].headings.pt,'Agendamento cancelado');assert.match(sent[0].contents.pt,/cancelou seu atendimento/);
  assert.equal(sent[0].idempotency_key,sent[1].idempotency_key);
});
await test('Cancelamento push: não envia antes de salvar o cancelamento nem sem inscrição',async()=>{
  for(const status of ['waiting','ready','pending','serving','completed']){
    item.status=status;assert.equal((await handler.fetch(request({event:'appointment_cancelled',tenantId,queueItemId}))).status,202);
  }
  item.status='cancelled';item.push_id=null;
  assert.equal((await handler.fetch(request({event:'appointment_cancelled',tenantId,queueItemId}))).status,202);
  assert.equal(sent.length,0);
});
await test('Cancelamento push: exige profissional autenticado do estabelecimento',async()=>{
  item.status='cancelled';
  assert.equal((await handler.fetch(request({event:'appointment_cancelled',tenantId,queueItemId},{headers:{authorization:''}}))).status,401);
  access.tenant_ids=[];
  assert.equal((await handler.fetch(request({event:'appointment_cancelled',tenantId,queueItemId}))).status,401);
  assert.equal(sent.length,0);
});
for(const event of ['service_started','service_completed'])await test(`Push API: ${event} não envia aviso mesmo em versões antigas do app`, async()=>{
  item.status=event==='service_started'?'serving':'completed';
  assert.equal((await handler.fetch(request({event,tenantId,queueItemId}))).status,400);
  assert.equal(sent.length,0);
});
await test('Push API: falha do provedor retorna 502', async () => { providerStatus = 400; providerBody = { errors: ['mock error'] }; assert.equal((await handler.fetch(request())).status, 502); });
await test('Push API: nenhum dispositivo elegível retorna sem envio', async () => { providerBody = {}; const response = await handler.fetch(request()); assert.equal(response.status, 202); assert.equal((await response.json()).sent, false); });
await test('Push API: limite de 24 requisições por minuto', async () => { for (let n = 0; n < 24; n++) await handler.fetch(request({}, { ip: 'rate-test' })); assert.equal((await handler.fetch(request({}, { ip: 'rate-test' }))).status, 429); });
await test('Segurança Push API: ação profissional exige autenticação de servidor', async () => { const response = await handler.fetch(request(undefined,{headers:{authorization:''}})); assert.equal(response.status, 401);assert.equal(sent.length,0); });
await test('Segurança Push API: sessão inválida é rejeitada', async()=>{authStatus=401;assert.equal((await handler.fetch(request())).status,401);assert.equal(sent.length,0);});
await test('Segurança Push API: profissional de outro estabelecimento é rejeitado',async()=>{access.tenant_ids=[];assert.equal((await handler.fetch(request())).status,401);assert.equal(sent.length,0);});
await test('Segurança Push API: cliente sem comprovante de posse é rejeitado',async()=>{assert.equal((await handler.fetch(request({event:'client_joined',tenantId,queueItemId}))).status,401);assert.equal(sent.length,0);});
await test('Segurança Push API: comprovante falso é rejeitado',async()=>{validProof=false;assert.equal((await handler.fetch(request({event:'client_joined',tenantId,queueItemId,customerToken:'a'.repeat(64)}))).status,401);assert.equal(sent.length,0);});
await test('Push API: falha na verificação é tratada sem enviar notificação',async()=>{proofThrows=true;assert.equal((await handler.fetch(request({event:'client_joined',tenantId,queueItemId,customerToken:'a'.repeat(64)}))).status,500);assert.equal(sent.length,0);});
await test('Push API: chave secreta moderna usa apikey na prova do cliente e nas leituras administrativas',async()=>{
  process.env.SUPABASE_SECRET_KEY='sb_secret_fixture_only_not_a_real_key';databaseHeaders=[];
  try{
    assert.equal((await handler.fetch(request())).status,200);
    item.status='waiting';
    assert.equal((await handler.fetch(request({event:'client_joined',tenantId,queueItemId,customerToken:'a'.repeat(64)}))).status,200);
    const privileged=databaseHeaders.filter(headers=>headers.apikey===process.env.SUPABASE_SECRET_KEY);
    assert.ok(privileged.length>=5);
    for(const headers of privileged) assert.ok(!('Authorization' in headers));
  }finally{delete process.env.SUPABASE_SECRET_KEY;}
});
function now() { return '2026-10-17T10:00:00-03:00'; }
await mkdir(new URL('../scratch/admin-audit/', import.meta.url), { recursive: true });
await writeFile(new URL('../scratch/admin-audit/push-results.json', import.meta.url), JSON.stringify(results, null, 2));
console.log(JSON.stringify({ passed: results.filter(r => r.status === 'passed').length, failed: results.filter(r => r.status === 'failed').length, results }, null, 2));
if (results.some(result => result.status === 'failed')) process.exitCode = 1;

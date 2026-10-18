import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium, webkit } = require(process.env.AUDIT_PLAYWRIGHT || 'playwright');
const engine = process.env.AUDIT_BROWSER === 'webkit' ? webkit : chromium;
const browser = await engine.launch({ ...(engine===chromium && process.env.AUDIT_BROWSER_CHANNEL ? {channel:process.env.AUDIT_BROWSER_CHANNEL} : {}), headless: true });
let results = [];
const filter = process.env.AUDIT_FILTER ? new RegExp(process.env.AUDIT_FILTER, 'i') : null;
if (filter) {
  try { const prior = JSON.parse(await readFile(new URL('browser-results.json', import.meta.url), 'utf8')); results = Array.isArray(prior) ? prior : prior.results; } catch {}
}
const output = new URL('./', import.meta.url);
const today = '2026-10-17';
const now = '2026-10-17T09:00:00-03:00';
const tenantId = '11111111-1111-4111-8111-111111111111';
const base = {
  id: tenantId, name: 'Barbearia QA', slug: 'qa', whatsapp: '71999999999', profession: 'barber',
  primary_color: '#7257d9', secondary_color: '#123abc', is_online: true, is_active: true,
  booking_type: 'queue', subscription_status: 'active', monthly_fee: 59.9, payment_day: 10,
  next_payment_at: '2026-11-10T00:00:00Z', has_logo: false, logo_url: null,
  services: [{ id: 'cut', name: 'Corte QA', price: 35, duration: 30 }, { id: 'long', name: 'Corte longo QA', price: 70, duration: 90 }],
  login_email: 'test@example.invalid', login_password: 'Only-fixture-123', appointment_interval: 30,
  lunch_start: '12:00', lunch_end: '13:00', working_hours: Array.from({ length: 7 }, (_, day) => ({ day, start: '08:00', end: '18:00' })),
};
const row = (id, status = 'waiting', extra = {}) => ({ id, tenant_id: tenantId, name: `Cliente ${id}`, whatsapp: '71999999999', service_id: 'cut', service_name: 'Corte QA', price: 35, status, joined_at: now, duration: 30, ...extra });
async function wait(check, message = 'State did not update', ms = 7500) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 40)); }
  assert.fail(message);
}
async function visible(locator) { await locator.waitFor({ state: 'visible' }); }
const field = (page, text) => page.locator('.form-group').filter({ has: page.locator('label').filter({ hasText: new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }) }).first().locator('input, select').first();
async function fixture({ width = 1440, tenant = {}, tables = {}, auth = true, forged = false, master = false, delay = 0, push = 'unsupported', permissionChoice = 'granted', pushFailures = 0, path, userAgent, standalone = false, origin = 'https://admin-audit.test', ownedItems = [] } = {}) {
  const db = {
    tenants: [structuredClone({ ...base, ...tenant })], queue_items: [], tenant_tasks: [], tenant_products: [], tenant_expenses: [], financial_records: [],
    platform_settings: [{ id: 'settings', pix_key: 'fixture-key', pix_name: 'QA beneficiary' }], ...structuredClone(tables),
  };
  const requests = []; const exceptions = []; const faults = [];
  if(pushFailures) faults.push({table:'push-device',remaining:pushFailures,status:200,body:{registered:false,reason:'not-linked'}});
  const context = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: 'America/Bahia', serviceWorkers: 'block', ...(userAgent ? {userAgent} : {}) });
  if (standalone) await context.addInitScript(() => {
    const original = window.matchMedia.bind(window);
    window.matchMedia = query => query === '(display-mode: standalone)' ? Object.defineProperty(original(query), 'matches', {value:true}) : original(query);
  });
  const user = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: base.login_email, aud: 'authenticated', role: 'authenticated' };
  const session = { access_token: 'qa-verified-token', refresh_token: 'qa-refresh-token', expires_at: 9999999999, expires_in: 3600, token_type: 'bearer', user };
  await context.addInitScript(({ auth, forged, master, session, push, permissionChoice, ownedItems, tenantId }) => {
    if (forged) localStorage.setItem(master ? 'admin_auth' : 'suavez_auth_qa', 'true');
    if (auth) localStorage.setItem('sb-tfquhfhmmnbwntmkfkdo-auth-token', JSON.stringify(session));
    if(ownedItems.length) localStorage.setItem(`suavez_customer_ids_${tenantId}`,JSON.stringify(ownedItems));
    // Isolated SDK and browser permission: never requests native permission or contacts devices.
    const listeners = { permissionChange: new Set(), change: new Set() };
    let status = localStorage.getItem('qa_push_status') || push;
    let nativePermission = status === 'enabled' || status === 'incomplete' ? 'granted' : status === 'blocked' ? 'denied' : 'default';
    // Linux WebKit has no native Notification API. This fixture tests our UI only.
    if (!window.Notification) window.Notification = class Notification {};
    Object.defineProperty(Notification, 'permission', { configurable: true, get: () => nativePermission });
    const harness = { requestCalls: 0, loginCalls: 0, logoutCalls: 0, optInCalls: 0, initOptions: null };
    let finishPermission;const queued=[];
    const sdk = {
      init: async options => { harness.initOptions = options; if(permissionChoice==='origin-error') throw new Error('Can only be used on: https://production.example.invalid'); if(permissionChoice==='init-error')throw new Error('Fixture initialization failed'); },
      login: async id => { harness.loginCalls++;if(permissionChoice==='identity-error')throw new Error('QA identity unavailable');sdk.User.externalId=id; }, logout: async () => {harness.logoutCalls++;sdk.User.externalId=null;}, Slidedown: { promptPush: async () => {} },
      Notifications: {
        permission: nativePermission === 'granted', isPushSupported: () => push !== 'unsupported',
        requestPermission: async () => {
          harness.requestCalls++;
          if (permissionChoice === 'error') throw new Error('Fixture SDK unavailable');
          if (permissionChoice === 'network-error') throw new Error('Failed to fetch');
          if (permissionChoice === 'hang') return new Promise(resolve=>{finishPermission=value=>{setStatus(value);resolve();};});
          setStatus(permissionChoice === 'granted' ? 'enabled' : permissionChoice === 'denied' ? 'blocked' : 'prompt');
        },
        addEventListener: (event, callback) => listeners[event]?.add(callback),
      },
      User: { PushSubscription: { id: null, token: null, optedIn: false,
        addEventListener: (_event, callback) => listeners.change.add(callback),
        removeEventListener: (_event, callback) => listeners.change.delete(callback),
        optIn: async () => {harness.optInCalls++;if(permissionChoice==='opt-in-hang')return new Promise(()=>{});setStatus('enabled');},
      } },
    };
    function setStatus(value) {
      status = value; localStorage.setItem('qa_push_status',value);
      nativePermission = ['enabled','incomplete','permission-only'].includes(value) ? 'granted' : value === 'blocked' ? 'denied' : 'default';
      sdk.Notifications.permission = nativePermission === 'granted';
      Object.assign(sdk.User.PushSubscription, { id: value === 'enabled' || value === 'incomplete' ? 'qa-subscription' : null, token: value === 'enabled' ? 'qa-token' : null, optedIn: value === 'enabled' || value === 'incomplete' });
      for(const callback of listeners.permissionChange) callback(sdk.Notifications.permission);
      for(const callback of listeners.change) callback({ current: {id:sdk.User.PushSubscription.id} });
    }
    setStatus(status);
    window.__pushHarness = Object.assign(harness,{setStatus,setNativePermission: value => { nativePermission=value; },setChoice:value=>{permissionChoice=value;},finishPermission:value=>finishPermission?.(value),flushSDK:async()=>{for(const fn of queued.splice(0)) await fn(sdk);}});
    window.OneSignalDeferred = { push: fn => push==='sdk-delayed' ? queued.push(fn) : Promise.resolve().then(() => fn(sdk)).catch(() => {}) };
  }, { auth, forged, master, session, push, permissionChoice, ownedItems, tenantId });

  await context.route('**/*', async route => {
    const request = route.request(); const url = new URL(request.url()); const method = request.method();
    const cors = {'access-control-allow-origin':origin,'access-control-allow-methods':'GET,POST,PUT,PATCH,DELETE,OPTIONS','access-control-allow-headers':'authorization,apikey,content-type,x-client-info,prefer,range'};
    if(method==='OPTIONS')return route.fulfill({status:204,headers:cors,body:''});
    const send = (data, status = 200, headers = {}) => route.fulfill({ status, contentType: 'application/json', headers:{...cors,...headers}, body: method === 'HEAD' ? '' : JSON.stringify(data) });
    if (url.pathname.startsWith('/auth/v1/')) {
      requests.push({table:'auth',method,path:url.pathname,body:request.postDataJSON()});
      const failure=faults.find(f=>f.table==='auth'&&f.remaining!==0);
      if(failure){failure.remaining--;return send(failure.body||{message:'QA auth failure'},failure.status||500);}
      if (url.pathname.endsWith('/recover')) return send({});
      if (url.pathname.endsWith('/logout')) return send({});
      if (url.pathname.endsWith('/token')) {
        const body = request.postDataJSON();
        return body.email === base.login_email && body.password === base.login_password ? send(session) : send({ error: 'invalid_grant', msg: 'Invalid login credentials' },400);
      }
      return request.headers().authorization === 'Bearer qa-verified-token' ? send(user) : send({ message: 'Invalid token' },401);
    }
    if (url.pathname === '/api/tenant-account') {
      const body = request.postDataJSON(); requests.push({ table:'tenant-account',method,body });
      if (db.tenants.some(t => t.slug===body.tenant.slug && t.id!==body.id)) return send({error:'Este subdomínio (slug) já está em uso.'},409);
      if (body.id) Object.assign(db.tenants.find(t=>t.id===body.id),body.tenant);
      else db.tenants.push({ ...structuredClone(base),...body.tenant,id:crypto.randomUUID() });
      return send({ saved:true });
    }
    if (url.pathname === '/api/push-device') {
      const body=request.postDataJSON();requests.push({table:'push-device',method,body});
      const failure=faults.find(f=>f.table==='push-device'&&f.remaining!==0);
      if(failure){failure.remaining--;return send(failure.body||{error:'QA push unavailable'},failure.status||502);}
      return send(body.action==='test'?{registered:true,sent:true}:{registered:true});
    }
    if (url.pathname.startsWith('/rest/v1/')) {
      const table = url.pathname.split('/').pop();
      let body;
      try { body = request.postDataJSON(); } catch { body = null; }
      requests.push({ table, method, body, query: url.search });
      const failure = faults.find(f => f.table === table && f.method === method && f.remaining !== 0);
      if (failure) { failure.remaining--; return send({ code: 'QA_FAILURE', message: 'Falha simulada de teste' }, 503); }
      if (method !== 'GET' && method !== 'HEAD' && delay) await new Promise(resolve => setTimeout(resolve, delay));
      if (url.pathname.includes('/rpc/')) {
        if (table==='staff_access') return request.headers().authorization==='Bearer qa-verified-token' ? send({is_master:master,tenant_ids:master ? []:[tenantId]}) : send(null,401);
        if (table==='get_public_tenant') return send(db.tenants.filter(t=>t.slug===body.p_slug).map(t=>{ const {login_password,login_email,admin_push_id,...safe}=t; void login_password;void login_email;void admin_push_id;return safe; }));
        if (table==='get_public_queue') return send(db.queue_items.filter(q=>q.tenant_id===body.p_tenant_id));
        if (table==='get_public_products') return send(db.tenant_products.filter(q=>q.tenant_id===body.p_tenant_id));
        if (table==='complete_service') {
          const old=db.financial_records.find(r=>r.source_queue_item_id===body.p_queue_id);
          if(old) return send({record_id:old.id,already_completed:true});
          const q=db.queue_items.find(q=>q.id===body.p_queue_id);
          if(!q) return send({message:'Missing queue item'},400);
          const r={id:crypto.randomUUID(),tenant_id:q.tenant_id,price:q.price,completed_at:now,source_queue_item_id:q.id,customer_name:q.name,service_name:q.service_name,appointment_time:q.appointment_time,started_at:q.started_at,duration:q.duration};
          db.financial_records.push(r); db.queue_items=db.queue_items.filter(x=>x!==q);
          return send({record_id:r.id,already_completed:false});
        }
        if(table==='record_expense') {
          let r=db.tenant_expenses.find(r=>r.request_id===body.p_request_id);
          if(!r) { r={id:crypto.randomUUID(),tenant_id:body.p_tenant_id,description:body.p_description,amount:body.p_amount,request_id:body.p_request_id,created_at:now}; db.tenant_expenses.push(r); }
          return send(r.id);
        }
        return send({message:`RPC ${table} not mocked`},404);
      }
      const rows = db[table];
      if (!rows) return send({ code: '42P01', message: `Table ${table} not mocked` }, 404);
      const match = item => [...url.searchParams].every(([key, value]) => {
        if (['select', 'order', 'limit', 'offset'].includes(key)) return true;
        const dot = value.indexOf('.'); const op = value.slice(0, dot); const v = value.slice(dot + 1);
        if (op === 'eq') return String(item[key]) === v;
        if (op === 'in') return v.slice(1,-1).split(',').includes(String(item[key]));
        if (op === 'gte') return String(item[key]) >= v;
        if (op === 'lt') return String(item[key]) < v;
        return true;
      });
      let affected = rows.filter(match);
      if (method === 'POST') {
        affected = (Array.isArray(body) ? body : [body]).map(data => ({ id: crypto.randomUUID(), joined_at: now, created_at: now, completed_at: now, services: [], is_active: true, ...data }));
        if (table === 'tenants' && affected.some(item => rows.some(old => old.slug === item.slug))) return send({ code: '23505', message: 'duplicate key value violates unique constraint' }, 409);
        rows.push(...affected);
      }
      if (method === 'PATCH') affected.forEach(item => Object.assign(item, body));
      if (method === 'DELETE') db[table] = rows.filter(item => !match(item));
      const count = affected.length;
      const limit = Number(url.searchParams.get('limit') || affected.length);
      const offset=Number(url.searchParams.get('offset')||0);
      affected = affected.slice(offset, offset+limit);
      const single = request.headers().accept?.includes('vnd.pgrst.object');
      const select = url.searchParams.get('select');
      const project = item => select && select !== '*' ? Object.fromEntries(select.split(',').map(key => [key, item[key]])) : item;
      return send(single ? project(affected[0] || {}) : affected.map(project), 200, { 'content-range': `0-${Math.max(0, count - 1)}/${count}` });
    }
    if (url.pathname.startsWith('/storage/v1/object/') && method === 'POST') {
      requests.push({ table: 'storage', method, path: url.pathname });
      return send({ Key: url.pathname.replace('/storage/v1/object/', ''), Id: 'qa-file' });
    }
    if (url.pathname === '/api/send-push') { requests.push({ table: 'push', method, body: request.postDataJSON() }); return send({ sent: false, reason: 'isolated_audit' }); }
    if (url.pathname === '/api/pwa-manifest') {
      const audience = url.searchParams.get('audience'); const segment = audience === 'professional' ? 'profissional' : 'cliente';
      return send({id:`/apps/${tenantId}/${audience}`,name:'Barbearia QA',start_url:`/qa/${segment}/`,scope:`/qa/${segment}/`,display:'standalone',icons:[{src:'/icons/suavez-v2-192.png',sizes:'192x192',type:'image/png'},{src:'/icons/suavez-v2-512.png',sizes:'512x512',type:'image/png'}]});
    }
    if (url.origin === origin) {
      const asset = url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/') || url.pathname === '/pwa-bootstrap.js' ? url.pathname.slice(1) : 'index.html';
      const body = await readFile(new URL(`../../dist/${asset}`, import.meta.url));
      return route.fulfill({ status: 200, contentType: asset.endsWith('.js') ? 'application/javascript' : asset.endsWith('.css') ? 'text/css' : asset.endsWith('.png') ? 'image/png' : 'text/html', body });
    }
    if(process.env.AUDIT_FONTS==='1' && ['fonts.googleapis.com','fonts.gstatic.com'].includes(url.hostname)) return route.continue();
    return route.abort();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  if (engine===chromium) await page.routeWebSocket('**/realtime/**', socket => socket.close());
  await page.clock.install({ time: new Date(now) });
  page.on('pageerror', error => exceptions.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  const entry=path || (master?'/admin':auth?'/qa/profissional/':'/qa/cliente/');
  await page.goto(`${origin}${entry}`);
  if(entry==='/qa')await page.waitForURL('**/qa/cliente/');
  await visible(page.locator(entry.startsWith('/recuperar-acesso') ? '.recovery-card' : entry.includes('/cliente')||entry==='/qa' ? '.customer-app' : !auth && entry.includes('/profissional') ? '.tenant-login' : auth ? master ? '.admin-layout' : '.professional-admin' : master ? '.master-login' : '.customer-app').first());
  const nav = async name => {
    const sidebar = page.locator(master ? '.sidebar-nav' : '.admin-sidebar');
    if (width < (master ? 1024 : 1021)) {
      await page.locator(master ? '.mobile-toggle' : '.mobile-menu-btn').click();
    }
    await sidebar.getByRole('button', { name: new RegExp(name, 'i') }).click();
  };
  const close = async () => { await context.close(); };
  return { db, requests, exceptions, faults, context, page, nav, close };
}
async function test(name, options, callback) {
  if (filter && !filter.test(name)) return;
  results = results.filter(result => result.name !== name);
  let f;
  try {
    f = await fixture(options);
    await callback(f);
    assert.deepEqual(f.exceptions, [], 'Runtime exception');
    results.push({ name, status: 'passed' });
    console.log('PASS', name);
  } catch (error) {
    const entry = { name, status: 'failed', error: error.message.split('\n').slice(0, 5).join('\n'), exceptions: f?.exceptions || [] };
    results.push(entry); console.log('FAIL', name, entry.error);
    if (f) await f.page.screenshot({ path: fileURLToPath(new URL(`${results.length}-failure.png`, output)), animations: 'disabled' }).catch(() => {});
  } finally { await f?.close(); }
  await writeFile(new URL('browser-results.json', output), JSON.stringify(results, null, 2));
}
async function addClient(f, name = 'Cliente criado QA', date) {
  await f.page.locator('.admin-header-action').click();
  await f.page.locator('#admin-client-name').fill(name);
  await f.page.locator('#admin-client-whatsapp').fill('71999999999');
  await f.page.locator('#admin-client-service').selectOption('cut');
  if (date) { await f.page.locator('#admin-client-date').fill(date); await f.page.locator('#admin-client-time').selectOption('10:00'); }
  await f.page.getByRole('button', { name: date ? 'Confirmar Agendamento' : 'Colocar na Fila', exact: true }).click();
  await wait(() => f.db.queue_items.some(item => item.name === name));
}
async function noOverflow(f) {
  const sizes = await f.page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }));
  assert.ok(sizes.content <= sizes.viewport, `Horizontal overflow: ${JSON.stringify(sizes)}`);
}

try {
  const iphoneUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1';
  const androidUA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';
  async function promptEvent(f, outcome = 'accepted') {
    await f.page.evaluate(outcome => {
      window.__installCalls = 0;
      const event = new Event('beforeinstallprompt', {cancelable:true});
      Object.assign(event, {prompt:async () => { window.__installCalls++; if(outcome==='error') throw new Error('QA install error'); },userChoice:Promise.resolve({outcome})});
      window.dispatchEvent(event);
    }, outcome);
  }
  await test('PWA: cliente permanece cliente mesmo com sessão master neste navegador', {path:'/qa/cliente/',master:true,width:390}, async f => {
    await visible(f.page.locator('.customer-hero'));
    assert.equal(await f.page.locator('.professional-admin').count(),0);
    assert.equal(f.requests.some(r=>['financial_records','tenant_tasks','staff_access'].includes(r.table)),false);
    assert.match(await f.page.locator('link[rel="manifest"]').getAttribute('href'),/audience=customer/);
    await noOverflow(f);
    await f.page.screenshot({path:fileURLToPath(new URL('pwa-cliente-mobile.png',output)),animations:'disabled'});
  });
  await test('PWA: profissional abre login próprio e não consulta dados privados sem sessão', {path:'/qa/profissional/',auth:false,width:390}, async f => {
    await visible(f.page.getByRole('heading',{name:'Bom ter você de volta.'}));
    assert.equal(await f.page.locator('.customer-app').isVisible(),false);
    assert.equal(f.requests.some(r=>['financial_records','tenant_tasks'].includes(r.table)),false);
    await f.page.keyboard.press('Escape');await visible(f.page.locator('.tenant-login'));
    await f.page.reload();await visible(f.page.locator('.tenant-login'));
    assert.match(await f.page.locator('link[rel="manifest"]').getAttribute('href'),/audience=professional/);
  });
  await test('PWA: profissional restaura painel e volta ao login ao sair', {path:'/qa/profissional/'}, async f => {
    await visible(f.page.locator('.professional-admin'));await f.page.waitForLoadState('networkidle');await f.page.reload();await visible(f.page.locator('.professional-admin'));
    await f.page.waitForLoadState('networkidle');
    await f.page.getByRole('button',{name:'Sair do Painel'}).click();await visible(f.page.getByRole('button',{name:'Entrar no meu painel'}));
    await f.page.waitForLoadState('networkidle');
    await f.page.reload();await visible(f.page.locator('.tenant-login'));
  });
  await test('PWA: sair no mobile fecha painel imediatamente enquanto servidor encerra sessão', {path:'/qa/profissional/',width:390,standalone:true}, async f => {
    let release;
    const gate=new Promise(resolve=>{release=resolve;});
    await f.page.route('**/auth/v1/logout?*',async route=>{await gate;await route.fulfill({status:204,body:''});});
    await f.page.locator('.mobile-menu-btn').click();
    await f.page.getByRole('button',{name:'Sair do Painel'}).click();
    await f.page.getByRole('button',{name:'Encerrando sessão…'}).waitFor({state:'visible',timeout:1000});
    assert.equal(await f.page.locator('.professional-admin').count(),0);
    assert.equal(await f.page.getByRole('button',{name:'Encerrando sessão…'}).isDisabled(),true);
    await f.page.clock.runFor(1000);assert.equal(await f.page.locator('.professional-admin').count(),0,'Painel voltou antes de concluir a saída');
    release();await f.page.getByRole('button',{name:'Entrar no meu painel'}).waitFor({state:'visible'});
    await f.page.reload();await visible(f.page.locator('.tenant-login'));
  });
  await test('PWA: falha ao sair informa erro e mantém sessão sem anunciar saída falsa', {path:'/qa/profissional/'}, async f => {
    await f.page.route('**/auth/v1/logout?*',route=>route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({message:'QA offline'})}));
    await f.page.getByRole('button',{name:'Sair do Painel'}).click();
    await visible(f.page.getByText('Não foi possível encerrar sua sessão. Confira a conexão e tente novamente.',{exact:true}));
    await visible(f.page.locator('.professional-admin'));
  });
  await test('PWA: login de avisos atrasado não vincula aparelho depois de sair', {path:'/qa/profissional/',push:'sdk-delayed'}, async f => {
    await f.page.getByRole('button',{name:'Sair do Painel'}).click();
    await visible(f.page.getByRole('button',{name:'Entrar no meu painel'}));
    await f.page.evaluate(()=>window.__pushHarness.flushSDK());
    await wait(()=>f.page.evaluate(()=>window.__pushHarness.logoutCalls===1));
    assert.equal(await f.page.evaluate(()=>window.__pushHarness.loginCalls),0);
  });
  await test('PWA: instalação do cliente no endereço antigo leva à entrada correta', {auth:false,width:390,path:'/qa'}, async f => {
    await f.page.getByRole('button',{name:'Instalar app',exact:true}).click();
    await visible(f.page.getByRole('dialog',{name:'Barbearia QA no seu celular'}));
    assert.equal(new URL(f.page.url()).pathname,'/qa/cliente/');assert.equal(new URL(f.page.url()).search,'');
    await noOverflow(f);
  });
  await test('PWA: endereço antigo com sessão profissional continua público e permite acesso explícito ao profissional', {path:'/qa'}, async f => {
    assert.equal(f.requests.some(r=>r.table==='staff_access'),false);
    await f.page.getByRole('button',{name:'Acessar área profissional'}).click();
    await visible(f.page.locator('.professional-admin'));
    await f.page.getByRole('button',{name:'Instalar app profissional'}).click();
    await visible(f.page.getByRole('dialog',{name:'Barbearia QA no seu celular'}));
    assert.equal(new URL(f.page.url()).pathname,'/qa/profissional/');
    assert.match(await f.page.locator('link[rel="manifest"]').getAttribute('href'),/audience=professional/);
  });
  await test('PWA: Android abre confirmação nativa só no clique e não anuncia conclusão', {path:'/qa/cliente/',auth:false,width:390,userAgent:androidUA}, async f => {
    await promptEvent(f);assert.equal(await f.page.evaluate(()=>window.__installCalls),0);
    await f.page.getByRole('button',{name:'Instalar app',exact:true}).click();
    await visible(f.page.getByRole('dialog'));await visible(f.page.getByText(/Pedido enviado ao navegador/));
    assert.equal(await f.page.evaluate(()=>window.__installCalls),1);
    assert.equal(await f.page.getByText(/instalação concluída|instalado com sucesso/i).count(),0);
    await f.page.getByRole('button',{name:'Entendi',exact:true}).click();
    await visible(f.page.getByRole('button',{name:'Ver orientação'}));
  });
  await test('PWA: dispensar confirmação e falha nativa oferecem alternativa', {path:'/qa/profissional/',width:390,userAgent:androidUA}, async f => {
    await promptEvent(f,'dismissed');await f.page.getByRole('button',{name:'Instalar app profissional'}).click();
    await visible(f.page.getByText('Você pode instalar quando quiser pelo menu do navegador.'));
    await f.page.getByRole('button',{name:'Entendi',exact:true}).click();
    await promptEvent(f,'error');await f.page.getByRole('button',{name:'Instalar app profissional'}).click();
    await visible(f.page.getByText('Não foi possível abrir a instalação. Tente pelo menu do navegador.'));
  });
  await test('PWA: iPhone mostra passos Safari e diálogo mantém foco e fecha', {path:'/qa/cliente/',auth:false,width:390,userAgent:iphoneUA}, async f => {
    await f.page.getByRole('button',{name:'Instalar app',exact:true}).click();
    const dialog=f.page.getByRole('dialog');await visible(dialog);
    await visible(dialog.getByText('Adicionar à Tela de Início',{exact:true}));
    assert.equal(await dialog.getByRole('button',{name:'Instalar agora'}).count(),0);
    await f.page.keyboard.press('Tab');assert.equal(await f.page.evaluate(()=>Boolean(document.activeElement.closest('dialog'))),true);
    await noOverflow(f);await f.page.screenshot({path:fileURLToPath(new URL('pwa-ios-orientacao.png',output)),animations:'disabled'});
    await f.page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
    assert.equal(await f.page.getByRole('button',{name:'Instalar app',exact:true}).evaluate(el=>el===document.activeElement),true);
  });
  await test('PWA: navegador interno no iPhone orienta abrir no Safari', {path:'/qa/cliente/',auth:false,width:320,userAgent:iphoneUA+' Instagram 300'}, async f => {
    await f.page.getByRole('button',{name:'Instalar app',exact:true}).click();
    await visible(f.page.getByText('Para seguir estas instruções, abra este endereço no Safari.'));await noOverflow(f);
  });
  for(const audience of ['cliente','profissional']) await test(`PWA: instalado em modo standalone esconde convite ${audience}`, {path:`/qa/${audience}/`,auth:audience==='profissional',standalone:true,width:390}, async f => {
    assert.equal(await f.page.locator('.install-app-card').count(),0);
  });
  await test('PWA: painel profissional desktop oferece instalação sem perder ações', {path:'/qa/profissional/',width:1440,push:'enabled'}, async f => {
    await visible(f.page.getByRole('button',{name:'Instalar app profissional'}));await noOverflow(f);
    await f.page.screenshot({path:fileURLToPath(new URL('pwa-profissional-desktop.png',output)),animations:'disabled'});
  });
  await test('Login profissional: rejeita senha errada, aceita correta, persiste e sai', { auth: false }, async f => {
    await f.page.getByRole('button', { name: 'Acessar área profissional' }).click();
    await f.page.locator('#professional-email').fill(base.login_email);
    await f.page.locator('#professional-password').fill('wrong');
    await f.page.locator('.login-btn').click();
    await visible(f.page.getByText('E-mail ou senha incorretos!', { exact: true }));
    await f.page.locator('#professional-password').fill(base.login_password);
    await f.page.locator('.login-btn').click();
    await visible(f.page.locator('.professional-admin'));
    await f.page.reload(); await visible(f.page.locator('.professional-admin'));
    await f.page.locator('.btn-logout').click(); await visible(f.page.locator('.tenant-login'));
    assert.equal(await f.page.evaluate(() => localStorage.getItem('suavez_auth_qa')), null);
  });
  await test('Segurança: sessão profissional não deve ser forjável no localStorage', {auth:false,forged:true}, async f => {
    assert.equal(await f.page.locator('.professional-admin').count(), 0, 'Acesso ao painel obtido apenas gravando suavez_auth_qa=true, sem autenticação de servidor');
  });
  await test('Segurança: sessão master não deve ser forjável no localStorage', { master: true,auth:false,forged:true }, async f => {
    assert.equal(await f.page.locator('.master-login').count(), 1, 'Acesso master obtido apenas gravando admin_auth=true');
  });
  for (const width of [390, 1440]) await test(`Navegação profissional e layout ${width}px`, { width }, async f => {
    for (const tab of ['Financeiro', 'Serviços', 'Produtos', 'Tarefas', 'Atendimento e horários', 'Perfil e aparência', 'Fila de agora']) {
      await f.nav(tab); await noOverflow(f);
    }
  });
  await test('Fila: adiciona cliente com serviço, preço e duração corretos', {}, async f => {
    await addClient(f); const item = f.db.queue_items[0];
    assert.equal(item.status, 'waiting'); assert.equal(item.tenant_id, tenantId); assert.equal(item.price, 35); assert.equal(item.duration, 30);
    await visible(f.page.getByRole('heading', { name: 'Cliente criado QA', exact: true }));
  });
  await test('Fila: chamar, iniciar e concluir gera uma receita e remove da fila', { tables: { queue_items: [row('lifecycle')] } }, async f => {
    await f.page.getByRole('button', { name: 'Chamar', exact: true }).click();
    await wait(() => f.db.queue_items[0].status === 'ready');
    await f.page.getByRole('button', { name: 'Atender', exact: true }).click();
    await wait(() => f.db.queue_items[0].status === 'serving');
    await f.page.getByRole('button', { name: /Concluir/ }).click();
    await wait(() => f.db.queue_items.length === 0);
    assert.equal(f.db.financial_records.length, 1); assert.equal(f.db.financial_records[0].price, 35);
    assert.ok(f.requests.some(r => r.table === 'push' && r.body.event === 'client_called'));
    assert.deepEqual(f.requests.filter(r=>r.table==='push').map(r=>r.body.event),['client_called'],'Iniciar e concluir não devem enviar avisos ao cliente');
    await f.nav('Financeiro'); await f.page.getByRole('button',{name:'Ver detalhado',exact:true}).click();
    const details=f.page.getByRole('dialog');await visible(details.getByText('Cliente lifecycle',{exact:true}));
    await visible(details.getByText('Corte QA',{exact:true}));assert.match(await details.locator('.financial-detail-price').innerText(),/35,00/);
  });
  await test('Fila: cancelar exige confirmação, mantém registro e envia aviso sem receita', { tables: { queue_items: [row('remove')] } }, async f => {
    await f.page.getByRole('button', { name: 'Cancelar atendimento de Cliente remove' }).click();
    const dialog = f.page.getByRole('alertdialog'); await visible(dialog);
    await dialog.getByRole('button', { name: 'Manter cliente', exact: true }).click(); assert.equal(f.db.queue_items.length, 1);
    await f.page.getByRole('button', { name: 'Cancelar atendimento de Cliente remove' }).click();
    await f.page.getByRole('alertdialog').getByRole('button', { name: 'Sim, cancelar atendimento', exact: true }).click();
    await wait(() => f.db.queue_items[0].status === 'cancelled'); assert.equal(f.db.financial_records.length, 0);
    await wait(()=>f.requests.some(r=>r.table==='push'&&r.body.event==='appointment_cancelled'));
    assert.equal(await f.page.getByRole('button',{name:'Cancelar atendimento de Cliente remove'}).count(),0);
    assert.equal(f.requests.some(r=>r.table==='queue_items'&&r.method==='DELETE'),false);
  });
  for(const status of ['waiting','ready','serving','pending'])await test(`Cancelamento: ${status} permite cancelar pelo mobile, sem duplicar nem criar receita`, {width:390,delay:300,tenant:{booking_type:status==='pending'?'appointment':'queue'},tables:{queue_items:[row('cancel',status)]}}, async f=>{
    await f.page.getByRole('button',{name:'Cancelar atendimento de Cliente cancel'}).click();
    const dialog=f.page.getByRole('alertdialog',{name:'Cancelar atendimento?'});await visible(dialog);
    await f.page.keyboard.press('Tab');assert.equal(await f.page.evaluate(()=>Boolean(document.activeElement.closest('[role=alertdialog]'))),true);
    if(status==='waiting')await f.page.screenshot({path:fileURLToPath(new URL('cancelar-atendimento-mobile.png',output)),animations:'disabled'});
    await dialog.getByRole('button',{name:'Sim, cancelar atendimento'}).dispatchEvent('click');
    await dialog.getByRole('button',{name:/Cancelando|Sim, cancelar/}).dispatchEvent('click');
    await wait(()=>f.db.queue_items[0].status==='cancelled');await wait(()=>f.requests.some(r=>r.table==='push'));
    assert.equal(f.requests.filter(r=>r.table==='queue_items'&&r.method==='PATCH').length,1);
    assert.deepEqual(f.requests.filter(r=>r.table==='push').map(r=>r.body.event),['appointment_cancelled']);
    assert.equal(f.db.financial_records.length,0);await noOverflow(f);
  });
  await test('Cancelamento: erro ao salvar mantém atendimento e não envia notificação', {tables:{queue_items:[row('error-cancel')]}}, async f=>{
    f.faults.push({table:'queue_items',method:'PATCH',remaining:1});
    await f.page.getByRole('button',{name:'Cancelar atendimento de Cliente error-cancel'}).click();
    await f.page.getByRole('button',{name:'Sim, cancelar atendimento'}).click();
    await visible(f.page.getByText('Não foi possível cancelar o atendimento. Tente novamente.',{exact:true}));
    assert.equal(f.db.queue_items[0].status,'waiting');assert.equal(f.requests.some(r=>r.table==='push'),false);
    await visible(f.page.getByRole('alertdialog'));
  });
  await test('Cancelamento: atendimento alterado em outro aparelho não recebe segundo aviso', {tables:{queue_items:[row('race-cancel')]}}, async f=>{
    await f.page.getByRole('button',{name:'Cancelar atendimento de Cliente race-cancel'}).click();
    f.db.queue_items[0].status='cancelled';
    await f.page.getByRole('button',{name:'Sim, cancelar atendimento'}).click();
    await visible(f.page.getByText('Este atendimento já foi alterado em outro aparelho. Atualize a fila.',{exact:true}));
    assert.equal(f.requests.some(r=>r.table==='push'),false);assert.equal(f.db.financial_records.length,0);
  });
  await test('Cancelamento: agenda permite cancelar compromisso confirmado e avisa falha de push', {tenant:{booking_type:'appointment'},tables:{queue_items:[row('scheduled-cancel','waiting',{appointment_time:now})]}}, async f=>{
    await f.nav('Agenda');await f.page.getByRole('button',{name:'Cancelar atendimento de Cliente scheduled-cancel'}).click();
    await f.page.getByRole('button',{name:'Sim, cancelar atendimento'}).click();
    await wait(()=>f.db.queue_items[0].status==='cancelled');
    await visible(f.page.getByText('Atendimento cancelado, mas não foi possível enviar o aviso ao cliente. Confira se ele aceitou as notificações.',{exact:true}));
    assert.equal(f.db.financial_records.length,0);assert.equal(f.requests.filter(r=>r.table==='push').length,1);
  });
  await test('Fila: erro ao registrar receita preserva atendimento', { tables: { queue_items: [row('error', 'serving')] } }, async f => {
    f.faults.push({ table: 'complete_service', method: 'POST', remaining: 1 });
    await f.page.getByRole('button', { name: /Concluir/ }).click();
    await visible(f.page.getByText(/Não foi possível concluir o atendimento/));
    assert.equal(f.db.queue_items.length, 1); assert.equal(f.db.financial_records.length, 0);
  });
  await test('Fila: erro ao remover após concluir desfaz receita', { tables: { queue_items: [row('rollback', 'serving')] } }, async f => {
    f.faults.push({ table: 'complete_service', method: 'POST', remaining: 1 });
    await f.page.getByRole('button', { name: /Concluir/ }).click();
    await visible(f.page.getByText(/Não foi possível concluir o atendimento/));
    await wait(() => f.db.financial_records.length === 0); assert.equal(f.db.queue_items.length, 1);
  });
  await test('Status: abre e fecha estabelecimento com atualização por polling', {}, async f => {
    const old = f.db.tenants[0].is_online;
    await f.page.locator('.tenant-status-card button, .status-toggle').first().click();
    await wait(() => f.db.tenants[0].is_online !== old);
    await f.page.reload(); assert.equal(f.db.tenants[0].is_online, false);
  });
  await test('Tarefas: criar, concluir, reabrir e excluir', {}, async f => {
    await f.nav('Tarefas'); await f.page.getByPlaceholder('Adicione uma nova atividade...').fill('Comprar material QA');
    await f.page.getByRole('button', { name: 'Adicionar', exact: true }).click();
    await f.page.getByRole('checkbox', { name: 'Concluir tarefa: Comprar material QA' }).click();
    await wait(() => f.db.tenant_tasks[0].is_completed === true);
    await f.page.getByRole('checkbox', { name: 'Reabrir tarefa: Comprar material QA' }).click();
    await wait(() => f.db.tenant_tasks[0].is_completed === false);
    await f.page.getByRole('button', { name: 'Excluir tarefa: Comprar material QA' }).click();
    await wait(() => f.db.tenant_tasks.length === 0);
  });
  await test('Tarefas: impede vazio e informa falha de gravação', {}, async f => {
    await f.nav('Tarefas'); await f.page.getByPlaceholder('Adicione uma nova atividade...').fill('   ');
    await f.page.getByRole('button', { name: 'Adicionar', exact: true }).click(); assert.equal(f.db.tenant_tasks.length, 0);
    f.faults.push({ table: 'tenant_tasks', method: 'POST', remaining: 1 });
    await f.page.getByPlaceholder('Adicione uma nova atividade...').fill('Falha QA');
    await f.page.getByRole('button', { name: 'Adicionar', exact: true }).click();
    await visible(f.page.getByText(/Não foi possível adicionar a tarefa/)); assert.equal(f.db.tenant_tasks.length, 0);
  });
  await test('Serviços: criar com vírgula, editar e excluir', {}, async f => {
    await f.nav('Serviços'); await f.page.getByRole('button', { name: '+ Novo Serviço', exact: true }).click();
    const modal = f.page.getByRole('dialog');
    await modal.getByPlaceholder('ex: Corte Social').fill('Serviço QA');
    await modal.getByPlaceholder('ex: 35,00').fill('1.234,56'); await modal.getByPlaceholder('ex: 45').fill('45');
    await modal.getByRole('button', { name: 'Adicionar Serviço', exact: true }).click();
    await wait(() => f.db.tenants[0].services.some(s => s.name === 'Serviço QA'));
    assert.equal(f.db.tenants[0].services.at(-1).price, 1234.56);
    const card = f.page.locator('.admin-service-card').filter({ hasText: 'Serviço QA' });
    await card.getByTitle('Editar', { exact: true }).click();
    await modal.getByPlaceholder('ex: 35,00').fill('40,50'); await modal.getByRole('button', { name: 'Salvar Alterações', exact: true }).click();
    await wait(() => f.db.tenants[0].services.at(-1).price === 40.5);
    await card.getByTitle('Excluir', { exact: true }).click(); await wait(() => !f.db.tenants[0].services.some(s => s.name === 'Serviço QA'));
  });
  await test('Serviços: valida preço negativo e duração inválida', {}, async f => {
    await f.nav('Serviços'); await f.page.getByRole('button', { name: '+ Novo Serviço', exact: true }).click();
    const modal = f.page.getByRole('dialog');
    await modal.getByPlaceholder('ex: Corte Social').fill('Inválido QA'); await modal.getByPlaceholder('ex: 35,00').fill('-10');
    await modal.getByRole('button', { name: 'Adicionar Serviço', exact: true }).click();
    await visible(f.page.getByText('Informe um preço válido e não negativo.', { exact: true })); assert.equal(f.db.tenants[0].services.length, 2);
  });
  await test('Produtos: cadastra, valida preço e remove', {}, async f => {
    await f.nav('Produtos'); await f.page.getByPlaceholder('Ex: Pomada X').fill('Pomada QA'); await f.page.getByPlaceholder('29,90').fill('0');
    await f.page.getByRole('button', { name: 'Adicionar Produto', exact: true }).click();
    await visible(f.page.getByText(/Informe um preço de produto maior que zero/)); assert.equal(f.db.tenant_products.length, 0);
    await f.page.getByPlaceholder('29,90').fill('29,90'); await f.page.getByRole('button', { name: 'Adicionar Produto', exact: true }).click();
    await wait(() => f.db.tenant_products.length === 1); assert.equal(f.db.tenant_products[0].price, 29.9);
    await f.page.locator('.admin-product-card').filter({ hasText: 'Pomada QA' }).getByRole('button', { name: 'Remover', exact: true }).click();
    await wait(() => f.db.tenant_products.length === 0);
  });
  await test('Produtos: arquivo de imagem válido é comprimido e enviado', {}, async f => {
    await f.nav('Produtos');
    const png = await f.page.evaluate(() => { const c = document.createElement('canvas'); c.width = c.height = 16; return c.toDataURL('image/png').split(',')[1]; });
    await f.page.locator('input[type=file]').setInputFiles({ name: 'fixture.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
    await f.page.getByPlaceholder('Ex: Pomada X').fill('Foto QA'); await f.page.getByPlaceholder('29,90').fill('20');
    await f.page.getByRole('button', { name: 'Adicionar Produto', exact: true }).click();
    await wait(() => f.db.tenant_products.length === 1); assert.ok(f.requests.some(r => r.table === 'storage'));
    assert.ok(f.db.tenant_products[0].image_url.includes('product-images/products/'));
  });
  await test('Produtos: imagem corrompida deve informar erro ou permitir continuar', {}, async f => {
    await f.nav('Produtos'); await f.page.locator('input[type=file]').setInputFiles({ name: 'invalid.png', mimeType: 'image/png', buffer: Buffer.from('invalid image bytes') });
    await f.page.getByPlaceholder('Ex: Pomada X').fill('Foto inválida QA'); await f.page.getByPlaceholder('29,90').fill('20');
    await f.page.getByRole('button', { name: 'Adicionar Produto', exact: true }).click();
    await visible(f.page.getByText('A imagem está corrompida ou não é suportada.', {exact:true}));
    assert.equal(f.db.tenant_products.length,0); assert.equal(f.requests.filter(r=>r.table==='storage').length,0);
  });
  await test('Produtos: rejeita nome contendo apenas espaços', {}, async f => {
    await f.nav('Produtos'); await f.page.getByPlaceholder('Ex: Pomada X').fill('   '); await f.page.getByPlaceholder('29,90').fill('20');
    await f.page.getByRole('button', { name: 'Adicionar Produto', exact: true }).click();
    await new Promise(resolve => setTimeout(resolve, 300)); assert.equal(f.db.tenant_products.length, 0, 'Produto gravado com nome vazio após trim');
  });
  const financialTables = { financial_records: [{ id: 'f1', tenant_id: tenantId, price: '100.50', completed_at: now }, { id: 'f2', tenant_id: tenantId, price: '49.50', completed_at: now }, { id: 'f3', tenant_id: tenantId, price: '60', completed_at: '2026-09-30T12:00:00-03:00' }], tenant_expenses: [{ id: 'e1', tenant_id: tenantId, amount: '25', description: 'Material QA', created_at: now }] };
  const detailTables={financial_records:[
    {id:'ana',tenant_id:tenantId,price:'120.50',customer_name:'Ana Cláudia Pereira',service_name:'Corte e hidratação',duration:60,completed_at:now,appointment_time:'2026-10-17T08:00:00-03:00',started_at:'2026-10-17T08:05:00-03:00'},
    {id:'joao',tenant_id:tenantId,price:'35',customer_name:'João da Silva',service_name:'Barba',completed_at:now},
    {id:'legacy',tenant_id:tenantId,price:'50',customer_name:null,service_name:null,completed_at:now},
    {id:'older',tenant_id:tenantId,price:'60',customer_name:'Cliente de Setembro',service_name:'Corte social',completed_at:'2026-09-30T12:00:00-03:00'},
  ],tenant_expenses:[{id:'expense-only',tenant_id:tenantId,description:'Material',amount:10,created_at:'2026-08-12T12:00:00-03:00'}]};
  await test('Financeiro detalhado: histórico acima de mil registros mantém clientes e totais completos',{tables:{
    financial_records:Array.from({length:1005},(_,i)=>({id:`large-${i}`,tenant_id:tenantId,price:10,customer_name:`Cliente ${i}`,service_name:'Corte',completed_at:now})),
    tenant_expenses:Array.from({length:1002},(_,i)=>({id:`expense-${i}`,tenant_id:tenantId,amount:1,description:`Material ${i}`,created_at:now})),
  }},async f=>{
    await f.nav('Financeiro');await visible(f.page.getByRole('heading',{name:'Resumo financeiro'}));
    assert.match(await f.page.locator('.financial-kpis .admin-kpi-card').filter({hasText:'Saldo líquido no mês'}).innerText(),/9\.048,00/);
    await f.page.getByRole('button',{name:'Ver detalhado',exact:true}).click();
    const dialog=f.page.getByRole('dialog');assert.match(await dialog.locator('.financial-detail-summary').innerText(),/10\.050,00/);
    assert.equal(await dialog.locator('.financial-detail-item').count(),1005);
    await dialog.getByRole('searchbox').fill('Cliente 1004');await visible(dialog.getByText('Cliente 1004',{exact:true}));
    assert.equal(await dialog.locator('.financial-detail-item').count(),1);
  });
  for(const width of [320,390,768,1440])await test(`Financeiro detalhado: clientes, serviços, busca, mês e acessibilidade em ${width}px`,{width,tables:detailTables},async f=>{
    await f.nav('Financeiro');
    const trigger=f.page.getByRole('button',{name:'Ver detalhado',exact:true});await trigger.click();
    const dialog=f.page.getByRole('dialog',{name:'Outubro 2026'});await visible(dialog);
    assert.match(await dialog.locator('.financial-detail-summary').innerText(),/205,50/);
    assert.equal(await dialog.locator('.financial-detail-item').count(),3);
    await visible(dialog.getByText('Ana Cláudia Pereira',{exact:true}));await visible(dialog.getByText('Corte e hidratação',{exact:true}));
    await visible(dialog.getByText('Cliente não registrado',{exact:true}));await visible(dialog.getByText(/Alguns registros antigos/));
    assert.match(await dialog.locator('.financial-detail-item').first().innerText(),/17\/10\/2026.*08:00/);
    assert.equal(await dialog.getByText('Cliente de Setembro',{exact:true}).count(),0);
    await dialog.getByRole('searchbox').fill('claudia');assert.equal(await dialog.locator('.financial-detail-item').count(),1);
    assert.match(await dialog.getByRole('status').innerText(),/120,50/);
    await dialog.getByRole('searchbox').fill('barba');await visible(dialog.getByText('João da Silva',{exact:true}));
    await dialog.getByRole('searchbox').fill('inexistente');await visible(dialog.getByText('Nenhum atendimento corresponde à busca.'));
    await dialog.getByRole('searchbox').fill('');await noOverflow(f);
    assert.equal(await dialog.evaluate(el=>el.scrollWidth>el.clientWidth),false,'Diálogo possui rolagem horizontal');
    if(width===390||width===1440)await f.page.screenshot({path:fileURLToPath(new URL(`financeiro-detalhado-${width}.png`,output)),animations:'disabled'});
    await dialog.getByRole('button',{name:'Fechar detalhamento'}).focus();await f.page.keyboard.press('Shift+Tab');
    assert.equal(await f.page.evaluate(()=>!!document.activeElement.closest('dialog')),true);
    await f.page.keyboard.press('Escape');await wait(()=>dialog.isVisible().then(v=>!v));await trigger.focus();
    await f.page.getByRole('button',{name:'Ver detalhado de Setembro 2026',exact:true}).click();
    const september=f.page.getByRole('dialog',{name:'Setembro 2026'});await visible(september);
    await visible(september.getByText('Cliente de Setembro',{exact:true}));assert.equal(await september.locator('.financial-detail-item').count(),1);
    assert.match(await september.locator('.financial-detail-summary').innerText(),/60,00/);
    await september.getByRole('button',{name:'Fechar detalhamento'}).click();
    await f.page.getByRole('button',{name:'Ver detalhado de Agosto 2026',exact:true}).click();
    await visible(f.page.getByRole('dialog').getByText('Nenhum atendimento concluído neste mês.'));
    assert.equal(f.requests.some(r=>r.table==='financial_records'&&['POST','PATCH','DELETE'].includes(r.method)),false);
  });
  for(const width of [320,390,768,1024,1440])await test(`Financeiro visual: valores completos e histórico sem sobreposição em ${width}px`, {width,standalone:true,push:'enabled',tables:{
    financial_records:[{id:'large',tenant_id:tenantId,price:'1234567.89',completed_at:now},{id:'older',tenant_id:tenantId,price:'100',completed_at:'2026-09-30T12:00:00-03:00'}],
    tenant_expenses:[{id:'long',tenant_id:tenantId,amount:'23456.78',description:'Reposição de materiais e manutenção do estabelecimento com descrição extensa',created_at:now}],
  }}, async f=>{
    await f.nav('Financeiro');await visible(f.page.getByRole('heading',{name:'Resumo financeiro'}));
    await f.page.evaluate(()=>document.fonts.ready);await noOverflow(f);
    const issues=await f.page.locator('.financial-kpis .financial-value').evaluateAll(elements=>elements.flatMap(element=>{
      const card=element.closest('.admin-kpi-card').getBoundingClientRect();
      const range=document.createRange();range.selectNodeContents(element);
      return [...range.getClientRects()].filter(r=>r.left<card.left||r.right>card.right||r.top<card.top||r.bottom>card.bottom).map(()=>element.textContent);
    }));
    assert.deepEqual(issues,[],'Valores financeiros cortados pelo cartão');
    assert.equal(await f.page.locator('.financial-kpis').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),width<=360?1:width<=1250?2:4);
    const overlap=await f.page.locator('.financial-month-row').evaluateAll(rows=>rows.some(row=>{
      const a=row.querySelector('.financial-month-description').getBoundingClientRect();
      const b=row.querySelector('.financial-month-amounts').getBoundingClientRect();
      return a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
    }));
    assert.equal(overlap,false,'Mês e valores se sobrepõem');
    if(width===390||width===1440)await f.page.screenshot({path:fileURLToPath(new URL(`financeiro-corrigido-${width}.png`,output)),animations:'disabled'});
    await f.page.getByRole('button',{name:/Excluir saída Reposição/}).scrollIntoViewIfNeeded();await noOverflow(f);
    if(width===390)await f.page.screenshot({path:fileURLToPath(new URL('financeiro-historico-corrigido-390.png',output)),animations:'disabled'});
    assert.equal(f.requests.some(r=>r.table==='record_expense'),false);
  });
  await test('Financeiro: receitas, despesas, saldo e filtro mensal', { tables: financialTables }, async f => {
    await f.nav('Financeiro'); await visible(f.page.getByRole('heading', { name: 'Resumo financeiro' }));
    const kpi = label => f.page.locator('.financial-kpis .admin-kpi-card').filter({ hasText: label });
    assert.match(await kpi('Saldo líquido no mês').innerText(), /125,00/); assert.match(await kpi('Faturamento Mensal').innerText(), /150,00/); assert.match(await kpi('Saídas Mensais').innerText(), /25,00/);
    await f.page.locator('.financial-month-filter select').selectOption('2026-09'); assert.match(await kpi('Saldo líquido no mês').innerText(), /60,00/);
  });
  await test('Financeiro: lança e exclui saída, valida zero/negativo', { tables: financialTables }, async f => {
    await f.nav('Financeiro'); await f.page.getByPlaceholder('Descrição (ex: Aluguel)').fill('Despesa QA'); await f.page.getByPlaceholder('R$ 0,00').fill('-10');
    await f.page.getByRole('button', { name: 'Lançar', exact: true }).click(); await visible(f.page.getByText(/valor maior que zero/)); assert.equal(f.db.tenant_expenses.length, 1);
    await f.page.getByPlaceholder('R$ 0,00').fill('1.234,56'); await f.page.getByRole('button', { name: 'Lançar', exact: true }).click();
    await wait(() => f.db.tenant_expenses.length === 2); assert.equal(f.db.tenant_expenses.at(-1).amount, 1234.56);
    await f.page.getByRole('button', { name: 'Excluir saída Despesa QA' }).click(); await wait(() => f.db.tenant_expenses.length === 1);
  });
  await test('Financeiro: falha de gravação não registra saída e informa erro', {}, async f => {
    await f.nav('Financeiro'); f.faults.push({ table: 'record_expense', method: 'POST', remaining: 1 });
    await f.page.getByPlaceholder('Descrição (ex: Aluguel)').fill('Falha QA'); await f.page.getByPlaceholder('R$ 0,00').fill('50'); await f.page.getByRole('button', { name: 'Lançar', exact: true }).click();
    await visible(f.page.getByText(/Não foi possível registrar a saída/)); assert.equal(f.db.tenant_expenses.length, 0);
  });
  await test('Perfil: salva WhatsApp e cores ao sair do campo', {}, async f => {
    await f.nav('Perfil e aparência'); const phone = field(f.page, 'WhatsApp de contato'); await phone.fill('71988887777'); await phone.blur();
    await wait(() => f.db.tenants[0].whatsapp.includes('98888'));
    const color = f.page.locator('input[type=color]').first(); await color.fill('#ff00ff'); await color.blur(); await wait(() => f.db.tenants[0].primary_color === '#ff00ff');
    await f.page.reload(); await f.nav('Perfil e aparência'); assert.equal(await f.page.locator('input[type=color]').first().inputValue(), '#ff00ff');
  });
  await test('Agenda: alterna modelo e valida intervalo e almoço', {}, async f => {
    await f.nav('Atendimento e horários'); await f.page.locator('.admin-booking-option').filter({ hasText: /Horário Marcado/ }).click();
    await wait(() => f.db.tenants[0].booking_type === 'appointment');
    const interval = f.page.locator('input[type=number]'); await interval.fill('0'); await interval.blur();
    await visible(f.page.getByText('Use um intervalo entre 5 e 240 minutos.', { exact: true })); assert.equal(f.db.tenants[0].appointment_interval, 30);
    await interval.fill('15'); await interval.blur(); await wait(() => f.db.tenants[0].appointment_interval === 15);
    const lunch = f.page.locator('.glass-card').filter({ hasText: 'Intervalo de Almoço' }).locator('input[type=time]');
    await lunch.first().fill('14:00'); await lunch.first().blur(); await visible(f.page.getByText('O início do intervalo precisa ser antes do fim.', { exact: true })); assert.equal(f.db.tenants[0].lunch_start, '12:00');
  });
  await test('Agenda: desativa e reativa um dia de expediente', { tenant: { booking_type: 'appointment' } }, async f => {
    await f.nav('Atendimento e horários'); await f.page.getByRole('checkbox', { name: 'Desativar expediente de Segunda' }).locator('..').click();
    await wait(() => !f.db.tenants[0].working_hours.some(h => h.day === 1));
    await f.page.getByRole('checkbox', { name: 'Ativar expediente de Segunda' }).locator('..').click(); await wait(() => f.db.tenants[0].working_hours.some(h => h.day === 1));
  });
  await test('Agenda: adiciona reserva futura e impede almoço, conflito e fim do expediente', { tenant: { booking_type: 'appointment' }, tables: { queue_items: [row('reserved', 'waiting', { appointment_time: '2026-10-18T10:30:00-03:00' })] } }, async f => {
    await f.nav('Agenda'); await f.page.locator('.admin-header-action').click(); await f.page.locator('#admin-client-name').fill('Reserva QA'); await f.page.locator('#admin-client-whatsapp').fill('71999999999'); await f.page.locator('#admin-client-service').selectOption('long'); await f.page.locator('#admin-client-date').fill('2026-10-18');
    const times = await f.page.locator('#admin-client-time option').allTextContents();
    assert.ok(!times.includes('10:00')); assert.ok(!times.includes('11:00')); assert.ok(!times.includes('12:00')); assert.ok(!times.includes('17:00'));
    await f.page.locator('#admin-client-service').selectOption('cut'); await f.page.locator('#admin-client-time').selectOption('10:00'); await f.page.getByRole('button', { name: 'Confirmar Agendamento', exact: true }).click();
    await wait(() => f.db.queue_items.some(item => item.name === 'Reserva QA')); const item = f.db.queue_items.at(-1); assert.equal(item.status, 'waiting'); assert.equal(item.appointment_time, '2026-10-18T10:00:00-03:00');
  });
  await test('Agenda: aprova e recusa solicitações pendentes', { tenant: { booking_type: 'appointment' }, tables: { queue_items: [row('approve', 'pending', { appointment_time: '2026-10-17T10:00:00-03:00' }), row('reject', 'pending', { appointment_time: '2026-10-17T11:00:00-03:00' })] } }, async f => {
    const approve = f.page.locator('.admin-queue-item').filter({ hasText: 'Cliente approve' }); await approve.getByRole('button', { name: 'Confirmar', exact: true }).click(); await wait(() => f.db.queue_items[0].status === 'waiting');
    const reject = f.page.locator('.admin-queue-item').filter({ hasText: 'Cliente reject' }); await reject.getByRole('button', { name: 'Recusar', exact: true }).click(); await wait(() => f.db.queue_items[1].status === 'cancelled');
  });
  await test('Sincronização: serviços atualizam no polling quando realtime está indisponível', {}, async f => {
    await f.nav('Serviços'); f.db.tenants[0].services = [...f.db.tenants[0].services, { id: 'external', name: 'Novo serviço de outro dispositivo', price: 20, duration: 30 }];
    await visible(f.page.getByRole('heading', { name: 'Novo serviço de outro dispositivo', exact: true }));
  });
  await test('Master: navega estabelecimentos, financeiro e configurações', { master: true }, async f => {
    for (const tab of ['SaaS Financeiro', 'Configurações', 'Estabelecimentos']) { await f.nav(tab); await noOverflow(f); }
  });
  await test('Master: cadastra e impede slug duplicado', { master: true }, async f => {
    await f.page.getByRole('button', { name: 'Novo Cadastro', exact: true }).click(); await f.page.getByPlaceholder('Ex: Barbearia do João').fill('Studio QA Novo');
    await f.page.getByPlaceholder('admin@exemplo.com').fill('new@example.invalid'); await f.page.locator('input[type=password]').fill('Only-fixture-456');
    await f.page.getByRole('button', { name: 'Finalizar Cadastro', exact: true }).click(); await wait(() => f.db.tenants.length === 2);
    assert.equal(f.db.tenants.at(-1).slug, 'studioqanovo');
    await f.page.getByRole('button', { name: 'Novo Cadastro', exact: true }).click(); await f.page.getByPlaceholder('Ex: Barbearia do João').fill('Outro QA'); await f.page.getByPlaceholder('barbearia-joao').fill('qa');
    await f.page.getByPlaceholder('admin@exemplo.com').fill('duplicate@example.invalid'); await f.page.locator('input[type=password]').fill('Only-fixture-456'); await f.page.getByRole('button', { name: 'Finalizar Cadastro', exact: true }).click();
    await visible(f.page.getByText('Este subdomínio (slug) já está em uso.', { exact: true })); assert.equal(f.db.tenants.length, 2);
  });
  await test('Master: editar cadastro preserva cor secundária existente', { master: true }, async f => {
    await f.page.getByRole('button', { name: 'Editar', exact: true }).click();
    assert.equal(await f.page.locator('input[placeholder="#ffffff"]').inputValue(), '#123abc', 'Formulário não carrega a cor secundária do estabelecimento');
  });
  await test('Master: suspende, reativa e exclui cadastro', { master: true }, async f => {
    await f.page.getByRole('button', { name: 'Suspender', exact: true }).click(); await wait(() => f.db.tenants[0].is_active === false);
    await f.page.getByRole('button', { name: 'Ativar', exact: true }).click(); await wait(() => f.db.tenants[0].is_active === true);
    await f.page.getByTitle('Excluir', { exact: true }).click(); await wait(() => f.db.tenants.length === 0);
  });
  await test('Master: salva dados PIX globais', { master: true }, async f => {
    await f.nav('Configurações'); await f.page.getByPlaceholder('Nome completo ou da empresa').fill('Beneficiário QA'); await f.page.getByPlaceholder('E-mail, CPF/CNPJ, Telefone ou Chave Aleatória').fill('qa-pix@example.invalid');
    await f.page.getByRole('button', { name: 'Salvar Configurações', exact: true }).click(); await wait(() => f.db.platform_settings[0].pix_name === 'Beneficiário QA'); assert.equal(f.db.platform_settings[0].pix_key, 'qa-pix@example.invalid');
  });
  await test('Master: salva mensalidade, status e dia de pagamento', { master: true }, async f => {
    await f.nav('SaaS Financeiro'); await f.page.getByRole('button', { name: 'Gerenciar', exact: true }).click();
    const modal = f.page.locator('.modal-overlay'); await modal.locator('input[type=number]').first().fill('79.9'); await modal.locator('input[type=number]').nth(1).fill('15'); await modal.locator('select').selectOption('overdue'); await modal.getByRole('button', { name: 'Salvar Alterações', exact: true }).click();
    await wait(() => f.db.tenants[0].monthly_fee === 79.9); assert.equal(f.db.tenants[0].payment_day, 15); assert.equal(f.db.tenants[0].subscription_status, 'overdue');
  });
  await test('Master: rejeita mensalidade negativa e dia de pagamento inválido', { master: true }, async f => {
    await f.nav('SaaS Financeiro'); await f.page.getByRole('button', { name: 'Gerenciar', exact: true }).click(); const modal = f.page.locator('.modal-overlay');
    await modal.locator('input[type=number]').first().fill('-5'); await modal.locator('input[type=number]').nth(1).fill('45'); await modal.getByRole('button', { name: 'Salvar Alterações', exact: true }).click();
    await new Promise(resolve => setTimeout(resolve, 300)); assert.equal(f.db.tenants[0].monthly_fee, 59.9, 'Mensalidade negativa e vencimento dia 45 foram enviados e aceitos pelo fluxo');
  });
  await test('Master: oferece logout para encerrar sessão administrativa', { master: true }, async f => {
    assert.ok(await f.page.getByRole('button', { name: /Sair|Logout|Encerrar sessão/i }).count() > 0, 'Painel master não tem ação de sair');
  });
  await test('Adicional: conclusão simultânea em dois dispositivos não duplica receita', { delay: 350, tables: { queue_items: [row('concurrent', 'serving')] } }, async f => {
    const second = await f.context.newPage(); second.setDefaultTimeout(8000); await second.routeWebSocket('**/realtime/**', socket => socket.close()); await second.clock.install({ time: new Date(now) });
    await second.goto('https://admin-audit.test/qa/profissional/'); await visible(second.locator('.professional-admin'));
    await Promise.all([f.page.getByRole('button', { name: 'Concluir', exact: true }).click(), second.getByRole('button', { name: 'Concluir', exact: true }).click()]);
    await wait(() => f.db.queue_items.length === 0); assert.equal(f.db.financial_records.length, 1, 'Dois dispositivos concluem o mesmo atendimento e registram duas receitas');
  });
  await test('Adicional: duplo clique ao lançar despesa não duplica cobrança', { delay: 350 }, async f => {
    await f.nav('Financeiro'); await f.page.getByPlaceholder('Descrição (ex: Aluguel)').fill('Duplo clique QA'); await f.page.getByPlaceholder('R$ 0,00').fill('50');
    await f.page.getByRole('button', { name: 'Lançar', exact: true }).evaluate(button => { button.click(); button.click(); });
    await wait(() => f.db.tenant_expenses.length > 0); assert.equal(f.db.tenant_expenses.length, 1, 'Dois lançamentos foram enviados pelo mesmo gesto de duplo clique');
  });
  await test('Adicional: expediente impede fechamento antes da abertura', { tenant: { booking_type: 'appointment' } }, async f => {
    await f.nav('Atendimento e horários'); const monday = f.page.locator('.admin-schedule-grid > div').filter({ has: f.page.getByText('Segunda', { exact: true }) });
    await monday.locator('input[type=time]').first().fill('19:00'); await new Promise(resolve => setTimeout(resolve, 300));
    const h = f.db.tenants[0].working_hours.find(h => h.day === 1); assert.ok(h.start < h.end, 'Expediente salvo com abertura 19:00 e fechamento 18:00');
  });
  await test('Adicional: replicar expediente para todos os dias ativos', { tenant: { booking_type: 'appointment' } }, async f => {
    await f.nav('Atendimento e horários'); const monday = f.page.locator('.admin-schedule-grid > div').filter({ has: f.page.getByText('Segunda', { exact: true }) });
    await monday.locator('input[type=time]').first().fill('09:00'); await wait(() => f.db.tenants[0].working_hours.find(h => h.day === 1).start === '09:00');
    await monday.getByRole('button', { name: 'Aplicar a todos', exact: true }).click(); await wait(() => f.db.tenants[0].working_hours.every(h => h.start === '09:00'));
  });
  await test('Adicional: vencimento no aviso de pagamento usa a data local correta', { tenant: { subscription_status: 'overdue', next_payment_at: '2026-10-17T03:00:00Z' } }, async f => {
    await visible(f.page.locator('.payment-alert-banner')); await wait(async () => (await f.page.locator('.payment-alert-banner').innerText()).includes('mensalidade vence hoje'));
    assert.match(await f.page.locator('.payment-alert-banner').innerText(), /17\/10\/2026/, 'Vencimento é exibido um dia antes no fuso America/Bahia');
  });
  for (const width of [390,1440]) for (const subscription_status of ['pending','overdue']) await test(`Cobrança: vencimento futuro em 28/10 não é atraso mesmo com status ${subscription_status} em ${width}px`, {width,tenant:{subscription_status,next_payment_at:'2026-10-28T00:00:00Z'}}, async f => {
    const banner=f.page.locator('.payment-alert-banner');await visible(banner);
    assert.match(await banner.innerText(),/Sua mensalidade vence em 28\/10\/2026/);
    assert.doesNotMatch(await banner.innerText(),/venceu|suspensão|atraso/i);
    assert.match(await banner.getAttribute('class'),/billing-pending/);
    assert.equal(await f.page.getByText('A vencer',{exact:true}).textContent(),'A vencer');await noOverflow(f);
    assert.equal(f.requests.some(r=>r.method==='PATCH'&&r.table==='tenants'),false);
    if(subscription_status==='overdue') await f.page.screenshot({path:fileURLToPath(new URL(`billing-futuro-${width}.png`,output)),animations:'disabled'});
  });
  await test('Cobrança: painel aberto atualiza o vencimento ao voltar após meia-noite', {tenant:{subscription_status:'pending',next_payment_at:'2026-10-17T00:00:00Z'}}, async f => {
    await visible(f.page.getByText('Sua mensalidade vence hoje',{exact:true}));
    await f.page.clock.setFixedTime(new Date('2026-10-18T00:01:00-03:00'));
    await f.page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await visible(f.page.getByText('Atenção: Pagamento em atraso',{exact:true}));
    assert.match(await f.page.locator('.payment-alert-banner').innerText(),/venceu em 17\/10\/2026/);
  });
  await test('Cobrança: pagamento pendente com data passada é exibido como atraso', {tenant:{subscription_status:'pending',next_payment_at:'2026-10-16T00:00:00Z'}}, async f => {
    const banner=f.page.locator('.payment-alert-banner');await visible(banner);
    assert.match(await banner.innerText(),/venceu em 16\/10\/2026/);assert.match(await banner.getAttribute('class'),/billing-overdue/);
    await visible(f.page.getByText('Atrasado',{exact:true}));
  });
  await test('Cobrança: ausência de data não afirma vencimento nem suspensão', {tenant:{subscription_status:'overdue',next_payment_at:null}}, async f => {
    const banner=f.page.locator('.payment-alert-banner');await visible(banner);
    assert.match(await banner.innerText(),/está pendente de pagamento/);assert.doesNotMatch(await banner.innerText(),/venceu|suspensão|atraso/i);
  });
  await test('Cobrança: plano ativo com vencimento antigo não ganha cobrança indevida', {tenant:{subscription_status:'active',next_payment_at:'2026-10-01T00:00:00Z'}}, async f => {
    await visible(f.page.getByText('Plano Ativo',{exact:true}));assert.equal(await f.page.locator('.payment-alert-banner').count(),0);
  });
  await test('Cobrança: master conta e filtra atrasos pela data, preservando cadastros', {master:true,tables:{tenants:[{...base,subscription_status:'overdue',next_payment_at:'2026-10-28T00:00:00Z'},{...base,id:'past',slug:'past',name:'Vencido QA',subscription_status:'pending',next_payment_at:'2026-10-16T00:00:00Z'}]}}, async f => {
    await f.nav('SaaS Financeiro');
    const overdue=f.page.locator('.stat-card').filter({has:f.page.getByText('Inadimplentes',{exact:true})});
    assert.equal(await overdue.locator('.stat-value').innerText(),'1');
    await f.page.locator('select').first().selectOption('overdue');assert.equal(await f.page.locator('tbody tr').count(),1);assert.match(await f.page.locator('tbody').innerText(),/Vencido QA/);
    await f.page.locator('select').first().selectOption('pending');assert.equal(await f.page.locator('tbody tr').count(),1);assert.match(await f.page.locator('tbody').innerText(),/Barbearia QA/);assert.match(await f.page.locator('tbody').innerText(),/A vencer/i);
    assert.equal(f.requests.some(r=>r.method==='PATCH'&&r.table==='tenants'),false);
  });
  await test('Adicional: aviso permite copiar chave PIX sem enviar comprovante', { tenant: { subscription_status: 'overdue' } }, async f => {
    await f.page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: async value => { window.__qaClipboard = value; } }, configurable: true }));
    await f.page.getByTitle('Copiar PIX', { exact: true }).click(); assert.equal(await f.page.evaluate(() => window.__qaClipboard), 'fixture-key');
    const href = await f.page.getByRole('link', { name: 'Enviar Comprovante' }).getAttribute('href'); assert.ok(href.startsWith('https://wa.me/'));
  });
  await test('Adicional: busca e filtro do financeiro master', { master: true, tables: { tenants: [base, { ...base, id: 'other', slug: 'other', name: 'Studio Outro', subscription_status: 'overdue' }] } }, async f => {
    await f.nav('SaaS Financeiro'); await f.page.getByPlaceholder('Pesquisar por nome do estabelecimento...').fill('Studio Outro'); assert.equal(await f.page.locator('tbody tr').count(), 1);
    await f.page.getByPlaceholder('Pesquisar por nome do estabelecimento...').fill(''); await f.page.locator('.financial-filters select, .filter-bar select').count();
    await f.page.locator('select').first().selectOption('active'); assert.equal(await f.page.locator('tbody tr').count(), 1); assert.match(await f.page.locator('tbody').innerText(), /Barbearia QA/);
  });
  await test('Adicional: edição master preserva mensalidade gratuita de zero', { master: true, tenant: { monthly_fee: 0 } }, async f => {
    await f.nav('SaaS Financeiro'); await f.page.getByRole('button', { name: 'Gerenciar', exact: true }).click();
    assert.equal(Number(await f.page.locator('.modal-overlay input[type=number]').first().inputValue()), 0, 'Mensalidade zero é substituída por 59,90 ao editar');
  });
  await test('Adicional: MRR master exclui estabelecimentos em teste', { master: true, tables: { tenants: [base, { ...base, id: 'trial', slug: 'trial', name: 'Em teste QA', subscription_status: 'trial', monthly_fee: 100 }] } }, async f => {
    await f.nav('SaaS Financeiro'); const card = f.page.locator('.stat-card').filter({ hasText: 'Faturamento MRR' }); assert.equal((await card.locator('.stat-value').innerText()).replace(/\s/g, ''), 'R$59.90', 'MRR soma assinaturas em teste como receita recorrente');
  });
  await test('Adicional: login master rejeita senha errada e aceita conta verificada pelo servidor', { master: true, auth: false }, async f => {
    await f.page.locator('input[type=email]').fill('invalid@example.invalid'); await f.page.locator('input[type=password]').fill('invalid'); await f.page.getByRole('button', { name: 'Acessar Plataforma', exact: true }).click();
    await visible(f.page.locator('.master-login'));
    await f.page.locator('input[type=email]').fill(base.login_email); await f.page.locator('input[type=password]').fill(base.login_password); await f.page.getByRole('button', { name: 'Acessar Plataforma', exact: true }).click(); await visible(f.page.locator('.admin-layout'));
  });
  await test('Adicional: serviço com duração menor que cinco minutos não é enviado', {}, async f => {
    await f.nav('Serviços'); await f.page.getByRole('button', { name: '+ Novo Serviço', exact: true }).click(); const modal = f.page.getByRole('dialog');
    await modal.getByPlaceholder('ex: Corte Social').fill('Duração inválida QA'); await modal.getByPlaceholder('ex: 35,00').fill('35'); await modal.getByPlaceholder('ex: 45').fill('1');
    await modal.getByRole('button', { name: 'Adicionar Serviço', exact: true }).click(); assert.equal(await modal.getByPlaceholder('ex: 45').evaluate(input => input.checkValidity()), false); assert.equal(f.db.tenants[0].services.length, 2);
  });
  await test('Adicional: navegação master em celular 390px', { master: true, width: 390 }, async f => {
    for (const tab of ['SaaS Financeiro', 'Configurações', 'Estabelecimentos']) { await f.nav(tab); await noOverflow(f); }
  });
  await test('Avisos: aceite explícito remove o alerta e persiste ao recarregar', {push:'prompt'}, async f => {
    const card=f.page.getByRole('status',{name:'Permissão de notificações'});await visible(card);
    assert.equal(await f.page.evaluate(()=>window.__pushHarness.requestCalls),0);
    await card.getByRole('button',{name:'Aceitar notificações'}).click();await card.waitFor({state:'detached'});
    assert.equal(await f.page.evaluate(()=>window.__pushHarness.requestCalls),1);
    await f.page.reload();await visible(f.page.locator('.professional-admin'));
    assert.equal(await f.page.locator('.notification-permission-card').count(),0);
    assert.equal(await f.page.getByText('Avisos ativos',{exact:true}).count(),0);
    assert.equal(await f.page.evaluate(()=>window.__pushHarness.requestCalls),0);
  });
  await test('Avisos: dispositivo já inscrito não recebe pedido nem botão repetido', {push:'enabled'}, async f => {
    await f.nav('Financeiro');await f.nav('Serviços');
    assert.equal(await f.page.locator('.notification-permission-card').count(),0);
    assert.equal(await f.page.evaluate(()=>window.__pushHarness.requestCalls),0);
  });
  for(const width of [390,1440])await test(`Avisos: profissional confirma vínculo remoto e oferece teste só do aparelho em ${width}px`, {push:'enabled',width,standalone:true}, async f=>{
    await f.nav('Perfil e aparência');
    const button=f.page.getByRole('button',{name:'Enviar teste neste aparelho'});await visible(button);
    assert.equal(f.requests.some(r=>r.table==='push-device'&&r.body.action==='test'),false);
    await button.click();await visible(f.page.getByText(/Teste enviado a este aparelho/));
    assert.equal(f.requests.filter(r=>r.table==='push-device'&&r.body.action==='test').length,1);
    assert.equal(await f.page.evaluate(()=>window.__pushHarness.requestCalls),0);await noOverflow(f);
    if(width===390)await f.page.screenshot({path:fileURLToPath(new URL('push-device-verified-mobile.png',output)),animations:'disabled'});
  });
  await test('Avisos automáticos: PWA recupera vínculo atrasado ao abrir sem clique nem novo pedido', {push:'enabled',pushFailures:1,width:390,standalone:true}, async f=>{
    await wait(()=>f.requests.some(r=>r.table==='push-device'));
    assert.equal(await f.page.getByRole('button',{name:'Reconectar avisos'}).count(),0);
    await f.page.clock.runFor(3000);
    await f.nav('Perfil e aparência');await visible(f.page.getByRole('button',{name:'Enviar teste neste aparelho'}));
    assert.equal(f.requests.filter(r=>r.table==='push-device').length,2);
    assert.equal(await f.page.evaluate(()=>window.__pushHarness.requestCalls),0);
    assert.equal(f.requests.some(r=>r.table==='push-device'&&r.body.action==='test'),false);
    await f.page.reload();await f.nav('Perfil e aparência');await visible(f.page.getByRole('button',{name:'Enviar teste neste aparelho'}));
    assert.equal(await f.page.evaluate(()=>window.__pushHarness.requestCalls),0);
  });
  await test('Avisos automáticos: volta da internet recupera falha persistente sem botão manual', {push:'enabled',pushFailures:3}, async f=>{
    await wait(()=>f.requests.filter(r=>r.table==='push-device').length===1);
    await f.page.clock.runFor(3000);await wait(()=>f.requests.filter(r=>r.table==='push-device').length===2);
    await f.page.clock.runFor(7000);await visible(f.page.getByRole('button',{name:'Reconectar avisos'}));
    await f.page.evaluate(()=>window.dispatchEvent(new Event('online')));
    await f.page.getByRole('button',{name:'Reconectar avisos'}).waitFor({state:'detached'});
    await f.nav('Perfil e aparência');await visible(f.page.getByRole('button',{name:'Enviar teste neste aparelho'}));
    assert.equal(await f.page.evaluate(()=>window.__pushHarness.requestCalls),0);
  });
  await test('Avisos automáticos: retorno do PWA agrupa eventos e revalida sem pedir permissão', {push:'enabled'}, async f=>{
    await f.nav('Perfil e aparência');await visible(f.page.getByRole('button',{name:'Enviar teste neste aparelho'}));
    const before=f.requests.filter(r=>r.table==='push-device').length;
    await f.page.evaluate(()=>{window.dispatchEvent(new Event('pageshow'));window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'));});
    await visible(f.page.getByRole('button',{name:'Enviar teste neste aparelho'}));
    await wait(()=>f.requests.filter(r=>r.table==='push-device').length===before+1);
    assert.equal(await f.page.evaluate(()=>window.__pushHarness.requestCalls),0);
  });
  await test('Avisos automáticos: sair cancela tentativas e não reconecta profissional em segundo plano', {push:'enabled',pushFailures:3}, async f=>{
    await wait(()=>f.requests.some(r=>r.table==='push-device'));
    await f.page.getByRole('button',{name:'Sair do Painel'}).click();await visible(f.page.getByRole('button',{name:'Entrar no meu painel'}));
    const before=f.requests.filter(r=>r.table==='push-device').length;
    await f.page.clock.runFor(20000);await f.page.evaluate(()=>window.dispatchEvent(new Event('online')));
    assert.equal(f.requests.filter(r=>r.table==='push-device').length,before);
    assert.equal(await f.page.evaluate(()=>window.__pushHarness.requestCalls),0);
  });
  await test('Avisos automáticos: conexão travada tem limite e mantém recuperação manual disponível', {push:'enabled'}, async f=>{
    await f.nav('Perfil e aparência');await visible(f.page.getByRole('button',{name:'Enviar teste neste aparelho'}));
    let release, arrived=false;const gate=new Promise(resolve=>{release=resolve;});
    const handler=async route=>{arrived=true;await gate;await route.abort().catch(()=>{});};
    await f.page.route('**/api/push-device',handler);
    await f.page.evaluate(()=>window.dispatchEvent(new Event('online')));await wait(()=>arrived);
    await f.page.clock.runFor(46000);await visible(f.page.getByRole('button',{name:'Reconectar avisos'}));
    await visible(f.page.getByText(/Não foi possível recuperar automaticamente os avisos a tempo/));
    release();await f.page.unroute('**/api/push-device',handler);
    await f.page.getByRole('button',{name:'Reconectar avisos'}).click();await visible(f.page.getByRole('button',{name:'Enviar teste neste aparelho'}));
    assert.equal(await f.page.evaluate(()=>window.__pushHarness.requestCalls),0);
  });
  await test('Avisos: permissão aceita com vínculo remoto ausente mostra correção e recupera sem novo prompt', {push:'enabled',width:390}, async f=>{
    await f.nav('Perfil e aparência');await visible(f.page.getByRole('button',{name:'Enviar teste neste aparelho'}));
    await f.nav('Fila de agora');
    const baseline=f.requests.filter(r=>r.table==='push-device').length;
    f.faults.push({table:'push-device',remaining:3,status:200,body:{registered:false,reason:'not-linked'}});
    await f.page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await wait(()=>f.requests.filter(r=>r.table==='push-device').length>baseline);
    await f.page.clock.runFor(3000);
    await wait(()=>f.requests.filter(r=>r.table==='push-device').length>baseline+1);
    await f.page.clock.runFor(7000);
    const retry=f.page.getByRole('button',{name:'Reconectar avisos'});await visible(retry);
    await visible(f.page.getByText(/Não foi possível restabelecer automaticamente o vínculo/));
    assert.equal(await f.page.evaluate(()=>window.__pushHarness.requestCalls),0);
    await retry.click();await retry.waitFor({state:'detached'});await noOverflow(f);
  });
  await test('Avisos: vínculo usa prova do aparelho sem reivindicar identidade pública previsível', {push:'enabled',permissionChoice:'identity-error'}, async f=>{
    await f.nav('Perfil e aparência');await visible(f.page.getByRole('button',{name:'Enviar teste neste aparelho'}));
    assert.equal(await f.page.evaluate(()=>window.__pushHarness.loginCalls),0);
    const registration=f.requests.find(r=>r.table==='push-device');
    assert.equal(registration.body.subscriptionToken,'qa-token');
    assert.equal(registration.body.action,'status');
  });
  await test('Avisos: negar permissão mantém alerta e oferece instruções sem repetir prompt', {push:'prompt',permissionChoice:'denied'}, async f => {
    await f.page.getByRole('button',{name:'Aceitar notificações'}).click();
    await visible(f.page.getByRole('alert',{name:'Permissão de notificações'}));
    assert.equal(await f.page.getByRole('button',{name:'Aceitar notificações'}).count(),0);
    await f.page.getByText('Como permitir as notificações',{exact:true}).click();
    await visible(f.page.getByText(/Toque no ícone ao lado do endereço/));
    assert.equal(await f.page.evaluate(()=>window.__pushHarness.requestCalls),1);
  });
  await test('Avisos: permissão revogada reaparece e volta a sumir quando restaurada', {push:'enabled'}, async f => {
    await f.page.evaluate(()=>window.__pushHarness.setStatus('blocked'));
    await visible(f.page.getByRole('alert',{name:'Permissão de notificações'}));
    await f.page.evaluate(()=>window.__pushHarness.setStatus('enabled'));
    await f.page.locator('.notification-permission-card').waitFor({state:'detached'});
  });
  await test('Avisos: navegador sem suporte informa limitação sem botão inoperante', {push:'unsupported'}, async f => {
    await visible(f.page.getByText('Avisos indisponíveis neste navegador',{exact:true}));
    assert.equal(await f.page.getByRole('button',{name:'Aceitar notificações'}).count(),0);
  });
  await test('Avisos: SDK com falha não anuncia ativação e permite nova tentativa', {push:'prompt',permissionChoice:'error'}, async f => {
    await f.page.getByRole('button',{name:'Aceitar notificações'}).click();
    await visible(f.page.getByRole('button',{name:'Tentar novamente'}));
    assert.equal(await f.page.getByText('Notificações e aviso sonoro ativados neste dispositivo.',{exact:true}).count(),0);
  });
  await test('Avisos: pedido de permissão sem resposta libera botão com explicação e aceita resposta tardia', {push:'prompt',permissionChoice:'hang',width:390}, async f => {
    await f.page.getByRole('button',{name:'Aceitar notificações'}).click();await visible(f.page.getByRole('button',{name:'Aguardando permissão…'}));
    await f.page.clock.runFor(31000);await visible(f.page.getByRole('button',{name:'Tentar novamente'}));
    await visible(f.page.locator('.notification-permission-card').getByRole('alert'));
    assert.match(await f.page.locator('.notification-permission-card').innerText(),/navegador não respondeu ao pedido de permissão/);
    assert.equal(f.requests.some(r=>r.table==='tenants'&&r.method==='PATCH'),false);
    await f.page.screenshot({path:fileURLToPath(new URL('push-permission-timeout.png',output)),animations:'disabled'});
    await f.page.getByRole('button',{name:'Tentar novamente'}).click();
    assert.equal(await f.page.evaluate(()=>window.__pushHarness.requestCalls),1,'não abre um segundo pedido nativo enquanto o anterior está pendente');
    await f.page.evaluate(()=>window.__pushHarness.finishPermission('enabled'));
    await f.page.locator('.notification-permission-card').waitFor({state:'detached'});
  });
  await test('Avisos: inscrição travada após permitir também tem prazo e mensagem específica', {push:'permission-only',permissionChoice:'opt-in-hang'}, async f => {
    await f.page.getByRole('button',{name:'Aceitar notificações'}).click();await f.page.clock.runFor(16000);
    await visible(f.page.getByRole('button',{name:'Tentar novamente'}));
    assert.match(await f.page.locator('.notification-permission-card').innerText(),/permissão foi aceita, mas a inscrição/);
    assert.equal(await f.page.evaluate(()=>window.__pushHarness.requestCalls),0);
    assert.equal(await f.page.evaluate(()=>window.__pushHarness.optInCalls),1);
  });
  await test('Avisos: bloqueio informado depois do prazo substitui o erro antigo pela orientação correta', {push:'prompt',permissionChoice:'hang'}, async f => {
    await f.page.getByRole('button',{name:'Aceitar notificações'}).click();await f.page.clock.runFor(31000);
    await visible(f.page.getByRole('button',{name:'Tentar novamente'}));
    await f.page.evaluate(()=>window.__pushHarness.finishPermission('blocked'));
    await visible(f.page.getByRole('alert',{name:'Permissão de notificações'}));
    assert.doesNotMatch(await f.page.locator('.notification-permission-card').innerText(),/navegador não respondeu/);
    assert.equal(await f.page.getByRole('button',{name:'Tentar novamente'}).count(),0);
  });
  await test('Avisos: permissão nativa já concedida não recebe um novo pedido se o SDK ainda está desatualizado', {push:'prompt'}, async f => {
    await f.page.evaluate(()=>window.__pushHarness.setNativePermission('granted'));
    await f.page.getByRole('button',{name:'Aceitar notificações'}).click();await f.page.locator('.notification-permission-card').waitFor({state:'detached'});
    assert.equal(await f.page.evaluate(()=>window.__pushHarness.requestCalls),0);
    assert.equal(await f.page.evaluate(()=>window.__pushHarness.optInCalls),1);
  });
  await test('Avisos: falha de inicialização é explicada sem chamar a permissão', {push:'prompt',permissionChoice:'init-error'}, async f => {
    await f.page.clock.runFor(4000);await f.page.getByRole('button',{name:'Tentar novamente'}).click();
    assert.match(await f.page.locator('.notification-permission-card').innerText(),/serviço de avisos não conseguiu iniciar/);
    assert.equal(await f.page.evaluate(()=>window.__pushHarness.requestCalls),0);
  });
  await test('Avisos: SDK atrasado não dispara pedido nativo depois de expirar a tentativa', {push:'sdk-delayed'}, async f => {
    await f.page.clock.runFor(4000);await f.page.getByRole('button',{name:'Tentar novamente'}).click();
    await f.page.clock.runFor(11000);await visible(f.page.getByRole('button',{name:'Tentar novamente'}));
    assert.match(await f.page.locator('.notification-permission-card').innerText(),/serviço de avisos não respondeu/);
    await f.page.evaluate(()=>window.__pushHarness.flushSDK());
    assert.equal(await f.page.evaluate(()=>window.__pushHarness.requestCalls),0);
    await f.page.getByRole('button',{name:'Aceitar notificações'}).click();await f.page.locator('.notification-permission-card').waitFor({state:'detached'});
  });
  await test('Avisos: erro de domínio no localhost explica app de testes sem abrir permissão', {push:'prompt',permissionChoice:'origin-error',origin:'http://localhost:5173',width:390}, async f => {
    await f.page.clock.runFor(4000);await f.page.getByRole('button',{name:'Tentar novamente'}).click();
    await visible(f.page.locator('.notification-permission-card').getByRole('alert'));
    assert.match(await f.page.locator('.notification-permission-card').innerText(),/mesma URL e porta locais/);
    assert.equal(await f.page.evaluate(()=>window.__pushHarness.requestCalls),0);
    await noOverflow(f);await f.page.screenshot({path:fileURLToPath(new URL('push-localhost-error.png',output)),animations:'disabled'});
  });
  await test('Avisos: falha de rede mantém motivo visível após o toast e recupera na nova tentativa', {push:'prompt',permissionChoice:'network-error'}, async f => {
    await f.page.getByRole('button',{name:'Aceitar notificações'}).click();await visible(f.page.getByRole('button',{name:'Tentar novamente'}));
    await f.page.clock.runFor(6000);assert.match(await f.page.locator('.notification-permission-card').innerText(),/conexão com o serviço de avisos falhou/);
    await f.page.evaluate(()=>window.__pushHarness.setChoice('granted'));await f.page.getByRole('button',{name:'Tentar novamente'}).click();
    await f.page.locator('.notification-permission-card').waitFor({state:'detached'});
  });
  await test('Avisos: cliente recebe explicação e botão disponível após pedido travado', {auth:false,ownedItems:['mine'],tables:{queue_items:[row('mine')]},push:'prompt',permissionChoice:'hang',width:390}, async f => {
    await f.page.getByRole('button',{name:'Aceitar notificações'}).click();await f.page.clock.runFor(31000);
    await visible(f.page.getByRole('button',{name:'Tentar novamente'}));
    assert.match(await f.page.locator('.notification-permission-card').innerText(),/navegador não respondeu/);
    assert.equal(f.requests.some(r=>r.table==='customer_queue_action'&&r.body.p_action==='subscribe'),false);
  });
  await test('Avisos: aceite sem token não é considerado ativo antes da inscrição completa', {push:'incomplete'}, async f => {
    const button=f.page.getByRole('button',{name:'Aceitar notificações'});await visible(button);await button.click();
    assert.equal(await f.page.locator('.notification-permission-card').count(),1);
    await f.page.evaluate(()=>window.__pushHarness.setStatus('enabled'));
    await f.page.locator('.notification-permission-card').waitFor({state:'detached'});
  });
  await test('Avisos: revogação no navegador é detectada ao voltar para a aba', {push:'enabled'}, async f => {
    await f.page.evaluate(()=>{window.__pushHarness.setNativePermission('denied');window.dispatchEvent(new Event('focus'));});
    await visible(f.page.getByRole('alert',{name:'Permissão de notificações'}));
    assert.equal(await f.page.evaluate(()=>window.__pushHarness.requestCalls),0);
  });
  await test('Avisos: dispensar o pedido mantém opção de aceitar sem anunciar sucesso', {push:'prompt',permissionChoice:'default'}, async f => {
    await f.page.getByRole('button',{name:'Aceitar notificações'}).click();
    await visible(f.page.getByRole('button',{name:'Aceitar notificações'}));
    assert.equal(await f.page.getByText('Notificações e aviso sonoro ativados neste dispositivo.',{exact:true}).count(),0);
  });
  await test('Navegação nova: rodapé profissional, menu com Escape e sem rolagem lateral', {width:390,push:'prompt',tenant:{booking_type:'appointment'}}, async f => {
    const nav=f.page.getByRole('navigation',{name:'Acessos rápidos do painel'});
    await nav.getByRole('button',{name:'Financeiro',exact:true}).click();await visible(f.page.getByRole('heading',{name:'Resumo financeiro'}));
    await nav.getByRole('button',{name:'Agenda',exact:true}).click();await noOverflow(f);
    await nav.getByRole('button',{name:'Mais',exact:true}).click();await visible(f.page.getByRole('button',{name:'Fechar menu de navegação'}));
    await f.page.keyboard.press('Shift+Tab');assert.equal(await f.page.evaluate(()=>Boolean(document.activeElement.closest('#professional-admin-menu'))),true);
    await f.page.keyboard.press('Tab');assert.equal(await f.page.getByRole('button',{name:'Fechar menu de navegação'}).evaluate(el=>el===document.activeElement),true);
    await f.page.keyboard.press('Escape');assert.equal(await f.page.locator('#professional-admin-menu').getAttribute('inert'),'');
    assert.equal(await nav.getByRole('button',{name:'Mais',exact:true}).evaluate(el=>el===document.activeElement),true);
    await nav.getByRole('button',{name:'Hoje',exact:true}).click();await noOverflow(f);
    await f.page.evaluate(()=>document.fonts.ready);await f.page.screenshot({path:fileURLToPath(new URL('professional-mobile-final.png',output)),animations:'disabled'});
    await f.page.getByRole('button',{name:'Aceitar notificações'}).click();await f.page.locator('.notification-permission-card').waitFor({state:'detached'});
    await f.page.screenshot({path:fileURLToPath(new URL('professional-mobile-accepted.png',output)),animations:'disabled'});
  });
  await test('Navegação nova: rodapé master chega a clientes, financeiro e ajustes', {master:true,width:390}, async f => {
    const nav=f.page.getByRole('navigation',{name:'Acessos rápidos da plataforma'});
    await nav.getByRole('button',{name:'Financeiro',exact:true}).click();await visible(f.page.getByRole('heading',{name:'Controle Financeiro SaaS'}));
    await nav.getByRole('button',{name:'Ajustes',exact:true}).click();await visible(f.page.getByRole('heading',{name:'Configurações Globais'}));
    await nav.getByRole('button',{name:'Clientes',exact:true}).click();await noOverflow(f);
    await f.page.evaluate(()=>document.fonts.ready);await f.page.screenshot({path:fileURLToPath(new URL('master-mobile-final.png',output)),animations:'disabled'});
  });
  await test('Responsivo novo: celular de 320px mantém atalhos e conteúdo utilizáveis', {width:320,push:'prompt'}, async f => {
    await noOverflow(f);const nav=f.page.getByRole('navigation',{name:'Acessos rápidos do painel'});
    await nav.getByRole('button',{name:'Financeiro',exact:true}).click();await visible(f.page.getByRole('heading',{name:'Resumo financeiro'}));await noOverflow(f);
    await nav.getByRole('button',{name:'Mais',exact:true}).click();await visible(f.page.getByRole('button',{name:'Fechar menu de navegação'}));
    await f.page.getByRole('button',{name:'Fechar menu de navegação'}).click();await noOverflow(f);
  });
  await test('Responsivo novo: master em 1024px mantém navegação desktop acessível', {master:true,width:1024}, async f => {
    await visible(f.page.locator('#master-admin-menu').getByRole('button',{name:'SaaS Financeiro'}));
    await f.page.locator('#master-admin-menu').getByRole('button',{name:'SaaS Financeiro'}).click();await noOverflow(f);
  });
  await test('Visual novo: painel profissional desktop com ações e fonte Poppins', {push:'enabled',tenant:{name:'Studio Bella',booking_type:'appointment',primary_color:'#e979b9'},tables:{queue_items:[row('one','waiting',{name:'Mariana Costa',appointment_time:now}),row('two','pending',{name:'Camila Santos',appointment_time:now})]}}, async f => {
    assert.match(await f.page.locator('.topbar-info h1').evaluate(el=>getComputedStyle(el).fontFamily),/Poppins/);
    await noOverflow(f);await f.page.evaluate(()=>document.fonts.ready);await f.page.screenshot({path:fileURLToPath(new URL('professional-desktop-final.png',output)),animations:'disabled'});
  });
  for (const width of [390,1440]) {
    await test(`Recuperação: solicita link sem revelar cadastro e limita reenvio — ${width}px`, {width,auth:false,path:'/recuperar-acesso'}, async f=>{
      await f.page.getByLabel('E-mail da conta').fill('professional@example.invalid');
      await f.page.getByRole('button',{name:'Enviar link de recuperação'}).click();
      await visible(f.page.getByText(/Se este e-mail estiver cadastrado/));
      assert.equal(await f.page.getByRole('button',{name:/Reenviar em/}).isDisabled(),true);
      const request=f.requests.find(r=>r.table==='auth'&&r.path.endsWith('/recover'));
      assert.equal(request.body.email,'professional@example.invalid');await noOverflow(f);
    });
  }
  await test('Recuperação: erro do envio libera botão e informa problema', {auth:false,path:'/recuperar-acesso'}, async f=>{
    f.faults.push({table:'auth',remaining:1,status:429});
    await f.page.getByLabel('E-mail da conta').fill('professional@example.invalid');
    await f.page.getByRole('button',{name:'Enviar link de recuperação'}).click();
    await visible(f.page.getByRole('alert'));assert.match(await f.page.getByRole('alert').innerText(),/Muitas tentativas/);
    assert.equal(await f.page.getByRole('button',{name:'Enviar link de recuperação'}).isEnabled(),true);
  });
  await test('Recuperação: link inválido oferece novo envio sem formulário de senha', {auth:false,path:'/recuperar-acesso#error=access_denied&error_code=otp_expired'}, async f=>{
    await visible(f.page.getByRole('alert'));assert.equal(await f.page.getByLabel('Nova senha',{exact:true}).count(),0);
  });
  await test('Recuperação: link válido atualiza senha e encerra sessões', {auth:false,path:'/recuperar-acesso#access_token=qa-verified-token&refresh_token=qa-refresh-token&expires_in=3600&token_type=bearer&type=recovery'}, async f=>{
    await visible(f.page.getByLabel('Nova senha',{exact:true}));
    await f.page.getByLabel('Nova senha',{exact:true}).fill('New-fixture-password123');
    await f.page.getByLabel('Confirmar nova senha').fill('Different-fixture-123');
    await f.page.getByRole('button',{name:'Salvar nova senha'}).click();await visible(f.page.getByText('As senhas não coincidem.'));
    assert.equal(f.requests.some(r=>r.table==='auth'&&r.method==='PUT'),false);
    await f.page.getByLabel('Confirmar nova senha').fill('New-fixture-password123');
    await f.page.getByRole('button',{name:'Salvar nova senha'}).click();
    await visible(f.page.getByRole('heading',{name:'Senha atualizada'}));
    await wait(()=>f.requests.some(r=>r.table==='auth'&&r.path.endsWith('/logout')));
    assert.equal(f.requests.find(r=>r.table==='auth'&&r.method==='PUT').body.password,'New-fixture-password123');
  });
} finally {
  await browser.close();
  const summary = { passed: results.filter(r => r.status === 'passed').length, failed: results.filter(r => r.status === 'failed').length, total: results.length };
  await writeFile(new URL('browser-results.json', output), JSON.stringify({ summary, results }, null, 2));
  console.log(JSON.stringify(summary));
  if(summary.failed)process.exitCode=1;
}

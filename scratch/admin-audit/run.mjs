import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.AUDIT_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
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
async function fixture({ width = 1440, tenant = {}, tables = {}, auth = true, forged = false, master = false, delay = 0 } = {}) {
  const db = {
    tenants: [structuredClone({ ...base, ...tenant })], queue_items: [], tenant_tasks: [], tenant_products: [], tenant_expenses: [], financial_records: [],
    platform_settings: [{ id: 'settings', pix_key: 'fixture-key', pix_name: 'QA beneficiary' }], ...structuredClone(tables),
  };
  const requests = []; const exceptions = []; const faults = [];
  const context = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: 'America/Bahia', serviceWorkers: 'block' });
  const user = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: base.login_email, aud: 'authenticated', role: 'authenticated' };
  const session = { access_token: 'qa-verified-token', refresh_token: 'qa-refresh-token', expires_at: 9999999999, expires_in: 3600, token_type: 'bearer', user };
  await context.addInitScript(({ auth, forged, master, session }) => {
    if (forged) localStorage.setItem(master ? 'admin_auth' : 'suavez_auth_qa', 'true');
    if (auth) localStorage.setItem('sb-tfquhfhmmnbwntmkfkdo-auth-token', JSON.stringify(session));
    // Unsupported push SDK fixture: never contacts real devices or providers.
    const sdk = { init: async () => {}, login: async () => {}, logout: async () => {}, Slidedown: { promptPush: async () => {} }, Notifications: { permission: false, isPushSupported: () => false, addEventListener: () => {}, requestPermission: async () => {} }, User: { PushSubscription: { id: null, token: null, optedIn: false, addEventListener: () => {}, removeEventListener: () => {}, optIn: async () => {} } } };
    window.OneSignalDeferred = { push: fn => Promise.resolve().then(() => fn(sdk)).catch(() => {}) };
  }, { auth, forged, master, session });
  await context.route('**/*', async route => {
    const request = route.request(); const url = new URL(request.url()); const method = request.method();
    const send = (data, status = 200, headers = {}) => route.fulfill({ status, contentType: 'application/json', headers, body: method === 'HEAD' ? '' : JSON.stringify(data) });
    if (url.pathname.startsWith('/auth/v1/')) {
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
          const r={id:crypto.randomUUID(),tenant_id:q.tenant_id,price:q.price,completed_at:now,source_queue_item_id:q.id};
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
      affected = affected.slice(0, limit);
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
    if (url.hostname === 'admin-audit.test') {
      const asset = url.pathname.startsWith('/assets/') ? url.pathname.slice(1) : 'index.html';
      const body = await readFile(new URL(`../../dist/${asset}`, import.meta.url));
      return route.fulfill({ status: 200, contentType: asset.endsWith('.js') ? 'application/javascript' : asset.endsWith('.css') ? 'text/css' : 'text/html', body });
    }
    return route.abort();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  await page.routeWebSocket('**/realtime/**', socket => socket.close());
  await page.clock.install({ time: new Date(now) });
  page.on('pageerror', error => exceptions.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.goto(`https://admin-audit.test/${master ? 'admin' : 'qa'}`);
  await visible(page.locator(auth ? master ? '.admin-layout' : '.professional-admin' : master ? '.master-login' : '.customer-app').first());
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
    await f.page.locator('.btn-logout').click(); await visible(f.page.locator('.customer-app'));
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
  });
  await test('Fila: remover exige confirmação e não registra receita', { tables: { queue_items: [row('remove')] } }, async f => {
    await f.page.getByRole('button', { name: 'Remover Cliente remove do atendimento' }).click();
    const dialog = f.page.getByRole('alertdialog'); await visible(dialog);
    await dialog.getByRole('button', { name: 'Manter cliente', exact: true }).click(); assert.equal(f.db.queue_items.length, 1);
    await f.page.getByRole('button', { name: 'Remover Cliente remove do atendimento' }).click();
    await f.page.getByRole('alertdialog').getByRole('button', { name: 'Sim, remover da fila', exact: true }).click();
    await wait(() => f.db.queue_items.length === 0); assert.equal(f.db.financial_records.length, 0);
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
    await second.goto('https://admin-audit.test/qa'); await visible(second.locator('.professional-admin'));
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
    await visible(f.page.locator('.payment-alert-banner')); await wait(async () => (await f.page.locator('.payment-alert-banner').innerText()).includes('mensalidade venceu'));
    assert.match(await f.page.locator('.payment-alert-banner').innerText(), /17\/10\/2026/, 'Vencimento é exibido um dia antes no fuso America/Bahia');
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
} finally {
  await browser.close();
  const summary = { passed: results.filter(r => r.status === 'passed').length, failed: results.filter(r => r.status === 'failed').length, total: results.length };
  await writeFile(new URL('browser-results.json', output), JSON.stringify({ summary, results }, null, 2));
  console.log(JSON.stringify(summary));
}

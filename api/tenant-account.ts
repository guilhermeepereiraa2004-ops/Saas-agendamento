import { verifyStaff, serverConfig } from './_lib/auth.js';

export default { async fetch(request: Request) {
  const respond = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
  if (request.method !== 'POST') return respond({ error: 'Method not allowed' }, 405);
  const origin = request.headers.get('origin');
  const configuredOrigin = process.env.APP_ORIGIN?.replace(/\/$/, '');
  if (!origin || (origin !== new URL(request.url).origin && origin !== configuredOrigin)) return respond({ error: 'Origin not allowed' }, 403);
  if (!await verifyStaff(request)) return respond({ error: 'Unauthorized' }, 401);
  const config = serverConfig();
  if (!config) return respond({ error: 'O servidor precisa da chave administrativa do Supabase.' }, 503);
  try {
    const raw = await request.text();
    if (raw.length > 2_000_000) return respond({ error: 'Payload too large' }, 413);
    let payload;
    try { payload = JSON.parse(raw); } catch { return respond({ error: 'Invalid JSON' }, 400); }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return respond({ error: 'Cadastro inválido.' }, 400);
    const { id, tenant, password } = payload;
    if (!tenant || typeof tenant.name !== 'string' || !tenant.name.trim() || typeof tenant.slug !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(tenant.slug) || typeof tenant.login_email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(tenant.login_email) || !Number.isFinite(tenant.monthly_fee) || tenant.monthly_fee < 0 || !Number.isInteger(tenant.payment_day) || tenant.payment_day < 1 || tenant.payment_day > 31 || (password !== undefined && (typeof password !== 'string' || password.length < 12 || password.length > 128)) || (!id && !password)) return respond({ error: 'Dados do cadastro inválidos. A senha deve ter ao menos 12 caracteres.' }, 400);
    if (id && (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))) return respond({ error: 'Cadastro inválido.' }, 400);
    const allowed = ['name','slug','whatsapp','primary_color','secondary_color','has_logo','logo_url','login_email','profession','booking_type','subscription_status','next_payment_at','payment_day','monthly_fee'];
    const profile = Object.fromEntries(allowed.filter(key => key in tenant).map(key => [key, tenant[key]]));
    const call = async (path: string, method: string, body?: unknown) => fetch(`${config.url}${path}`, { method, headers: { ...config.headers, Prefer: 'return=representation' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    if (id) {
      const oldResponse = await call(`/rest/v1/tenants?id=eq.${id}`, 'GET');
      if (!oldResponse.ok) {
        const keyType = config.key.startsWith('sb_secret_') ? 'secret'
          : /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(config.key) ? 'legacy-jwt'
          : config.key.includes('sb_secret_') ? 'secret-with-extra-characters'
          : config.key.startsWith('eyJ2IjoidjIi') ? 'encrypted-envelope' : 'invalid-format';
        console.error('Tenant profile lookup failed', { status: oldResponse.status, keyType });
        return respond({ error: oldResponse.status === 401 && !config.key.startsWith('sb_secret_')
          ? 'A chave administrativa do Supabase está desatualizada. Configure uma chave secreta atual no servidor.'
          : 'Não foi possível ler o cadastro.' }, 502);
      }
      const [old] = await oldResponse.json() as Record<string, unknown>[];
      if (!old) return respond({ error: 'Cadastro não encontrado.' }, 404);
      const accountResponse = await call('/rest/v1/rpc/get_tenant_account', 'POST', { p_tenant_id: id });
      const account = accountResponse.ok ? await accountResponse.json() as { user_id?: string } | null : null;
      if (!accountResponse.ok) return respond({ error: 'Não foi possível verificar o acesso existente.' }, 502);
      if (!account?.user_id) {
        if (!password) return respond({ error: 'Defina uma senha nova com pelo menos 12 caracteres para migrar este acesso ao login seguro.' }, 409);
        const createdUser = await call('/auth/v1/admin/users', 'POST', { email: tenant.login_email, password, email_confirm: true });
        if (!createdUser.ok) return respond({ error: 'Não foi possível criar o acesso. Verifique se o e-mail já está cadastrado.' }, 400);
        const user = await createdUser.json() as { id: string };
        const saved = await call(`/rest/v1/tenants?id=eq.${id}`, 'PATCH', profile);
        if (!saved.ok) { await call(`/auth/v1/admin/users/${user.id}`, 'DELETE'); return respond({ error: 'Não foi possível salvar o cadastro.' }, 400); }
        const linked = await call('/rest/v1/rpc/assign_tenant_account', 'POST', { p_tenant_id: id, p_user_id: user.id });
        if (!linked.ok) { await call(`/rest/v1/tenants?id=eq.${id}`, 'PATCH', Object.fromEntries(allowed.map(key => [key, old[key]]))); await call(`/auth/v1/admin/users/${user.id}`, 'DELETE'); return respond({ error: 'Não foi possível vincular o acesso. Tente novamente.' }, 502); }
        return respond({ saved: true });
      }
      const saved = await call(`/rest/v1/tenants?id=eq.${id}`, 'PATCH', profile);
      if (!saved.ok) return respond({ error: 'Não foi possível salvar o cadastro. Verifique os dados e o slug.' }, 400);
      if (password || old.login_email !== tenant.login_email) {
        const updated = await call(`/auth/v1/admin/users/${account.user_id}`, 'PUT', { email: tenant.login_email, ...(password ? { password } : {}) });
        if (!updated.ok) { await call(`/rest/v1/tenants?id=eq.${id}`, 'PATCH', Object.fromEntries(allowed.map(key => [key, old[key]]))); return respond({ error: 'Não foi possível atualizar o acesso. O cadastro anterior foi mantido.' }, 400); }
      }
    } else {
      const createdUser = await call('/auth/v1/admin/users', 'POST', { email: tenant.login_email, password, email_confirm: true });
      if (!createdUser.ok) return respond({ error: 'Não foi possível criar o acesso. Verifique se o e-mail já está cadastrado.' }, 400);
      const user = await createdUser.json() as { id: string };
      const saved = await call('/rest/v1/tenants', 'POST', [profile]);
      if (!saved.ok) { await call(`/auth/v1/admin/users/${user.id}`, 'DELETE'); return respond({ error: 'Não foi possível criar o estabelecimento. Verifique o slug e os dados.' }, 400); }
      const [created] = await saved.json() as { id: string }[];
      const linked = await call('/rest/v1/rpc/assign_tenant_account', 'POST', { p_tenant_id: created.id, p_user_id: user.id });
      if (!linked.ok) { await call(`/rest/v1/tenants?id=eq.${created.id}`, 'DELETE'); await call(`/auth/v1/admin/users/${user.id}`, 'DELETE'); return respond({ error: 'Não foi possível vincular o acesso. Tente novamente.' }, 502); }
    }
    return respond({ saved: true });
  } catch { return respond({ error: 'Não foi possível concluir a operação. Tente novamente.' }, 500); }
} };

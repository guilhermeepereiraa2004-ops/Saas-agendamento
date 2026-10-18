const baseUrl = () => (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim().replace(/\/$/, '');
const anonKey = () => (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim();

export async function verifyStaff(request: Request, tenantId?: string) {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ') || !baseUrl() || !anonKey()) return null;
  try {
    const headers = { apikey: anonKey(), Authorization: authorization };
    const user = await fetch(`${baseUrl()}/auth/v1/user`, { headers, signal: AbortSignal.timeout(8000) });
    if (!user.ok) return null;
    const verifiedUser = await user.json() as { id?: string };
    if (!verifiedUser.id) return null;
    let sessionId: string | null = null;
    try {
      const claims = JSON.parse(Buffer.from(authorization.slice(7).split('.')[1], 'base64url').toString());
      if (claims.sub === verifiedUser.id && typeof claims.session_id === 'string' && /^[0-9a-f-]{36}$/i.test(claims.session_id)) sessionId = claims.session_id;
    } catch { /* Other endpoints can still validate legacy sessions through Auth. */ }
    const result = await fetch(`${baseUrl()}/rest/v1/rpc/staff_access`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(8000) });
    if (!result.ok) return null;
    const access = await result.json() as { is_master: boolean; tenant_ids: string[] } | null;
    if (!access) return null;
    return (tenantId ? access.is_master || access.tenant_ids.includes(tenantId) : access.is_master) ? { ...access, userId: verifiedUser.id, sessionId } : null;
  } catch { return null; }
}

export async function serverRpc<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const config = serverConfig();
  if (!config) throw new Error('Server configuration unavailable');
  const response = await fetch(`${config.url}/rest/v1/rpc/${name}`, {
    method: 'POST', headers: config.headers, body: JSON.stringify(body), signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error('Private operation unavailable');
  return response.json() as Promise<T>;
}

export function serverConfig() {
  const key = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim();
  if (!baseUrl() || !key) return null;
  const headers: Record<string, string> = { apikey: key, 'Content-Type': 'application/json' };
  if (!key.startsWith('sb_secret_')) headers.Authorization = `Bearer ${key}`;
  return { url: baseUrl(), key, headers };
}

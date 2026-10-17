const baseUrl = () => (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim().replace(/\/$/, '');
const anonKey = () => (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim();

export async function verifyStaff(request: Request, tenantId?: string) {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ') || !baseUrl() || !anonKey()) return null;
  try {
    const headers = { apikey: anonKey(), Authorization: authorization };
    const user = await fetch(`${baseUrl()}/auth/v1/user`, { headers, signal: AbortSignal.timeout(8000) });
    if (!user.ok || !(await user.json() as { id?: string }).id) return null;
    const result = await fetch(`${baseUrl()}/rest/v1/rpc/staff_access`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(8000) });
    if (!result.ok) return null;
    const access = await result.json() as { is_master: boolean; tenant_ids: string[] } | null;
    if (!access) return null;
    return (tenantId ? access.is_master || access.tenant_ids.includes(tenantId) : access.is_master) ? access : null;
  } catch { return null; }
}

export function serverConfig() {
  const key = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim();
  if (!baseUrl() || !key) return null;
  const headers: Record<string, string> = { apikey: key, 'Content-Type': 'application/json' };
  if (!key.startsWith('sb_secret_')) headers.Authorization = `Bearer ${key}`;
  return { url: baseUrl(), key, headers };
}

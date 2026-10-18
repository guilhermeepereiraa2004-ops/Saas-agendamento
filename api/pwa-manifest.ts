/// <reference types="node" />
import { tenantAppPath, type AppAudience } from '../src/lib/pwa.js';

// Public metadata only: the same RPC already used by the customer page.
// Never use an administrative key to generate an install manifest.
export default { async fetch(request: Request) {
  const error = (message: string, status: number) => Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });
  if (request.method !== 'GET') return error('Method not allowed', 405);
  const query = new URL(request.url).searchParams;
  const slug = query.get('slug') || '';
  const audience = query.get('audience');
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(slug) || !['customer', 'professional'].includes(audience || '')) return error('Invalid app', 400);
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim().replace(/\/$/, '');
  const key = (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim();
  if (!url || !key) return error('App temporarily unavailable', 503);
  try {
    const response = await fetch(`${url}/rest/v1/rpc/get_public_tenant`, {
      method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_slug: slug }), signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return error('App temporarily unavailable', 502);
    const [tenant] = await response.json() as { id: string; name: string; is_active?: boolean }[];
    if (!tenant || tenant.is_active === false) return error('App not found', 404);
    const role = audience as AppAudience;
    const start = tenantAppPath(slug, role);
    return Response.json({
      id: `/apps/${tenant.id}/${role}`,
      name: `${tenant.name} · ${role === 'professional' ? 'Profissional' : 'Sua Vez'}`,
      short_name: (role === 'professional' ? `${tenant.name} Pro` : tenant.name).slice(0, 24),
      description: role === 'professional' ? `Painel profissional de ${tenant.name}` : `Agendamentos e fila de ${tenant.name}`,
      start_url: start, scope: start, display: 'standalone', lang: 'pt-BR',
      background_color: '#f5f1e8', theme_color: '#173f32',
      icons: [192, 512].flatMap(size => [
        { src: `/icons/suavez-v2-${size}.png`, sizes: `${size}x${size}`, type: 'image/png', purpose: 'any' },
        { src: `/icons/suavez-v2-maskable-${size}.png`, sizes: `${size}x${size}`, type: 'image/png', purpose: 'maskable' },
      ]),
    }, { headers: { 'Content-Type': 'application/manifest+json; charset=utf-8', 'Cache-Control': 'public, max-age=0, must-revalidate', 'X-Content-Type-Options': 'nosniff' } });
  } catch { return error('App temporarily unavailable', 502); }
} };

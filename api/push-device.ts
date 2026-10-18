/// <reference types="node" />
import { verifyStaff } from './_lib/auth.js';
import { tenantAppPath } from '../src/lib/pwa.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const testLimits = new Map<string, number>();
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });

export default { async fetch(request: Request) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const origin = new URL(request.url).origin;
  if (request.headers.get('origin') !== origin) return json({ error: 'Origin not allowed' }, 403);
  let body: { tenantId?: string; subscriptionId?: string; action?: string };
  try {
    const text = await request.text();
    if (text.length > 1024) return json({ error: 'Payload too large' }, 413);
    body = JSON.parse(text);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Invalid request' }, 400);
  } catch { return json({ error: 'Invalid request' }, 400); }
  const { tenantId = '', subscriptionId = '', action } = body;
  if (typeof tenantId !== 'string' || typeof subscriptionId !== 'string' || typeof action !== 'string' || !uuid.test(tenantId) || !uuid.test(subscriptionId) || !['status', 'test'].includes(action)) return json({ error: 'Invalid device' }, 400);
  if (!await verifyStaff(request, tenantId)) return json({ error: 'Unauthorized' }, 401);
  const appId = (process.env.ONESIGNAL_APP_ID || process.env.VITE_ONESIGNAL_APP_ID)?.trim();
  const key = process.env.ONESIGNAL_REST_API_KEY?.trim();
  if (!appId || !key) return json({ error: 'Push provider is not configured' }, 503);
  try {
    // Only inspect the authenticated establishment's user. Never return its other devices or tokens.
    const response = await fetch(`https://api.onesignal.com/apps/${encodeURIComponent(appId)}/users/by/external_id/admin_${tenantId}`, {
      headers: { Authorization: `Key ${key}` }, signal: AbortSignal.timeout(8000),
    });
    if (response.status === 404) return json({ registered: false, reason: 'not-linked' });
    if (!response.ok) return json({ error: 'Could not verify device' }, 502);
    const user = await response.json() as { subscriptions?: { id: string; type?: string; enabled?: boolean; notification_types?: number }[] };
    const subscription = user.subscriptions?.find(item => item.id === subscriptionId);
    if (!subscription) return json({ registered: false, reason: 'not-linked' });
    if (!subscription.enabled || subscription.notification_types !== 1 || !['ChromePush', 'FirefoxPush', 'SafariPush'].includes(subscription.type || '')) return json({ registered: false, reason: 'not-subscribed' });
    if (action === 'status') return json({ registered: true });

    // An explicit test is restricted to this verified device, with a cooldown.
    const limitKey = `${tenantId}:${subscriptionId}`;
    const now = Date.now();
    if ((testLimits.get(limitKey) || 0) > now) return json({ error: 'Wait before another test' }, 429);
    testLimits.set(limitKey, now + 30000);
    if (testLimits.size > 1000) for (const [id, until] of testLimits) if (until <= now) testLimits.delete(id);
    const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim().replace(/\/$/, '');
    const publicKey = (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim();
    const tenantResponse = await fetch(`${url}/rest/v1/tenants?id=eq.${tenantId}&select=slug`, {
      headers: { apikey: publicKey, Authorization: request.headers.get('authorization')! }, signal: AbortSignal.timeout(8000),
    });
    if (!tenantResponse.ok) return json({ error: 'Could not load establishment' }, 502);
    const [tenant] = await tenantResponse.json() as { slug: string }[];
    if (!tenant) return json({ error: 'Establishment not found' }, 404);
    const sent = await fetch('https://api.onesignal.com/notifications?c=push', {
      method: 'POST', headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: appId, include_subscription_ids: [subscriptionId],
        name: 'suavez_device_test', headings: { en: 'Teste de notificações', pt: 'Teste de notificações' },
        contents: { en: 'Este aparelho recebeu o aviso de teste do seu painel profissional.', pt: 'Este aparelho recebeu o aviso de teste do seu painel profissional.' },
        web_url: origin + tenantAppPath(tenant.slug, 'professional'),
        chrome_web_icon: `${origin}/logo_suavez.png`, ttl: 300, idempotency_key: crypto.randomUUID(),
      }), signal: AbortSignal.timeout(10000),
    });
    const result = await sent.json() as { id?: string };
    if (!sent.ok || !result.id) return json({ error: 'Could not send test' }, 502);
    // Accepted by the provider is not confirmation that Android displayed it.
    return json({ registered: true, sent: true });
  } catch { return json({ error: 'Could not contact push provider' }, 502); }
} };

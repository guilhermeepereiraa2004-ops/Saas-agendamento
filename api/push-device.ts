/// <reference types="node" />
import { createHash, timingSafeEqual } from 'node:crypto';
import { verifyStaff, serverRpc } from './_lib/auth.js';
import { tenantAppPath } from '../src/lib/pwa.js';
import { pushOrigin } from './_lib/push-origin.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const testLimits = new Map<string, number>();
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
type Subscription = { id: string; type?: string; token?: string; enabled?: boolean; notification_types?: number };

export default { async fetch(request: Request) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const origin = new URL(request.url).origin;
  if (request.headers.get('origin') !== origin) return json({ error: 'Origin not allowed' }, 403);
  let body: { tenantId?: string; subscriptionId?: string; subscriptionToken?: string; action?: string; queueItemId?: string; customerToken?: string };
  try {
    const text = await request.text();
    if (text.length > 12000) return json({ error: 'Payload too large' }, 413);
    body = JSON.parse(text);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Invalid request' }, 400);
  } catch { return json({ error: 'Invalid request' }, 400); }
  const { tenantId = '', subscriptionId = '', subscriptionToken = '', action } = body;
  if (typeof tenantId !== 'string' || typeof subscriptionId !== 'string' || typeof action !== 'string' || !uuid.test(tenantId) || !uuid.test(subscriptionId) || !['status','test','unregister','customer-status'].includes(action)) return json({ error: 'Invalid device' }, 400);
  const canonicalOrigin = pushOrigin(request);
  if (action !== 'unregister' && origin !== canonicalOrigin) return json({ error: 'Open the current site to enable notifications', reason: 'obsolete-origin', origin: canonicalOrigin }, 409);
  const staff = action === 'customer-status' ? null : await verifyStaff(request, tenantId);
  if (action !== 'customer-status' && !staff?.sessionId) return json({ error: 'Unauthorized' }, 401);
  const parameters = { p_tenant_id: tenantId, p_subscription_id: subscriptionId, p_user_id: staff?.userId, p_session_id: staff?.sessionId };
  try {
    if (action === 'customer-status') {
      if (typeof body.queueItemId !== 'string' || !uuid.test(body.queueItemId) || typeof body.customerToken !== 'string' || body.customerToken.length < 32 || body.customerToken.length > 128) return json({ error: 'Unauthorized' }, 401);
      if (!await serverRpc<boolean>('verify_customer_queue_access', { p_queue_id: body.queueItemId, p_tenant_id: tenantId, p_token: body.customerToken })) return json({ error: 'Unauthorized' }, 401);
    }
    if (action === 'unregister') {
      await serverRpc('professional_push_device', { ...parameters, p_action: 'unregister' });
      return json({ registered: false });
    }
    if (typeof subscriptionToken !== 'string' || !subscriptionToken || subscriptionToken.length > 8192) return json({ registered: false, reason: 'proof-required' });
    const appId = (process.env.ONESIGNAL_APP_ID || process.env.VITE_ONESIGNAL_APP_ID)?.trim();
    const key = process.env.ONESIGNAL_REST_API_KEY?.trim();
    if (!appId || !key) return json({ error: 'Push provider is not configured' }, 503);
    const providerGet = (path: string) => fetch(`https://api.onesignal.com/apps/${encodeURIComponent(appId)}${path}`, {
      headers: { Authorization: `Key ${key}` }, signal: AbortSignal.timeout(8000),
    });
    const identityResponse = await providerGet(`/subscriptions/${subscriptionId}/user/identity`);
    if (identityResponse.status === 404) return json({ registered: false, reason: 'not-linked' });
    if (!identityResponse.ok) return json({ error: 'Could not verify device' }, 502);
    const identity = await identityResponse.json() as { identity?: { onesignal_id?: string }; onesignal_id?: string };
    const providerUserId = identity.identity?.onesignal_id || identity.onesignal_id;
    if (!providerUserId || !uuid.test(providerUserId)) return json({ registered: false, reason: 'not-linked' });
    const response = await providerGet(`/users/by/onesignal_id/${providerUserId}`);
    if (!response.ok) return json({ error: 'Could not verify device' }, 502);
    const user = await response.json() as { subscriptions?: Subscription[] };
    const subscription = user.subscriptions?.find(item => item.id === subscriptionId);
    if (!subscription?.token) return json({ registered: false, reason: 'not-linked' });
    const actual = createHash('sha256').update(subscription.token).digest();
    const supplied = createHash('sha256').update(subscriptionToken).digest();
    if (!timingSafeEqual(actual, supplied)) return json({ registered: false, reason: 'invalid-proof' });
    if (!subscription.enabled || subscription.notification_types !== 1 || !['ChromePush','FirefoxPush','SafariPush'].includes(subscription.type || '')) return json({ registered: false, reason: 'not-subscribed' });
    if (action !== 'customer-status') {
      const registered = await serverRpc<boolean>('professional_push_device', { ...parameters, p_action: 'register', p_token_hash: supplied.toString('hex') });
      if (!registered) return json({ registered: false, reason: 'not-linked' });
    }
    const originRegistered = await serverRpc<boolean>('register_push_subscription_origin', { p_subscription_id: subscriptionId, p_app_id: appId, p_origin: canonicalOrigin });
    if (!originRegistered) return json({ registered: false, reason: 'obsolete-origin' });
    if (action === 'status' || action === 'customer-status') return json({ registered: true });
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
    return json({ registered: true, sent: true });
  } catch { return json({ error: 'Could not verify authorized device' }, 502); }
} };

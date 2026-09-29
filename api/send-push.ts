type PushEventName =
  | 'client_joined'
  | 'client_called'
  | 'client_on_way'
  | 'service_started'
  | 'appointment_approved'
  | 'appointment_rejected';

type QueueRecord = {
  id: string;
  name: string;
  service_name: string;
  status: string;
  is_on_way: boolean;
  push_id: string | null;
  appointment_time: string | null;
};

type TenantRecord = {
  id: string;
  name: string;
  slug: string;
};

type EventMessage = {
  title: string;
  message: string;
  target: { subscriptionId: string } | { externalId: string };
  actionLabel: string;
};

const allowedEvents = new Set<PushEventName>([
  'client_joined',
  'client_called',
  'client_on_way',
  'service_started',
  'appointment_approved',
  'appointment_rejected',
]);

const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function isSameOriginRequest(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;

  const requestOrigin = new URL(request.url).origin;
  const configuredOrigin = process.env.APP_ORIGIN?.replace(/\/$/, '');
  const allowedOrigin = origin === requestOrigin || origin === configuredOrigin;
  const fetchSite = request.headers.get('sec-fetch-site');
  return allowedOrigin && (!fetchSite || fetchSite === 'same-origin' || fetchSite === 'same-site');
}

function withinRateLimit(request: Request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (bucket.count >= 24) return false;
  bucket.count += 1;
  return true;
}

async function stableUuid(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function getSupabaseRow<T>(path: string): Promise<T | null> {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) throw new Error('Supabase server environment is not configured');

  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      Accept: 'application/json',
    },
  });
  if (!response.ok) throw new Error(`Supabase lookup failed (${response.status})`);
  const rows = await response.json() as T[];
  return rows[0] || null;
}

function buildMessage(event: PushEventName, item: QueueRecord, tenant: TenantRecord): EventMessage | null {
  const clientTarget = item.push_id ? { subscriptionId: item.push_id } : null;
  // Um External ID reúne as assinaturas do mesmo profissional no celular e no desktop.
  const adminTarget = { externalId: `admin_${tenant.id}` };

  if (event === 'client_joined' && adminTarget && ['waiting', 'pending'].includes(item.status)) {
    const scheduled = Boolean(item.appointment_time);
    return {
      title: scheduled ? 'Novo agendamento solicitado' : 'Novo cliente na fila',
      message: `${item.name} solicitou ${item.service_name}.`,
      target: adminTarget,
      actionLabel: 'Abrir painel',
    };
  }
  if (event === 'client_on_way' && adminTarget && item.is_on_way && ['waiting', 'ready'].includes(item.status)) {
    return {
      title: 'Cliente a caminho',
      message: `${item.name} confirmou que já está a caminho.`,
      target: adminTarget,
      actionLabel: 'Ver fila',
    };
  }
  if (!clientTarget) return null;
  if (event === 'client_called' && item.status === 'ready') {
    return { title: 'Sua vez está chegando', message: `Olá, ${item.name}. Aproxime-se: seu atendimento começa em instantes.`, target: clientTarget, actionLabel: 'Acompanhar' };
  }
  if (event === 'service_started' && item.status === 'serving') {
    return { title: 'Atendimento iniciado', message: `Olá, ${item.name}. Seu atendimento de ${item.service_name} começou.`, target: clientTarget, actionLabel: 'Ver atendimento' };
  }
  if (event === 'appointment_approved' && item.status === 'waiting' && item.appointment_time) {
    return { title: 'Agendamento confirmado', message: `Olá, ${item.name}. Seu horário para ${item.service_name} foi confirmado.`, target: clientTarget, actionLabel: 'Ver agendamento' };
  }
  if (event === 'appointment_rejected' && item.status === 'cancelled' && item.appointment_time) {
    return { title: 'Agendamento não confirmado', message: `Olá, ${item.name}. O horário solicitado para ${item.service_name} não pôde ser confirmado.`, target: clientTarget, actionLabel: 'Ver opções' };
  }
  return null;
}

export default {
  async fetch(request: Request) {
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    if (!isSameOriginRequest(request)) return json({ error: 'Origin not allowed' }, 403);
    if (!withinRateLimit(request)) return json({ error: 'Too many requests' }, 429);

    const contentLength = Number(request.headers.get('content-length') || 0);
    if (contentLength > 4096) return json({ error: 'Payload too large' }, 413);

    let body: { event?: string; tenantId?: string; queueItemId?: string };
    try {
      const rawBody = await request.text();
      if (rawBody.length > 4096) return json({ error: 'Payload too large' }, 413);
      body = JSON.parse(rawBody) as typeof body;
    } catch {
      return json({ error: 'Invalid JSON' }, 400);
    }

    const event = body.event as PushEventName;
    const tenantId = body.tenantId || '';
    const queueItemId = body.queueItemId || '';
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!allowedEvents.has(event) || !uuidPattern.test(tenantId) || !uuidPattern.test(queueItemId)) {
      return json({ error: 'Invalid notification event' }, 400);
    }

    try {
      const itemQuery = `queue_items?id=eq.${encodeURIComponent(queueItemId)}&tenant_id=eq.${encodeURIComponent(tenantId)}&select=id,name,service_name,status,is_on_way,push_id,appointment_time`;
      const tenantQuery = `tenants?id=eq.${encodeURIComponent(tenantId)}&select=id,name,slug`;
      const [item, tenant] = await Promise.all([
        getSupabaseRow<QueueRecord>(itemQuery),
        getSupabaseRow<TenantRecord>(tenantQuery),
      ]);

      if (!item || !tenant) return json({ error: 'Record not found' }, 404);
      const eventMessage = buildMessage(event, item, tenant);
      if (!eventMessage) return json({ skipped: true, reason: 'Event state or subscription is not eligible' }, 202);

      const appId = process.env.ONESIGNAL_APP_ID || process.env.VITE_ONESIGNAL_APP_ID;
      // Compatibilidade temporária com projetos que ainda cadastraram a chave com o
      // prefixo antigo. A chave nunca é importada pelo bundle do navegador.
      const restApiKey = process.env.ONESIGNAL_REST_API_KEY || process.env.VITE_ONESIGNAL_REST_API_KEY;
      if (!appId || !restApiKey) return json({ error: 'Push provider is not configured' }, 503);

      const appOrigin = process.env.APP_ORIGIN?.replace(/\/$/, '') || new URL(request.url).origin;
      const destinationUrl = `${appOrigin}/${tenant.slug}`;
      const targetIdentity = 'subscriptionId' in eventMessage.target
        ? eventMessage.target.subscriptionId
        : eventMessage.target.externalId;
      const idempotencyKey = await stableUuid(`${event}:${tenantId}:${queueItemId}:${targetIdentity}`);
      const target = 'subscriptionId' in eventMessage.target
        ? { include_subscription_ids: [eventMessage.target.subscriptionId] }
        : { include_aliases: { external_id: [eventMessage.target.externalId] }, target_channel: 'push' };

      const oneSignalResponse = await fetch('https://api.onesignal.com/notifications?c=push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Key ${restApiKey}`,
        },
        body: JSON.stringify({
          app_id: appId,
          ...target,
          name: `suavez_${event}`,
          headings: { en: eventMessage.title, pt: eventMessage.title },
          contents: { en: eventMessage.message, pt: eventMessage.message },
          web_url: destinationUrl,
          chrome_web_icon: `${appOrigin}/logo_suavez.png`,
          chrome_web_badge: `${appOrigin}/suavez-mark.svg`,
          web_buttons: [{ id: 'open', text: eventMessage.actionLabel, url: destinationUrl }],
          priority: 10,
          ttl: 900,
          idempotency_key: idempotencyKey,
          custom_data: { event, queue_item_id: queueItemId, tenant_id: tenantId },
        }),
      });

      const providerResult = await oneSignalResponse.json().catch(() => ({}));
      if (!oneSignalResponse.ok) {
        console.error('OneSignal send failed', { status: oneSignalResponse.status, event, queueItemId });
        return json({ error: 'Push provider rejected the notification' }, 502);
      }

      if (!providerResult.id) {
        return json({ sent: false, skipped: true, reason: 'No eligible push subscription' }, 202);
      }

      return json({ sent: true, notificationId: providerResult.id });
    } catch (error) {
      console.error('Push function failed', error instanceof Error ? error.message : error);
      return json({ error: 'Could not send notification' }, 500);
    }
  },
};

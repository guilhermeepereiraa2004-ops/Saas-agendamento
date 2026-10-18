import { authorizationHeaders } from './access';

export async function professionalPushDevice(tenantId: string, subscriptionId: string, action: 'status' | 'test' = 'status', signal?: AbortSignal) {
  const headers = { 'Content-Type': 'application/json', ...await authorizationHeaders() };
  signal?.throwIfAborted();
  const timeout = AbortSignal.timeout(action === 'test' ? 40000 : 28000);
  const response = await fetch('/api/push-device', {
    method: 'POST', headers,
    body: JSON.stringify({ tenantId, subscriptionId, action }), signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (response.status === 429) throw new Error('Aguarde 30 segundos antes de enviar outro teste.');
  if (!response.ok) throw new Error('Não foi possível conferir o vínculo deste aparelho. Confira sua conexão e tente novamente.');
  return response.json() as Promise<{ registered: boolean; reason?: 'not-linked' | 'not-subscribed'; sent?: boolean }>;
}

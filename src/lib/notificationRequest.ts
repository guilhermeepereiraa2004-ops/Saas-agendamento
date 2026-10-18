import type { NotificationStatus } from './notificationStatus';

export type NotificationFailureReason = 'sdk-timeout' | 'permission-timeout' | 'subscription-timeout' | 'initialization' | 'request-error' | 'origin-mismatch' | 'unconfigured' | 'insecure-origin' | 'blocked' | 'unsupported' | 'dismissed' | 'service-worker' | 'network';
export type NotificationPermissionResult = { id: string; status: 'enabled'; message?: never }
  | { id: null; status: Exclude<NotificationStatus, 'checking' | 'enabled'>; reason: NotificationFailureReason; message: string };

export function notificationFailure(reason: NotificationFailureReason, local = false): Extract<NotificationPermissionResult, { id: null }> {
  const messages: Record<NotificationFailureReason, string> = {
    'sdk-timeout': 'O serviço de avisos não respondeu. Confira a conexão ou se o navegador está bloqueando o OneSignal e tente novamente.',
    'permission-timeout': 'O navegador não respondeu ao pedido de permissão. Confira se há um pedido junto à barra de endereço. Responda por lá ou tente novamente.',
    'subscription-timeout': 'A permissão foi aceita, mas a inscrição de notificações não terminou. Confira sua conexão e tente novamente.',
    initialization: 'O serviço de avisos não conseguiu iniciar. Recarregue a página e tente novamente.',
    'request-error': 'Não foi possível concluir o pedido de notificações. Recarregue a página e tente novamente.',
    'origin-mismatch': local ? 'O OneSignal está configurado para outro endereço. Para testar no localhost, use um app OneSignal de testes com a mesma URL e porta locais.' : 'O serviço de avisos está configurado para outro endereço. Entre em contato com o suporte para conferir o domínio do site.',
    unconfigured: 'Os avisos não estão configurados neste ambiente. Entre em contato com o suporte.',
    'insecure-origin': 'Este endereço não permite notificações. Abra o site por HTTPS ou use localhost no computador para testar.',
    blocked: 'As notificações estão bloqueadas. Libere-as nas configurações do site no navegador e tente novamente.',
    unsupported: 'Este navegador não oferece suporte aos avisos. No iPhone ou iPad, adicione o site à Tela de Início e abra pelo ícone; em outros aparelhos, use um navegador compatível.',
    dismissed: 'A permissão não foi concedida. Você pode aceitar as notificações quando quiser.',
    'service-worker': 'Não foi possível preparar as notificações neste navegador. Recarregue a página e tente novamente; se continuar, entre em contato com o suporte.',
    network: 'A conexão com o serviço de avisos falhou. Confira sua internet e tente novamente.',
  };
  return { id: null, reason, status: reason === 'blocked' ? 'blocked' : reason === 'unsupported' || reason === 'insecure-origin' ? 'unsupported' : reason === 'dismissed' ? 'prompt' : 'unavailable', message: messages[reason] };
}

export function classifyNotificationError(error: unknown, fallback: NotificationFailureReason = 'request-error'): NotificationFailureReason {
  const message = error instanceof Error ? error.message : String(error);
  if (/can only be used on|origin.*(?:match|invalid)|(?:domain|site url).*match/i.test(message)) return 'origin-mismatch';
  if (/service.?worker|unsupported mime|bad http response/i.test(message)) return 'service-worker';
  if (/failed to fetch|network|ERR_CONNECTION|ERR_NAME_NOT_RESOLVED/i.test(message)) return 'network';
  return fallback;
}

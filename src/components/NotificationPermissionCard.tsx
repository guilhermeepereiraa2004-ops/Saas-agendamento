import type { NotificationStatus } from '../lib/notificationStatus';

type Props = {
  status: NotificationStatus;
  busy: boolean;
  audience: 'professional' | 'customer';
  onAccept: () => void;
  error?: string;
};

export function NotificationPermissionCard({ status, busy, audience, onAccept, error }: Props) {
  if (status === 'checking' || status === 'enabled') return null;
  const blocked = status === 'blocked';
  const unsupported = status === 'unsupported';
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
  return (
    <section className={`notification-permission-card is-${status}`} aria-label="Permissão de notificações" role={blocked ? 'alert' : 'status'}>
      <span className="notification-permission-icon" aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M10 21h4"/>{blocked && <path d="m3 3 18 18"/>}</svg>
      </span>
      <div className="notification-permission-copy">
        <strong>{blocked ? 'As notificações estão bloqueadas' : unsupported ? 'Avisos indisponíveis neste navegador' : status === 'unavailable' ? 'Não foi possível conectar os avisos' : 'Você ainda não recebe avisos neste aparelho'}</strong>
        <p role={error && !busy && !blocked ? 'alert' : undefined}>{error && !busy ? error : blocked ? 'Permita as notificações nas configurações do site para receber os avisos.' : unsupported ? ios ? 'No iPhone ou iPad, adicione este site à Tela de Início e abra pelo ícone para ativar os avisos.' : 'Abra este site em um navegador com suporte a notificações, como Chrome ou Edge.' : status === 'unavailable' ? 'Confira sua conexão e tente novamente. O painel continua disponível.' : audience === 'professional' ? 'Ative para saber quando um cliente entra na fila ou solicita um agendamento.' : 'Ative para receber a chamada e as atualizações do seu atendimento.'}</p>
        {blocked && <details><summary>Como permitir as notificações</summary><p>Toque no ícone ao lado do endereço do site. Abra as permissões do site, escolha Notificações e selecione Permitir. Depois volte ao painel; o status será verificado novamente.</p></details>}
      </div>
      {!blocked && !unsupported && <button type="button" className="notification-permission-accept" onClick={onAccept} disabled={busy} aria-busy={busy}>{busy ? 'Aguardando permissão…' : status === 'unavailable' ? 'Tentar novamente' : 'Aceitar notificações'}<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg></button>}
    </section>
  );
}

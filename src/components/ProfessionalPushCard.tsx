import type { useProfessionalPush } from '../lib/useProfessionalPush';

export function ProfessionalPushCard({ push, settings = false }: { push: ReturnType<typeof useProfessionalPush>; settings?: boolean }) {
  if (!settings && push.state !== 'error') return null;
  return <section className="notification-permission-card" aria-label="Avisos deste aparelho">
    <div className="notification-permission-copy">
      <strong>{push.state === 'verified' ? 'Aparelho vinculado aos avisos profissionais' : push.state === 'checking' ? 'Conferindo os avisos deste aparelho…' : 'Confira os avisos deste aparelho'}</strong>
      <p role={push.message ? 'status' : undefined}>{push.message || 'Confira o vínculo com seu painel e envie um teste somente para este aparelho.'}</p>
    </div>
    <button type="button" className="notification-permission-accept" disabled={push.testing || push.state === 'checking'} onClick={() => void (push.state === 'verified' ? push.sendTest() : push.reconnect())}>
      {push.testing ? 'Enviando teste…' : push.state === 'checking' ? 'Conferindo…' : push.state === 'verified' ? 'Enviar teste neste aparelho' : 'Reconectar avisos'}
    </button>
  </section>;
}

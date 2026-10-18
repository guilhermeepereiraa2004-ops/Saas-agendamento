import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import type { Tenant } from '../types';
import { tenantAppPath, type AppAudience } from '../lib/pwa';
import { installState, isAppleMobile, standaloneApp } from '../lib/pwaInstall';
import './InstallAppCard.css';

export function InstallAppCard({ tenant, audience }: { tenant: Tenant; audience: AppAudience }) {
  const status = useSyncExternalStore(installState.subscribe, installState.snapshot);
  const [standalone, setStandalone] = useState(standaloneApp);
  const [open, setOpen] = useState(() => new URLSearchParams(location.search).get('instalar') === '1');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const inFlight = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const target = tenantAppPath(tenant.slug, audience);
  const canonical = location.pathname === target || `${location.pathname}/` === target;
  const apple = isAppleMobile();
  const android = /Android/i.test(navigator.userAgent);
  const embedded = /Instagram|FBAN|FBAV|Line\//i.test(navigator.userAgent);
  const iosSafari = apple && /Safari/.test(navigator.userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo|Instagram|FBAN|FBAV/.test(navigator.userAgent);

  useEffect(() => {
    const media = matchMedia('(display-mode: standalone)');
    const refresh = () => setStandalone(standaloneApp());
    media.addEventListener('change', refresh);
    window.addEventListener('pageshow', refresh);
    return () => { media.removeEventListener('change', refresh); window.removeEventListener('pageshow', refresh); };
  }, []);

  useEffect(() => {
    const element = dialog.current;
    if (open && element && !element.open) element.showModal();
    if (!open && element?.open) element.close();
    if (open && new URLSearchParams(location.search).has('instalar')) {
      const url = new URL(location.href); url.searchParams.delete('instalar');
      history.replaceState(history.state, '', url);
    }
  }, [open]);

  const requestInstall = async () => {
    if (inFlight.current) return;
    setOpen(true);
    if (!canonical || status !== 'ready') return;
    inFlight.current = true; setBusy(true); setMessage('');
    try {
      const result = await installState.request();
      if (result === 'dismissed') setMessage('Você pode instalar quando quiser pelo menu do navegador.');
    } catch { setMessage('Não foi possível abrir a instalação. Tente pelo menu do navegador.'); }
    finally { inFlight.current = false; setBusy(false); }
  };

  if (standalone) return null;
  return <section className="install-app-card" aria-label={audience === 'professional' ? 'Aplicativo profissional' : 'Aplicativo do cliente'}>
    <img src="/icons/suavez-v2-192.png" alt="" width="44" height="44" />
    <div className="install-app-copy">
      <strong>{audience === 'professional' ? 'Seu painel sempre à mão' : 'Seu atendimento a um toque'}</strong>
      <p>{status === 'requested' && canonical ? 'Instalação solicitada. Aguarde o celular finalizar; isso pode levar alguns instantes.' : audience === 'professional' ? 'Abra direto no painel de ' + tenant.name + '.' : 'Adicione o app de ' + tenant.name + ' ao seu celular.'}</p>
    </div>
    {status === 'requested' && canonical ? <button type="button" onClick={() => setOpen(true)}>Ver orientação</button> : canonical
      ? <button type="button" onClick={() => void requestInstall()} disabled={busy}>{busy ? 'Aguardando…' : audience === 'professional' ? 'Instalar app profissional' : 'Instalar app'}</button>
      : <a href={`${target}?instalar=1`}>{audience === 'professional' ? 'Instalar app profissional' : 'Instalar app'}</a>}
    <dialog ref={dialog} className="install-app-dialog" aria-labelledby={titleId} onCancel={() => setOpen(false)} onClose={() => setOpen(false)}>
      <button type="button" className="install-app-close" aria-label="Fechar orientação de instalação" onClick={() => setOpen(false)}>×</button>
      <img src="/icons/suavez-v2-192.png" width="56" height="56" alt="" />
      <span className="install-app-eyebrow">{audience === 'professional' ? 'App profissional' : 'App do cliente'}</span>
      <h2 id={titleId}>{tenant.name} no seu celular</h2>
      <p>{audience === 'professional' ? 'O ícone abre o painel deste estabelecimento. Sua conta profissional continua protegida por login.' : 'O ícone abre os agendamentos e a fila deste estabelecimento.'}</p>
      {status === 'requested' && canonical ? <div className="install-app-notice" role="status">Pedido enviado ao navegador. Aguarde a instalação terminar e procure o ícone no celular. No Android, confira também Configurações → Aplicativos.</div> : apple ? <>
        {!iosSafari && <div className="install-app-notice">Para seguir estas instruções, abra este endereço no Safari.</div>}
        <ol><li>No Safari, toque em <strong>Compartilhar</strong> (quadrado com seta para cima). Dependendo da versão, ele fica no menu do navegador.</li><li>Escolha <strong>Adicionar à Tela de Início</strong>. Se não aparecer, procure em <strong>Editar Ações</strong>.</li><li>Se aparecer <strong>Abrir como App da Web</strong>, mantenha ativado e toque em <strong>Adicionar</strong>.</li><li>Abra o app pelo novo ícone na Tela de Início.</li></ol>
      </> : <>
        {embedded && <div className="install-app-notice">Abra este endereço no Chrome ou Safari, fora do navegador do aplicativo.</div>}
        <ol><li>{android ? <>No Chrome, abra o menu <strong>⋮</strong>.</> : <>Abra o menu do Chrome ou Edge.</>}</li><li>Escolha <strong>Instalar e criar atalho → Instalar</strong>, ou <strong>Instalar app</strong>, conforme o navegador.</li><li>Confirme e aguarde a instalação terminar. No Android, o app também deve aparecer na lista de aplicativos.</li></ol>
        {status === 'ready' && canonical && <button type="button" className="install-app-primary" onClick={() => void requestInstall()} disabled={busy}>{busy ? 'Aguardando confirmação…' : 'Instalar agora'}</button>}
      </>}
      {message && <p role="status" className="install-app-notice">{message}</p>}
      <p className="install-app-footnote">Instalar o app não ativa as notificações automaticamente. Você poderá aceitá-las dentro dele.</p>
      <button type="button" className="install-app-done" onClick={() => setOpen(false)}>Entendi</button>
    </dialog>
  </section>;
}

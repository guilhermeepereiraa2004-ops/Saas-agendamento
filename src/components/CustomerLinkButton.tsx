import { useId, useRef } from 'react';
import { tenantAppPath } from '../lib/pwa';
import { useToasts } from '../lib/toast';

export function CustomerLinkButton({ slug }: { slug: string }) {
  const { showToast } = useToasts();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const customerUrl = new URL(tenantAppPath(slug, 'customer'), window.location.origin).href;

  async function copyCustomerLink() {
    try {
      await navigator.clipboard.writeText(customerUrl);
      showToast('Link do cliente copiado! Agora é só colar e enviar.', 'success');
    } catch {
      dialogRef.current?.showModal();
      inputRef.current?.select();
    }
  }

  return (
    <>
      <button ref={buttonRef} type="button" className="admin-customer-link-button" onClick={copyCustomerLink} aria-label="Copiar link do cliente" title="Copiar link da página do cliente">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.1 0l3-3a5 5 0 0 0-7.1-7.1l-1.7 1.7M14 11a5 5 0 0 0-7.1 0l-3 3a5 5 0 0 0 7.1 7.1l1.7-1.7"/></svg>
        <span>Link do cliente</span>
      </button>
      <dialog ref={dialogRef} className="admin-customer-link-dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-help`} onClose={() => buttonRef.current?.focus({ preventScroll: true })}>
        <h2 id={`${id}-title`}>Envie seu link ao cliente</h2>
        <p id={`${id}-help`}>O navegador não permitiu copiar automaticamente. O link está selecionado: toque e segure para copiar ou use a opção Copiar do seu aparelho.</p>
        <label htmlFor={`${id}-url`}>Link da página do cliente</label>
        <input ref={inputRef} id={`${id}-url`} type="url" value={customerUrl} readOnly spellCheck={false} onClick={event => event.currentTarget.select()} />
        <form method="dialog"><button type="submit">Fechar</button></form>
      </dialog>
    </>
  );
}

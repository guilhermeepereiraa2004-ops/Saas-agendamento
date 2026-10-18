import { useCallback, useEffect, useRef, useState } from 'react';
import { getOneSignalId, loginOneSignal } from './oneSignal';
import { professionalPushDevice } from './professionalPush';

export function useProfessionalPush(tenantId: string, active: boolean, enabled: boolean) {
  const [state, setState] = useState<'idle' | 'checking' | 'verified' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [testing, setTesting] = useState(false);
  const revision = useRef(0);
  const pending = useRef<Promise<boolean> | null>(null);
  const subscription = useRef<string | null>(null);
  const invalidate = useCallback(() => { revision.current++; pending.current = null; }, []);

  const reconnect = useCallback((): Promise<boolean> => {
    if (!active) return Promise.resolve(false);
    if (pending.current) return pending.current;
    const current = revision.current;
    setState('checking'); setMessage('');
    const check = async () => {
      try {
        const identified = await loginOneSignal(`admin_${tenantId}`);
        if (current !== revision.current) return false;
        const id = await getOneSignalId();
        if (current !== revision.current) return false;
        subscription.current = id;
        if (!id) {
          if (enabled) throw new Error('A permissão está aceita, mas não foi possível recuperar a inscrição deste aparelho. Recarregue o app e tente reconectar os avisos.');
          setState('idle'); return false;
        }
        if (!identified) throw new Error('A permissão está aceita, mas não foi possível vincular este aparelho ao seu painel. Tente reconectar os avisos.');
        const result = await professionalPushDevice(tenantId, id);
        if (current !== revision.current) return false;
        if (!result.registered) throw new Error(result.reason === 'not-subscribed'
          ? 'O serviço de avisos não considera este aparelho inscrito. Confira as notificações do app e do Chrome nos ajustes do celular e tente reconectar.'
          : 'A permissão está aceita, mas este aparelho ainda não está vinculado ao profissional no serviço de avisos. Toque em reconectar.');
        setState('verified'); return true;
      } catch (error) {
        if (current === revision.current) {
          setState('error');
          setMessage(error instanceof Error ? error.message : 'Não foi possível conferir os avisos deste aparelho. Tente novamente.');
        }
        return false;
      }
    };
    const task = check().finally(() => { if (pending.current === task) pending.current = null; });
    pending.current = task;
    return task;
  }, [active, enabled, tenantId]);

  useEffect(() => {
    invalidate();
    if (!active) return;
    void reconnect();
    const visible = () => { if (document.visibilityState === 'visible') void reconnect(); };
    window.addEventListener('focus', visible);
    document.addEventListener('visibilitychange', visible);
    return () => {
      invalidate();
      window.removeEventListener('focus', visible);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [active, enabled, reconnect, invalidate]);

  const sendTest = async () => {
    if (testing || !active) return;
    setTesting(true); setMessage('');
    const current = revision.current;
    try {
      if (!subscription.current || state !== 'verified') { await reconnect(); return; }
      const result = await professionalPushDevice(tenantId, subscription.current, 'test');
      if (current !== revision.current) return;
      if (!result.registered || !result.sent) { setState('error'); setMessage('Este aparelho perdeu o vínculo com os avisos. Toque em reconectar.'); return; }
      setMessage('Teste enviado a este aparelho. Confira a notificação do Android ou iPhone. Se não aparecer, confira as notificações do app e do Chrome nos ajustes do celular.');
    } catch (error) {
      if (current === revision.current) setMessage(error instanceof Error ? error.message : 'Não foi possível enviar o teste.');
    } finally { setTesting(false); }
  };
  return { state, message, testing, reconnect, sendTest };
}

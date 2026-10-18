import { useCallback, useEffect, useRef, useState } from 'react';
import { getOneSignalId } from './oneSignal';
import { professionalPushDevice } from './professionalPush';

function pause(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}

export function useProfessionalPush(tenantId: string, active: boolean, enabled: boolean) {
  const [state, setState] = useState<'idle' | 'checking' | 'verified' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [testing, setTesting] = useState(false);
  const revision = useRef(0);
  const pending = useRef<Promise<boolean> | null>(null);
  const subscription = useRef<string | null>(null);
  const cancellation = useRef<AbortController | null>(null);
  const invalidate = useCallback(() => { revision.current++; cancellation.current?.abort(); pending.current = null; }, []);

  const reconnect = useCallback((): Promise<boolean> => {
    if (!active) return Promise.resolve(false);
    if (pending.current) return pending.current;
    const current = revision.current;
    const controller = new AbortController();
    cancellation.current = controller;
    setState('checking'); setMessage('');
    const deadline = setTimeout(() => {
      if (current !== revision.current || controller.signal.aborted) return;
      controller.abort();
      pending.current = null;
      setState('error');
      setMessage('Não foi possível recuperar automaticamente os avisos a tempo. Confira a conexão e tente reconectar.');
    }, 45000);
    const check = async () => {
      let lastError: unknown;
      // Identity and subscription creation can reach the provider after the page
      // becomes usable. Keep recovery silent while that synchronization finishes.
      for (const delay of [0, 2000, 6000]) {
        try {
          if (delay) await pause(delay, controller.signal);
          if (current !== revision.current || controller.signal.aborted) return false;
          const id = await getOneSignalId();
          if (current !== revision.current || controller.signal.aborted) return false;
          subscription.current = id;
          if (!id) {
            if (enabled) throw new Error('A permissão está aceita, mas não foi possível recuperar a inscrição deste aparelho. Recarregue o app e tente reconectar os avisos.');
            setState('idle'); return false;
          }
          const result = await professionalPushDevice(tenantId, id, 'status', controller.signal);
          if (current !== revision.current || controller.signal.aborted) return false;
          if (!result.registered) throw new Error(result.reason === 'not-subscribed'
            ? 'O serviço de avisos não considera este aparelho inscrito. Confira as notificações do app e do Chrome nos ajustes do celular e tente reconectar.'
            : 'Não foi possível restabelecer automaticamente o vínculo deste aparelho. Confira a conexão e tente reconectar os avisos.');
          setState('verified'); return true;
        } catch (error) {
          if (current !== revision.current || controller.signal.aborted) return false;
          lastError = error;
        }
      }
      setState('error');
      setMessage(lastError instanceof Error ? lastError.message : 'Não foi possível conferir os avisos deste aparelho. Tente novamente.');
      return false;
    };
    const task = check().finally(() => { clearTimeout(deadline); if (pending.current === task) pending.current = null; });
    pending.current = task;
    return task;
  }, [active, enabled, tenantId]);

  useEffect(() => {
    invalidate();
    if (!active) return;
    void reconnect();
    const visible = () => { if (document.visibilityState === 'visible') void reconnect(); };
    window.addEventListener('focus', visible);
    window.addEventListener('pageshow', visible);
    window.addEventListener('online', visible);
    document.addEventListener('visibilitychange', visible);
    return () => {
      invalidate();
      window.removeEventListener('focus', visible);
      window.removeEventListener('pageshow', visible);
      window.removeEventListener('online', visible);
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
  const unregister = async () => {
    invalidate();
    if (subscription.current) await professionalPushDevice(tenantId, subscription.current, 'unregister');
  };
  return { state, message, testing, reconnect, sendTest, unregister };
}

import { useState, useCallback, useEffect, useRef } from 'react';
import { ToastContext, type ToastType } from '../lib/toast';

interface Toast {
  id: number;
  message: string;
  type: ToastType;
  title?: string;
  url?: string;
  priority?: boolean;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const recentPriorityNotifications = useRef(new Map<string, number>());

  const dismissToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(toast => toast.id !== id));
  }, []);

  const enqueueToast = useCallback((toast: Omit<Toast, 'id'>, duration = 4000) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts(prev => [...prev, { ...toast, id }]);
    window.setTimeout(() => dismissToast(id), duration);
  }, [dismissToast]);

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    enqueueToast({ message, type });
  }, [enqueueToast]);

  useEffect(() => {
    const handlePriorityNotification = (event: Event) => {
      const detail = (event as CustomEvent<{ title?: string; message?: string; url?: string; key?: string }>).detail || {};
      const dedupeKey = detail.key || detail.message || detail.title || 'notification';
      const now = Date.now();
      const lastShownAt = recentPriorityNotifications.current.get(dedupeKey) || 0;
      if (now - lastShownAt < 5000) return;
      recentPriorityNotifications.current.set(dedupeKey, now);
      for (const [key, timestamp] of recentPriorityNotifications.current) {
        if (now - timestamp > 30000) recentPriorityNotifications.current.delete(key);
      }

      enqueueToast({
        title: detail.title || 'Nova atualização',
        message: detail.message || 'Você recebeu uma nova notificação.',
        url: detail.url,
        type: 'info',
        priority: true,
      }, 8500);

      if ('vibrate' in navigator) navigator.vibrate?.([180, 80, 180]);
    };

    window.addEventListener('suavez:notification', handlePriorityNotification);
    return () => window.removeEventListener('suavez:notification', handlePriorityNotification);
  }, [enqueueToast]);

  const normalToasts = toasts.filter(toast => !toast.priority);
  const priorityToasts = toasts.filter(toast => toast.priority);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}

      <div className="notification-popover-stack" aria-live="assertive" aria-atomic="true">
        {priorityToasts.map(toast => (
          <article key={toast.id} className="notification-popover" role="alert">
            <div className="notification-popover-icon" aria-hidden="true">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></svg>
            </div>
            <div className="notification-popover-copy">
              <span className="notification-popover-kicker">Agora no Sua Vez</span>
              <strong>{toast.title}</strong>
              <p>{toast.message}</p>
              {toast.url && (
                <button type="button" onClick={() => { window.location.href = toast.url!; }}>
                  Abrir atendimento
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
                </button>
              )}
            </div>
            <button type="button" className="notification-popover-close" onClick={() => dismissToast(toast.id)} aria-label="Fechar notificação">×</button>
          </article>
        ))}
      </div>

      <div className="toast-stack" aria-live="polite">
        {normalToasts.map(toast => (
          <div key={toast.id} className={`app-toast app-toast--${toast.type}`} role="status">
            <div className="app-toast-icon" aria-hidden="true">
              {toast.type === 'success' && <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>}
              {toast.type === 'error' && <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/></svg>}
              {toast.type === 'warning' && <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4m0 4h.01"/></svg>}
              {toast.type === 'info' && <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><path d="M12 11v5m0-8h.01"/></svg>}
            </div>
            <span>{toast.message}</span>
            <button type="button" onClick={() => dismissToast(toast.id)} aria-label="Fechar aviso">×</button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

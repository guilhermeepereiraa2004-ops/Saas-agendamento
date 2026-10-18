import { customerTokens } from './customerTokens';
import { playNotificationSound, unlockNotificationSound } from './notificationSound';
import { authorizationHeaders } from './access';
import { resolveNotificationStatus, type NotificationStatus } from './notificationStatus';

export type PushEventName =
  | 'client_joined'
  | 'client_called'
  | 'client_on_way'
  | 'service_started'
  | 'appointment_approved'
  | 'appointment_rejected';

export type PushSendResult = {
  sent: boolean;
  reason?: string;
  error?: string;
};

interface SubscriptionSnapshot {
  id?: string | null;
}

interface SubscriptionChangeEvent {
  current?: SubscriptionSnapshot;
}

interface ForegroundNotificationEvent {
  notification?: {
    title?: string;
    body?: string;
    launchURL?: string;
    display?: () => void;
  };
  preventDefault?: () => void;
}

interface OneSignalSubscription {
  id: string | null;
  token: string | null;
  optedIn: boolean;
  optIn: () => Promise<void>;
  addEventListener: (event: 'change', listener: (event: SubscriptionChangeEvent) => void) => void;
  removeEventListener: (event: 'change', listener: (event: SubscriptionChangeEvent) => void) => void;
}

interface OneSignalClient {
  init: (options: Record<string, unknown>) => Promise<void>;
  login: (externalId: string) => Promise<void>;
  logout: () => Promise<void>;
  Slidedown: {
    promptPush: () => Promise<void>;
  };
  Notifications: {
    permission: boolean;
    permissionNative?: NotificationPermission;
    isPushSupported: () => boolean;
    requestPermission: () => Promise<void>;
    addEventListener: {
      (event: 'permissionChange', listener: () => void): void;
      (event: 'foregroundWillDisplay', listener: (event: ForegroundNotificationEvent) => void): void;
    };
  };
  User: {
    PushSubscription: OneSignalSubscription;
  };
}

declare global {
  interface Window {
    OneSignalDeferred: Array<(oneSignal: OneSignalClient) => void | Promise<void>>;
    OneSignal: OneSignalClient;
    _oneSignalInitialized?: boolean;
    _oneSignalListenersRegistered?: boolean;
  }
}

type PushState = {
  permission: boolean;
  optedIn: boolean;
  id: string | null;
  token: string | null;
};

function getPushState(oneSignal: OneSignalClient): PushState {
  return {
    permission: Boolean(oneSignal.Notifications.permission),
    optedIn: Boolean(oneSignal.User.PushSubscription.optedIn),
    id: oneSignal.User.PushSubscription.id || null,
    token: oneSignal.User.PushSubscription.token || null,
  };
}

function publishPushState(oneSignal: OneSignalClient) {
  const detail = getPushState(oneSignal);
  const status = readNotificationStatus(oneSignal);
  window.dispatchEvent(new CustomEvent('suavez:push-state', {
    detail: { ...detail, status, enabled: status === 'enabled' },
  }));
}

function readNotificationStatus(oneSignal: OneSignalClient): NotificationStatus {
  return resolveNotificationStatus({
    ...getPushState(oneSignal),
    supported: oneSignal.Notifications.isPushSupported(),
    nativePermission: typeof Notification === 'undefined' ? undefined : Notification.permission,
  });
}

export function getNotificationStatus(): Promise<NotificationStatus> {
  return new Promise(resolve => {
    const fallback: NotificationStatus = typeof Notification === 'undefined' ? 'unsupported'
      : Notification.permission === 'denied' ? 'blocked' : 'unavailable';
    const timeout = window.setTimeout(() => resolve(fallback), 3500);
    window.OneSignalDeferred = window.OneSignalDeferred || [];
    window.OneSignalDeferred.push(oneSignal => {
      window.clearTimeout(timeout);
      try { resolve(readNotificationStatus(oneSignal)); } catch { resolve(fallback); }
    });
  });
}

function waitForSubscriptionId(oneSignal: OneSignalClient, timeoutMs = 12000): Promise<string | null> {
  const ready = () => readNotificationStatus(oneSignal) === 'enabled';
  const currentId = oneSignal.User.PushSubscription.id;
  if (currentId && ready()) return Promise.resolve(currentId);

  return new Promise(resolve => {
    let settled = false;
    const finish = (id: string | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      oneSignal.User.PushSubscription.removeEventListener('change', onChange);
      resolve(id);
    };
    const onChange = (event: SubscriptionChangeEvent) => {
      const id = event.current?.id || oneSignal.User.PushSubscription.id;
      if (id && ready()) finish(id);
    };
    const timeout = window.setTimeout(() => finish(ready() ? oneSignal.User.PushSubscription.id : null), timeoutMs);
    oneSignal.User.PushSubscription.addEventListener('change', onChange);
  });
}

export function initializeOneSignal() {
  const appId = import.meta.env.VITE_ONESIGNAL_APP_ID?.trim();

  if (!appId || appId === 'seu_app_id_do_onesignal_aqui') {
    console.warn('OneSignal: VITE_ONESIGNAL_APP_ID não configurado.');
    return;
  }

  if (window._oneSignalInitialized) return;
  window._oneSignalInitialized = true;
  const unlockSound = () => void unlockNotificationSound();
  window.addEventListener('pointerdown', unlockSound, { once: true, passive: true });
  window.addEventListener('keydown', unlockSound, { once: true });
  window.OneSignalDeferred = window.OneSignalDeferred || [];

  window.OneSignalDeferred.push(async oneSignal => {
    try {
      await oneSignal.init({
        appId,
        allowLocalhostAsSecureOrigin: true,
        autoResubscribe: true,
        persistNotification: true,
        notificationClickHandlerMatch: 'origin',
        notificationClickHandlerAction: 'focus',
        serviceWorkerPath: '/OneSignalSDKWorker.js',
        serviceWorkerUpdaterPath: '/OneSignalSDKUpdaterWorker.js',
        notifyButton: { enable: false },
        promptOptions: { slidedown: { prompts: [{ type: 'push', autoPrompt: false }] } },
      });

      if (!window._oneSignalListenersRegistered) {
        window._oneSignalListenersRegistered = true;

        const updateState = () => publishPushState(oneSignal);
        oneSignal.Notifications.addEventListener('permissionChange', updateState);
        oneSignal.User.PushSubscription.addEventListener('change', updateState);
        oneSignal.Notifications.addEventListener('foregroundWillDisplay', event => {
          const notification = event.notification || {};
          const canControlNativeDisplay = typeof event.preventDefault === 'function'
            && typeof notification.display === 'function';
          if (canControlNativeDisplay) event.preventDefault?.();

          playNotificationSound();
          window.dispatchEvent(new CustomEvent('suavez:notification', {
            detail: {
              title: notification.title || 'Nova atualização',
              message: notification.body || 'Você recebeu uma nova notificação do Sua Vez.',
              url: notification.launchURL || window.location.href,
            },
          }));

          if (canControlNativeDisplay) notification.display?.();
        });
      }

      publishPushState(oneSignal);
      console.info('OneSignal: inicializado.');
    } catch (error) {
      window._oneSignalInitialized = false;
      console.error('OneSignal: falha na inicialização.', error);
    }
  });
}

export function requestNotificationPermission(): Promise<string | null> {
  void unlockNotificationSound();

  return new Promise(resolve => {
    const sdkTimeout = window.setTimeout(() => resolve(null), 15000);
    window.OneSignalDeferred = window.OneSignalDeferred || [];
    window.OneSignalDeferred.push(async oneSignal => {
      try {
        // The permission request must run before identity/network work in the click handler.
        window.clearTimeout(sdkTimeout);
        if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
          publishPushState(oneSignal);
          window.clearTimeout(sdkTimeout);
          resolve(null);
          return;
        }
        if (!oneSignal.Notifications.isPushSupported()) {
          console.warn('OneSignal: este navegador não oferece suporte a push web.');
          publishPushState(oneSignal);
          window.clearTimeout(sdkTimeout);
          resolve(null);
          return;
        }

        if (!oneSignal.Notifications.permission || (typeof Notification !== 'undefined' && Notification.permission === 'default')) {
          // O botão da aplicação já funciona como pre-prompt. A solicitação nativa
          // precisa acontecer diretamente dentro do gesto do usuário, sobretudo no mobile.
          await oneSignal.Notifications.requestPermission();
        }

        if (!oneSignal.Notifications.permission) {
          publishPushState(oneSignal);
          window.clearTimeout(sdkTimeout);
          resolve(null);
          return;
        }

        if (!oneSignal.User.PushSubscription.optedIn) {
          await oneSignal.User.PushSubscription.optIn();
        }

        const id = await waitForSubscriptionId(oneSignal);
        publishPushState(oneSignal);
        window.clearTimeout(sdkTimeout);
        resolve(oneSignal.User.PushSubscription.optedIn && oneSignal.User.PushSubscription.token ? id : null);
      } catch (error) {
        window.clearTimeout(sdkTimeout);
        console.error('OneSignal: erro ao solicitar notificações.', error);
        resolve(null);
      }
    });
  });
}

export function isNotificationEnabled(): Promise<boolean> {
  return getNotificationStatus().then(status => status === 'enabled');
}

export function getOneSignalId(): Promise<string | null> {
  return new Promise(resolve => {
    const sdkTimeout = window.setTimeout(() => resolve(null), 13000);
    window.OneSignalDeferred = window.OneSignalDeferred || [];
    window.OneSignalDeferred.push(async oneSignal => {
      if (!oneSignal.Notifications.permission || !oneSignal.User.PushSubscription.optedIn
        || (typeof Notification !== 'undefined' && Notification.permission !== 'granted')) {
        window.clearTimeout(sdkTimeout);
        resolve(null);
        return;
      }
      const id = await waitForSubscriptionId(oneSignal);
      window.clearTimeout(sdkTimeout);
      resolve(oneSignal.User.PushSubscription.token ? id : null);
    });
  });
}

export function loginOneSignal(externalId: string): Promise<boolean> {
  return new Promise(resolve => {
    const sdkTimeout = window.setTimeout(() => resolve(false), 15000);
    window.OneSignalDeferred = window.OneSignalDeferred || [];
    window.OneSignalDeferred.push(async oneSignal => {
      try {
        await oneSignal.login(externalId);
        window.clearTimeout(sdkTimeout);
        resolve(true);
      } catch (error) {
        window.clearTimeout(sdkTimeout);
        console.error('OneSignal: não foi possível identificar o dispositivo.', error);
        resolve(false);
      }
    });
  });
}

export function logoutOneSignal(): Promise<void> {
  return new Promise(resolve => {
    const sdkTimeout = window.setTimeout(resolve, 5000);
    window.OneSignalDeferred = window.OneSignalDeferred || [];
    window.OneSignalDeferred.push(async oneSignal => {
      try {
        await oneSignal.logout();
      } catch (error) {
        console.error('OneSignal: não foi possível encerrar a identificação do dispositivo.', error);
      } finally {
        window.clearTimeout(sdkTimeout);
        resolve();
      }
    });
  });
}

export async function sendPushNotification(event: PushEventName, tenantId: string, queueItemId: string): Promise<PushSendResult> {
  try {
    const tokens = customerTokens(tenantId);
    const response = await fetch('/api/send-push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...await authorizationHeaders() },
      body: JSON.stringify({ event, tenantId, queueItemId, customerToken: tokens[queueItemId] }),
      keepalive: true,
    });

    const result = await response.json().catch(() => ({})) as {
      sent?: boolean;
      reason?: string;
      error?: string;
    };

    if (!response.ok) {
      console.error('OneSignal: o servidor recusou o envio.', result);
      return { sent: false, error: result.error || 'Push provider rejected the notification' };
    }

    return {
      sent: Boolean(result.sent),
      reason: result.reason,
    };
  } catch (error) {
    console.error('OneSignal: falha ao solicitar o envio.', error);
    return { sent: false, error: 'Could not request the notification' };
  }
}

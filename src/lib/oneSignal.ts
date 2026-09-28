export type PushEventName =
  | 'client_joined'
  | 'client_called'
  | 'client_on_way'
  | 'service_started'
  | 'appointment_approved'
  | 'appointment_rejected';

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
  };
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
  Slidedown: {
    promptPush: () => Promise<void>;
  };
  Notifications: {
    permission: boolean;
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
  window.dispatchEvent(new CustomEvent('suavez:push-state', {
    detail: { ...detail, enabled: detail.permission && detail.optedIn && Boolean(detail.id && detail.token) },
  }));
}

function waitForSubscriptionId(oneSignal: OneSignalClient, timeoutMs = 12000): Promise<string | null> {
  const currentId = oneSignal.User.PushSubscription.id;
  if (currentId) return Promise.resolve(currentId);

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
      if (id) finish(id);
    };
    const timeout = window.setTimeout(() => finish(oneSignal.User.PushSubscription.id || null), timeoutMs);
    oneSignal.User.PushSubscription.addEventListener('change', onChange);
  });
}

export function initializeOneSignal() {
  const appId = import.meta.env.VITE_ONESIGNAL_APP_ID;

  if (import.meta.env.DEV) {
    console.info('OneSignal: desativado no ambiente de desenvolvimento.');
    return;
  }

  if (!appId || appId === 'seu_app_id_do_onesignal_aqui') {
    console.warn('OneSignal: VITE_ONESIGNAL_APP_ID não configurado.');
    return;
  }

  if (window._oneSignalInitialized) return;
  window._oneSignalInitialized = true;
  window.OneSignalDeferred = window.OneSignalDeferred || [];

  window.OneSignalDeferred.push(async oneSignal => {
    try {
      await oneSignal.init({
        appId,
        allowLocalhostAsSecureOrigin: true,
        autoResubscribe: true,
        notificationClickHandlerMatch: 'origin',
        notificationClickHandlerAction: 'focus',
        serviceWorkerPath: '/OneSignalSDKWorker.js',
        serviceWorkerUpdaterPath: '/OneSignalSDKUpdaterWorker.js',
      });

      if (!window._oneSignalListenersRegistered) {
        window._oneSignalListenersRegistered = true;

        const updateState = () => publishPushState(oneSignal);
        oneSignal.Notifications.addEventListener('permissionChange', updateState);
        oneSignal.User.PushSubscription.addEventListener('change', updateState);
        oneSignal.Notifications.addEventListener('foregroundWillDisplay', event => {
          const notification = event.notification || {};
          window.dispatchEvent(new CustomEvent('suavez:notification', {
            detail: {
              title: notification.title || 'Nova atualização',
              message: notification.body || 'Você recebeu uma nova notificação do Sua Vez.',
              url: notification.launchURL || window.location.href,
            },
          }));
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
  if (!import.meta.env.PROD) return Promise.resolve(null);

  return new Promise(resolve => {
    const sdkTimeout = window.setTimeout(() => resolve(null), 15000);
    window.OneSignalDeferred = window.OneSignalDeferred || [];
    window.OneSignalDeferred.push(async oneSignal => {
      try {
        if (!oneSignal.Notifications.permission) {
          try {
            await oneSignal.Slidedown.promptPush();
          } catch {
            await oneSignal.Notifications.requestPermission();
          }
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
  if (!import.meta.env.PROD) return Promise.resolve(true);

  return new Promise(resolve => {
    const timeout = window.setTimeout(() => resolve(false), 2500);
    window.OneSignalDeferred = window.OneSignalDeferred || [];
    window.OneSignalDeferred.push(oneSignal => {
      window.clearTimeout(timeout);
      const state = getPushState(oneSignal);
      resolve(state.permission && state.optedIn && Boolean(state.id && state.token));
    });
  });
}

export function getOneSignalId(): Promise<string | null> {
  if (!import.meta.env.PROD) return Promise.resolve(null);

  return new Promise(resolve => {
    const sdkTimeout = window.setTimeout(() => resolve(null), 13000);
    window.OneSignalDeferred = window.OneSignalDeferred || [];
    window.OneSignalDeferred.push(async oneSignal => {
      if (!oneSignal.Notifications.permission || !oneSignal.User.PushSubscription.optedIn) {
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

export async function sendPushNotification(event: PushEventName, tenantId: string, queueItemId: string) {
  if (!import.meta.env.PROD) return;

  try {
    const response = await fetch('/api/send-push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, tenantId, queueItemId }),
      keepalive: true,
    });

    if (!response.ok) {
      const result: unknown = await response.json().catch(() => ({}));
      console.error('OneSignal: o servidor recusou o envio.', result);
    }
  } catch (error) {
    console.error('OneSignal: falha ao solicitar o envio.', error);
  }
}

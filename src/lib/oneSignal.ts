import { customerTokens } from './customerTokens';
import { playNotificationSound, unlockNotificationSound } from './notificationSound';
import { authorizationHeaders } from './access';
import { resolveNotificationStatus, type NotificationStatus } from './notificationStatus';
import { classifyNotificationError, notificationFailure, type NotificationFailureReason, type NotificationPermissionResult } from './notificationRequest';

export type PushEventName =
  | 'client_joined'
  | 'client_called'
  | 'appointment_cancelled'
  | 'client_on_way'
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
    externalId?: string | null;
    addEventListener?: (event: 'change', listener: () => void) => void;
    PushSubscription: OneSignalSubscription;
  };
}

interface OneSignalRuntime {
  client: OneSignalClient | null;
  failure: Extract<NotificationPermissionResult, { id: null }> | null;
  observers: Set<() => void>;
  permissionRequest: Promise<void> | null;
  identity?: { version: number; queue: Promise<void>; pendingId?: string | null; pending?: Promise<boolean> | null };
}
// Keep SDK readiness across development hot reloads, like the initialization guard.
const runtime = window._oneSignalRuntime ??= { client: null, failure: null, observers: new Set<() => void>(), permissionRequest: null } as OneSignalRuntime;
const localEnvironment = () => ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
const failure = (reason: NotificationFailureReason) => notificationFailure(reason, localEnvironment());
const publishSdkReady = () => { for (const observer of [...runtime.observers]) observer(); };

function observeSdk(observer: () => void) {
  if (runtime.client || runtime.failure) { observer(); return () => {}; }
  runtime.observers.add(observer);
  return () => { runtime.observers.delete(observer); };
}

declare global {
  interface Window {
    OneSignalDeferred: Array<(oneSignal: OneSignalClient) => void | Promise<void>>;
    OneSignal: OneSignalClient;
    _oneSignalInitialized?: boolean;
    _oneSignalListenersRegistered?: boolean;
    _oneSignalRuntime?: OneSignalRuntime;
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
    let unsubscribe = () => {};
    const timeout = window.setTimeout(() => { unsubscribe(); resolve(fallback); }, 3500);
    unsubscribe = observeSdk(() => {
      window.clearTimeout(timeout);
      unsubscribe();
      try { resolve(runtime.client ? readNotificationStatus(runtime.client) : fallback); } catch { resolve(fallback); }
    });
  });
}

function waitForSubscriptionId(oneSignal: OneSignalClient, timeoutMs = 12000, signal?: AbortSignal): Promise<string | null> {
  if (signal?.aborted) return Promise.resolve(null);
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
      signal?.removeEventListener('abort', onAbort);
      resolve(id);
    };
    const onChange = (event: SubscriptionChangeEvent) => {
      const id = event.current?.id || oneSignal.User.PushSubscription.id;
      if (id && ready()) finish(id);
    };
    const onAbort = () => finish(null);
    const timeout = window.setTimeout(() => finish(ready() ? oneSignal.User.PushSubscription.id : null), timeoutMs);
    oneSignal.User.PushSubscription.addEventListener('change', onChange);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function initializeOneSignal() {
  const appId = import.meta.env.VITE_ONESIGNAL_APP_ID?.trim();

  if (!appId || appId === 'seu_app_id_do_onesignal_aqui') {
    runtime.failure = failure('unconfigured');
    publishSdkReady();
    console.warn('OneSignal: VITE_ONESIGNAL_APP_ID não configurado.');
    return;
  }

  if (window._oneSignalInitialized) return;
  runtime.failure = null;
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
        notificationClickHandlerMatch: 'exact',
        notificationClickHandlerAction: 'navigate',
        serviceWorkerPath: '/OneSignalSDKWorker.js',
        serviceWorkerUpdaterPath: '/OneSignalSDKUpdaterWorker.js',
        notifyButton: { enable: false },
        promptOptions: { slidedown: { prompts: [{ type: 'push', autoPrompt: false }] } },
      });
      runtime.client = oneSignal;
      runtime.failure = null;
      publishSdkReady();

      if (!window._oneSignalListenersRegistered) {
        window._oneSignalListenersRegistered = true;

        const updateState = () => publishPushState(oneSignal);
        oneSignal.Notifications.addEventListener('permissionChange', updateState);
        oneSignal.User.PushSubscription.addEventListener('change', updateState);
        oneSignal.User.addEventListener?.('change', updateState);
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
      runtime.client = null;
      runtime.failure = failure(classifyNotificationError(error, 'initialization'));
      publishSdkReady();
      window._oneSignalInitialized = false;
      console.error('OneSignal: falha na inicialização.', error);
    }
  });
}

export function requestNotificationPermission(): Promise<NotificationPermissionResult> {
  void unlockNotificationSound();
  if (!window.isSecureContext) return Promise.resolve(failure('insecure-origin'));
  return new Promise(resolve => {
    let settled = false;
    let timer: number;
    let unsubscribe = () => {};
    const controller = new AbortController();
    const finish = (result: NotificationPermissionResult) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      unsubscribe();
      controller.abort();
      resolve(result);
    };
    const deadline = (reason: NotificationFailureReason, ms: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => finish(failure(reason)), ms);
    };
    const request = async (oneSignal: OneSignalClient) => {
      try {
        // The permission request must run before identity/network work in the click handler.
        if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
          publishPushState(oneSignal);
          finish(failure('blocked'));
          return;
        }
        if (!oneSignal.Notifications.isPushSupported()) {
          console.warn('OneSignal: este navegador não oferece suporte a push web.');
          publishPushState(oneSignal);
          finish(failure('unsupported'));
          return;
        }

        const permitted = () => typeof Notification === 'undefined' ? oneSignal.Notifications.permission : Notification.permission === 'granted';
        if (!permitted()) {
          // O botão da aplicação já funciona como pre-prompt. A solicitação nativa
          // precisa acontecer diretamente dentro do gesto do usuário, sobretudo no mobile.
          deadline('permission-timeout', 30000);
          runtime.permissionRequest ??= oneSignal.Notifications.requestPermission().finally(() => { runtime.permissionRequest = null; });
          await runtime.permissionRequest;
          if (settled) return;
        }

        if (!permitted()) {
          publishPushState(oneSignal);
          finish(failure(typeof Notification !== 'undefined' && Notification.permission === 'denied' ? 'blocked' : 'dismissed'));
          return;
        }

        deadline('subscription-timeout', 15000);
        if (!oneSignal.User.PushSubscription.optedIn) {
          await oneSignal.User.PushSubscription.optIn();
          if (settled) return;
        }

        const id = await waitForSubscriptionId(oneSignal, 12000, controller.signal);
        if (settled) return;
        publishPushState(oneSignal);
        finish(id && readNotificationStatus(oneSignal) === 'enabled' ? { id, status: 'enabled' } : failure('subscription-timeout'));
      } catch (error) {
        if (settled) return;
        console.error('OneSignal: erro ao solicitar notificações.', error);
        finish(failure(classifyNotificationError(error)));
      }
    };
    deadline('sdk-timeout', 10000);
    unsubscribe = observeSdk(() => {
      if (settled) return;
      unsubscribe();
      if (runtime.failure) { finish(runtime.failure); return; }
      if (runtime.client) void request(runtime.client);
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
  return changeIdentity(externalId);
}

export function logoutOneSignal(): Promise<void> {
  return changeIdentity(null).then(() => {});
}

// Do not let an old login queued during SDK loading relink a device after logout.
function changeIdentity(externalId: string | null): Promise<boolean> {
  const identity = runtime.identity ??= { version: 0, queue: Promise.resolve() };
  if (identity.pending && identity.pendingId === externalId) return identity.pending;
  const version = ++identity.version;
  const task = new Promise<boolean>(resolve => {
    let settled = false;
    let unsubscribe = () => {};
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true; window.clearTimeout(timeout); unsubscribe(); resolve(ok);
    };
    const timeout = window.setTimeout(() => finish(false), 15000);
    unsubscribe = observeSdk(() => {
      if (settled) return;
      unsubscribe();
      if (runtime.failure) { finish(false); return; }
      const client = runtime.client;
      if (!client) return;
      identity.queue = identity.queue.catch(() => {}).then(async () => {
        if (settled || version !== identity.version) { finish(false); return; }
        try {
          if (externalId === null) await client.logout();
          else await client.login(externalId);
          finish(version === identity.version && (externalId === null || client.User.externalId === externalId));
        } catch {
          finish(false);
        }
      });
    });
  });
  identity.pendingId = externalId;
  identity.pending = task;
  void task.finally(() => { if (identity.pending === task) identity.pending = null; });
  return task;
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

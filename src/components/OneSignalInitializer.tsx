import { useEffect } from 'react';

declare global {
  interface Window {
    OneSignalDeferred: any[];
    OneSignal: any;
    _oneSignalInitialized: boolean;
  }
}

export function OneSignalInitializer() {
  useEffect(() => {
    const appId = import.meta.env.VITE_ONESIGNAL_APP_ID;
    
    if (!appId || appId === 'seu_app_id_do_onesignal_aqui') {
      console.warn('OneSignal: VITE_ONESIGNAL_APP_ID não configurado corretamente.');
      return;
    }

    // Evita dupla inicialização (React StrictMode roda useEffect 2x em dev)
    if (window._oneSignalInitialized) {
      console.log('OneSignal: já inicializado, ignorando.');
      return;
    }
    window._oneSignalInitialized = true;

    // Padrão OneSignal v16
    window.OneSignalDeferred = window.OneSignalDeferred || [];
    window.OneSignalDeferred.push(async (OneSignal: any) => {
      console.log('OneSignal: Inicializando...');
      await OneSignal.init({
        appId: appId,
        allowLocalhostAsSecureOrigin: true,
      });
      console.log('OneSignal: Inicializado com sucesso');
    });
  }, []);

  return null;
}

// Helper para vincular o usuário atual ao OneSignal
export const loginOneSignal = async (externalId: string) => {
  window.OneSignalDeferred = window.OneSignalDeferred || [];
  window.OneSignalDeferred.push(async (OneSignal: any) => {
    try {
      await OneSignal.login(externalId);
      console.log('OneSignal: Usuário logado:', externalId);
    } catch (error) {
      console.error('OneSignal: Erro ao logar:', error);
    }
  });
};

// Helper para solicitar permissão de notificação
export const requestNotificationPermission = async () => {
  console.log('OneSignal: Solicitando permissão...');
  window.OneSignalDeferred = window.OneSignalDeferred || [];
  window.OneSignalDeferred.push(async (OneSignal: any) => {
    try {
      await OneSignal.Notifications.requestPermission();
      console.log('OneSignal: Janela de permissão aberta');
    } catch (error) {
      console.error('OneSignal: Erro ao solicitar permissão:', error);
    }
  });
};

import { useEffect } from 'react';

declare global {
  interface Window {
    OneSignalDeferred: any[];
    OneSignal: any;
    _oneSignalInitialized: boolean;
  }
}

let initializationError: string | null = null;
let isInitialized = false;

export function OneSignalInitializer() {
  useEffect(() => {
    const appId = import.meta.env.VITE_ONESIGNAL_APP_ID;
    
    if (!appId || appId === 'seu_app_id_do_onesignal_aqui') {
      console.warn('OneSignal: VITE_ONESIGNAL_APP_ID não configurado corretamente.');
      initializationError = 'AppID não configurado';
      return;
    }

    if (window._oneSignalInitialized) return;
    window._oneSignalInitialized = true;

    window.OneSignalDeferred = window.OneSignalDeferred || [];
    window.OneSignalDeferred.push(async (OneSignal: any) => {
      console.log('OneSignal: Iniciando configuração com AppID:', appId);
      try {
        await OneSignal.init({
          appId: appId,
          allowLocalhostAsSecureOrigin: true,
          notifyButton: { enable: false },
        });
        isInitialized = true;
        initializationError = null;
        console.log('OneSignal: Inicializado com sucesso.');
      } catch (e: any) {
        console.error('OneSignal: Erro na inicialização:', e);
        initializationError = e.toString();
        if (initializationError?.includes('Can only be used on')) {
          console.warn('⚠️ OneSignal: Erro de Domínio. Ative "Local Testing" no Dashboard do OneSignal.');
        }
      }
    });
  }, []);

  return null;
}

// Helper para vincular o usuário atual ao OneSignal
export const loginOneSignal = async (externalId: string) => {
  window.OneSignalDeferred = window.OneSignalDeferred || [];
  window.OneSignalDeferred.push(async (OneSignal: any) => {
    try {
      console.log('OneSignal: Tentando login:', externalId);
      await OneSignal.login(externalId);
      console.log('OneSignal: Usuário logado com sucesso');
    } catch (error) {
      console.error('OneSignal: Erro ao logar:', error);
    }
  });
};

// Helper para solicitar permissão de notificação
export const requestNotificationPermission = async () => {
  console.log('OneSignal: Preparando solicitação de permissão...');
  
  if (initializationError) {
    if (initializationError.includes('Can only be used on')) {
      throw new Error('CONFIG_ERROR: O OneSignal está configurado apenas para o domínio de produção. Ative a opção "Local Testing" no painel do OneSignal para testar no localhost.');
    }
    throw new Error(`INIT_ERROR: ${initializationError}`);
  }

  return new Promise<void>((resolve, reject) => {
    // Timeout para evitar que a promessa fique "pendurada"
    const timeout = setTimeout(() => {
      if (!isInitialized) {
        reject(new Error('TIMEOUT: O SDK do OneSignal ainda não inicializou.'));
      } else {
        reject(new Error('TIMEOUT: O SDK não respondeu. Verifique seu AdBlocker.'));
      }
    }, 5000);

    window.OneSignalDeferred = window.OneSignalDeferred || [];
    window.OneSignalDeferred.push(async (OneSignal: any) => {
      clearTimeout(timeout);
      try {
        if (!OneSignal.Notifications.isPushSupported()) {
          return reject(new Error('NOT_SUPPORTED: Este navegador não suporta notificações.'));
        }

        console.log('OneSignal: Abrindo prompt...');
        await OneSignal.Notifications.requestPermission();
        resolve();
      } catch (error) {
        console.error('OneSignal: Falha ao solicitar permissão:', error);
        reject(error);
      }
    });
  });
};

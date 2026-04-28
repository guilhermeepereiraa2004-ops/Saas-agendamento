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
    const isDev = import.meta.env.DEV;
    
    if (isDev) {
      console.log('OneSignal: Desativado em modo de desenvolvimento.');
      return;
    }

    // Se o OneSignal falhar por qualquer motivo externo, não queremos que o app trave
    window.addEventListener('error', (e) => {
      if (e.message.includes('OneSignal') || e.filename?.includes('OneSignal')) {
        console.warn('OneSignal: Falha detectada no script externo. Continuando...');
      }
    }, true);

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

// Helper para verificar se as notificações estão ativas
export const isNotificationEnabled = async (): Promise<boolean> => {
  if (!import.meta.env.PROD) return true; // Em dev, sempre true
  
  return new Promise((resolve) => {
    window.OneSignalDeferred = window.OneSignalDeferred || [];
    window.OneSignalDeferred.push(async (OneSignal: any) => {
      resolve(OneSignal.Notifications.permission);
    });
    // Timeout caso o OneSignal não responda
    setTimeout(() => resolve(false), 1000);
  });
};

// Helper para obter o ID de inscrição atual (OneSignal V5)
export const getOneSignalId = async (): Promise<string | null> => {
  return new Promise((resolve) => {
    // Timeout de segurança reduzido para 800ms
    const timeout = setTimeout(() => {
      console.warn('OneSignal: Timeout ou SDK indisponível.');
      resolve(null);
    }, 800);

    if (!window.OneSignalDeferred && !window.OneSignal) {
      clearTimeout(timeout);
      resolve(null);
      return;
    }

    window.OneSignalDeferred = window.OneSignalDeferred || [];
    window.OneSignalDeferred.push(async (OneSignal: any) => {
      clearTimeout(timeout);
      try {
        const id = OneSignal.User.PushSubscription.id;
        resolve(id || null);
      } catch (e) {
        console.error('OneSignal: Erro ao ler ID:', e);
        resolve(null);
      }
    });
  });
};

// Helper para enviar notificação (Requer REST API KEY - idealmente feito no backend)
export const sendPushNotification = async (pushId: string, title: string, message: string) => {
  const appId = import.meta.env.VITE_ONESIGNAL_APP_ID;
  const apiKey = import.meta.env.VITE_ONESIGNAL_REST_API_KEY;

  if (!appId || !apiKey || apiKey === 'sua_chave_rest_api_aqui') {
    console.warn('OneSignal: REST API Key não configurada. Não é possível enviar notificações automáticas.');
    return;
  }

  try {
    const response = await fetch('https://onesignal.com/api/v1/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Authorization': `Basic ${apiKey}`
      },
      body: JSON.stringify({
        app_id: appId,
        include_subscription_ids: [pushId],
        headings: { en: title, pt: title },
        contents: { en: message, pt: message },
        priority: 10
      })
    });
    const data = await response.json();
    console.log('OneSignal: Notificação enviada:', data);
  } catch (error) {
    console.error('OneSignal: Erro ao enviar notificação:', error);
  }
};

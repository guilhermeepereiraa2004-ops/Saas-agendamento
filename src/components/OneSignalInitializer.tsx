import { useEffect } from 'react';

// Declarar OneSignal no objeto window para o TypeScript
declare global {
  interface Window {
    OneSignalDeferred: any[];
    OneSignal: any;
    _oneSignalInitialized?: boolean;
  }
}

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
        });
        console.log('OneSignal: Inicializado com sucesso.');
      } catch (error) {
        console.error('OneSignal: Erro na inicialização:', error);
        if (String(error).includes('SecurityError') || String(error).includes('MIME type')) {
          console.warn('⚠️ OneSignal: Erro de Domínio ou Service Worker. Verifique os arquivos na pasta public.');
        }
      }
    });

    const script = document.createElement('script');
    script.src = 'https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js';
    script.defer = true;
    document.head.appendChild(script);
  }, []);

  return null;
}

/**
 * Helpers para interagir com o OneSignal de forma segura
 */

// Identificar usuário no OneSignal
export const loginOneSignal = (externalId: string) => {
  if (!import.meta.env.PROD) return;
  
  window.OneSignalDeferred = window.OneSignalDeferred || [];
  window.OneSignalDeferred.push(async (OneSignal: any) => {
    try {
      await OneSignal.login(externalId);
      console.log('OneSignal: Usuário identificado:', externalId);
    } catch (err) {
      console.error('OneSignal: Erro ao fazer login do usuário:', err);
    }
  });
};

// Solicitar permissão de forma amigável (Slidedown)
export const requestNotificationPermission = async () => {
  if (!import.meta.env.PROD) return;

  window.OneSignalDeferred = window.OneSignalDeferred || [];
  window.OneSignalDeferred.push(async (OneSignal: any) => {
    console.log('OneSignal: Preparando solicitação de permissão (Slidedown)...');
    try {
      // Slidedown é menos propenso a ser bloqueado pelo navegador
      await OneSignal.Slidedown.prompt();
    } catch (err) {
      console.error('OneSignal: Erro ao abrir Slidedown, tentando nativo...', err);
      await OneSignal.Notifications.requestPermission();
    }
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
        resolve(null);
      }
    });
  });
};

// Disparar notificação via REST API (Backend/Helper)
export const sendPushNotification = async (pushId: string, title: string, message: string, url?: string) => {
  const appId = import.meta.env.VITE_ONESIGNAL_APP_ID;
  const apiKey = import.meta.env.VITE_ONESIGNAL_REST_API_KEY;

  if (!appId || !apiKey || apiKey === 'sua_chave_rest_api_aqui') {
    console.warn('OneSignal: REST API Key não configurada. Não é possível enviar notificações automáticas.');
    return;
  }

  try {
    console.log('[DEBUG] Enviando Push para:', pushId);
    const response = await fetch('https://onesignal.com/api/v1/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Authorization': `Basic ${apiKey}`
      },
      body: JSON.stringify({
        app_id: appId,
        include_subscription_ids: [pushId],
        contents: { en: message, pt: message },
        headings: { en: title, pt: title },
        url: url, // Link para redirecionamento
        priority: 10, // Prioridade alta para "pular" na tela
        android_visibility: 1 // Torna visível na tela de bloqueio
      })
    });
    
    const result = await response.json();
    console.log('[DEBUG] Resposta do OneSignal:', result);
    
    if (!response.ok) {
      console.error('[DEBUG] Falha no OneSignal API:', result);
    }
  } catch (error) {
    console.error('OneSignal: Erro ao disparar notificação via API:', error);
  }
};

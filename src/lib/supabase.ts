import { createClient } from '@supabase/supabase-js';
import { authFetch } from './authFetch';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Supabase URL e Anon Key são obrigatórios nas variáveis de ambiente (.env)');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
  global: {
    fetch: authFetch,
    headers: {
      'x-application-name': 'suavez',
    },
  },
});

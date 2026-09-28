# SaaS Agendamento - Sua Vez

Sistema de gerenciamento de filas e agendamentos multirrecursos (barbearias, lava-jatos, clínicas, etc.).

## 🚀 Como fazer o deploy na Vercel

1. **Conecte seu GitHub**: No painel da Vercel, importe o seu repositório `Saas-agendamento`.
2. **Configuração do Projeto**:
   - **Framework Preset**: Vite (Será detectado automaticamente).
   - **Root Directory**: `./` (Padrão).
   - **Build Command**: `npm run build`.
   - **Output Directory**: `dist`.
3. **Variáveis de Ambiente**:
   No campo "Environment Variables", adicione:
   - `VITE_SUPABASE_URL`: (Copie a URL do seu painel Supabase)
   - `VITE_SUPABASE_ANON_KEY`: (Copie a chave anônima do seu painel Supabase)
   - `VITE_ONESIGNAL_APP_ID`: ID público do aplicativo no OneSignal.
   - `ONESIGNAL_REST_API_KEY`: chave REST privada do OneSignal. Esta variável é usada somente pela função `/api/send-push` e **nunca deve receber o prefixo `VITE_`**.
   - `APP_ORIGIN`: domínio canônico da aplicação, por exemplo `https://suavez.app`.

   Se uma chave REST já foi publicada anteriormente como `VITE_ONESIGNAL_REST_API_KEY`, gere uma nova chave no OneSignal, configure `ONESIGNAL_REST_API_KEY` na Vercel e revogue a antiga.

## 🛠️ Tecnologias
- **Frontend**: React 19 + TypeScript + Vite 8
- **Backend**: Supabase (Database & Autenticação)
- **Push**: OneSignal via função server-side da Vercel
- **Styling**: CSS Moderno (Vanilla/Native)

## 📦 Comandos Locais
```bash
# Instalar dependências
npm install

# Rodar em ambiente de desenvolvimento
npm run dev

# Gerar build de produção
npm run build
```

## 📄 Notas de Roteamento
O arquivo `vercel.json` já está configurado para lidar com rotas de Single Page Application (SPA), garantindo que atualizações de página em sub-rotas como `/dashboard` não retornem erro 404.

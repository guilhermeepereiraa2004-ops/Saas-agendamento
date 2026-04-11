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
   No campo "Environment Variables", adicione as seguintes chaves do seu projeto Supabase:
   - `VITE_SUPABASE_URL`: (Copie a URL do seu painel Supabase)
   - `VITE_SUPABASE_ANON_KEY`: (Copie a chave anônima do seu painel Supabase)

## 🛠️ Tecnologias
- **Frontend**: React 19 + TypeScript + Vite 6
- **Backend**: Supabase (Database & Autenticação)
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

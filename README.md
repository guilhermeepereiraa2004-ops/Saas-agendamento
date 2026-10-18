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
   - `VITE_SUPABASE_ANON_KEY`: chave pública atual do Supabase (`sb_publishable_...`). O nome da variável foi mantido por compatibilidade; ela também aceita a chave `anon` antiga durante a migração.
   - `SUPABASE_SECRET_KEY`: chave secreta atual do Supabase (`sb_secret_...`), somente no servidor. Necessária para provisionar contas e verificar o destinatário das notificações. Configure como Secret em Production. **Nunca use o prefixo `VITE_` nesta chave.** O servidor também aceita `SUPABASE_SERVICE_ROLE_KEY` por compatibilidade; `SUPABASE_SECRET_KEY` tem prioridade.
   - `VITE_ONESIGNAL_APP_ID`: ID público do aplicativo no OneSignal.
   - `ONESIGNAL_REST_API_KEY`: chave REST privada do OneSignal. Esta variável é usada somente pela função `/api/send-push` e **nunca deve receber o prefixo `VITE_`**.
   - `APP_ORIGIN`: domínio canônico da aplicação, por exemplo `https://suavez.app`.

   Se uma chave REST já foi publicada anteriormente como `VITE_ONESIGNAL_REST_API_KEY`, gere uma nova chave no OneSignal, configure `ONESIGNAL_REST_API_KEY` na Vercel e revogue a antiga.

   Ao migrar as chaves do Supabase, atualize tanto a chave pública quanto a secreta, publique novamente e valide os fluxos antes de desativar as chaves legadas. Desativar as chaves legadas interrompe chamadas de versões antigas que ainda as utilizem; abas já abertas precisam recarregar a versão publicada. As novas chaves são enviadas no cabeçalho `apikey`; o JWT do usuário continua no cabeçalho de autorização das chamadas autenticadas.

   Se uma chave `service_role` antiga foi exposta, desativá-la como API key não basta: ela também é um JWT. Depois de confirmar que uma assinatura nova está ativa e as aplicações usam as chaves atuais, revogue a assinatura legada para invalidar esses tokens. Não revogue a assinatura atual. Usuários com tokens assinados pela chave revogada podem precisar entrar novamente. Consulte [JWT Signing Keys](https://supabase.com/docs/guides/auth/signing-keys).

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

# Verificar contraste dos temas personalizados
npm run test:theme

# Testar permissões e integridade financeira em PostgreSQL isolado
npm run test:database

# Testar a API de criação e migração de contas sem chamadas reais
node scripts/test-accounts.mjs

# Testar notificações com dados e provedores simulados
node scratch/admin-audit/push-api.mjs
```

A auditoria de interface está em `scratch/admin-audit/run.mjs` e usa o build de `dist`. Ela requer o pacote Playwright e o navegador Chrome; `AUDIT_PLAYWRIGHT` permite informar o caminho do pacote quando instalado fora do projeto. Relatórios, capturas e scripts específicos de contas reais permanecem fora do Git.

## Migração para autenticação segura

Aplique `supabase/migrations/20261017190332_secure_access_and_financial_integrity.sql` junto com a publicação do novo código. A migração remove permanentemente a coluna de senhas em texto puro, restringe as tabelas por estabelecimento e cria funções transacionais para receitas e despesas. Não exclui registros financeiros existentes.

Antes da ativação, crie a conta do administrador pelo Supabase Auth com senha nova. No SQL Editor, vincule o usuário pelo e-mail conferido (substitua o exemplo):

```sql
insert into app_private.platform_admins(user_id)
select id from auth.users where email = 'seu-email@example.com'
on conflict do nothing;
```

Confirme que existe exatamente uma conta correspondente antes de vincular. Não use `user_metadata` para conceder acesso. Depois, pelo painel master, edite cada estabelecimento antigo e defina uma senha nova com ao menos 12 caracteres para migrar o acesso do profissional. As senhas anteriores não são reutilizadas.

Reservas anteriores à migração não possuem o token de propriedade do cliente. Continuam gerenciáveis pelo profissional; o cliente precisará contatar o estabelecimento para alterar essas reservas antigas. Novas reservas recebem um token aleatório e só aceitam alterações do cliente mediante essa prova.

A conclusão de atendimento exige o status em atendimento. A função grava a receita e remove a fila em uma única transação, protegida por bloqueio e índice único. Repetições retornam a receita existente. Despesas usam um identificador por solicitação e validam o conteúdo ao repetir uma tentativa. Duplicações históricas não são excluídas automaticamente, pois valor e horário iguais não provam duplicidade.

### Redefinir a senha master sem recuperação por e-mail

O utilitário local `node scripts/reset-master-password.mjs` atualiza somente a senha da conta identificada no arquivo local ignorado `.master-reset.local` (metadados `projectRef`, `userId` e `email`, sem credenciais). Ele aceita a chave secreta atual ou a chave `service_role` antiga e confirma a conta no projeto esperado pela API administrativa antes de aceitar a nova senha.

Execute em um terminal interativo. A chave e a senha são solicitadas com entrada oculta e não são gravadas em arquivo. Não passe credenciais como argumentos do comando. O identificador da conta é preservado, mantendo o vínculo master. Testes isolados: `node scripts/test-master-reset.mjs`.

No Windows, `node scripts/reset-master-password.mjs --window` oferece campos protegidos e um botão para colar a chave. As credenciais trafegam somente em memória entre os processos locais e o endpoint Auth do projeto.

## 📄 Notas de Roteamento
O arquivo `vercel.json` já está configurado para lidar com rotas de Single Page Application (SPA), garantindo que atualizações de página em sub-rotas como `/dashboard` não retornem erro 404.

## Avisos e navegação do painel

O pedido de notificações parte do botão **Aceitar notificações**. Entrar no painel ou confirmar uma reserva não abre o pedido automaticamente. O alerta desaparece quando o aparelho possui permissão, inscrição ativa, identificador e token de push; o estado é consultado novamente ao voltar para a aba e acompanha os eventos do SDK. Não há um marcador local que simule permissão concedida.

Se a permissão estiver bloqueada, o painel mostra como liberá-la nas configurações do site. Navegadores sem suporte recebem uma orientação específica. A identificação do profissional e a sincronização da inscrição continuam no servidor, usando a sessão autenticada. Consulte a [referência oficial do OneSignal Web SDK](https://documentation.onesignal.com/docs/en/web-sdk-reference).

No celular, o painel profissional oferece atalhos fixos para Hoje, Agenda ou Serviços, Financeiro e Mais. O master oferece Clientes, Financeiro e Ajustes. Os menus adicionais permitem fechar com Escape, mantêm o foco no menu aberto e restauram o foco ao fechar. Os dois painéis usam Poppins e mantêm áreas de toque com pelo menos 44 pixels nas ações principais.

## Aplicativos do cliente e profissional

Cada estabelecimento oferece dois PWAs: `/<slug>/cliente/` para fila e agendamentos e `/<slug>/profissional/` para login e painel. O link antigo `/<slug>` continua funcionando e encaminha à experiência apropriada após verificar a sessão; a entrada explícita do cliente sempre mantém a visão pública, mesmo com uma sessão de equipe no navegador.

O botão **Instalar app** aparece na página do cliente; **Instalar app profissional** aparece no painel. No Chrome/Android, usa `beforeinstallprompt` quando disponível e sempre exige clique e confirmação da pessoa. Sem esse evento, mostra as instruções do navegador. No iOS/iPadOS, orienta a instalação manual no Safari (Compartilhar → Adicionar à Tela de Início → Adicionar). Nenhuma permissão de notificações é solicitada pela instalação. Em modo standalone, o convite fica oculto. A aceitação do pedido não é apresentada como conclusão da instalação no Android.

`/api/pwa-manifest` gera apenas metadados públicos, usando a chave pública e a RPC `get_public_tenant`. O `id` combina o UUID do estabelecimento e o público do app; o `start_url` e o `scope` apontam à entrada correspondente. Os dois apps usam a logo Sua Vez e nomes que identificam o estabelecimento. Notificações abrem a rota correspondente ao destinatário. A instalação não concede acesso profissional: a sessão e o vínculo com o estabelecimento continuam sendo verificados no servidor.

O PWA geral anterior tem identidade `/`, preservada explicitamente no manifesto estático. Ele não é convertido automaticamente em um dos novos apps. Para usar uma instalação específica, instale pelo botão da página correspondente. Testes: `npm run test:pwa` para o endpoint e a auditoria `scratch/admin-audit/run.mjs` para os fluxos simulados de Android, iOS, autenticação e responsividade. A conclusão da instalação e as notificações no aparelho exigem teste em dispositivo real.

## Ícones do site e PWA

Favicon, ícones de instalação e Apple Touch Icon usam o mesmo símbolo do componente `BrandMark`, com as cores de `src/brand.css`. Os PNGs têm dimensões reais de 192 e 512 pixels, o ícone Apple tem 180 pixels e o ICO inclui 16, 32 e 48 pixels. As versões maskable têm fundo opaco e mantêm o símbolo na área segura para recortes do sistema.

Para regenerar os arquivos, execute `node scripts/generate-app-icons.mjs` com Playwright e Chrome disponíveis. Assim como na auditoria de interface, `AUDIT_PLAYWRIGHT` aceita um caminho alternativo para o pacote. Os arquivos são distribuídos em `public/icons/`; ao trocar a identidade visual, atualize também a versão dos caminhos no HTML e no manifest para renovar o cache. Um ícone antigo salvo pelo sistema pode exigir remover o atalho/app instalado e adicioná-lo novamente.

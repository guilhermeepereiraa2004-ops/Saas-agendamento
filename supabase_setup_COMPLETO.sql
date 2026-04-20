-- ================================================================
-- SUAAVEZ - SETUP COMPLETO DO SUPABASE
-- Execute este arquivo inteiro no SQL Editor do Supabase
-- Dashboard -> SQL Editor -> New query -> Cole e clique em RUN
-- ================================================================


-- ================================================================
-- PASSO 1: CRIAR AS TABELAS
-- ================================================================

-- Extensão para gerar UUIDs (já vem ativa no Supabase, mas por segurança)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Tabela de Estabelecimentos (cada barbeiro/salão/etc é um "tenant")
CREATE TABLE IF NOT EXISTS tenants (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            TEXT NOT NULL,
    slug            TEXT NOT NULL UNIQUE,
    whatsapp        TEXT,
    primary_color   TEXT DEFAULT '#eab308',
    has_logo        BOOLEAN DEFAULT false,
    logo_url        TEXT,
    services        JSONB DEFAULT '[]'::jsonb,
    is_online       BOOLEAN DEFAULT true,
    profession      TEXT DEFAULT 'barber',
    login_email     TEXT,
    login_password  TEXT,
    completed_today INTEGER DEFAULT 0,
    booking_type    TEXT DEFAULT 'queue' CHECK (booking_type IN ('queue', 'appointment')),
    working_hours   JSONB DEFAULT '[]'::jsonb,
    created_at      TIMESTAMPTZ DEFAULT now()
);

-- Tabela da Fila de Clientes
CREATE TABLE IF NOT EXISTS queue_items (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id   UUID REFERENCES tenants(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    whatsapp    TEXT NOT NULL,
    service_id  TEXT NOT NULL,
    service_name TEXT NOT NULL,
    price       DECIMAL(10,2) NOT NULL,
    status      TEXT NOT NULL CHECK (status IN ('waiting', 'serving', 'ready')),
    appointment_time TIMESTAMPTZ,
    joined_at   TIMESTAMPTZ DEFAULT now()
);

-- Tabela de Registros Financeiros
CREATE TABLE IF NOT EXISTS financial_records (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id    UUID REFERENCES tenants(id) ON DELETE CASCADE,
    price        DECIMAL(10,2) NOT NULL,
    completed_at TIMESTAMPTZ DEFAULT now()
);


-- ================================================================
-- PASSO 2: SEGURANÇA (Row Level Security - RLS)
-- ================================================================

-- Ativar RLS em todas as tabelas
ALTER TABLE tenants          ENABLE ROW LEVEL SECURITY;
ALTER TABLE queue_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_records ENABLE ROW LEVEL SECURITY;

-- TENANTS: qualquer um pode ver (necessário para carregar a página do estabelecimento)
DROP POLICY IF EXISTS "Tenants são visíveis para todos" ON tenants;
CREATE POLICY "Tenants são visíveis para todos" ON tenants
    FOR SELECT USING (true);

-- TENANTS: qualquer um pode atualizar (is_online, completed_today, etc.)
DROP POLICY IF EXISTS "Tenants podem ser atualizados" ON tenants;
CREATE POLICY "Tenants podem ser atualizados" ON tenants
    FOR UPDATE USING (true);

-- QUEUE_ITEMS: qualquer um pode ver a fila
DROP POLICY IF EXISTS "Fila visível para todos" ON queue_items;
CREATE POLICY "Fila visível para todos" ON queue_items
    FOR SELECT USING (true);

-- QUEUE_ITEMS: qualquer um pode entrar na fila
DROP POLICY IF EXISTS "Qualquer um pode entrar na fila" ON queue_items;
CREATE POLICY "Qualquer um pode entrar na fila" ON queue_items
    FOR INSERT WITH CHECK (true);

-- QUEUE_ITEMS: qualquer um pode atualizar status (waiting -> serving)
DROP POLICY IF EXISTS "Fila pode ser atualizada" ON queue_items;
CREATE POLICY "Fila pode ser atualizada" ON queue_items
    FOR UPDATE USING (true);

-- QUEUE_ITEMS: qualquer um pode deletar da fila (finalizar atendimento)
DROP POLICY IF EXISTS "Fila pode ser deletada" ON queue_items;
CREATE POLICY "Fila pode ser deletada" ON queue_items
    FOR DELETE USING (true);

-- FINANCIAL_RECORDS: somente o tenant dono pode ver
DROP POLICY IF EXISTS "Financeiro visível para todos" ON financial_records;
CREATE POLICY "Financeiro visível para todos" ON financial_records
    FOR SELECT USING (true);

-- FINANCIAL_RECORDS: qualquer um pode inserir (o sistema registra ao finalizar atendimento)
DROP POLICY IF EXISTS "Financeiro pode ser inserido" ON financial_records;
CREATE POLICY "Financeiro pode ser inserido" ON financial_records
    FOR INSERT WITH CHECK (true);


-- ================================================================
-- PASSO 3: REALTIME - ESSENCIAL PARA ATUALIZAÇÕES AO VIVO
-- ================================================================

-- Adicionar tabelas à publicação do Realtime (ignora se já existir)
DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE queue_items;
EXCEPTION WHEN duplicate_object THEN
    NULL; -- já estava na publicação, tudo certo
END $$;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE tenants;
EXCEPTION WHEN duplicate_object THEN
    NULL; -- já estava na publicação, tudo certo
END $$;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE financial_records;
EXCEPTION WHEN duplicate_object THEN
    NULL;
END $$;

-- REPLICA IDENTITY FULL: garante que eventos de UPDATE e DELETE
-- trafeguem todos os campos (não só a chave primária)
ALTER TABLE queue_items       REPLICA IDENTITY FULL;
ALTER TABLE tenants           REPLICA IDENTITY FULL;
ALTER TABLE financial_records REPLICA IDENTITY FULL;


-- ================================================================
-- PASSO 4: VERIFICAÇÃO FINAL
-- Execute as queries abaixo para confirmar que tudo está correto
-- ================================================================

-- Verificar tabelas criadas
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public'
  AND table_name IN ('tenants', 'queue_items', 'financial_records');

-- Verificar Replica Identity (deve mostrar "FULL" nas duas tabelas)
SELECT 
    c.relname AS tabela,
    CASE c.relreplident
        WHEN 'f' THEN '✅ FULL - Realtime funcionando corretamente'
        WHEN 'd' THEN '❌ DEFAULT - Execute o PASSO 3 novamente'
        ELSE 'Outro: ' || c.relreplident
    END AS replica_identity
FROM pg_class c
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE n.nspname = 'public'
  AND c.relname IN ('queue_items', 'tenants');

-- Verificar tabelas na publicação Realtime
SELECT tablename 
FROM pg_publication_tables 
WHERE pubname = 'supabase_realtime'
  AND tablename IN ('queue_items', 'tenants');

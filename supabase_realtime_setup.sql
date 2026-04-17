-- =============================================================
-- SUPABASE REALTIME SETUP - Execute no SQL Editor do Supabase
-- =============================================================

-- 1. Verificar se as tabelas já estão na publicação
SELECT schemaname, tablename 
FROM pg_publication_tables 
WHERE pubname = 'supabase_realtime';

-- 2. Adicionar tabelas à publicação (se ainda não estiverem)
ALTER PUBLICATION supabase_realtime ADD TABLE queue_items;
ALTER PUBLICATION supabase_realtime ADD TABLE tenants;

-- 3. MUITO IMPORTANTE: Definir REPLICA IDENTITY FULL para que eventos
--    UPDATE e DELETE tragam os dados antigos E novos corretamente
ALTER TABLE queue_items REPLICA IDENTITY FULL;
ALTER TABLE tenants REPLICA IDENTITY FULL;

-- 4. Verificar o resultado
SELECT 
    c.relname AS table_name,
    CASE c.relreplident
        WHEN 'd' THEN 'DEFAULT (somente PK)'
        WHEN 'f' THEN 'FULL (todos os campos) ✅'
        WHEN 'i' THEN 'INDEX'
        WHEN 'n' THEN 'NOTHING'
    END AS replica_identity
FROM pg_class c
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE n.nspname = 'public'
  AND c.relname IN ('queue_items', 'tenants');

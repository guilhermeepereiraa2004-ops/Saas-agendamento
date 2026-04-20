-- Atualização do Banco de Dados para Suporte a Horários Marcados

ALTER TABLE tenants 
ADD COLUMN IF NOT EXISTS booking_type TEXT DEFAULT 'queue' CHECK (booking_type IN ('queue', 'appointment')),
ADD COLUMN IF NOT EXISTS working_hours JSONB DEFAULT '[]'::jsonb;

-- Nota: Certifique-se de executar este script no SQL Editor do seu Supabase.

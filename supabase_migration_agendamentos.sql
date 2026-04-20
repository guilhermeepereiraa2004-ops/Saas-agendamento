-- Atualização do Banco de Dados para Suporte a Agendamentos Específicos

ALTER TABLE queue_items 
ADD COLUMN IF NOT EXISTS appointment_time TIMESTAMPTZ;

-- Nota: Certifique-se de executar este script no SQL Editor do seu Supabase.

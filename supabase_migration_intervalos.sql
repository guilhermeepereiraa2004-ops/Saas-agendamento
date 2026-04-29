-- Migração para suporte a intervalos de agendamento e horário de almoço
ALTER TABLE tenants 
ADD COLUMN IF NOT EXISTS appointment_interval INTEGER DEFAULT 30,
ADD COLUMN IF NOT EXISTS lunch_start TEXT DEFAULT '12:00',
ADD COLUMN IF NOT EXISTS lunch_end TEXT DEFAULT '13:00';

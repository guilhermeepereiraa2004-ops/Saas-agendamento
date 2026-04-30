-- Migração para suporte a cor do letreiro (texto secundário)
ALTER TABLE tenants 
ADD COLUMN IF NOT EXISTS secondary_color TEXT DEFAULT '#ffffff';

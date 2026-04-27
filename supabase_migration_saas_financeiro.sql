-- Script para configurar o Financeiro do SaaS (Gestão de Assinaturas)
-- Execute este script no SQL Editor do seu Dashboard Supabase.

ALTER TABLE tenants 
ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'trial' 
CHECK (subscription_status IN ('active', 'overdue', 'pending', 'trial'));

ALTER TABLE tenants 
ADD COLUMN IF NOT EXISTS next_payment_at TIMESTAMPTZ;

ALTER TABLE tenants 
ADD COLUMN IF NOT EXISTS monthly_fee DECIMAL(10,2) DEFAULT 0.00;

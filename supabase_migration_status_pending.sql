-- Atualizando a restrição de status para incluir 'pending', 'completed' e 'cancelled'
ALTER TABLE queue_items DROP CONSTRAINT IF EXISTS queue_items_status_check;
ALTER TABLE queue_items ADD CONSTRAINT queue_items_status_check CHECK (status IN ('serving', 'ready', 'waiting', 'pending', 'completed', 'cancelled'));

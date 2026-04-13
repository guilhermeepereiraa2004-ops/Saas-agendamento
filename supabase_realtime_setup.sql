-- Enable Realtime for the tables
BEGIN;
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
      CREATE PUBLICATION supabase_realtime;
    END IF;
  END $$;

  ALTER PUBLICATION supabase_realtime ADD TABLE queue_items;
  ALTER PUBLICATION supabase_realtime ADD TABLE tenants;
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END;
COMMIT;

-- Set Replica Identity to FULL (Required for UPDATE events to carry all data)
ALTER TABLE queue_items REPLICA IDENTITY FULL;
ALTER TABLE tenants REPLICA IDENTITY FULL;

-- 1. Tenants Table
CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    whatsapp TEXT,
    primary_color TEXT DEFAULT '#eab308',
    has_logo BOOLEAN DEFAULT false,
    logo_url TEXT,
    services JSONB DEFAULT '[]'::jsonb,
    is_online BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Queue Items Table
CREATE TABLE queue_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    whatsapp TEXT NOT NULL,
    service_id TEXT NOT NULL,
    service_name TEXT NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('serving', 'ready', 'waiting', 'pending', 'completed', 'cancelled')),
    joined_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Daily Stats (Simplified for MVP)
ALTER TABLE tenants ADD COLUMN completed_today INTEGER DEFAULT 0;

-- 4. RLS Policies (Security)
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE queue_items ENABLE ROW LEVEL SECURITY;

-- Allow public read of tenants (so anyone can visit a barber page)
CREATE POLICY "Tenants are viewable by everyone" ON tenants
    FOR SELECT USING (true);

-- Allow public read of queue (so clients see the queue)
CREATE POLICY "Queue is viewable by everyone" ON queue_items
    FOR SELECT USING (true);

-- Allow anyone to join the queue
CREATE POLICY "Anyone can join the queue" ON queue_items
    FOR INSERT WITH CHECK (true);

-- Allow updates (In production, use Auth. For now, open for development)
CREATE POLICY "Allow updates for development" ON queue_items
    FOR ALL USING (true);

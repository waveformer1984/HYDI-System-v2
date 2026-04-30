-- HYDI Revenue Engine Database Schema
-- Creates tables for the 5 core money-making systems

-- Leads table for lead scraping system
CREATE TABLE IF NOT EXISTS leads (
    id TEXT PRIMARY KEY,
    company TEXT NOT NULL,
    contact TEXT,
    niche TEXT,
    source TEXT,
    score INTEGER DEFAULT 0,
    status TEXT DEFAULT 'new',
    created_at TIMESTAMP DEFAULT NOW(),
    contacted_at TIMESTAMP,
    converted_at TIMESTAMP
);

-- Outreach tracking
CREATE TABLE IF NOT EXISTS outreach (
    id TEXT PRIMARY KEY,
    lead_id TEXT REFERENCES leads(id),
    email_subject TEXT,
    email_body TEXT,
    status TEXT DEFAULT 'sent',
    sent_at TIMESTAMP DEFAULT NOW(),
    responded_at TIMESTAMP,
    response_type TEXT
);

-- Proposals table
CREATE TABLE IF NOT EXISTS proposals (
    id TEXT PRIMARY KEY,
    lead_id TEXT REFERENCES leads(id),
    project_type TEXT,
    title TEXT,
    description TEXT,
    pricing JSONB,
    timeline TEXT,
    deliverables JSONB,
    status TEXT DEFAULT 'generated',
    created_at TIMESTAMP DEFAULT NOW(),
    sent_at TIMESTAMP,
    accepted_at TIMESTAMP
);

-- Quotes table
CREATE TABLE IF NOT EXISTS quotes (
    id TEXT PRIMARY KEY,
    project_type TEXT,
    quantity INTEGER,
    complexity TEXT,
    rush_order BOOLEAN DEFAULT FALSE,
    base_price DECIMAL(10,2),
    unit_price DECIMAL(10,2),
    total DECIMAL(10,2),
    currency TEXT DEFAULT 'usd',
    valid_until TIMESTAMP,
    status TEXT DEFAULT 'active',
    created_at TIMESTAMP DEFAULT NOW()
);

-- Checkout sessions (Stripe)
CREATE TABLE IF NOT EXISTS checkout_sessions (
    id TEXT PRIMARY KEY,
    quote_id TEXT REFERENCES quotes(id),
    stripe_session_id TEXT,
    amount DECIMAL(10,2),
    currency TEXT,
    status TEXT DEFAULT 'pending',
    customer_email TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP
);

-- Product ideas
CREATE TABLE IF NOT EXISTS product_ideas (
    id TEXT PRIMARY KEY,
    name TEXT,
    category TEXT,
    description TEXT,
    estimated_cost DECIMAL(10,2),
    estimated_price DECIMAL(10,2),
    trend_score INTEGER,
    status TEXT DEFAULT 'idea',
    created_at TIMESTAMP DEFAULT NOW()
);

-- Product listings
CREATE TABLE IF NOT EXISTS product_listings (
    id TEXT PRIMARY KEY,
    product_idea_id TEXT REFERENCES product_ideas(id),
    platform TEXT,
    title TEXT,
    description TEXT,
    price DECIMAL(10,2),
    tags JSONB,
    images JSONB,
    status TEXT DEFAULT 'draft',
    created_at TIMESTAMP DEFAULT NOW(),
    published_at TIMESTAMP
);

-- Task queue for revenue operations
CREATE TABLE IF NOT EXISTS task_queue (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    task_type TEXT,
    description TEXT,
    status TEXT DEFAULT 'pending',
    priority TEXT DEFAULT 'normal',
    created_at TIMESTAMP DEFAULT NOW(),
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    result JSONB
);

-- Enable RLS
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE outreach ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkout_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_ideas ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_listings ENABLE ROW LEVEL SECURITY;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_score ON leads(score DESC);
CREATE INDEX IF NOT EXISTS idx_outreach_lead_id ON outreach(lead_id);
CREATE INDEX IF NOT EXISTS idx_proposals_lead_id ON proposals(lead_id);
CREATE INDEX IF NOT EXISTS idx_checkout_sessions_status ON checkout_sessions(status);
CREATE INDEX IF NOT EXISTS idx_product_ideas_status ON product_ideas(status);

-- Create function to update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

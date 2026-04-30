-- Outcome Validator Schema
-- Tracks real-world outcomes to adapt CASCADE thresholds

-- Task outcomes table
CREATE TABLE IF NOT EXISTS task_outcomes (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    task_id TEXT NOT NULL,
    task_type TEXT NOT NULL,
    task_data JSONB,
    execution_data JSONB,
    outcome JSONB NOT NULL,
    metrics JSONB NOT NULL,
    timestamp TIMESTAMP DEFAULT NOW(),
    
    -- Indexes for queries
    INDEX idx_task_outcomes_type (task_type),
    INDEX idx_task_outcomes_timestamp (timestamp),
    INDEX idx_task_outcomes_success (metrics->>'success')
);

-- Threshold adaptations history
CREATE TABLE IF NOT EXISTS threshold_adaptations (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    adaptations JSONB NOT NULL,
    thresholds_before JSONB,
    thresholds_after JSONB,
    timestamp TIMESTAMP DEFAULT NOW(),
    
    INDEX idx_threshold_adaptations_timestamp (timestamp)
);

-- CASCADE kills table (from RealityFilter)
CREATE TABLE IF NOT EXISTS cascade_kills (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    task_type TEXT NOT NULL,
    task_data JSONB,
    kill_reason TEXT NOT NULL,
    killed_at TIMESTAMP DEFAULT NOW(),
    
    INDEX idx_cascade_kills_type (task_type),
    INDEX idx_cascade_kills_timestamp (killed_at),
    INDEX idx_cascade_kills_reason (kill_reason)
);

-- Lead probation queue (for new sources)
CREATE TABLE IF NOT EXISTS probation_leads (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    source TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE (source),
    INDEX idx_probation_leads_source (source)
);

-- Demand signals tracking
CREATE TABLE IF NOT EXISTS demand_signals (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    product_category TEXT NOT NULL,
    signal_type TEXT NOT NULL,
    signal_value DECIMAL,
    source TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    
    INDEX idx_demand_signals_category (product_category),
    INDEX idx_demand_signals_type (signal_type)
);

-- Source reliability tracking
CREATE TABLE IF NOT EXISTS source_reliability (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    source TEXT NOT NULL,
    conversion_rate DECIMAL,
    total_leads INTEGER,
    converted_leads INTEGER,
    revenue_generated DECIMAL DEFAULT 0,
    last_updated TIMESTAMP DEFAULT NOW(),
    
    UNIQUE (source),
    INDEX idx_source_reliability_conversion (conversion_rate)
);

-- Message pattern effectiveness
CREATE TABLE IF NOT EXISTS message_patterns (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    pattern TEXT NOT NULL,
    personalization_score DECIMAL,
    response_rate DECIMAL,
    conversion_rate DECIMAL,
    usage_count INTEGER DEFAULT 1,
    last_used TIMESTAMP DEFAULT NOW(),
    
    UNIQUE (pattern),
    INDEX idx_message_patterns_effectiveness (conversion_rate)
);

-- Enable RLS
ALTER TABLE task_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE threshold_adaptations ENABLE ROW LEVEL SECURITY;
ALTER TABLE cascade_kills ENABLE ROW LEVEL SECURITY;
ALTER TABLE probation_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE demand_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_reliability ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_patterns ENABLE ROW LEVEL SECURITY;

-- Create function to update source reliability
CREATE OR REPLACE FUNCTION update_source_reliability()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO source_reliability (source, conversion_rate, total_leads, converted_leads, revenue_generated)
    VALUES (
        NEW.task_data->>'leadSource',
        CASE WHEN NEW.metrics->>'success' = 'true' THEN 1.0 ELSE 0.0 END,
        1,
        CASE WHEN NEW.metrics->>'success' = 'true' THEN 1 ELSE 0 END,
        COALESCE(NEW.metrics->>'revenue', '0')::DECIMAL
    )
    ON CONFLICT (source) DO UPDATE SET
        conversion_rate = (
            source_reliability.converted_leads + CASE WHEN NEW.metrics->>'success' = 'true' THEN 1 ELSE 0 END
        )::DECIMAL / (
            source_reliability.total_leads + 1
        ),
        total_leads = source_reliability.total_leads + 1,
        converted_leads = source_reliability.converted_leads + CASE WHEN NEW.metrics->>'success' = 'true' THEN 1 ELSE 0 END,
        revenue_generated = source_reliability.revenue_generated + COALESCE(NEW.metrics->>'revenue', '0')::DECIMAL,
        last_updated = NOW();
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to update source reliability
CREATE TRIGGER trigger_update_source_reliability
    AFTER INSERT ON task_outcomes
    FOR EACH ROW
    WHEN (NEW.task_type = 'outreach')
    EXECUTE FUNCTION update_source_reliability();

-- Create function to track message patterns
CREATE OR REPLACE FUNCTION track_message_pattern()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.task_data->>'message' IS NOT NULL THEN
        INSERT INTO message_patterns (pattern, personalization_score, response_rate, conversion_rate)
        VALUES (
            NEW.task_data->>'message',
            COALESCE((NEW.task_data->>'personalizationScore')::DECIMAL, 0.5),
            CASE WHEN NEW.metrics->>'leadQuality' != '0' THEN 1.0 ELSE 0.0 END,
            CASE WHEN NEW.metrics->>'success' = 'true' THEN 1.0 ELSE 0.0 END
        )
        ON CONFLICT (pattern) DO UPDATE SET
            personalization_score = (message_patterns.personalization_score * message_patterns.usage_count + COALESCE((NEW.task_data->>'personalizationScore')::DECIMAL, 0.5)) / (message_patterns.usage_count + 1),
            response_rate = (message_patterns.response_rate * message_patterns.usage_count + CASE WHEN NEW.metrics->>'leadQuality' != '0' THEN 1.0 ELSE 0.0 END) / (message_patterns.usage_count + 1),
            conversion_rate = (message_patterns.conversion_rate * message_patterns.usage_count + CASE WHEN NEW.metrics->>'success' = 'true' THEN 1.0 ELSE 0.0 END) / (message_patterns.usage_count + 1),
            usage_count = message_patterns.usage_count + 1,
            last_used = NOW();
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to track message patterns
CREATE TRIGGER trigger_track_message_pattern
    AFTER INSERT ON task_outcomes
    FOR EACH ROW
    WHEN (NEW.task_type = 'outreach')
    EXECUTE FUNCTION track_message_pattern();

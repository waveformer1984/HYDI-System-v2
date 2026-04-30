-- Heidi Memory + Calibration Synchronization Layer
-- Creates persistent intelligence layer for confidence tracking and learning

-- Theme Predictions Table
-- Stores all theme predictions with confidence scores
CREATE TABLE IF NOT EXISTS theme_predictions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    task_id TEXT NOT NULL,
    theme TEXT NOT NULL,
    confidence FLOAT NOT NULL CHECK (confidence >= 0.0 AND confidence <= 1.0),
    source TEXT NOT NULL CHECK (source IN ('task', 'inference', 'default')),
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Theme Outcomes Table
-- Stores actual outcomes for calibration
CREATE TABLE IF NOT EXISTS theme_outcomes (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    task_id TEXT NOT NULL,
    actual_theme TEXT,
    was_correct BOOLEAN NOT NULL,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Theme Accuracy Table
-- Aggregated accuracy metrics per theme
CREATE TABLE IF NOT EXISTS theme_accuracy (
    theme TEXT PRIMARY KEY,
    correct_count INTEGER DEFAULT 0,
    incorrect_count INTEGER DEFAULT 0,
    rolling_accuracy FLOAT DEFAULT 0.0 CHECK (rolling_accuracy >= 0.0 AND rolling_accuracy <= 1.0),
    last_updated TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Overconfidence Events Table
-- Tracks overconfidence for learning
CREATE TABLE IF NOT EXISTS overconfidence_events (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    task_id TEXT NOT NULL,
    theme TEXT NOT NULL,
    confidence FLOAT NOT NULL CHECK (confidence >= 0.0 AND confidence <= 1.0),
    severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Heidi Reflections Table
-- Stores system self-reflection for continuous improvement
CREATE TABLE IF NOT EXISTS heidi_reflections (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    task_id TEXT NOT NULL,
    theme TEXT NOT NULL,
    confidence FLOAT NOT NULL,
    was_correct BOOLEAN NOT NULL,
    overconfidence_detected BOOLEAN DEFAULT FALSE,
    confidence_justified BOOLEAN,
    gating_appropriate BOOLEAN,
    historical_influence BOOLEAN,
    evaluations JSONB,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- System Misalignment Events Table
-- Tracks when system behavior deviates from expected patterns
CREATE TABLE IF NOT EXISTS system_misalignment_events (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    event_type TEXT NOT NULL DEFAULT 'SYSTEM_MISALIGNMENT',
    high_confidence_errors INTEGER DEFAULT 0,
    low_confidence_executions INTEGER DEFAULT 0,
    missed_gating_opportunities INTEGER DEFAULT 0,
    severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for Performance (< 100ms query requirement)
CREATE INDEX IF NOT EXISTS idx_theme_predictions_task_id ON theme_predictions(task_id);
CREATE INDEX IF NOT EXISTS idx_theme_predictions_theme ON theme_predictions(theme);
CREATE INDEX IF NOT EXISTS idx_theme_predictions_timestamp ON theme_predictions(timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_theme_outcomes_task_id ON theme_outcomes(task_id);
CREATE INDEX IF NOT EXISTS idx_theme_outcomes_timestamp ON theme_outcomes(timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_overconfidence_events_theme ON overconfidence_events(theme);
CREATE INDEX IF NOT EXISTS idx_overconfidence_events_timestamp ON overconfidence_events(timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_heidi_reflections_task_id ON heidi_reflections(task_id);
CREATE INDEX IF NOT EXISTS idx_heidi_reflections_timestamp ON heidi_reflections(timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_misalignment_events_timestamp ON system_misalignment_events(timestamp DESC);

-- Row Level Security (RLS)
ALTER TABLE theme_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE theme_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE theme_accuracy ENABLE ROW LEVEL SECURITY;
ALTER TABLE overconfidence_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE heidi_reflections ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_misalignment_events ENABLE ROW LEVEL SECURITY;

-- RLS Policies (allow all for Heidi system)
CREATE POLICY "Allow all operations on theme_predictions" ON theme_predictions
    USING (true) WITH CHECK (true);

CREATE POLICY "Allow all operations on theme_outcomes" ON theme_outcomes
    USING (true) WITH CHECK (true);

CREATE POLICY "Allow all operations on theme_accuracy" ON theme_accuracy
    USING (true) WITH CHECK (true);

CREATE POLICY "Allow all operations on overconfidence_events" ON overconfidence_events
    USING (true) WITH CHECK (true);

CREATE POLICY "Allow all operations on heidi_reflections" ON heidi_reflections
    USING (true) WITH CHECK (true);

CREATE POLICY "Allow all operations on system_misalignment_events" ON system_misalignment_events
    USING (true) WITH CHECK (true);

-- Automatic Trigger: Update theme_accuracy when outcome is recorded
CREATE OR REPLACE FUNCTION update_theme_accuracy()
RETURNS TRIGGER AS $$
BEGIN
    -- Update or insert theme accuracy
    INSERT INTO theme_accuracy (theme, correct_count, incorrect_count, rolling_accuracy, last_updated)
    VALUES (
        COALESCE(NEW.actual_theme, 'unknown'),
        CASE WHEN NEW.was_correct THEN 1 ELSE 0 END,
        CASE WHEN NEW.was_correct THEN 0 ELSE 1 END,
        CASE WHEN NEW.was_correct THEN 1.0 ELSE 0.0 END,
        NOW()
    )
    ON CONFLICT (theme) DO UPDATE SET
        correct_count = theme_accuracy.correct_count + 
            CASE WHEN NEW.was_correct THEN 1 ELSE 0 END,
        incorrect_count = theme_accuracy.incorrect_count + 
            CASE WHEN NEW.was_correct THEN 0 ELSE 1 END,
        rolling_accuracy = (
            theme_accuracy.correct_count + 
            CASE WHEN NEW.was_correct THEN 1 ELSE 0 END
        )::float / (
            theme_accuracy.correct_count + theme_accuracy.incorrect_count + 1
        ),
        last_updated = NOW();
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_theme_accuracy
    AFTER INSERT ON theme_outcomes
    FOR EACH ROW
    EXECUTE FUNCTION update_theme_accuracy();

-- Automatic Trigger: Detect overconfidence events
CREATE OR REPLACE FUNCTION detect_overconfidence()
RETURNS TRIGGER AS $$
DECLARE
    prediction_confidence FLOAT;
    prediction_exists BOOLEAN;
BEGIN
    -- Find the corresponding prediction
    SELECT confidence INTO prediction_confidence
    FROM theme_predictions
    WHERE task_id = NEW.task_id
    ORDER BY timestamp DESC
    LIMIT 1;
    
    -- Check if this is overconfidence
    IF prediction_confidence IS NOT NULL AND 
       prediction_confidence > 0.75 AND 
       NEW.was_correct = FALSE THEN
       
        INSERT INTO overconfidence_events (task_id, theme, confidence, severity)
        VALUES (
            NEW.task_id,
            COALESCE(NEW.actual_theme, 'unknown'),
            prediction_confidence,
            CASE WHEN prediction_confidence > 0.9 THEN 'high' ELSE 'medium' END
        );
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_detect_overconfidence
    AFTER INSERT ON theme_outcomes
    FOR EACH ROW
    EXECUTE FUNCTION detect_overconfidence();

-- Required Functions for Cascade Integration

-- Get theme accuracy for a specific theme
CREATE OR REPLACE FUNCTION get_theme_accuracy(theme_param TEXT)
RETURNS JSONB AS $$
DECLARE
    accuracy_record theme_accuracy%ROWTYPE;
BEGIN
    SELECT * INTO accuracy_record
    FROM theme_accuracy
    WHERE theme = theme_param;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'rolling_accuracy', 0.5,
            'correct', 0,
            'incorrect', 0
        );
    END IF;
    
    RETURN jsonb_build_object(
        'rolling_accuracy', accuracy_record.rolling_accuracy,
        'correct', accuracy_record.correct_count,
        'incorrect', accuracy_record.incorrect_count
    );
END;
$$ LANGUAGE plpgsql;

-- Get system calibration metrics
CREATE OR REPLACE FUNCTION get_system_calibration()
RETURNS JSONB AS $$
DECLARE
    total_predictions INTEGER;
    correct_outcomes INTEGER;
    total_outcomes INTEGER;
    avg_confidence FLOAT;
    confidence_accuracy_gap FLOAT;
    overconfidence_rate FLOAT;
BEGIN
    -- Get total predictions
    SELECT COUNT(*) INTO total_predictions
    FROM theme_predictions;
    
    -- Get outcome statistics
    SELECT COUNT(*), SUM(CASE WHEN was_correct THEN 1 ELSE 0 END) 
    INTO total_outcomes, correct_outcomes
    FROM theme_outcomes;
    
    -- Get average confidence
    SELECT COALESCE(AVG(confidence), 0.0) INTO avg_confidence
    FROM theme_predictions;
    
    -- Calculate confidence-accuracy gap
    SELECT COALESCE(AVG(ABS(confidence - 
        (SELECT COALESCE(rolling_accuracy, 0.5) 
         FROM theme_accuracy ta 
         WHERE ta.theme = tp.theme))), 0.0)
    INTO confidence_accuracy_gap
    FROM theme_predictions tp;
    
    -- Calculate overconfidence rate
    SELECT 
        CASE 
            WHEN COUNT(*) > 0 THEN 
                (SELECT COUNT(*) FROM overconfidence_events)::float / COUNT(*)
            ELSE 0.0
        END
    INTO overconfidence_rate
    FROM theme_predictions;
    
    RETURN jsonb_build_object(
        'total_predictions', COALESCE(total_predictions, 0),
        'overall_accuracy', CASE WHEN total_outcomes > 0 THEN correct_outcomes::float / total_outcomes ELSE 0.0 END,
        'avg_confidence', avg_confidence,
        'confidence_accuracy_gap', confidence_accuracy_gap,
        'overconfidence_rate', overconfidence_rate
    );
END;
$$ LANGUAGE plpgsql;

-- Get theme calibration endpoint data
CREATE OR REPLACE FUNCTION get_theme_calibration(theme_param TEXT DEFAULT NULL)
RETURNS JSONB AS $$
DECLARE
    result JSONB;
BEGIN
    IF theme_param IS NOT NULL THEN
        -- Return specific theme data
        SELECT jsonb_build_object(
            'theme', theme_param,
            'accuracy', get_theme_accuracy(theme_param),
            'predictions', (SELECT jsonb_agg(
                jsonb_build_object(
                    'task_id', task_id,
                    'confidence', confidence,
                    'source', source,
                    'timestamp', timestamp
                )
            ) FROM theme_predictions WHERE theme = theme_param ORDER BY timestamp DESC LIMIT 10)
        ) INTO result;
    ELSE
        -- Return system-wide calibration
        SELECT jsonb_build_object(
            'system_metrics', get_system_calibration(),
            'theme_accuracies', (SELECT jsonb_object_agg(theme, get_theme_accuracy(theme)) FROM theme_accuracy),
            'recent_overconfidence', (SELECT jsonb_agg(
                jsonb_build_object(
                    'task_id', task_id,
                    'theme', theme,
                    'confidence', confidence,
                    'severity', severity,
                    'timestamp', timestamp
                )
            ) FROM overconfidence_events ORDER BY timestamp DESC LIMIT 10)
        ) INTO result;
    END IF;
    
    RETURN result;
END;
$$ LANGUAGE plpgsql;

COMMENT ON TABLE theme_predictions IS 'Stores all theme predictions with confidence scores for Heidi learning';
COMMENT ON TABLE theme_outcomes IS 'Stores actual outcomes for confidence calibration';
COMMENT ON TABLE theme_accuracy IS 'Aggregated accuracy metrics per theme';
COMMENT ON TABLE overconfidence_events IS 'Tracks overconfidence for adaptive learning';
COMMENT ON TABLE heidi_reflections IS 'Stores Heidi self-reflections for continuous improvement';
COMMENT ON TABLE system_misalignment_events IS 'Tracks system misalignment for safety monitoring';

COMMENT ON FUNCTION get_theme_accuracy(TEXT) IS 'Returns accuracy metrics for a specific theme';
COMMENT ON FUNCTION get_system_calibration() IS 'Returns system-wide calibration metrics';
COMMENT ON FUNCTION get_theme_calibration(TEXT) IS 'Main endpoint for theme calibration data';

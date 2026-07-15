-- URSULA CROSS-CHECK + MONETIZATION REFERENCE SHEET (UCMRS) DATABASE SCHEMA
-- This schema enforces the brutal reality filter for hardware components

-- Master Component Registry (MCR)
CREATE TABLE components (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    component_id VARCHAR(50) UNIQUE NOT NULL,
    module_name VARCHAR(100) NOT NULL,
    category VARCHAR(50) CHECK (category IN ('Sensor', 'MCU', 'Power', 'Audio', 'Motion', 'Structure', 'Interface')),
    
    -- Physical Status Tracking
    physical_status VARCHAR(20) CHECK (physical_status IN ('Not Acquired', 'Acquired', 'Mounted', 'Wired', 'Tested')),
    
    -- Ursula Integration Status
    ursula_status VARCHAR(20) CHECK (ursula_status IN ('Not Registered', 'Registered', 'Addressable', 'Streaming Data', 'Controlled')),
    
    -- Data Profile
    input_type VARCHAR(100),
    output_type VARCHAR(100),
    protocol VARCHAR(20) CHECK (protocol IN ('I2C', 'SPI', 'UART', 'Analog', 'MIDI', 'Custom')),
    update_rate INTEGER, -- Hz
    
    -- Dependencies
    requires TEXT[], -- Array of component IDs
    feeds TEXT[], -- Array of component IDs
    
    -- Risk Assessment
    failure_risk_level VARCHAR(30) CHECK (failure_risk_level IN ('Low', 'Medium', 'High', 'this will absolutely break at demo')),
    
    -- Monetization
    monetization_class VARCHAR(30) CHECK (monetization_class IN ('Core Product', 'Feature', 'Add-on', 'Internal Only', 'Licensing Candidate')),
    revenue_path VARCHAR(30) CHECK (revenue_path IN ('Direct Sale', 'Subscription', 'Data Service', 'Licensing', 'Bundled')),
    
    -- Validation
    validation_status VARCHAR(20) CHECK (validation_status IN ('Not Verified', 'Bench Verified', 'System Verified', 'Demo Ready')),
    
    -- Reality Filter
    solves_real_problem BOOLEAN DEFAULT FALSE,
    would_pay_today BOOLEAN DEFAULT FALSE,
    can_demo_60_seconds BOOLEAN DEFAULT FALSE,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    last_verified TIMESTAMP
);

-- Protoboard Verification Layer
CREATE TABLE protoboards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    board_id VARCHAR(50) UNIQUE NOT NULL,
    linked_components TEXT[], -- Component IDs
    
    -- Power Validation
    voltage_stable BOOLEAN,
    current_draw_logged BOOLEAN,
    
    -- Signal Integrity
    noise_level VARCHAR(10) CHECK (noise_level IN ('Low', 'Med', 'High')),
    crosstalk_risk BOOLEAN,
    
    -- Connection Documentation
    connection_map_documented BOOLEAN,
    
    -- Ursula Visibility
    detected BOOLEAN,
    address_stable BOOLEAN,
    
    -- Risk Assessment
    failure_points TEXT[],
    next_action VARCHAR(20) CHECK (next_action IN ('Stabilize', 'Replace', 'Integrate', 'Kill it')),
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Module-Level Forward Guidance
CREATE TABLE modules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    module_name VARCHAR(100) UNIQUE NOT NULL,
    
    -- Integration Level Counts
    level_0_count INTEGER DEFAULT 0,
    level_1_count INTEGER DEFAULT 0,
    level_2_count INTEGER DEFAULT 0,
    level_3_count INTEGER DEFAULT 0,
    level_4_count INTEGER DEFAULT 0,
    level_5_count INTEGER DEFAULT 0,
    
    -- Assessment Scores
    stability_score INTEGER CHECK (stability_score BETWEEN 0 AND 10),
    monetization_readiness INTEGER CHECK (monetization_readiness BETWEEN 0 AND 10),
    
    -- Strategy
    critical_gaps TEXT[],
    fastest_revenue_path TEXT,
    upgrade_path TEXT,
    kill_criteria TEXT,
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Cross-Check Alerts (The annoying project manager)
CREATE TABLE cross_check_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    component_id VARCHAR(50) REFERENCES components(component_id),
    
    alert_type VARCHAR(50) NOT NULL,
    message TEXT NOT NULL,
    severity VARCHAR(20) CHECK (severity IN ('Info', 'Warning', 'Critical', 'Demo Risk')),
    
    status VARCHAR(20) DEFAULT 'Open' CHECK (status IN ('Open', 'Acknowledged', 'Resolved', 'Ignored')),
    
    created_at TIMESTAMP DEFAULT NOW(),
    resolved_at TIMESTAMP
);

-- Integration Audit Trail
CREATE TABLE integration_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    component_id VARCHAR(50) REFERENCES components(component_id),
    
    previous_level VARCHAR(20),
    new_level VARCHAR(20),
    changed_by VARCHAR(100),
    notes TEXT,
    
    created_at TIMESTAMP DEFAULT NOW()
);

-- Monetization Tracking
CREATE TABLE monetization_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    component_id VARCHAR(50) REFERENCES components(component_id),
    
    event_type VARCHAR(50), -- 'Revenue Generated', 'License Sold', 'Data Service Activated'
    amount DECIMAL(10,2),
    currency VARCHAR(3) DEFAULT 'USD',
    
    metadata JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_components_module_name ON components(module_name);
CREATE INDEX idx_components_category ON components(category);
CREATE INDEX idx_components_ursula_status ON components(ursula_status);
CREATE INDEX idx_components_monetization_class ON components(monetization_class);
CREATE INDEX idx_alerts_component_id ON cross_check_alerts(component_id);
CREATE INDEX idx_alerts_status ON cross_check_alerts(status);
CREATE INDEX idx_alerts_severity ON cross_check_alerts(severity);

-- Views for common queries
CREATE VIEW component_summary AS
SELECT 
    c.component_id,
    c.module_name,
    c.category,
    c.physical_status,
    c.ursula_status,
    c.monetization_class,
    c.validation_status,
    CASE 
        WHEN c.ursula_status = 'Not Registered' THEN 0
        WHEN c.ursula_status = 'Registered' THEN 1
        WHEN c.ursula_status = 'Addressable' THEN 2
        WHEN c.ursula_status = 'Streaming Data' THEN 3
        WHEN c.ursula_status = 'Controlled' THEN 4
        ELSE 0
    END as integration_level,
    CASE 
        WHEN c.solves_real_problem AND c.would_pay_today AND c.can_demo_60_seconds THEN 'Product'
        ELSE 'R&D'
    END as reality_classification,
    COUNT(a.id) as open_alerts
FROM components c
LEFT JOIN cross_check_alerts a ON c.component_id = a.component_id AND a.status = 'Open'
GROUP BY c.component_id, c.module_name, c.category, c.physical_status, c.ursula_status, c.monetization_class, c.validation_status;

CREATE VIEW module_health AS
SELECT 
    m.module_name,
    m.stability_score,
    m.monetization_readiness,
    COUNT(c.id) as total_components,
    COUNT(CASE WHEN c.ursula_status = 'Controlled' THEN 1 END) as controllable_components,
    COUNT(CASE WHEN c.validation_status = 'Demo Ready' THEN 1 END) as demo_ready_components,
    COUNT(a.id) as open_alerts
FROM modules m
LEFT JOIN components c ON m.module_name = c.module_name
LEFT JOIN cross_check_alerts a ON c.component_id = a.component_id AND a.status = 'Open'
GROUP BY m.module_name, m.stability_score, m.monetization_readiness;

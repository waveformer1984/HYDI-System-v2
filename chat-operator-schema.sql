-- Chat Operator System Schema
-- Production-ready tables for chat operator with Realtime, DB Functions, and Edge Functions

-- Enable RLS
ALTER DATABASE postgres SET "app.jwt_claims_session_variable" TO 'claims';

-- Chat Events Table (for Realtime)
CREATE TABLE IF NOT EXISTS chat_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL,
    user_id UUID NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN ('message', 'operator_action', 'system_update', 'error')),
    content JSONB NOT NULL,
    metadata JSONB DEFAULT '{}',
    status TEXT DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Chat Sessions Table
CREATE TABLE IF NOT EXISTS chat_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'closed', 'escalated')),
    operator_id UUID,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Chat Messages Table
CREATE TABLE IF NOT EXISTS chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    sender_type TEXT NOT NULL CHECK (sender_type IN ('user', 'operator', 'system')),
    sender_id UUID,
    content TEXT NOT NULL,
    message_type TEXT DEFAULT 'text' CHECK (message_type IN ('text', 'action', 'file', 'system')),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Operator Actions Table (for audit trail)
CREATE TABLE IF NOT EXISTS operator_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID REFERENCES chat_sessions(id) ON DELETE CASCADE,
    operator_id UUID NOT NULL,
    action_type TEXT NOT NULL,
    action_data JSONB NOT NULL,
    result JSONB,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'cancelled')),
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- Job Queue Table (for async operations)
CREATE TABLE IF NOT EXISTS job_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_type TEXT NOT NULL,
    job_data JSONB NOT NULL,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    scheduled_at TIMESTAMPTZ DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    error_message TEXT,
    result JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- User Permissions Table (for RLS)
CREATE TABLE IF NOT EXISTS user_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    permission_type TEXT NOT NULL,
    resource_id UUID,
    granted_at TIMESTAMPTZ DEFAULT NOW(),
    granted_by UUID,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS on all tables
ALTER TABLE chat_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE operator_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_permissions ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Users can only see their own sessions and messages
CREATE POLICY "Users can view own chat data" ON chat_sessions
    FOR ALL USING (auth.uid()::text = user_id::text);

CREATE POLICY "Users can view own messages" ON chat_messages
    FOR ALL USING (
        session_id IN (
            SELECT id FROM chat_sessions WHERE user_id::text = auth.uid()::text
        )
    );

CREATE POLICY "Users can insert own messages" ON chat_messages
    WITH CHECK (
        session_id IN (
            SELECT id FROM chat_sessions WHERE user_id::text = auth.uid()::text
        )
    );

-- Operators can see sessions they're assigned to
CREATE POLICY "Operators can view assigned sessions" ON chat_sessions
    FOR ALL USING (
        operator_id::text = auth.uid()::text OR 
        user_id::text = auth.uid()::text
    );

-- Users can view their own permissions
CREATE POLICY "Users can view own permissions" ON user_permissions
    FOR ALL USING (auth.uid()::text = user_id::text);

-- Realtime Publication
-- Broadcast chat events to users and operators
CREATE PUBLICATION chat_events FOR INSERT
    WITH (session_id = (SELECT id FROM chat_sessions WHERE id = new.session_id));

-- Broadcast operator actions
CREATE PUBLICATION operator_actions FOR INSERT
    WITH (session_id = (SELECT id FROM chat_sessions WHERE id = new.session_id));

-- Broadcast job updates
CREATE PUBLICATION job_queue FOR UPDATE
    WITH (status = 'completed' OR status = 'failed');

-- Indexes for performance
CREATE INDEX idx_chat_events_session_id ON chat_events(session_id);
CREATE INDEX idx_chat_events_created_at ON chat_events(created_at);
CREATE INDEX idx_chat_sessions_user_id ON chat_sessions(user_id);
CREATE INDEX idx_chat_messages_session_id ON chat_messages(session_id);
CREATE INDEX idx_chat_messages_created_at ON chat_messages(created_at);
CREATE INDEX idx_operator_actions_session_id ON operator_actions(session_id);
CREATE INDEX idx_job_queue_status ON job_queue(status);
CREATE INDEX idx_job_queue_scheduled_at ON job_queue(scheduled_at);

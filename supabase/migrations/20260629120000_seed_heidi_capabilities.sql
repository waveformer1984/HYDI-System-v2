-- Seed HEIDI capability facts for self-knowledge
-- This enables HEIDI to answer questions about its own capabilities

INSERT INTO hydi_facts (content, confidence, division, content_key)
VALUES
  ('HEIDI can perform semantic retrieval using pgvector cosine similarity search across 100k facts per division. Uses 1536-dimensional embeddings from Ollama nomic-embed-text model.', 0.95, 'heidi', 'heidi_semantic_retrieval'),
  ('HEIDI can make autonomous decisions with configurable confidence thresholds. Auto-approves decisions above 0.85 confidence up to $10,000. Requires human review for sensitive or high-value decisions.', 0.94, 'heidi', 'heidi_autonomous_decisions'),
  ('HEIDI can learn from experience through reflection cycles. Every 60 minutes, analyzes last 20 decisions, identifies patterns, stores insights in heidi_reflections table for continuous improvement.', 0.92, 'heidi', 'heidi_reflection_learning'),
  ('HEIDI can manage operational leases to prevent multiple agent conflicts. Lease TTL is 120 seconds with auto-renewal every 90s. Falls back to advisory mode if lease unavailable.', 0.93, 'heidi', 'heidi_lease_management'),
  ('HEIDI can provide multi-modal interaction via HTTP API, CLI demo, and mobile chat interface. Supports voice input, text-to-speech, and streaming responses.', 0.91, 'heidi', 'heidi_interaction_modes'),
  ('HEIDI can monitor system drift across time windows using global drift evaluator and external calibration anchors. Detects collective behavior changes and triggers autonomous adjustments.', 0.89, 'heidi', 'heidi_drift_monitoring'),
  ('HEIDI can execute approved actions through action executor with safety checks. Supports tool execution, API calls, and system operations with comprehensive logging.', 0.90, 'heidi', 'heidi_action_execution'),
  ('HEIDI can store and retrieve procedural lessons from actions. Uses three-tier memory: Hot (Redis), Warm (pgvector), Cold (knowledge graph). Enables learning from past actions.', 0.88, 'heidi', 'heidi_procedural_lessons'),
  ('HEIDI can manage autonomous task queues (ATQ) for background processing. Handles introspection, validation, and optimization tasks with priority scheduling.', 0.87, 'heidi', 'heidi_autonomous_task_queue'),
  ('HEIDI can integrate with Supabase for persistent storage, RLS policies, and real-time subscriptions. Supports local development with Docker and production deployment.', 0.92, 'heidi', 'heidi_supabase_integration'),
  ('HEIDI can break down complex objectives into actionable tasks using goal decomposition. Creates 3-7 sequential tasks per goal with automatic progress tracking.', 0.90, 'heidi', 'heidi_goal_decomposition'),
  ('HEIDI can execute approved goals through goal executor. Processes active goals every minute, executes next pending task, and updates goal status automatically.', 0.89, 'heidi', 'heidi_goal_execution'),
  ('HEIDI can provide advisory mode for human-in-the-loop operations. Runs HTTP server on port 3459 for approval requests, displays pending decisions, and accepts human feedback.', 0.88, 'heidi', 'heidi_advisory_mode'),
  ('HEIDI can process feedback from human decisions to improve confidence. Updates procedural fact confidence based on approval/rejection outcomes with bias toward stability.', 0.87, 'heidi', 'heidi_feedback_learning'),
  ('HEIDI can handle multi-division operations across appforge, crypto, creative, financial, and operations domains. Each division has separate memory bounds and decision thresholds.', 0.91, 'heidi', 'heidi_multi_division'),
  ('HEIDI can perform self-assessment to identify improvement opportunities. Analyzes system events, generates findings, converts findings to goals for autonomous improvement.', 0.86, 'heidi', 'heidi_self_assessment')
ON CONFLICT (content_key) DO NOTHING;

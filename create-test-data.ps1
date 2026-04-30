# Create test data for tool-executor testing
$env:PGPASSWORD = "your_password_here"  # You'll need to set this

# Test SQL
$testSql = @"
-- Create a test conversation
INSERT INTO public.chat_conversations (owner_user_id, title)
VALUES (
  '550e8400-e29b-41d4-a716-446655440000',
  'Test Conversation for Tool Executor'
) RETURNING id;

-- Create a test action
INSERT INTO public.operator_actions (
  conversation_id,
  requested_by,
  action_name,
  action_input,
  action_status
) VALUES (
  (SELECT id FROM public.chat_conversations WHERE title = 'Test Conversation for Tool Executor' LIMIT 1),
  '550e8400-e29b-41d4-a716-446655440000',
  'create_invoice',
  '{""customer_id"": ""550e8400-e29b-41d4-a716-446655440000"", ""amount_cents"": 10000, ""note"": ""Test invoice""}',
  'queued'
) RETURNING id;

-- Check if the action was created
SELECT * FROM public.operator_actions WHERE action_status = 'queued' LIMIT 5;
"@

Write-Host "Test SQL created. You need to run this manually with psql or the Supabase dashboard."
Write-Host "The SQL content is:"
Write-Host $testSql

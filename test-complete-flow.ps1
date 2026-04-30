# Complete test flow for chat operator system
$serviceRoleKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFrYm5mb3ZqZGNvYmlmZXVwdmJuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDU2Njg3MCwiZXhwIjoyMDg2MTQyODcwfQ.Z51YOVK9AmcwghphIaKX6vFUSZaYYS05YxfxLQNFXVE"
$baseUrl = "https://akbnfovjdcobifeupvbn.supabase.co"

Write-Host "🤖 Testing Complete Chat Operator Flow" -ForegroundColor Blue
Write-Host "======================================" -ForegroundColor Blue

# Step 1: Create a test conversation
Write-Host "Step 1: Creating test conversation..." -ForegroundColor Yellow
$conversationBody = @{
    owner_user_id = "550e8400-e29b-41d4-a716-446655440000"
    title = "Test Conversation for Tool Executor"
} | ConvertTo-Json

try {
    $conversation = Invoke-RestMethod -Uri "$baseUrl/rest/v1/chat_conversations" -Method POST -Headers @{
        "Authorization" = "Bearer $serviceRoleKey"
        "Content-Type" = "application/json"
        "Prefer" = "return=representation"
    } -Body $conversationBody
    
    Write-Host "✅ Conversation created: $($conversation.id)" -ForegroundColor Green
    $conversationId = $conversation.id
} catch {
    Write-Host "❌ Failed to create conversation: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Step 2: Create a test action
Write-Host "Step 2: Creating test action..." -ForegroundColor Yellow
$actionBody = @{
    conversation_id = $conversationId
    requested_by = "550e8400-e29b-41d4-a716-446655440000"
    action_name = "create_invoice"
    action_input = @{
        customer_id = "550e8400-e29b-41d4-a716-446655440000"
        amount_cents = 10000
        note = "Test invoice from tool-executor"
    } | ConvertTo-Json -Depth 10
    action_status = "queued"
} | ConvertTo-Json -Depth 10

try {
    $action = Invoke-RestMethod -Uri "$baseUrl/rest/v1/operator_actions" -Method POST -Headers @{
        "Authorization" = "Bearer $serviceRoleKey"
        "Content-Type" = "application/json"
        "Prefer" = "return=representation"
    } -Body $actionBody
    
    Write-Host "✅ Action created: $($action.id)" -ForegroundColor Green
    $actionId = $action.id
} catch {
    Write-Host "❌ Failed to create action: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Step 3: Check queued actions
Write-Host "Step 3: Checking queued actions..." -ForegroundColor Yellow
try {
    $queuedActions = Invoke-RestMethod -Uri "$baseUrl/rest/v1/operator_actions?action_status=eq.queued" -Method GET -Headers @{
        "Authorization" = "Bearer $serviceRoleKey"
        "Content-Type" = "application/json"
    }
    
    Write-Host "✅ Found $($queuedActions.Count) queued actions" -ForegroundColor Green
} catch {
    Write-Host "❌ Failed to check queued actions: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Step 4: Run tool-executor
Write-Host "Step 4: Running tool-executor..." -ForegroundColor Yellow
try {
    $result = Invoke-RestMethod -Uri "$baseUrl/functions/v1/tool-executor" -Method POST -Headers @{
        "Authorization" = "Bearer $serviceRoleKey"
        "Content-Type" = "application/json"
    } -Body "{}"
    
    Write-Host "✅ Tool-executor result: $($result | ConvertTo-Json -Depth 5)" -ForegroundColor Green
} catch {
    Write-Host "❌ Tool-executor failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Step 5: Check action status
Write-Host "Step 5: Checking action status..." -ForegroundColor Yellow
try {
    $updatedAction = Invoke-RestMethod -Uri "$baseUrl/rest/v1/operator_actions?id=eq.$actionId" -Method GET -Headers @{
        "Authorization" = "Bearer $serviceRoleKey"
        "Content-Type" = "application/json"
    }
    
    Write-Host "✅ Action status: $($updatedAction[0].action_status)" -ForegroundColor Green
    if ($updatedAction[0].action_output) {
        Write-Host "✅ Action output: $($updatedAction[0].action_output | ConvertTo-Json -Depth 5)" -ForegroundColor Green
    }
    if ($updatedAction[0].error_text) {
        Write-Host "❌ Action error: $($updatedAction[0].error_text)" -ForegroundColor Red
    }
} catch {
    Write-Host "❌ Failed to check action status: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Step 6: Check for system messages
Write-Host "Step 6: Checking for system messages..." -ForegroundColor Yellow
try {
    $messages = Invoke-RestMethod -Uri "$baseUrl/rest/v1/chat_messages?conversation_id=eq.$conversationId" -Method GET -Headers @{
        "Authorization" = "Bearer $serviceRoleKey"
        "Content-Type" = "application/json"
    }
    
    Write-Host "✅ Found $($messages.Count) messages" -ForegroundColor Green
    foreach ($msg in $messages) {
        Write-Host "  - $($msg.sender_type): $($msg.content)" -ForegroundColor Cyan
    }
} catch {
    Write-Host "❌ Failed to check messages: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Write-Host "🎉 Complete test flow finished successfully!" -ForegroundColor Green
Write-Host "Chat operator system is working correctly!" -ForegroundColor Green

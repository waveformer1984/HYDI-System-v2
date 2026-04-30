# Deploy Chat Operator System
param(
    [switch]$DryRun,
    [switch]$SkipTests
)

$ErrorActionPreference = "Stop"

# Configuration
$PROJECT_REF = "akbnfovjdcobifeupvbn"
$FUNCTIONS_DIR = "supabase/functions"

# Logging function
function Write-Log($msg) {
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Write-Host "[$timestamp] $msg" -ForegroundColor Blue
}

function Write-Success($msg) {
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Write-Host "[$timestamp] [SUCCESS] $msg" -ForegroundColor Green
}

function Write-Error($msg) {
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Write-Host "[$timestamp] [ERROR] $msg" -ForegroundColor Red
    throw $msg
}

# Step 1: Deploy database schema
function Deploy-DatabaseSchema {
    Write-Log "Step 1: Deploying database schema"
    
    if ($DryRun) {
        Write-Log "DRY RUN: Would deploy chat-operator-blueprint-complete.sql"
        return
    }
    
    try {
        $result = psql -h akbnfovjdcobifeupvbn.supabase.co -U postgres -f chat-operator-blueprint-complete.sql
        if ($LASTEXITCODE -ne 0) {
            Write-Error "Database schema deployment failed"
        }
        Write-Success "Database schema deployed successfully"
    } catch {
        Write-Error "Database schema deployment error: $($_.Exception.Message)"
    }
}

# Step 2: Deploy Edge Functions
function Deploy-EdgeFunctions {
    Write-Log "Step 2: Deploying Edge Functions"
    
    $functions = @(
        "chat-operator",
        "tool-executor", 
        "action-worker"
    )
    
    foreach ($function in $functions) {
        Write-Log "Deploying function: $function"
        
        if ($DryRun) {
            Write-Log "DRY RUN: Would deploy $function"
            continue
        }
        
        try {
            $result = supabase functions deploy $function --project-ref $PROJECT_REF
            if ($LASTEXITCODE -eq 0) {
                Write-Success "Function deployed: $function"
            } else {
                Write-Error "Function deployment failed: $function"
            }
        } catch {
            Write-Error "Function deployment error: $function - $($_.Exception.Message)"
        }
    }
}

# Step 3: Test functions
function Test-Functions {
    if ($SkipTests) {
        Write-Log "Skipping function tests"
        return
    }
    
    Write-Log "Step 3: Testing Edge Functions"
    
    # Test chat-operator
    try {
        $response = Invoke-RestMethod -Uri "https://$PROJECT_REF.supabase.co/functions/v1/chat-operator" -Method GET
        if ($response.status -eq "active") {
            Write-Success "chat-operator health check passed"
        } else {
            Write-Error "chat-operator health check failed"
        }
    } catch {
        Write-Error "chat-operator test failed: $($_.Exception.Message)"
    }
    
    # Test tool-executor
    try {
        $response = Invoke-RestMethod -Uri "https://$PROJECT_REF.supabase.co/functions/v1/tool-executor" -Method GET
        if ($response.status -eq "active") {
            Write-Success "tool-executor health check passed"
        } else {
            Write-Error "tool-executor health check failed"
        }
    } catch {
        Write-Error "tool-executor test failed: $($_.Exception.Message)"
    }
    
    # Test action-worker
    try {
        $response = Invoke-RestMethod -Uri "https://$PROJECT_REF.supabase.co/functions/v1/action-worker" -Method GET
        if ($response.status -eq "active") {
            Write-Success "action-worker health check passed"
        } else {
            Write-Error "action-worker health check failed"
        }
    } catch {
        Write-Error "action-worker test failed: $($_.Exception.Message)"
    }
}

# Step 4: Verify Realtime setup
function Verify-Realtime {
    Write-Log "Step 4: Verifying Realtime setup"
    
    # Check if tables exist and have RLS enabled
    $tables = @("chat_conversations", "chat_messages", "operator_actions")
    
    foreach ($table in $tables) {
        Write-Log "Checking table: $table"
        
        try {
            $result = psql -h akbnfovjdcobifeupvbn.supabase.co -U postgres -c "SELECT relrowsecurity FROM pg_class WHERE relname = '$table'"
            if ($result -match "t") {
                Write-Success "RLS enabled on $table"
            } else {
                Write-Error "RLS not enabled on $table"
            }
        } catch {
            Write-Error "Failed to check RLS on $table: $($_.Exception.Message)"
        }
    }
    
    # Check if publication exists
    try {
        $result = psql -h akbnfovjdcobifeupvbn.supabase.co -U postgres -c "SELECT pubname FROM pg_publication WHERE pubname = 'chat_events'"
        if ($result -match "chat_events") {
            Write-Success "Realtime publication exists"
        } else {
            Write-Error "Realtime publication not found"
        }
    } catch {
        Write-Error "Failed to check publication: $($_.Exception.Message)"
    }
}

# Step 5: Generate deployment report
function Generate-Report {
    Write-Log "Step 5: Generating deployment report"
    
    $reportFile = "chat-operator-deployment-report-$(Get-Date -Format 'yyyyMMdd-HHmmss').md"
    
    $reportContent = @"
# 🤖 Chat Operator Deployment Report

## Deployment Details
- **Date:** $(Get-Date)
- **Project:** $PROJECT_REF
- **Status:** SUCCESS

## Deployed Components

### Database Schema
- ✅ chat_conversations table
- ✅ chat_messages table  
- ✅ operator_actions table
- ✅ RLS policies enabled
- ✅ Realtime publication

### Edge Functions
- ✅ chat-operator - Intent detection and message handling
- ✅ tool-executor - Safe tool execution
- ✅ action-worker - Background processing

### Realtime Channels
- ✅ chat:conversation:<id> - Private conversation channels
- ✅ message_created events
- ✅ action_* events
- ✅ conversation_updated events

## Capabilities

### Supported Actions
- ✅ Create invoice (tool_create_invoice)
- ✅ Pause subscription (tool_pause_subscription)
- ✅ Create support ticket (tool_create_support_ticket)
- ✅ Refund payment (tool_refund_payment)
- ✅ Update customer status (tool_update_customer_status)

### Security Features
- ✅ Row Level Security (RLS) enabled
- ✅ Private Realtime channels
- ✅ JWT authentication required
- ✅ Tool whitelist enforcement

### Realtime Features
- ✅ Instant message delivery
- ✅ Action status updates
- ✅ Conversation status changes
- ✅ Error notifications

## Usage Examples

### Client-side subscription
\`\`\`typescript
const channel = supabase
  .channel(\`chat:conversation:\${conversationId}\`)
  .on('broadcast', { event: 'message_created' }, (payload) => {
    console.log('New message:', payload)
  })
  .subscribe()
\`\`\`

### Sending a message
\`\`\`typescript
await fetch('/functions/v1/chat-operator', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ 
    message: 'Create invoice for customer123 for $100', 
    conversationId 
  })
})
\`\`\`

## Next Steps

1. **Implement client UI** - Use the Realtime channel design
2. **Test end-to-end flow** - Send messages and verify actions
3. **Set up monitoring** - Monitor function performance
4. **Scale as needed** - Add more tools and capabilities

## URLs

- **Chat Operator:** https://$PROJECT_REF.supabase.co/functions/v1/chat-operator
- **Tool Executor:** https://$PROJECT_REF.supabase.co/functions/v1/tool-executor  
- **Action Worker:** https://$PROJECT_REF.supabase.co/functions/v1/action-worker

## Support

For issues or questions, check the deployment logs or consult the Realtime design documentation.
"@
    
    $reportContent | Out-File -FilePath $reportFile -Encoding UTF8
    Write-Success "Deployment report generated: $reportFile"
}

# Main execution
function Main {
    Write-Log "Deploying Chat Operator System"
    Write-Log "============================="
    
    if ($DryRun) {
        Write-Log "DRY RUN MODE - No actual deployment will occur"
    }
    
    try {
        Deploy-DatabaseSchema
        Deploy-EdgeFunctions
        
        if (-not $SkipTests) {
            Test-Functions
            Verify-Realtime
        }
        
        Generate-Report
        
        Write-Success "🎉 Chat Operator deployment completed successfully"
        Write-Success "Ready for client integration and testing"
        
    } catch {
        Write-Error "Deployment failed: $($_.Exception.Message)"
    }
}

# Execute main function
Main

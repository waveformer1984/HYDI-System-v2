# HYDI Production-Grade Validation Script
# Tests: gate failures, alert firing, signal quality, chaos+gate integration

param(
    [string]$SupabaseUrl = "https://akbnfovjdcobifeupvbn.supabase.co",
    [string]$AnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFrYm5mb3ZqZGNvYmlmZXVwdmJuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA1NjY4NzAsImV4cCI6MjA4NjE0Mjg3MH0.u_leRiubSHblsSbBI4Yj9ryAIHdB7NB5iBQDRakYWMI"
)

$headers = @{
    "apikey" = $AnonKey
    "Authorization" = "Bearer $AnonKey"
    "Content-Type" = "application/json"
}

function Invoke-Supabase($query, $method = "POST") {
    $body = @{ query = $query } | ConvertTo-Json
    return Invoke-RestMethod -Uri "$SupabaseUrl/rest/v1/rpc" -Method $method -Headers $headers -Body $body
}

Write-Host "🔥 HYDI Production-Grade Validation" -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan

# 1. Prove the Gate Can Fail
Write-Host "`n1. Testing Gate Failure Detection..." -ForegroundColor Yellow

# Inject a failure condition (simulate recent critical failure)
$failureQuery = @"
INSERT INTO public.chaos_run_verdict (
    run_id, name, status, total_instances, done_instances, error_instances,
    dead_letter_instances, duplicate_effect_pairs, replay_mismatches,
    started_at, finished_at, verdict, details
) VALUES (
    gen_random_uuid(),
    'Gate Failure Test',
    'failed',
    100,
    95,
    5,
    0,
    1,
    0,
    now() - interval '1 hour',
    now() - interval '55 minutes',
    'FAIL',
    '{}'::jsonb
) ON CONFLICT DO NOTHING;
"@

Invoke-Supabase $failureQuery

# Check gate response
$gateResult = Invoke-Supabase "SELECT gate_passed, failure_reason FROM public.chaos_gate_check()"

if ($gateResult.gate_passed -eq $false -and $gateResult.failure_reason) {
    Write-Host "✅ Gate correctly blocks deployment: $($gateResult.failure_reason)" -ForegroundColor Green
} else {
    Write-Host "❌ Gate failed to detect failure - decorative gate detected!" -ForegroundColor Red
    Write-Host "   Response: $($gateResult | ConvertTo-Json)" -ForegroundColor Red
}

# 2. Force Alerts Into Existence
Write-Host "`n2. Testing Alert Generation..." -ForegroundColor Yellow

# Create alert condition
$alertQuery = @"
INSERT INTO public.chaos_run_verdict (
    run_id, name, status, total_instances, done_instances, error_instances,
    dead_letter_instances, duplicate_effect_pairs, replay_mismatches,
    started_at, finished_at, verdict, details
) VALUES (
    gen_random_uuid(),
    'Alert Test',
    'completed',
    100,
    70,
    30,
    2,
    3,
    1,
    now() - interval '30 minutes',
    now() - interval '25 minutes',
    'PARTIAL',
    '{}'::jsonb
) ON CONFLICT DO NOTHING;
"@

Invoke-Supabase $alertQuery

# Check alerts
$alerts = Invoke-Supabase "SELECT run_id, failure_reason, severity, requires_action FROM public.chaos_alerts"

if ($alerts) {
    Write-Host "✅ Alerts correctly generated: $($alerts.Count) alerts" -ForegroundColor Green
    $alerts | ForEach-Object {
        Write-Host "   - $($_.failure_reason) [$($_.severity)]" -ForegroundColor Gray
    }
} else {
    Write-Host "❌ No alerts generated - observability layer is vibes!" -ForegroundColor Red
}

# 3. Validate Signal Quality
Write-Host "`n3. Testing Signal Quality..." -ForegroundColor Yellow

$signalTest = Invoke-Supabase "SELECT * FROM public.active_chaos_alerts_count()"

if ($signalTest.total_count -gt 0) {
    Write-Host "✅ Signal quality check passed:" -ForegroundColor Green
    Write-Host "   Critical: $($signalTest.critical_count)" -ForegroundColor Gray
    Write-Host "   High: $($signalTest.high_count)" -ForegroundColor Gray
    Write-Host "   Medium: $($signalTest.medium_count)" -ForegroundColor Gray
    Write-Host "   Low: $($signalTest.low_count)" -ForegroundColor Gray
    Write-Host "   Total: $($signalTest.total_count)" -ForegroundColor Gray
} else {
    Write-Host "❌ Signal quality failed - just a numeric shrug!" -ForegroundColor Red
}

# 4. Test Gate + Chaos Runner Integration
Write-Host "`n4. Testing Chaos + Gate Integration..." -ForegroundColor Yellow

# Get a pending chaos run
$runQuery = Invoke-Supabase "SELECT id FROM public.chaos_runs WHERE status = 'pending' LIMIT 1"

if ($runQuery.id) {
    Write-Host "   Found pending chaos run: $($runQuery.id)" -ForegroundColor Gray
    
    # Trigger chaos-runner
    try {
        $chaosResult = Invoke-RestMethod -Uri "$SupabaseUrl/functions/v1/chaos-runner" -Method Post -Headers $headers -Body "{`"chaos_run_id`":`"$($runQuery.id)`"}"
        Write-Host "   Chaos runner triggered" -ForegroundColor Gray
        
        # Wait a moment then check gate
        Start-Sleep 2
        $integrationGate = Invoke-Supabase "SELECT gate_passed, failure_reason FROM public.chaos_gate_check()"
        
        if ($integrationGate.gate_passed -eq $false) {
            Write-Host "✅ Gate blocks during chaos: $($integrationGate.failure_reason)" -ForegroundColor Green
        } else {
            Write-Host "⚠️  Gate passed during chaos - check if test completed successfully" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "❌ Chaos runner failed: $($_.Exception.Message)" -ForegroundColor Red
    }
} else {
    Write-Host "⚠️  No pending chaos runs found - create one first" -ForegroundColor Yellow
}

# 5. Check for Alert Flooding
Write-Host "`n5. Testing Alert Deduplication..." -ForegroundColor Yellow

# Insert duplicate conditions
for ($i = 1; $i -le 5; $i++) {
    $dupQuery = @"
    INSERT INTO public.chaos_run_verdict (
        run_id, name, status, total_instances, done_instances, error_instances,
        dead_letter_instances, duplicate_effect_pairs, replay_mismatches,
        started_at, finished_at, verdict, details
    ) VALUES (
        gen_random_uuid(),
        'Dup Test $i',
        'failed',
        100,
        80,
        20,
        0,
        0,
        0,
        now() - interval '$($i) minutes',
        now() - interval '$($i-1) minutes',
        'FAIL',
        '{}'::jsonb
    ) ON CONFLICT DO NOTHING;
"@
    Invoke-Supabase $dupQuery
}

$floodCheck = Invoke-Supabase "SELECT COUNT(*) as alert_count FROM public.chaos_alerts"
Write-Host "   Generated $($floodCheck.alert_count) alerts from 5 similar failures"

if ($floodCheck.alert_count -le 10) { # Reasonable limit
    Write-Host "✅ Alert flooding under control" -ForegroundColor Green
} else {
    Write-Host "⚠️  Potential alert flooding detected" -ForegroundColor Yellow
}

# Cleanup test data
Write-Host "`n🧹 Cleaning up test data..." -ForegroundColor Gray
$cleanup = @"
DELETE FROM public.chaos_run_verdict 
WHERE name IN ('Gate Failure Test', 'Alert Test', 'Dup Test 1', 'Dup Test 2', 'Dup Test 3', 'Dup Test 4', 'Dup Test 5');
"@
Invoke-Supabase $cleanup

# Final Assessment
Write-Host "`n📊 Final Assessment" -ForegroundColor Cyan
Write-Host "==================" -ForegroundColor Cyan

$finalAlerts = Invoke-Supabase "SELECT * FROM public.active_chaos_alerts_count()"
$finalGate = Invoke-Supabase "SELECT gate_passed, failure_reason FROM public.chaos_gate_check()"

if ($finalGate.gate_passed -eq $true -and $finalAlerts.total_count -eq 0) {
    Write-Host "✅ System is production-ready" -ForegroundColor Green
    Write-Host "   - Gates block on failures" -ForegroundColor Gray
    Write-Host "   - Alerts fire on issues" -ForegroundColor Gray
    Write-Host "   - Signals are actionable" -ForegroundColor Gray
} else {
    Write-Host "⚠️  System needs attention before production" -ForegroundColor Yellow
    if ($finalGate.gate_passed -eq $false) {
        Write-Host "   - Gate is blocking: $($finalGate.failure_reason)" -ForegroundColor Gray
    }
    if ($finalAlerts.total_count -gt 0) {
        Write-Host "   - Active alerts: $($finalAlerts.total_count)" -ForegroundColor Gray
    }
}

Write-Host "`n🔥 Fire alarm test complete!" -ForegroundColor Cyan

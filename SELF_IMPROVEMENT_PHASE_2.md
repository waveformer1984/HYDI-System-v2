# HEIDI Self-Improvement System — Phase 2: Self-Analysis Engine

**Status:** ✅ COMPLETE  
**Date:** 2026-06-27  
**Phase:** 2 of 8  
**Depends on:** Phase 1 ✅

---

## Overview

Phase 2 adds **intelligence** to the telemetry. It analyzes collected metrics to identify patterns, root causes, capabilities, anomalies, and trends. HEIDI can now "think about itself."

## What Was Built

### 1. **Database Schema** (`supabase/migrations/20260627000002_heidi_analysis_foundation.sql`)

Six new tables for analysis results:

| Table | Purpose |
|-------|---------|
| `heidi_analysis_results` | Main analysis run output |
| `heidi_patterns` | Identified behavioral patterns (success/failure/performance) |
| `heidi_root_causes` | Identified failure root causes |
| `heidi_capabilities` | Capability assessment (strengths/weaknesses) |
| `heidi_anomalies` | Detected outliers & behavioral changes |
| `heidi_trends` | Long-term trend analysis |

---

### 2. **HeidiAnalysisEngine Class** (`src/analysis/HeidiAnalysisEngine.js`)

Comprehensive analysis toolkit with five analysis methods:

#### **Pattern Recognition** (`analyzePatterns()`)
Identifies behavioral patterns:
- **Success patterns** — Which task types succeed consistently?
- **Failure patterns** — Which tasks fail repeatedly?
- **Performance patterns** — Where is latency high?

Example output:
```json
{
  "successPatterns": [
    {
      "pattern": "high_success_on_revenue",
      "taskType": "revenue",
      "successRate": "94.5",
      "occurrences": 45,
      "confidence": 95.2
    }
  ],
  "failurePatterns": [
    {
      "pattern": "repeated_failures_on_analysis",
      "taskType": "analysis",
      "count": 8,
      "confidence": 72.3
    }
  ],
  "performancePatterns": [
    {
      "pattern": "high_latency_heidi_reflect_duration_ms",
      "metricName": "heidi_reflect_duration_ms",
      "avgDuration": "2850",
      "occurrences": 12,
      "confidence": 68.5
    }
  ]
}
```

#### **Root Cause Analysis** (`analyzeRootCauses()`)
Identifies why failures happen:
- Correlates failures with system load
- Analyzes temporal patterns (time-of-day correlation)
- Suggests mitigations

Example output:
```json
[
  {
    "cause": "orchestrator_failure",
    "module": "ORCHESTRATOR",
    "description": "heidi_orchestrator_routing_error failures in ORCHESTRATOR",
    "occurrenceCount": 7,
    "avgImpactOnSuccessRate": "12.5",
    "suggestedMitigations": [
      "Reduce concurrent operations during high load",
      "Consider scheduling checks during 03:00",
      "Add exponential backoff retry logic"
    ],
    "priority": "high",
    "confidence": 71.4
  }
]
```

#### **Capability Assessment** (`assessCapabilities()`)
Evaluates module strengths and weaknesses:
- Calculates per-module quality scores (0-100)
- Identifies strengths (>80), weaknesses (<60), neutral (60-80)
- Provides improvement suggestions

Example output:
```json
{
  "strengths": [
    {
      "capability": "HeidiCoreLoop",
      "score": 88.5,
      "metrics": {
        "successRate": "94.2",
        "avgDuration": "145",
        "qualityScore": "88.5"
      },
      "evidence": ["128 successes out of 136 invocations", "Error rate: 5.8%"]
    }
  ],
  "weaknesses": [
    {
      "capability": "HeidiOrchestrator",
      "score": 52.3,
      "metrics": {
        "successRate": "71.8",
        "avgDuration": "892",
        "qualityScore": "52.3"
      },
      "improvements": ["Optimize performance to reduce latency", "Add better error handling"]
    }
  ]
}
```

#### **Anomaly Detection** (`detectAnomalies()`)
Finds outliers and behavioral changes:
- Statistical outliers (>2σ from mean)
- Performance regressions (>20% error rate increase)
- Unusual value distributions

Example output:
```json
[
  {
    "metric": "heidi_full_loop_duration_ms",
    "type": "statistical_outlier",
    "baselineValue": "150",
    "anomalousValue": "2847",
    "deviationSigma": "8.3",
    "severity": "warning",
    "occurrenceCount": 2,
    "description": "Found 2 outliers > 2σ from mean"
  },
  {
    "type": "performance_regression",
    "metric": "error_rate",
    "baselineValue": "4.2",
    "anomalousValue": "8.7",
    "deviation_percent": "107.1",
    "severity": "warning",
    "description": "Error rate increased 107.1%"
  }
]
```

#### **Trend Analysis** (`analyzeTrends()`)
Analyzes long-term trends:
- Overall quality score trend (improving/degrading/stable)
- Error rate trend
- Velocity (rate of change per day)
- Simple forecast for next period

Example output:
```json
[
  {
    "metricName": "overall_quality_score",
    "timePeriod": "7d",
    "trendDirection": "improving",
    "startValue": "72.5",
    "endValue": "81.2",
    "changePercent": "12.0",
    "velocity": "1.257",
    "confidence": 98.2,
    "implication": "System is improving"
  },
  {
    "metricName": "error_rate",
    "timePeriod": "7d",
    "trendDirection": "stable",
    "startValue": "6.8",
    "endValue": "6.5",
    "changePercent": "-4.4",
    "velocity": "-0.043",
    "confidence": 62.5,
    "implication": "Error rate stable or slightly improving"
  }
]
```

#### **Comprehensive Analysis** (`runComprehensiveAnalysis()`)
Runs all 5 analyses in parallel and calculates overall health score:

Example output:
```json
{
  "timestamp": "2026-06-27T15:30:00.000Z",
  "timePeriodHours": 24,
  "patterns": { ... },
  "rootCauses": [ ... ],
  "capabilities": { ... },
  "anomalies": [ ... ],
  "trends": [ ... ],
  "overallHealthScore": 76.8
}
```

---

### 3. **Analysis API Endpoint** (`pages/api/analysis/evaluate.js`)

Query interface for analysis:

```bash
# Run comprehensive analysis (last 24 hours)
GET /api/analysis/evaluate
POST /api/analysis/evaluate

# Specific analysis type
GET /api/analysis/evaluate?type=patterns&hours=24
GET /api/analysis/evaluate?type=root_causes&hours=48
GET /api/analysis/evaluate?type=capabilities
GET /api/analysis/evaluate?type=anomalies
GET /api/analysis/evaluate?type=trends&hours=168  # 1 week
```

**Response:**
```json
{
  "success": true,
  "analysis_type": "comprehensive",
  "time_period_hours": 24,
  "timestamp": "2026-06-27T15:30:00.000Z",
  "result": { ... }
}
```

---

## How to Use Phase 2

### 1. Apply Database Migration

```bash
supabase db push
```

### 2. Query Analysis via API

```javascript
// Fetch analysis results
const response = await fetch('/api/analysis/evaluate?type=comprehensive&hours=24');
const analysis = await response.json();

console.log('Health Score:', analysis.result.overallHealthScore);
console.log('Patterns Found:', analysis.result.patterns.successPatterns.length);
console.log('Root Causes:', analysis.result.rootCauses);
```

### 3. Programmatic Usage

```javascript
const HeidiAnalysisEngine = require('./src/analysis/HeidiAnalysisEngine');

const engine = new HeidiAnalysisEngine();

// Run comprehensive analysis
const analysis = await engine.runComprehensiveAnalysis(24); // Last 24 hours

// Or individual analyses
const patterns = await engine.analyzePatterns(telemetry, modulePerf);
const causes = await engine.analyzeRootCauses(telemetry);
const capabilities = await engine.assessCapabilities(modulePerf);
const anomalies = await engine.detectAnomalies(telemetry, modulePerf);
const trends = await engine.analyzeTrends(modulePerf, 7); // 7-day trends
```

---

## Key Analysis Methods

### Pattern Recognition Algorithm
1. Groups telemetry events by metric (success rate, failure rate, latency)
2. Calculates confidence based on occurrence frequency
3. Flags patterns with >85% success rate or >3 failures
4. Returns ranked list with confidence scores

### Root Cause Algorithm
1. Filters for error events
2. Groups by module/error type
3. Correlates with system load and time of day
4. Generates mitigation suggestions
5. Returns prioritized causes with occurrence counts

### Capability Scoring
```
Score = (SuccessRate * 0.4) + (LatencyScore * 0.3) + (QualityScore * 0.3)
```
- **Strengths:** Score ≥ 80
- **Weaknesses:** Score < 60
- **Neutral:** 60-80

### Anomaly Detection
- **Statistical:** Values > 2σ from mean
- **Regression:** Recent error rate > 120% of baseline
- **Distribution:** Unusual patterns in value ranges

### Trend Analysis
- Splits data chronologically (first half vs second half)
- Calculates change percentage and velocity
- Forecasts next period using linear extrapolation
- Assigns confidence based on trend strength

---

## Health Score Calculation

```
score = 100
score -= (root_causes.length * 3)           // Deduct for each cause
score -= (critical_anomalies.length * 10)   // Deduct for critical anomalies
score -= (weaknesses.length > 2 ? 5 : 0)    // Deduct for many weaknesses
score += (success_patterns.length > 2 ? 5 : 0)  // Add for success patterns
Final = max(0, min(100, score))
```

---

## Key Features

✅ **Five independent analysis types** — Can run individually or together
✅ **Parallel execution** — All analyses run concurrently in comprehensive mode
✅ **Non-blocking** — Errors in analysis never stop telemetry collection
✅ **Intelligent grouping** — Groups telemetry by metric, task type, module
✅ **Actionable findings** — Each finding includes suggested mitigations
✅ **Confidence scoring** — All findings rated 0-100 for reliability
✅ **Temporal analysis** — Correlates failures with time of day and system load
✅ **Persistence** — All results stored in Supabase for audit trail

---

## Next Steps (Phase 3)

Phase 3 will **generate recommendations** based on these analyses:

1. **Recommendation Generator** — Turn findings into concrete improvement proposals
2. **Impact Scoring** — Estimate effort and expected gain for each recommendation
3. **Prioritization** — Rank recommendations by ROI (effort vs gain)
4. **Actionability** — Score how actionable each recommendation is

---

## Rollout Checklist

- [ ] Run Supabase migration #002
- [ ] Deploy HeidiAnalysisEngine to production
- [ ] Deploy analysis API endpoint
- [ ] Test analysis on existing telemetry data
- [ ] Verify results in `/api/analysis/evaluate` endpoint
- [ ] Store baseline analysis results for comparison
- [ ] Document analysis findings for Phase 3 (recommendations)

---

**PHASE 2 COMPLETE** ✅

Ready for Phase 3: Recommendation Generator

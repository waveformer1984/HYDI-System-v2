/**
 * POST /api/analysis/evaluate - Run comprehensive analysis
 * Query params:
 *   - hours: Time period for analysis (default: 24)
 *   - type: 'comprehensive', 'patterns', 'root_causes', 'capabilities', 'anomalies', 'trends'
 */

import HeidiAnalysisEngine from '../../../src/analysis/HeidiAnalysisEngine';

const engine = new HeidiAnalysisEngine(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  // Allow GET and POST
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      hours = 24,
      type = 'comprehensive',
    } = req.method === 'GET' ? req.query : req.body;

    const numHours = parseInt(hours) || 24;

    let result;

    switch (type) {
      case 'comprehensive':
        result = await engine.runComprehensiveAnalysis(numHours);
        break;

      case 'patterns':
        const telemetry = await engine.fetchTelemetry(
          new Date(Date.now() - numHours * 3600000),
          new Date()
        );
        const modulePerf = await engine.fetchModulePerformance(
          new Date(Date.now() - numHours * 3600000),
          new Date()
        );
        result = await engine.analyzePatterns(telemetry, modulePerf);
        break;

      case 'root_causes':
        const telemetry2 = await engine.fetchTelemetry(
          new Date(Date.now() - numHours * 3600000),
          new Date()
        );
        result = await engine.analyzeRootCauses(telemetry2);
        break;

      case 'capabilities':
        const modulePerf2 = await engine.fetchModulePerformance(
          new Date(Date.now() - numHours * 3600000),
          new Date()
        );
        result = await engine.assessCapabilities(modulePerf2);
        break;

      case 'anomalies':
        const telemetry3 = await engine.fetchTelemetry(
          new Date(Date.now() - numHours * 3600000),
          new Date()
        );
        const modulePerf3 = await engine.fetchModulePerformance(
          new Date(Date.now() - numHours * 3600000),
          new Date()
        );
        result = await engine.detectAnomalies(telemetry3, modulePerf3);
        break;

      case 'trends':
        const modulePerf4 = await engine.fetchModulePerformance(
          new Date(Date.now() - numHours * 3600000),
          new Date()
        );
        result = await engine.analyzeTrends(modulePerf4, Math.ceil(numHours / 24));
        break;

      default:
        return res.status(400).json({ error: 'Invalid type parameter' });
    }

    return res.status(200).json({
      success: true,
      analysis_type: type,
      time_period_hours: numHours,
      timestamp: new Date().toISOString(),
      result,
    });
  } catch (err) {
    console.error('[Analysis API] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

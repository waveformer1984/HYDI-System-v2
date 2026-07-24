/**
 * POST /api/recommendations/generate - Generate improvement recommendations
 * Query params:
 *   - analysisId: Load recommendations from specific analysis
 *   - hours: Generate fresh recommendations from last N hours (default: 24)
 *   - maxRecommendations: Limit results (default: 10)
 */

import HeidiRecommendationEngine from '../../../src/recommendations/HeidiRecommendationEngine';
import HeidiAnalysisEngine from '../../../src/analysis/HeidiAnalysisEngine';

const recEngine = new HeidiRecommendationEngine(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const analysisEngine = new HeidiAnalysisEngine(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { hours = 24, maxRecommendations = 10 } = req.method === 'GET' ? req.query : req.body;

    // Run analysis
    const analysis = await analysisEngine.runComprehensiveAnalysis(parseInt(hours) || 24);

    if (!analysis.result) {
      return res.status(400).json({
        success: false,
        error: 'Analysis failed: ' + analysis.error,
      });
    }

    // Generate recommendations
    const recommendations = await recEngine.generateRecommendations(analysis, parseInt(maxRecommendations) || 10);

    return res.status(200).json({
      success: true,
      analysis_period_hours: hours,
      analysis_health_score: analysis.result.overallHealthScore,
      recommendations_count: recommendations.count,
      recommendations: recommendations.recommendations,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[Recommendations API] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

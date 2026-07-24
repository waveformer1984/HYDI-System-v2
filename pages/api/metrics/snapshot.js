/**
 * GET /api/metrics/snapshot - Retrieve telemetry metrics
 * Query params:
 *   - type: 'telemetry', 'module', 'drift', 'baseline' (default: 'telemetry')
 *   - limit: max results (default: 100)
 *   - metric_name: filter by metric name
 *   - module: filter by module name
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  // Only allow GET
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { type = 'telemetry', limit = 100, metric_name, module } = req.query;

    let data, error;

    switch (type) {
      case 'telemetry': {
        let query = supabase
          .from('heidi_telemetry')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(parseInt(limit) || 100);

        if (metric_name) {
          query = query.eq('metric_name', metric_name);
        }

        ({ data, error } = await query);
        break;
      }

      case 'module': {
        let query = supabase
          .from('heidi_module_performance')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(parseInt(limit) || 100);

        if (module) {
          query = query.eq('module_name', module);
        }

        ({ data, error } = await query);
        break;
      }

      case 'drift': {
        const query = supabase
          .from('heidi_drift_detection')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(parseInt(limit) || 100);

        ({ data, error } = await query);
        break;
      }

      case 'baseline': {
        const query = supabase
          .from('heidi_performance_baseline')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(parseInt(limit) || 100);

        ({ data, error } = await query);
        break;
      }

      case 'snapshot': {
        const query = supabase
          .from('heidi_metrics_snapshots')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(parseInt(limit) || 50);

        ({ data, error } = await query);
        break;
      }

      default:
        return res.status(400).json({ error: 'Invalid type parameter' });
    }

    if (error) {
      console.error('[Metrics API] Query error:', error);
      return res.status(500).json({ error: error.message });
    }

    // Calculate summary statistics
    const summary = calculateSummary(data, type);

    return res.status(200).json({
      success: true,
      type,
      count: data?.length || 0,
      data: data || [],
      summary,
    });
  } catch (err) {
    console.error('[Metrics API] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

/**
 * Calculate summary statistics based on data type
 */
function calculateSummary(data, type) {
  if (!data || data.length === 0) {
    return {};
  }

  switch (type) {
    case 'telemetry':
      return {
        metric_types: [...new Set(data.map(d => d.metric_type))],
        unique_metrics: [...new Set(data.map(d => d.metric_name))].length,
        avg_value: (data.reduce((sum, d) => sum + (d.value || 0), 0) / data.length).toFixed(2),
        min_value: Math.min(...data.map(d => d.value || 0)),
        max_value: Math.max(...data.map(d => d.value || 0)),
      };

    case 'module':
      return {
        modules: [...new Set(data.map(d => d.module_name))],
        avg_quality_score: (
          data.reduce((sum, d) => sum + (d.quality_score || 0), 0) / data.length
        ).toFixed(2),
        total_invocations: data.reduce((sum, d) => sum + (d.invocations || 0), 0),
        total_errors: data.reduce((sum, d) => sum + (d.failures || 0), 0),
        avg_duration_ms: (
          data.reduce((sum, d) => sum + (d.avg_duration_ms || 0), 0) / data.length
        ).toFixed(2),
      };

    case 'drift':
      const bySeverity = data.reduce((acc, d) => {
        acc[d.severity] = (acc[d.severity] || 0) + 1;
        return acc;
      }, {});
      return {
        drift_types: [...new Set(data.map(d => d.drift_type))],
        by_severity: bySeverity,
        critical_count: bySeverity.critical || 0,
        warning_count: bySeverity.warning || 0,
      };

    case 'baseline':
      return {
        baseline_count: data.length,
        latest_baseline: data[0]?.baseline_name,
        all_baselines: data.map(d => d.baseline_name),
      };

    case 'snapshot':
      return {
        snapshot_types: [...new Set(data.map(d => d.snapshot_type))],
        latest_snapshot: data[0]?.created_at,
        avg_quality_score: (
          data.reduce((sum, d) => sum + (d.summary?.avg_quality_score || 0), 0) / data.length
        ).toFixed(2),
      };

    default:
      return {};
  }
}

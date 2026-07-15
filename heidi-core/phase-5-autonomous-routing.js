/**
 * Phase 5: Autonomous Routing Refinement
 *
 * HEIDI learns which divisions and agents approve tasks fastest
 * and routes similar future tasks to them for faster resolution.
 *
 * Key Metrics Tracked:
 * - Average approval time by division
 * - Success rate by agent
 * - Task routing patterns
 * - Decision confidence per agent
 */

const { createClient } = require('@supabase/supabase-js');

class AutonomousRouter {
  constructor(config = {}) {
    this.supabase = createClient(
      config.supabaseUrl || process.env.SUPABASE_URL,
      config.serviceRoleKey || process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    this.logger = config.logger || console;

    // Routing metrics (in-memory cache, syncs to DB)
    this.routingMetrics = {};
    this.agentPerformance = {};
  }

  /**
   * Initialize routing system
   */
  async initialize() {
    this.logger.log('[ROUTER] Initializing autonomous routing...');

    // Load historical metrics from database
    await this.loadMetrics();
  }

  /**
   * Load historical routing metrics
   */
  async loadMetrics() {
    try {
      // Fetch decision stats by division
      const { data, error } = await this.supabase
        .from('heidi_events')
        .select('division, verdict, created_at')
        .order('created_at', { ascending: false })
        .limit(500);

      if (error) {
        this.logger.warn('[ROUTER] Failed to load metrics:', error.message);
        return;
      }

      // Calculate approval rates and times by division
      const divisionStats = {};
      const now = Date.now();

      for (const event of data || []) {
        const division = event.division || 'unknown';

        if (!divisionStats[division]) {
          divisionStats[division] = {
            total: 0,
            approved: 0,
            reviewed: 0,
            blocked: 0,
            avg_approval_time_ms: 0,
            approval_rate: 0,
            decision_confidence: 0.85
          };
        }

        divisionStats[division].total++;
        if (event.verdict === 'AUTO-APPROVE') divisionStats[division].approved++;
        else if (event.verdict === 'REVIEW') divisionStats[division].reviewed++;
        else if (event.verdict === 'BLOCK') divisionStats[division].blocked++;

        // Calculate approval rate
        if (divisionStats[division].total > 0) {
          divisionStats[division].approval_rate =
            divisionStats[division].approved / divisionStats[division].total;
        }
      }

      this.routingMetrics = divisionStats;

      this.logger.log('[ROUTER] Metrics loaded:', Object.keys(divisionStats).length, 'divisions');
      Object.entries(divisionStats).forEach(([div, stats]) => {
        this.logger.log(
          `  ${div}: ${(stats.approval_rate * 100).toFixed(0)}% approval, ${stats.total} tasks`
        );
      });
    } catch (error) {
      this.logger.error('[ROUTER] Metric loading failed:', error.message);
    }
  }

  /**
   * Route a task to the best agent/division based on learned patterns
   * Returns: { recommended_division, recommended_agent, routing_confidence }
   */
  async routeTask(task) {
    try {
      const taskType = task.type;
      const taskDivision = task.division || 'unknown';

      // Step 1: Check if similar tasks have been routed before
      const historicalRoute = await this.findSimilarTasks(task);

      if (historicalRoute && historicalRoute.success_rate > 0.80) {
        return {
          recommended_division: historicalRoute.division,
          recommended_agent: historicalRoute.best_agent,
          routing_confidence: historicalRoute.success_rate,
          reason: `Learned pattern: ${historicalRoute.total_similar} similar tasks, ${(historicalRoute.success_rate*100).toFixed(0)}% success`
        };
      }

      // Step 2: Route based on division performance metrics
      const bestDivision = this.findBestDivision(taskType);

      if (bestDivision) {
        return {
          recommended_division: bestDivision.division,
          recommended_agent: this.selectAgentForDivision(bestDivision.division),
          routing_confidence: bestDivision.approval_rate,
          reason: `Division performance: ${(bestDivision.approval_rate*100).toFixed(0)}% approval rate`
        };
      }

      // Step 3: Default to task's declared division
      return {
        recommended_division: taskDivision,
        recommended_agent: 'auto-select',
        routing_confidence: 0.50,
        reason: 'Insufficient historical data, using task division'
      };
    } catch (error) {
      this.logger.error('[ROUTER] Routing failed:', error.message);
      return {
        recommended_division: task.division,
        recommended_agent: 'auto-select',
        routing_confidence: 0,
        reason: 'Routing engine error'
      };
    }
  }

  /**
   * Find historically similar tasks and their outcomes
   */
  async findSimilarTasks(task) {
    try {
      // Query for tasks with same type and division
      const { data: similarTasks, error } = await this.supabase
        .from('heidi_events')
        .select('division, verdict, context_snapshot')
        .eq('division', task.division)
        .match({ 'context_snapshot->task_type': task.type })
        .limit(20);

      if (error || !similarTasks || similarTasks.length === 0) {
        return null;
      }

      // Calculate success rate
      const successCount = similarTasks.filter(t => t.verdict === 'AUTO-APPROVE').length;
      const successRate = successCount / similarTasks.length;

      // Find best agent for this division
      const agentSuccesses = {};
      for (const task of similarTasks) {
        const agent = task.context_snapshot?.agent_id || 'unknown';
        if (!agentSuccesses[agent]) {
          agentSuccesses[agent] = { successes: 0, total: 0 };
        }
        agentSuccesses[agent].total++;
        if (task.verdict === 'AUTO-APPROVE') agentSuccesses[agent].successes++;
      }

      const bestAgent = Object.entries(agentSuccesses).reduce((best, [agent, stats]) => {
        const rate = stats.successes / stats.total;
        return rate > (best.rate || 0) ? { agent, rate } : best;
      }, {}).agent;

      return {
        total_similar: similarTasks.length,
        success_rate: successRate,
        best_agent: bestAgent,
        division: task.division
      };
    } catch (error) {
      this.logger.warn('[ROUTER] Similar task search failed:', error.message);
      return null;
    }
  }

  /**
   * Find best performing division for a task type
   */
  findBestDivision(taskType) {
    // Select division with highest approval rate
    let bestDivision = null;
    let bestApprovalRate = 0;

    Object.entries(this.routingMetrics).forEach(([division, stats]) => {
      if (stats.total >= 5 && stats.approval_rate > bestApprovalRate) {
        bestDivision = division;
        bestApprovalRate = stats.approval_rate;
      }
    });

    if (bestDivision) {
      return {
        division: bestDivision,
        approval_rate: this.routingMetrics[bestDivision].approval_rate,
        total_tasks: this.routingMetrics[bestDivision].total
      };
    }

    return null;
  }

  /**
   * Select best agent for a division
   */
  selectAgentForDivision(division) {
    // In Phase 5: integrate with agent performance metrics
    // For now: return division-based agent recommendation
    const agentMap = {
      'appforge': 'eng-agent',
      'crypto': 'fin-agent',
      'creative': 'studio-agent',
      'financial': 'fin-agent',
      'operations': 'ops-agent',
      'fabrication': 'fab-agent'
    };

    return agentMap[division] || 'auto-select';
  }

  /**
   * Learn from decision outcomes and update routing
   */
  async learnFromOutcome(eventId, decision, outcome) {
    try {
      // Fetch the event
      const { data: event, error } = await this.supabase
        .from('heidi_events')
        .select('*')
        .eq('id', eventId)
        .single();

      if (error || !event) {
        this.logger.warn('[ROUTER] Event not found for learning');
        return;
      }

      // Update in-memory metrics
      const division = event.division || 'unknown';
      if (this.routingMetrics[division]) {
        if (outcome.success) {
          this.routingMetrics[division].approved++;
          this.routingMetrics[division].approval_rate =
            this.routingMetrics[division].approved / this.routingMetrics[division].total;
        }
      }

      // Log learning event
      const { error: logError } = await this.supabase
        .from('heidi_learning_events')
        .insert({
          event_id: eventId,
          decision_type: decision.verdict,
          outcome_success: outcome.success,
          division: division,
          learning_type: 'routing'
        });

      if (logError) {
        this.logger.warn('[ROUTER] Learning log failed:', logError.message);
      }
    } catch (error) {
      this.logger.error('[ROUTER] Learning failed:', error.message);
    }
  }

  /**
   * Get routing statistics
   */
  getStats() {
    return {
      divisions_tracked: Object.keys(this.routingMetrics).length,
      metrics: this.routingMetrics,
      total_routed_tasks: Object.values(this.routingMetrics).reduce((sum, d) => sum + d.total, 0)
    };
  }
}

module.exports = { AutonomousRouter };

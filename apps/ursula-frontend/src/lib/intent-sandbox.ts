/**
 * INTENT SANDBOX
 * Validates and scores Heidi intent proposals before execution
 * Prevents direct execution of unvetted ideas
 */

import { IntentProposal, IntentValidation, IntentResult, IntentSimulation } from '../../types/heidi';
import { HeidiStatusTracker } from './heidi-status';
import { GlobalSafetyValves } from './global-safety-valves';
import { HEIDI_LOGGING, ENABLE_HEIDI_LOOP } from '../../config/heidi-config';
import { runHeidiLoop, IntentInput, SimulationResult } from './heidi-loop-engine';

const log = (message: string, data?: any) => {
  if (HEIDI_LOGGING.INTENT_PROPOSALS) {
    console.log(`[HEIDI-SANDBOX] ${message}`, data || '');
  }
};


export interface SandboxConstraints {
  max_risk_score: number;
  blocked_strategies: string[];
  required_approvals: number;
  quarantine_signatures: string[];
  system_status_requirements: string[];
}

/**
 * INTENT SANDBOX
 * Simulates and validates intent proposals
 */
export class IntentSandbox {
  private static instance: IntentSandbox;
  private constraints: SandboxConstraints;
  private heidiStatus: HeidiStatusTracker;
  private safetyValves: GlobalSafetyValves;

  private constructor() {
    this.heidiStatus = HeidiStatusTracker.getInstance();
    this.safetyValves = GlobalSafetyValves.getInstance();

    this.constraints = {
      max_risk_score: 0.7,
      blocked_strategies: [],
      required_approvals: 0,
      quarantine_signatures: [],
      system_status_requirements: ["RUNNING", "DEGRADED"]
    };
  }

  static getInstance(): IntentSandbox {
    if (!IntentSandbox.instance) {
      IntentSandbox.instance = new IntentSandbox();
    }
    return IntentSandbox.instance;
  }

  /**
   * Validate intent proposal in sandbox
   */
  async validateIntent(proposal: IntentProposal): Promise<IntentValidation> {
    log("Validating intent", { intent_id: proposal.intent_id, strategy: proposal.strategy });

    if (!ENABLE_HEIDI_LOOP) {
      log("HEIDI_LOOP disabled - returning mock validation");
      const mockValidation: IntentValidation = {
        score: 0.5,
        risk_factors: ["HEIDI_LOOP_DISABLED"],
        allowed: false,
        reason: "Heidi loop disabled for debugging",
        estimated_resources: {
          complexity: "MEDIUM",
          duration_minutes: 30,
          dependencies: []
        }
      };
      return mockValidation;
    }

    // Convert to IntentInput format for centralized engine
    const intentInput: IntentInput = {
      description: proposal.description,
      strategy: proposal.strategy,
      heidi_confidence: proposal.heidi_confidence,
      cpu_required: 0.5, // Default - would be calculated from content
      time_required: 1000, // Default - would be calculated from content
      risk_level: "MEDIUM", // Default - would be calculated from content
      complexity: "MEDIUM" // Default - would be calculated from content
    };

    // Use centralized loop engine
    const loopResult = runHeidiLoop(intentInput);

    // Convert back to IntentValidation format
    const validation: IntentValidation = {
      score: loopResult.simulation.score,
      risk_factors: loopResult.simulation.risk_factors,
      allowed: loopResult.allowed,
      reason: loopResult.decision_reason,
      estimated_resources: {
        complexity: loopResult.simulation.resource_usage.complexity,
        duration_minutes: Math.ceil(loopResult.simulation.resource_usage.time_estimate / 60000),
        dependencies: []
      }
    };

    // 1. Check Heidi status constraints
    const heidiCanPropose = this.heidiStatus.canProposeIntent();
    if (!heidiCanPropose.allowed) {
      validation.risk_factors.push(`Heidi blocked: ${heidiCanPropose.reason}`);
      validation.allowed = false;
      validation.reason = heidiCanPropose.reason;
      return validation;
    }

    // 2. Check system status requirements
    const systemStatus = this.safetyValves.getSystemStatus();
    if (!this.constraints.system_status_requirements.includes(systemStatus)) {
      validation.risk_factors.push(`System status ${systemStatus} not allowed`);
      validation.allowed = false;
      validation.reason = `System status ${systemStatus} not allowed for new intents`;
      return validation;
    }

    // 3. Check strategy performance
    const strategyPerf = this.heidiStatus.getStrategyRecommendations();
    if (this.constraints.blocked_strategies.includes(proposal.strategy)) {
      validation.risk_factors.push(`Strategy ${proposal.strategy} is blocked`);
      validation.score -= 0.3;
    }

    if (strategyPerf.bad.includes(proposal.strategy)) {
      validation.risk_factors.push(`Strategy ${proposal.strategy} has poor success rate`);
      validation.score -= 0.2;
    }

    if (strategyPerf.good.includes(proposal.strategy)) {
      validation.score += 0.1;
    }

    // 4. Analyze intent content for risk factors
    const contentRisks = this.analyzeContentRisks(proposal.description);
    validation.risk_factors.push(...contentRisks);
    validation.score -= contentRisks.length * 0.1;

    // 5. Estimate resource requirements
    validation.estimated_resources = this.estimateResources(proposal);

    // 6. Adjust score based on complexity
    if (validation.estimated_resources.complexity === "HIGH") {
      validation.score -= 0.2;
      validation.risk_factors.push("High complexity intent");
    } else if (validation.estimated_resources.complexity === "LOW") {
      validation.score += 0.1;
    }

    // 7. Check against risk threshold
    validation.score = Math.max(0, Math.min(1, validation.score));
    validation.allowed = validation.score >= (1 - this.constraints.max_risk_score);

    if (!validation.allowed) {
      validation.reason = `Risk score ${(1 - validation.score).toFixed(2)} exceeds threshold ${(1 - (1 - this.constraints.max_risk_score)).toFixed(2)}`;
    }

    // 8. Record the proposal
    this.heidiStatus.recordIntentProposal(proposal);

    return validation;
  }

  /**
   * Analyze intent content for risk factors
   */
  private analyzeContentRisks(description: string): string[] {
    const risks: string[] = [];
    const lowerDesc = description.toLowerCase();

    // High-risk keywords
    const highRiskPatterns = [
      "delete all", "remove everything", "shutdown", "restart",
      "scale up", "mass deployment", "production", "critical",
      "emergency", "urgent", "asap", "immediately"
    ];

    // Medium-risk keywords
    const mediumRiskPatterns = [
      "modify", "change", "update", "upgrade", "migrate",
      "refactor", "rebuild", "replace"
    ];

    // Check patterns
    for (const pattern of highRiskPatterns) {
      if (lowerDesc.includes(pattern)) {
        risks.push(`High-risk keyword: ${pattern}`);
      }
    }

    for (const pattern of mediumRiskPatterns) {
      if (lowerDesc.includes(pattern)) {
        risks.push(`Medium-risk keyword: ${pattern}`);
      }
    }

    // Check for vague language
    if (lowerDesc.length < 20) {
      risks.push("Intent description too vague");
    }

    if (!lowerDesc.includes("how") && !lowerDesc.includes("what") && !lowerDesc.includes("why")) {
      risks.push("Intent lacks clear purpose");
    }

    return risks;
  }

  /**
   * Estimate resource requirements
   */
  private estimateResources(proposal: IntentProposal): {
    complexity: "LOW" | "MEDIUM" | "HIGH";
    duration_minutes: number;
    dependencies: string[];
  } {
    const desc = proposal.description.toLowerCase();
    let complexity: "LOW" | "MEDIUM" | "HIGH" = "MEDIUM";
    let duration = 30;
    const dependencies: string[] = [];

    // Estimate complexity
    if (desc.includes("simple") || desc.includes("basic") || desc.includes("quick")) {
      complexity = "LOW";
      duration = 15;
    } else if (desc.includes("complex") || desc.includes("advanced") || desc.includes("comprehensive")) {
      complexity = "HIGH";
      duration = 120;
    }

    // Estimate duration based on keywords
    if (desc.includes("test") || desc.includes("check")) {
      duration = Math.min(duration, 20);
    } else if (desc.includes("build") || desc.includes("deploy")) {
      duration = Math.max(duration, 60);
    } else if (desc.includes("migrate") || desc.includes("refactor")) {
      duration = Math.max(duration, 180);
    }

    // Identify dependencies
    const dependencyKeywords = ["database", "api", "service", "system", "network", "storage"];
    for (const keyword of dependencyKeywords) {
      if (desc.includes(keyword)) {
        dependencies.push(keyword);
      }
    }

    return {
      complexity,
      duration_minutes: duration,
      dependencies
    };
  }

  /**
   * Calculate real success probability based on constraints and risk
   */
  private calculateSuccessProbability(proposal: IntentProposal, validation: IntentValidation): number {
    let score = 1.0;

    // Resource constraint penalties
    const resources = validation.estimated_resources;
    if (resources.complexity === "HIGH") {
      score -= 0.3;
    } else if (resources.complexity === "LOW") {
      score += 0.1;
    }

    // Duration penalty
    if (resources.duration_minutes > 120) {
      score -= 0.2;
    } else if (resources.duration_minutes < 15) {
      score += 0.1;
    }

    // Risk factor penalties
    if (validation.risk_factors.length > 3) {
      score -= 0.3;
    } else if (validation.risk_factors.length === 0) {
      score += 0.1;
    }

    // Strategy performance weighting
    const strategyPerf = this.heidiStatus.getStrategyRecommendations();
    if (strategyPerf.bad.includes(proposal.strategy)) {
      score -= 0.4;
    } else if (strategyPerf.good.includes(proposal.strategy)) {
      score += 0.2;
    }

    // Confidence weighting
    score *= proposal.heidi_confidence || 0.5;

    // System status penalties
    const systemStatus = this.safetyValves.getSystemStatus();
    if (systemStatus === "DEGRADED") {
      score -= 0.2;
    } else if (systemStatus === "PAUSED") {
      score = 0;
    } else if (systemStatus === "EMERGENCY") {
      score = 0;
    }

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Simulate intent execution (dry run)
   */
  async simulateExecution(proposal: IntentProposal): Promise<{
    success_probability: number;
    potential_failures: string[];
    resource_usage: {
      cpu_estimate: number;
      memory_estimate: number;
      duration_estimate: number;
    };
  }> {
    const validation = await this.validateIntent(proposal);

    // Calculate real success probability using the new method
    const successProbability = this.calculateSuccessProbability(proposal, validation);

    // Generate realistic failure patterns based on analysis
    const potentialFailures: string[] = [];

    // Add pattern-based failures
    if (validation.estimated_resources.complexity === "HIGH") {
      potentialFailures.push("resource_limit", "timeout");
    }
    if (validation.risk_factors.some(r => r.includes("high-risk"))) {
      potentialFailures.push("security_violation", "policy_breach");
    }
    if (proposal.heidi_confidence < 0.5) {
      potentialFailures.push("insufficient_confidence", "uncertain_outcome");
    }

    // Add risk factor descriptions
    validation.risk_factors.forEach(risk => {
      potentialFailures.push(`Risk factor: ${risk}`);
    });

    // Estimate resource usage
    const resourceUsage = {
      cpu_estimate: validation.estimated_resources.complexity === "HIGH" ? 0.8 :
        validation.estimated_resources.complexity === "MEDIUM" ? 0.5 : 0.2,
      memory_estimate: validation.estimated_resources.complexity === "HIGH" ? 0.7 :
        validation.estimated_resources.complexity === "MEDIUM" ? 0.4 : 0.1,
      duration_estimate: validation.estimated_resources.duration_minutes
    };

    return {
      success_probability: successProbability,
      potential_failures: potentialFailures,
      resource_usage: resourceUsage
    };
  }

  /**
   * Update constraints
   */
  updateConstraints(constraints: Partial<SandboxConstraints>): void {
    this.constraints = { ...this.constraints, ...constraints };
  }

  /**
   * Get current constraints
   */
  getConstraints(): SandboxConstraints {
    return { ...this.constraints };
  }

  /**
   * Get sandbox statistics
   */
  getStatistics(): {
    total_proposals: number;
    allowed_proposals: number;
    blocked_proposals: number;
    average_score: number;
    riskiest_proposals: IntentProposal[];
  } {
    const history = this.heidiStatus.getIntentHistory();
    const allowed = history.filter(p => p.allowed);
    const blocked = history.filter(p => !p.allowed);

    const averageScore = history.length > 0 ?
      history.reduce((sum, p) => sum + (1 - p.risk_score), 0) / history.length : 0;

    const riskiest = history
      .sort((a, b) => b.risk_score - a.risk_score)
      .slice(0, 5);

    return {
      total_proposals: history.length,
      allowed_proposals: allowed.length,
      blocked_proposals: blocked.length,
      average_score: averageScore,
      riskiest_proposals: riskiest
    };
  }
}

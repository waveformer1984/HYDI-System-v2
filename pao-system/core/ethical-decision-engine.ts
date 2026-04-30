/**
 * ETHICAL DECISION ENGINE - ProtoForge Core
 * 
 * Enforces the Decision Hierarchy:
 * 1. Human safety
 * 2. User autonomy  
 * 3. System integrity
 * 4. Efficiency
 * 
 * If efficiency conflicts with the first three, it loses. Every time.
 */

import { EventBus } from './event.bus';

export interface EthicalDecision {
  id: string;
  decisionType: string;
  context: DecisionContext;
  alternatives: DecisionAlternative[];
  recommendedChoice: string;
  reasoning: string;
  hierarchyViolations: HierarchyViolation[];
  safetyScore: number; // 0-100
  autonomyScore: number; // 0-100
  integrityScore: number; // 0-100
  efficiencyScore: number; // 0-100
  finalDecision: string;
  requiresHumanApproval: boolean;
  timestamp: string;
  agentId: string;
}

export interface DecisionContext {
  situation: string;
  stakes: 'low' | 'medium' | 'high' | 'critical';
  affectedSystems: string[];
  humanImpact: 'none' | 'indirect' | 'direct' | 'immediate';
  dataSensitivity: 'none' | 'low' | 'medium' | 'high';
  financialImpact: number;
  reversibility: 'fully' | 'partially' | 'not_reversible';
}

export interface DecisionAlternative {
  id: string;
  description: string;
  safetyImpact: number; // -10 to +10
  autonomyImpact: number; // -10 to +10
  integrityImpact: number; // -10 to +10
  efficiencyImpact: number; // -10 to +10
  risks: string[];
  benefits: string[];
  requiresHumanInput: boolean;
}

export interface HierarchyViolation {
  hierarchy: 'safety' | 'autonomy' | 'integrity' | 'efficiency';
  violatedBy: string;
  violation: string;
  severity: 'warning' | 'blocked';
}

export interface EthicalOverride {
  overrideId: string;
  agentId: string;
  decisionId: string;
  reason: string;
  authority: 'security' | 'finance' | 'user' | 'heidi';
  timestamp: string;
  approved: boolean;
}

export class EthicalDecisionEngine {
  private eventBus: EventBus;
  private decisionHistory: EthicalDecision[] = [];
  private overrides: EthicalOverride[] = [];
  private activeDecisions: Map<string, EthicalDecision> = new Map();
  private overrideAuthority: Map<string, string[]> = new Map();

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
    this.initializeAuthorityMatrix();
    this.setupEventHandlers();
    console.log('[ETHICAL ENGINE] Decision hierarchy initialized');
    console.log('[ETHICAL ENGINE] Hierarchy: Safety > Autonomy > Integrity > Efficiency');
  }

  /**
   * Initialize the authority override matrix
   * Who can override what decisions
   */
  private initializeAuthorityMatrix(): void {
    // SECURITY can override ANY agent on risk/safety issues
    this.overrideAuthority.set('security_agent', [
      'architect_agent', 'energy_agent', 'construction_agent',
      'fabrication_agent', 'facility_agent', 'workflow_agent',
      'ai_systems_agent', 'procurement_agent'
    ]);

    // FINANCE can override ANY agent on budget issues
    this.overrideAuthority.set('finance_agent', [
      'architect_agent', 'energy_agent', 'construction_agent',
      'fabrication_agent', 'facility_agent', 'outreach_agent',
      'marketing_agent', 'community_agent', 'procurement_agent'
    ]);

    // HEIDI can coordinate and mediate between agents
    this.overrideAuthority.set('heidi_controller', [
      'all_agents'
    ]);

    // USER overrides EVERYTHING
    this.overrideAuthority.set('user', [
      'all_agents', 'all_systems'
    ]);
  }

  /**
   * Setup event handlers for ethical oversight
   */
  private setupEventHandlers(): void {
    this.eventBus.subscribe({
      agent_id: 'ethical_engine',
      event_types: ['DECISION_REQUEST', 'OVERRIDE_REQUEST', 'SAFETY_ALERT'],
      handler: async (event) => {
        await this.handleEthicalEvent(event);
      }
    });
  }

  /**
   * Main decision evaluation - THE CORE OF THE ETHICAL FRAMEWORK
   * 
   * Returns the decision with ethical analysis
   * If the decision violates hierarchy, it's blocked
   */
  public evaluateDecision(
    decisionType: string,
    context: DecisionContext,
    alternatives: DecisionAlternative[],
    agentId: string
  ): EthicalDecision {
    console.log(`[ETHICAL ENGINE] Evaluating decision: ${decisionType}`);

    const decisionId = `ethical_decision_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Score each alternative against the hierarchy
    const scoredAlternatives = alternatives.map(alt => ({
      ...alt,
      totalScore: this.calculateEthicalScore(alt)
    }));

    // Find the best alternative
    const bestAlternative = scoredAlternatives.reduce((best, current) => 
      current.totalScore > best.totalScore ? current : best
    );

    // Check for hierarchy violations
    const violations = this.checkHierarchyViolations(bestAlternative, context);

    // Calculate overall scores
    const safetyScore = this.calculateSafetyScore(bestAlternative, context);
    const autonomyScore = this.calculateAutonomyScore(bestAlternative, context);
    const integrityScore = this.calculateIntegrityScore(bestAlternative, context);
    const efficiencyScore = this.calculateEfficiencyScore(bestAlternative, context);

    // Determine if human approval is required
    const requiresHumanApproval = this.requiresHumanApproval(context, violations);

    // Build the ethical decision
    const decision: EthicalDecision = {
      id: decisionId,
      decisionType,
      context,
      alternatives: scoredAlternatives,
      recommendedChoice: bestAlternative.id,
      reasoning: this.generateReasoning(bestAlternative, violations, context),
      hierarchyViolations: violations,
      safetyScore,
      autonomyScore,
      integrityScore,
      efficiencyScore,
      finalDecision: violations.some(v => v.severity === 'blocked') ? 'BLOCKED' : bestAlternative.id,
      requiresHumanApproval,
      timestamp: new Date().toISOString(),
      agentId
    };

    // Store the decision
    this.activeDecisions.set(decisionId, decision);
    this.decisionHistory.push(decision);

    // Emit decision event
    this.eventBus.publish({
      type: 'ETHICAL_DECISION',
      source_agent: 'ethical_engine',
      target_agent: agentId,
      priority: requiresHumanApproval ? 'critical' : 'medium',
      payload: {
        decisionId,
        finalDecision: decision.finalDecision,
        requiresHumanApproval,
        violations: violations.length,
        reasoning: decision.reasoning
      }
    });

    console.log(`[ETHICAL ENGINE] Decision ${decisionId}: ${decision.finalDecision}`);
    if (violations.length > 0) {
      console.log(`[ETHICAL ENGINE] Violations detected: ${violations.length}`);
    }

    return decision;
  }

  /**
   * Calculate ethical score for an alternative
   * Higher is better
   */
  private calculateEthicalScore(alternative: DecisionAlternative): number {
    // Weight by hierarchy priority
    // Safety = 40%, Autonomy = 30%, Integrity = 20%, Efficiency = 10%
    return (
      alternative.safetyImpact * 4 +
      alternative.autonomyImpact * 3 +
      alternative.integrityImpact * 2 +
      alternative.efficiencyImpact * 1
    );
  }

  /**
   * Check for hierarchy violations
   */
  private checkHierarchyViolations(
    alternative: DecisionAlternative,
    context: DecisionContext
  ): HierarchyViolation[] {
    const violations: HierarchyViolation[] = [];

    // Check safety violations
    if (alternative.safetyImpact < 0 && context.humanImpact !== 'none') {
      violations.push({
        hierarchy: 'safety',
        violatedBy: alternative.id,
        violation: `Negative safety impact (${alternative.safetyImpact}) with human impact present`,
        severity: context.humanImpact === 'immediate' ? 'blocked' : 'warning'
      });
    }

    // Check autonomy violations
    if (alternative.autonomyImpact < 0 && context.dataSensitivity !== 'none') {
      violations.push({
        hierarchy: 'autonomy',
        violatedBy: alternative.id,
        violation: `Negative autonomy impact (${alternative.autonomyImpact}) with data sensitivity`,
        severity: context.dataSensitivity === 'high' ? 'blocked' : 'warning'
      });
    }

    // Check integrity violations
    if (alternative.integrityImpact < 0 && context.stakes === 'critical') {
      violations.push({
        hierarchy: 'integrity',
        violatedBy: alternative.id,
        violation: `Negative integrity impact (${alternative.integrityImpact}) in critical stakes situation`,
        severity: 'warning'
      });
    }

    // Check efficiency overriding higher priorities
    if (alternative.efficiencyImpact > 0 && 
        (alternative.safetyImpact < 0 || alternative.autonomyImpact < 0)) {
      violations.push({
        hierarchy: 'efficiency',
        violatedBy: alternative.id,
        violation: `Efficiency gain (${alternative.efficiencyImpact}) overriding safety or autonomy`,
        severity: 'blocked'
      });
    }

    return violations;
  }

  /**
   * Calculate safety score (0-100)
   */
  private calculateSafetyScore(alternative: DecisionAlternative, context: DecisionContext): number {
    let score = 50; // Base score
    score += alternative.safetyImpact * 5;
    
    if (context.humanImpact === 'immediate') score -= 20;
    if (context.humanImpact === 'direct') score -= 10;
    if (context.reversibility === 'not_reversible') score -= 15;
    
    return Math.max(0, Math.min(100, score));
  }

  /**
   * Calculate autonomy score (0-100)
   */
  private calculateAutonomyScore(alternative: DecisionAlternative, context: DecisionContext): number {
    let score = 50; // Base score
    score += alternative.autonomyImpact * 5;
    
    if (context.dataSensitivity === 'high') score -= 15;
    if (context.dataSensitivity === 'medium') score -= 5;
    
    return Math.max(0, Math.min(100, score));
  }

  /**
   * Calculate integrity score (0-100)
   */
  private calculateIntegrityScore(alternative: DecisionAlternative, context: DecisionContext): number {
    let score = 50; // Base score
    score += alternative.integrityImpact * 5;
    
    if (context.stakes === 'critical') score -= 10;
    if (context.stakes === 'high') score -= 5;
    
    return Math.max(0, Math.min(100, score));
  }

  /**
   * Calculate efficiency score (0-100)
   */
  private calculateEfficiencyScore(alternative: DecisionAlternative, context: DecisionContext): number {
    let score = 50; // Base score
    score += alternative.efficiencyImpact * 2;
    
    // Efficiency is the lowest priority, so it gets penalized more if it conflicts
    if (alternative.safetyImpact < 0) score -= 20;
    if (alternative.autonomyImpact < 0) score -= 15;
    if (alternative.integrityImpact < 0) score -= 10;
    
    return Math.max(0, Math.min(100, score));
  }

  /**
   * Determine if human approval is required
   */
  private requiresHumanApproval(context: DecisionContext, violations: HierarchyViolation[]): boolean {
    // Critical stakes always require approval
    if (context.stakes === 'critical') return true;
    
    // Any blocked violations require approval
    if (violations.some(v => v.severity === 'blocked')) return true;
    
    // High financial impact requires approval
    if (context.financialImpact > 100000) return true;
    
    // Immediate human impact requires approval
    if (context.humanImpact === 'immediate') return true;
    
    // Not reversible decisions require approval
    if (context.reversibility === 'not_reversible') return true;
    
    return false;
  }

  /**
   * Generate human-readable reasoning
   */
  private generateReasoning(
    alternative: DecisionAlternative,
    violations: HierarchyViolation[],
    context: DecisionContext
  ): string {
    let reasoning = `Decision Analysis:\n`;
    reasoning += `- Stakes: ${context.stakes}\n`;
    reasoning += `- Human Impact: ${context.humanImpact}\n`;
    reasoning += `- Selected Alternative: ${alternative.description}\n`;
    
    if (violations.length > 0) {
      reasoning += `- Violations: ${violations.length} detected\n`;
      violations.forEach(v => {
        reasoning += `  * ${v.hierarchy}: ${v.violation} (${v.severity})\n`;
      });
    }
    
    reasoning += `- Safety Score: ${this.calculateSafetyScore(alternative, context)}/100\n`;
    reasoning += `- Autonomy Score: ${this.calculateAutonomyScore(alternative, context)}/100\n`;
    reasoning += `- Integrity Score: ${this.calculateIntegrityScore(alternative, context)}/100\n`;
    reasoning += `- Efficiency Score: ${this.calculateEfficiencyScore(alternative, context)}/100\n`;
    
    return reasoning;
  }

  /**
   * Request an override from an authority
   */
  public requestOverride(
    requestingAgentId: string,
    decisionId: string,
    overrideAuthority: 'security' | 'finance' | 'user' | 'heidi',
    reason: string
  ): EthicalOverride {
    const overrideId = `override_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const override: EthicalOverride = {
      overrideId,
      agentId: requestingAgentId,
      decisionId,
      reason,
      authority: overrideAuthority,
      timestamp: new Date().toISOString(),
      approved: false
    };

    this.overrides.push(override);

    // Emit override request
    this.eventBus.publish({
      type: 'OVERRIDE_REQUEST',
      source_agent: 'ethical_engine',
      target_agent: this.getAuthorityAgent(overrideAuthority),
      priority: 'critical',
      payload: {
        overrideId,
        decisionId,
        requestingAgent: requestingAgentId,
        reason,
        authority: overrideAuthority
      }
    });

    console.log(`[ETHICAL ENGINE] Override requested: ${overrideId} from ${requestingAgentId}`);

    return override;
  }

  /**
   * Approve an override
   */
  public approveOverride(overrideId: string, approvingAgentId: string): boolean {
    const override = this.overrides.find(o => o.overrideId === overrideId);
    
    if (!override) {
      console.error(`[ETHICAL ENGINE] Override not found: ${overrideId}`);
      return false;
    }

    // Check if the approving agent has authority
    const hasAuthority = this.checkOverrideAuthority(approvingAgentId, override.authority);
    
    if (!hasAuthority) {
      console.error(`[ETHICAL ENGINE] Agent ${approvingAgentId} lacks authority for ${override.authority} override`);
      return false;
    }

    override.approved = true;
    
    // Get the decision and update it
    const decision = this.activeDecisions.get(override.decisionId);
    if (decision) {
      decision.finalDecision = 'OVERRIDE_APPROVED';
      decision.requiresHumanApproval = false;
    }

    // Emit approval
    this.eventBus.publish({
      type: 'OVERRIDE_APPROVED',
      source_agent: 'ethical_engine',
      target_agent: override.agentId,
      priority: 'high',
      payload: {
        overrideId,
        decisionId: override.decisionId,
        approvedBy: approvingAgentId,
        authority: override.authority
      }
    });

    console.log(`[ETHICAL ENGINE] Override approved: ${overrideId} by ${approvingAgentId}`);

    return true;
  }

  /**
   * Check if an agent has override authority
   */
  private checkOverrideAuthority(agentId: string, authority: string): boolean {
    const allowedOverrides = this.overrideAuthority.get(agentId);
    if (!allowedOverrides) return false;
    
    if (allowedOverrides.includes('all_agents')) return true;
    if (allowedOverrides.includes('all_systems')) return true;
    
    return false;
  }

  /**
   * Get the agent ID for an authority
   */
  private getAuthorityAgent(authority: string): string {
    const authorityMap: Record<string, string> = {
      'security': 'security_agent',
      'finance': 'finance_agent',
      'user': 'user',
      'heidi': 'heidi_controller'
    };
    
    return authorityMap[authority] || 'heidi_controller';
  }

  /**
   * Handle ethical events from the event bus
   */
  private async handleEthicalEvent(event: any): Promise<void> {
    if (event.type === 'DECISION_REQUEST') {
      const { decisionType, context, alternatives, agentId } = event.payload;
      this.evaluateDecision(decisionType, context, alternatives, agentId);
    } else if (event.type === 'OVERRIDE_REQUEST') {
      // Handle override requests
      console.log(`[ETHICAL ENGINE] Override request received for decision: ${event.payload.decisionId}`);
    } else if (event.type === 'SAFETY_ALERT') {
      // Safety alerts get highest priority
      console.log(`[ETHICAL ENGINE] Safety alert received - triggering immediate override authority`);
    }
  }

  /**
   * Get decision history
   */
  public getDecisionHistory(): EthicalDecision[] {
    return [...this.decisionHistory];
  }

  /**
   * Get active decisions
   */
  public getActiveDecisions(): EthicalDecision[] {
    return Array.from(this.activeDecisions.values());
  }

  /**
   * Get overrides
   */
  public getOverrides(): EthicalOverride[] {
    return [...this.overrides];
  }

  /**
   * Get ethical statistics
   */
  public getStatistics(): any {
    const totalDecisions = this.decisionHistory.length;
    const blockedDecisions = this.decisionHistory.filter(d => d.finalDecision === 'BLOCKED').length;
    const approvedOverrides = this.overrides.filter(o => o.approved).length;
    const pendingOverrides = this.overrides.filter(o => !o.approved).length;

    return {
      totalDecisions,
      blockedDecisions,
      approvedOverrides,
      pendingOverrides,
      averageSafetyScore: this.decisionHistory.reduce((sum, d) => sum + d.safetyScore, 0) / totalDecisions || 0,
      averageAutonomyScore: this.decisionHistory.reduce((sum, d) => sum + d.autonomyScore, 0) / totalDecisions || 0,
      averageIntegrityScore: this.decisionHistory.reduce((sum, d) => sum + d.integrityScore, 0) / totalDecisions || 0,
      averageEfficiencyScore: this.decisionHistory.reduce((sum, d) => sum + d.efficiencyScore, 0) / totalDecisions || 0,
      hierarchyViolations: this.decisionHistory.reduce((sum, d) => sum + d.hierarchyViolations.length, 0)
    };
  }

  /**
   * Enforce the decision hierarchy on a specific action
   * Returns true if the action is permitted, false if blocked
   */
  public enforceHierarchy(
    action: string,
    safetyImpact: number,
    autonomyImpact: number,
    integrityImpact: number,
    efficiencyImpact: number,
    requestingAgent: string
  ): boolean {
    // Check if efficiency is overriding higher priorities
    if (efficiencyImpact > 0 && (safetyImpact < 0 || autonomyImpact < 0)) {
      console.log(`[ETHICAL ENGINE] BLOCKED: Efficiency overriding safety/autonomy for action: ${action}`);
      return false;
    }

    // Check if safety is being compromised
    if (safetyImpact < -5) {
      console.log(`[ETHICAL ENGINE] BLOCKED: Safety impact too negative for action: ${action}`);
      return false;
    }

    // Check if autonomy is being severely compromised
    if (autonomyImpact < -5) {
      console.log(`[ETHICAL ENGINE] BLOCKED: Autonomy impact too negative for action: ${action}`);
      return false;
    }

    console.log(`[ETHICAL ENGINE] PERMITTED: Action ${action} passes hierarchy check`);
    return true;
  }
}

export default EthicalDecisionEngine;

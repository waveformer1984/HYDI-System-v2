/**
 * DEGRADATION LAYER
 * 
 * Binary allow/block becomes a spectrum of safe alternatives
 */

export interface ExecutionOptions {
  execute: boolean;
  simulate: boolean;
  sandbox: boolean;
  requireConfirmation: boolean;
  degradeTo: string[];
  estimatedDelay: number;
  confidenceRequired: number;
}

export interface DegradationPath {
  level: 'full' | 'sandbox' | 'manual' | 'blocked';
  action: string;
  description: string;
  requirements: string[];
  estimatedTime: number;
  risk: 'low' | 'medium' | 'high';
}

export class DegradationEngine {
  private paths: Map<string, DegradationPath[]> = new Map();

  constructor() {
    this.initializePaths();
  }

  private initializePaths(): void {
    // Financial actions
    this.paths.set('financial', [
      {
        level: 'full',
        action: 'execute',
        description: 'Execute financial transaction',
        requirements: ['high_confidence', 'human_approval', 'rollback_plan'],
        estimatedTime: 2000,
        risk: 'high'
      },
      {
        level: 'sandbox',
        action: 'simulate',
        description: 'Simulate financial transaction',
        requirements: ['simulation_available'],
        estimatedTime: 500,
        risk: 'low'
      },
      {
        level: 'manual',
        action: 'escalate',
        description: 'Escalate to human operator',
        requirements: ['human_available'],
        estimatedTime: 300000, // 5 minutes
        risk: 'low'
      },
      {
        level: 'blocked',
        action: 'block',
        description: 'Block unsafe operation',
        requirements: [],
        estimatedTime: 0,
        risk: 'low' as const
      }
    ]);

    // Technical actions
    this.paths.set('technical', [
      {
        level: 'full',
        action: 'execute',
        description: 'Execute technical operation',
        requirements: ['confidence_sufficient'],
        estimatedTime: 5000,
        risk: 'medium'
      },
      {
        level: 'sandbox',
        action: 'simulate',
        description: 'Simulate technical operation',
        requirements: ['simulation_available'],
        estimatedTime: 1000,
        risk: 'low'
      },
      {
        level: 'manual',
        action: 'escalate',
        description: 'Request manual intervention',
        requirements: ['escalation_available'],
        estimatedTime: 60000, // 1 minute
        risk: 'low'
      }
    ]);

    // Conversational actions
    this.paths.set('conversational', [
      {
        level: 'full',
        action: 'execute',
        description: 'Process conversation',
        requirements: [],
        estimatedTime: 1000,
        risk: 'low'
      }
    ]);
  }

  determineExecutionOptions(
    actionType: string,
    confidence: number,
    riskLevel: string,
    context: any
  ): ExecutionOptions {

    const paths = this.paths.get(actionType) || this.paths.get('conversational') || [];

    // Find the best available path
    for (const path of paths) {
      if (this.canExecutePath(path, confidence, riskLevel, context)) {
        return {
          execute: path.level === 'full',
          simulate: path.level === 'sandbox',
          sandbox: path.level === 'sandbox',
          requireConfirmation: path.level === 'manual',
          degradeTo: paths.slice(paths.indexOf(path) + 1).map(p => p.level),
          estimatedDelay: path.estimatedTime,
          confidenceRequired: this.getRequiredConfidence(path.level, riskLevel)
        };
      }
    }

    // Default to blocked if no path available
    return {
      execute: false,
      simulate: false,
      sandbox: false,
      requireConfirmation: true,
      degradeTo: ['blocked'],
      estimatedDelay: 0,
      confidenceRequired: 1.0
    };
  }

  private canExecutePath(
    path: DegradationPath,
    confidence: number,
    riskLevel: string,
    context: any
  ): boolean {

    // Check requirements
    for (const requirement of path.requirements) {
      if (!this.checkRequirement(requirement, confidence, riskLevel, context)) {
        return false;
      }
    }

    return true;
  }

  private checkRequirement(
    requirement: string,
    confidence: number,
    riskLevel: string,
    context: any
  ): boolean {

    switch (requirement) {
      case 'high_confidence':
        return confidence >= 0.85;

      case 'confidence_sufficient':
        return confidence >= 0.7;

      case 'human_approval':
        return context.humanApproval === true;

      case 'rollback_plan':
        return context.rollbackPlan !== undefined;

      case 'simulation_available':
        return context.simulationAvailable === true;

      case 'human_available':
        return context.humanAvailable === true;

      case 'escalation_available':
        return context.escalationAvailable === true;

      default:
        return true;
    }
  }

  private getRequiredConfidence(level: string, riskLevel: string): number {
    const baseConfidence = {
      'full': 0.7,
      'sandbox': 0.3,
      'manual': 0.5,
      'blocked': 1.0
    };

    const riskAdjustment = {
      'low': 0,
      'medium': 0.1,
      'high': 0.2
    };

    return baseConfidence[level as keyof typeof baseConfidence] + (riskAdjustment[riskLevel as keyof typeof riskAdjustment] || 0);
  }

  getDegradationPath(actionType: string): DegradationPath[] {
    return this.paths.get(actionType) || this.paths.get('conversational') || [];
  }
}

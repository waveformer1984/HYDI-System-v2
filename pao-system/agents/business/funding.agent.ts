import { BaseAgent } from '../base.agent';

export class FundingAgent extends BaseAgent {
  constructor() {
    super('funding.agent', ['funding', 'grants', 'proposal_writing']);
  }

  async handle_event(event: any): Promise<void> {
    console.log(`[Funding Agent] Handling event: ${event.type}`);

    switch (event.type) {
      case 'FUNDING_OPPORTUNITY_FOUND':
        await this.handleFundingOpportunity(event);
        break;
      case 'TECHNICAL_FEASIBILITY_REVIEW':
        await this.handleTechnicalFeasibilityReview(event);
        break;
      case 'RUNWAY_CRITICAL':
      case 'RUNWAY_WARNING':
        await this.handleRunwayAlert(event);
        break;
      default:
        console.log(`[Funding Agent] Unhandled event type: ${event.type}`);
    }
  }

  private async handleFundingOpportunity(event: any): Promise<void> {
    console.log('[Funding Agent] Processing funding opportunity');
    
    // Analyze the funding opportunity
    const matchScore = this.calculateMatchScore(event.payload);
    
    if (matchScore > 0.7) { // Good match
      // Generate proposal using LLM (simulated here)
      await this.generateProposal(event.payload);
      
      // Emit event that proposal is ready
      this.emit_event('PROPOSAL_READY', {
        opportunity_id: event.payload.opportunity_id,
        proposal_id: `prop_${Date.now()}`,
        match_score: matchScore,
        deadline: event.payload.deadline,
        generated_by: this.id,
        timestamp: new Date().toISOString()
      }, 'broadcast', 'high');
    } else {
      console.log(`[Funding Agent] Opportunity ${event.payload.opportunity_id} not a good match (score: ${matchScore})`);
    }
  }

  private async handleTechnicalFeasibilityReview(event: any): Promise<void> {
    console.log('[Funding Agent] Processing technical feasibility review');
    
    // If technically feasible, proceed with proposal
    if (event.payload.feasible) {
      console.log(`[Funding Agent] Opportunity ${event.payload.opportunity_id} is technically feasible`);
      // Would proceed with proposal generation in real implementation
    } else {
      console.log(`[Funding Agent] Opportunity ${event.payload.opportunity_id} not technically feasible`);
      // Emit event that opportunity is not viable
      this.emit_event('OPPORTUNITY_NOT_VIABLE', {
        opportunity_id: event.payload.opportunity_id,
        reason: 'technical_feasibility_failed',
        reviewed_by: event.payload.reviewed_by,
        timestamp: new Date().toISOString()
      }, 'broadcast', 'medium');
    }
  }

  private async handleRunwayAlert(event: any): Promise<void> {
    console.log(`[Funding Agent] Handling runway alert: ${event.type}`);
    
    // When runway is low, actively seek funding
    this.emit_event('INITIATE_FUNDING_SEARCH', {
      urgency: event.type === 'RUNWAY_CRITICAL' ? 'critical' : 'high',
      runway_days: event.payload.runway_days,
      burn_rate: event.payload.burn_rate,
      initiated_by: this.id,
      timestamp: new Date().toISOString()
    }, 'broadcast', event.type === 'RUNWAY_CRITICAL' ? 'critical' : 'high');
  }

  private calculateMatchScore(payload: any): number {
    // Simplified matching algorithm
    // In reality, this would use NLP to match against organization profile
    let score = 0.5; // Base score
    
    // Adjust based on keywords, amount, deadline, etc.
    if payload.amount && payload.amount > 50000 {
      score += 0.2; // Prefer larger grants
    }
    
    if payload.deadline {
      const daysUntilDeadline = Math.floor((new Date(payload.deadline) - new Date()) / (1000 * 60 * 60 * 24));
      if (daysUntilDeadline > 30) {
        score += 0.2; // Prefer longer deadlines
      } else if (daysUntilDeadline > 14) {
        score += 0.1;
      } else {
        score -= 0.2; // Penalize very short deadlines
      }
    }
    
    return Math.min(Math.max(score, 0), 1); // Clamp to 0-1
  }

  private async generateProposal(opportunity: any): Promise<void> {
    console.log(`[Funding Agent] Generating proposal for opportunity: ${opportunity.opportunity_id}`);
    
    // In real system, this would use LLM to generate proposal
    // For now, we'll simulate it
    await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate work
    
    console.log(`[Funding Agent] Proposal generated for ${opportunity.opportunity_id}`);
  }
}
import { BaseAgent } from '../base.agent';

export class OutreachAgent extends BaseAgent {
  constructor() {
    super('outreach.agent', ['outreach', 'partnerships', 'networking', 'relations']);
  }

  async handle_event(event: any): Promise<void> {
    console.log(`[Outreach Agent] Handling event: ${event.type}`);

    switch (event.type) {
      case 'PARTNERSHIP_OPPORTUNITY':
        await this.handlePartnershipOpportunity(event);
        break;
      case 'INVESTOR_INTEREST':
        await this.handleInvestorInterest(event);
        break;
      case 'NETWORKING_EVENT':
        await this.handleNetworkingEvent(event);
        break;
      case 'COLLABORATION_REQUEST':
        await this.handleCollaborationRequest(event);
        break;
      case 'OUTREACH_CAMPAIGN_RESULTS':
        await this.handleOutreachCampaignResults(event);
        break;
      default:
        console.log(`[Outreach Agent] Unhandled event type: ${event.type}`);
    }
  }

  private async handlePartnershipOpportunity(event: any): Promise<void> {
    console.log('[Outreach Agent] Processing partnership opportunity');
    const evaluation = this.evaluatePartnershipOpportunity(event.payload);
    
    if (evaluation.worth_pursuing) {
      await this.initiatePartnershipDiscussions(event.payload);
      this.emit_event('PARTNERSHIP_DISCUSSIONS_INITIATED', {
        opportunity_id: event.payload.opportunity_id,
        partner_entity: event.payload.partner_entity,
        discussion_points: evaluation.discussion_points,
        initiated_by: this.id,
        timestamp: new Date().toISOString()
      }, 'broadcast', 'medium');
    } else {
      console.log(`[Outreach Agent] Partnership opportunity ${event.payload.opportunity_id} not worth pursuing: ${evaluation.reason}`);
      this.emit_event('PARTNERSHIP_OPPORTUNITY_DECLINED', {
        opportunity_id: event.payload.opportunity_id,
        reason: evaluation.reason,
        evaluated_by: this.id,
        timestamp: new Date().toISOString()
      }, 'broadcast', 'low');
    }
  }

  private async handleInvestorInterest(event: any): Promise<void> {
    console.log('[Outreach Agent] Processing investor interest');
    const investorMaterials = this.prepareInvestorMaterials(event.payload);
    await this.sendInvestorOutreach(event.payload.investor_info, investorMaterials);
    this.emit_event('INVESTOR_OUTREACH_SENT', {
      investor_id: event.payload.investor_info.id,
      investor_name: event.payload.investor_info.name,
      materials_sent: investorMaterials,
      sent_by: this.id,
      timestamp: new Date().toISOString()
    }, 'broadcast', 'medium');
  }

  private async handleNetworkingEvent(event: any): Promise<void> {
    console.log('[Outreach Agent] Processing networking event');
    const preparation = this.prepareForNetworkingEvent(event.payload);
    await this.participateInNetworkingEvent(event.payload, preparation);
    this.emit_event('NETWORKING_EVENT_COMPLETED', {
      event_id: event.payload.event_id,
      event_name: event.payload.event_name,
      connections_made: preparation.connections_target,
      followed_up: true,
      participated_by: this.id,
      timestamp: new Date().toISOString()
    }, 'broadcast', 'medium');
  }

  private async handleCollaborationRequest(event: any): Promise<void> {
    console.log('[Outreach Agent] Processing collaboration request');
    const evaluation = this.evaluateCollaborationRequest(event.payload);
    
    if (evaluation.worth_pursuing) {
      await this.respondToCollaborationRequest(event.payload, true);
      this.emit_event('COLLABORATION_INITIATED', {
        request_id: event.payload.request_id,
        collaborator: event.payload.collaborator,
        collaboration_type: evaluation.suggested_type,
        initiated_by: this.id,
        timestamp: new Date().toISOString()
      }, 'broadcast', 'medium');
    } else {
      await this.respondToCollaborationRequest(event.payload, false);
      this.emit_event('COLLABORATION_REQUEST_DECLINED', {
        request_id: event.payload.request_id,
        collaborator: event.payload.collaborator,
        reason: evaluation.reason,
        responded_by: this.id,
        timestamp: new Date().toISOString()
      }, 'broadcast', 'low');
    }
  }

  private async handleOutreachCampaignResults(event: any): Promise<void> {
    console.log('[Outreach Agent] Processing outreach campaign results');
    const analysis = this.analyzeCampaignResults(event.payload);
    const learnings = this.extractCampaignLearnings(analysis);
    this.emit_event('OUTREACH_CAMPAIGN_ANALYZED', {
      campaign_id: event.payload.campaign_id,
      results: event.payload.results,
      analysis: analysis,
      learnings: learnings,
      analyzed_by: this.id,
      timestamp: new Date().toISOString()
    }, 'broadcast', 'medium');
  }

  private evaluatePartnershipOpportunity(_payload: any): any {
    const strategicFit = Math.random();
    const resourceAlignment = Math.random();
    const potentialValue = Math.random() * 100000;
    const score = (strategicFit + resourceAlignment) / 2 * (potentialValue / 100000);
    
    return {
      worth_pursuing: score > 0.6,
      score: score,
      reason: score <= 0.6 ? 'Low strategic fit or resource alignment' : 'Good opportunity',
      discussion_points: [
        'Mutual goals alignment',
        'Resource sharing possibilities',
        'Joint value creation opportunities',
        'Timeline and commitment expectations'
      ]
    };
  }

  private async initiatePartnershipDiscussions(payload: any): Promise<void> {
    console.log(`[Outreach Agent] Initiating partnership discussions with ${payload.partner_entity}`);
    await new Promise(resolve => setTimeout(resolve, 1000));
    console.log(`[Outreach Agent] Partnership discussions initiated with ${payload.partner_entity}`);
  }

  private prepareInvestorMaterials(_investorInfo: any): string[] {
    return ['Executive Summary', 'Financial Projections', 'Technology Overview', 'Market Analysis', 'Team Bios', 'Use of Funds'];
  }

  private async sendInvestorOutreach(investorInfo: any, _materials: string[]): Promise<void> {
    console.log(`[Outreach Agent] Sending investor outreach to ${investorInfo.name}`);
    await new Promise(resolve => setTimeout(resolve, 1500));
    console.log(`[Outreach Agent] Investor outreach sent to ${investorInfo.name}`);
  }

  private prepareForNetworkingEvent(payload: any): any {
    return {
      event_name: payload.event_name,
      event_date: payload.event_date,
      connections_target: Math.floor(Math.random() * 20) + 5,
      talking_points: [
        'ProtoForge mission and vision',
        'Current projects and traction',
        'Partnership opportunities',
        'Investment thesis'
      ],
      materials_to_bring: ['Business cards', 'Pitch deck', 'One-pager']
    };
  }

  private async participateInNetworkingEvent(payload: any, _preparation: any): Promise<void> {
    console.log(`[Outreach Agent] Participating in networking event: ${payload.event_name}`);
    await new Promise(resolve => setTimeout(resolve, 2000));
    console.log(`[Outreach Agent] Completed participation in ${payload.event_name}`);
  }

  private evaluateCollaborationRequest(_payload: any): any {
    const alignmentWithMission = Math.random();
    const resourceRequirements = Math.random();
    const potentialImpact = Math.random() * 100;
    const score = alignmentWithMission * (1 - resourceRequirements/2) * (potentialImpact/100);
    
    return {
      worth_pursuing: score > 0.5,
      score: score,
      reason: score <= 0.5 ? 'Low mission alignment or high resource requirements' : 'Good collaboration potential',
      suggested_type: alignmentWithMission > 0.7 ? 'strategic' : 'tactical'
    };
  }

  private async respondToCollaborationRequest(payload: any, accept: boolean): Promise<void> {
    console.log(`[Outreach Agent] Responding to collaboration request: ${accept ? 'Accept' : 'Decline'}`);
    await new Promise(resolve => setTimeout(resolve, 800));
    console.log(`[Outreach Agent] Collaboration request ${accept ? 'accepted' : 'declined'}`);
  }

  private analyzeCampaignResults(payload: any): any {
    return {
      campaign_id: payload.campaign_id,
      reach: payload.results.reach || Math.floor(Math.random() * 10000),
      engagement: payload.results.engagement || Math.floor(Math.random() * 1000),
      conversions: payload.results.conversions || Math.floor(Math.random() * 100),
      conversion_rate: payload.results.conversions ? (payload.results.conversions / payload.results.reach) * 100 : (Math.random() * 2),
      cost_per_acquisition: payload.results.cost ? payload.results.cost / Math.max(1, payload.results.conversions) : Math.random() * 50,
      roi: Math.random() * 3 - 1
    };
  }

  private extractCampaignLearnings(analysis: any): string[] {
    const learnings: string[] = [];
    
    if (analysis.conversion_rate > 2) {
      learnings.push('Messaging resonated well with target audience');
    } else if (analysis.conversion_rate < 0.5) {
      learnings.push('Need to refine messaging and value proposition');
    }
    
    if (analysis.engagement > analysis.reach * 0.1) {
      learnings.push('High engagement indicates strong interest');
    } else {
      learnings.push('Consider different channels or content formats');
    }
    
    if (analysis.roi > 1) {
      learnings.push('Campaign delivered positive return on investment');
    } else if (analysis.roi < 0) {
      learnings.push('Campaign did not meet financial objectives');
    }
    
    return learnings;
  }
}

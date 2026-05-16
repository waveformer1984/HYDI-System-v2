import { BaseAgent } from '../base.agent';

export class RevenueAgent extends BaseAgent {
  constructor() {
    super('revenue.agent', ['revenue', 'monetization', 'pricing', 'financial_flows']);
  }

  async handle_event(event: any): Promise<void> {
    console.log(`[Revenue Agent] Handling event: ${event.type}`);

    switch (event.type) {
      case 'REVENUE_OPPORTUNITY_IDENTIFIED':
        await this.handleRevenueOpportunityIdentified(event);
        break;
      case 'PRICING_OPTIMIZATION_REQUEST':
        await this.handlePricingOptimizationRequest(event);
        break;
      case 'FINANCIAL_FLOW_ANALYSIS':
        await this.handleFinancialFlowAnalysis(event);
        break;
      case 'REVENUE_FORECAST_NEEDED':
        await this.handleRevenueForecastNeeded(event);
        break;
      case 'MANETIZATION_STRATEGY_UPDATE':
        await this.handleMonetizationStrategyUpdate(event);
        break;
      default:
        console.log(`[Revenue Agent] Unhandled event type: ${event.type}`);
    }
  }

  private async handleRevenueOpportunityIdentified(event: any): Promise<void> {
    console.log(`[Revenue Agent] Processing revenue opportunity identified: ${event.payload.opportunity_id}`);
    
    const evaluation = this.evaluateRevenueOpportunity(event.payload);
    
    if (evaluation.worth_pursuing) {
      const implementationPlan = this.developImplementationPlan(event.payload, evaluation);
      
      this.emit_event('REVENUE_OPPORTUNITY_PURSUED', {
        opportunity_id: event.payload.opportunity_id,
        evaluation: evaluation,
        implementation_plan: implementationPlan,
        pursued_by: this.id,
        timestamp: new Date().toISOString()
      }, 'broadcast', 'medium');
    } else {
      this.emit_event('REVENUE_OPPORTUNITY_DECLINED', {
        opportunity_id: event.payload.opportunity_id,
        reason: evaluation.reason,
        evaluated_by: this.id,
        timestamp: new Date().toISOString()
      }, 'broadcast', 'low');
    }
  }

  private async handlePricingOptimizationRequest(event: any): Promise<void> {
    console.log(`[Revenue Agent] Processing pricing optimization request`);
    
    const pricingAnalysis = this.analyzeCurrentPricing(event.payload);
    const recommendations = this.generatePricingRecommendations(pricingAnalysis);
    
    this.emit_event('PRICING_OPTIMIZATION_RECOMMENDATIONS', {
      product_service_id: event.payload.product_service_id,
      current_analysis: pricingAnalysis,
      recommendations: recommendations,
      analyzed_by: this.id,
      timestamp: new Date().toISOString()
    }, 'broadcast', 'medium');
  }

  private async handleFinancialFlowAnalysis(event: any): Promise<void> {
    console.log(`[Revenue Agent] Processing financial flow analysis`);
    
    const flowAnalysis = this.analyzeFinancialFlows(event.payload);
    const insights = this.generateFinancialFlowInsights(flowAnalysis);
    
    this.emit_event('FINANCIAL_FLOW_ANALYZED', {
      analysis_period: event.payload.period,
      flow_analysis: flowAnalysis,
      insights: insights,
      analyzed_by: this.id,
      timestamp: new Date().toISOString()
    }, 'broadcast', 'medium');
  }

  private async handleRevenueForecastNeeded(event: any): Promise<void> {
    console.log(`[Revenue Agent] Processing revenue forecast needed`);
    
    const forecast = this.generateRevenueForecast(event.payload);
    
    this.emit_event('REVENUE_FORECAST_GENERATED', {
      forecast_id: `forecast_${Date.now()}`,
      period: event.payload.period,
      forecast: forecast,
      assumptions: this.getForecastAssumptions(event.payload),
      generated_by: this.id,
      timestamp: new Date().toISOString()
    }, 'finance.agent', 'medium');
  }

  private async handleMonetizationStrategyUpdate(event: any): Promise<void> {
    console.log(`[Revenue Agent] Processing monetization strategy update`);
    
    const evaluation = this.evaluateMonetizationStrategy(event.payload);
    
    if (evaluation.sound) {
      this.emit_event('MONETIZATION_STRATEGY_CONFIRMED', {
        strategy_id: event.payload.strategy_id,
        evaluation: evaluation,
        confirmed_by: this.id,
        timestamp: new Date().toISOString()
      }, 'broadcast', 'medium');
    } else {
      this.emit_event('MONETIZATION_STRATEGY_REVISION_REQUIRED', {
        strategy_id: event.payload.strategy_id,
        evaluation: evaluation,
        recommended_revisions: evaluation.revisions,
        evaluated_by: this.id,
        timestamp: new Date().toISOString()
      }, 'broadcast', 'high');
    }
  }

  private evaluateRevenueOpportunity(payload: any): any {
    const marketSize = payload.market_size || Math.random() * 1000000;
    const addressableMarket = payload.addressable_market || marketSize * 0.1;
    const penetrationRate = payload.penetration_rate || 0.05;
    const revenuePerCustomer = payload.revenue_per_customer || Math.random() * 1000 + 100;
    const potentialCustomers = addressableMarket * penetrationRate;
    const potentialRevenue = potentialCustomers * revenuePerCustomer;
    const implementationCost = payload.implementation_cost || Math.random() * 50000;
    const timeToRevenue = payload.time_to_revenue || Math.random() * 12 + 3;
    const netPresentValue = this.calculateNPV(potentialRevenue, implementationCost, timeToRevenue);
    const roi = (potentialRevenue - implementationCost) / implementationCost;
    
    return {
      worth_pursuing: roi > 1 && netPresentValue > 0,
      market_size: `$${marketSize.toFixed(0)}`,
      addressable_market: `$${addressableMarket.toFixed(0)}`,
      potential_customers: potentialCustomers.toFixed(0),
      revenue_per_customer: `$${revenuePerCustomer.toFixed(2)}`,
      potential_annual_revenue: `$${potentialRevenue.toFixed(0)}`,
      implementation_cost: `$${implementationCost.toFixed(0)}`,
      time_to_revenue_months: timeToRevenue.toFixed(1),
      roi: `${(roi * 100).toFixed(1)}%`,
      npv: `$${netPresentValue.toFixed(0)}`,
      reason: !(roi > 1 && netPresentValue > 0)
        ? `Insufficient ROI (${(roi*100).toFixed(1)}%) or negative NPV`
        : 'Strong revenue opportunity with attractive ROI',
      confidence_level: payload.confidence || Math.random() * 0.4 + 0.6
    };
  }

  private calculateNPV(futureValue: number, cost: number, months: number): number {
    const monthlyRate = 0.1 / 12;
    const npv = -(cost) + (futureValue / Math.pow(1 + monthlyRate, months));
    return Math.max(0, npv);
  }

  private developImplementationPlan(opportunity: any, _evaluation: any): any {
    return {
      opportunity_id: opportunity.opportunity_id,
      phases: [
        {
          name: 'mvp_development',
          duration_weeks: Math.floor(Math.random() * 8) + 4,
          cost_percentage: 0.4,
          deliverables: ['core_product', 'basic_features']
        },
        {
          name: 'market_testing',
          duration_weeks: Math.floor(Math.random() * 6) + 2,
          cost_percentage: 0.2,
          deliverables: ['beta_version', 'user_feedback']
        },
        {
          name: 'full_launch',
          duration_weeks: Math.floor(Math.random() * 6) + 2,
          cost_percentage: 0.4,
          deliverables: ['complete_product', 'marketing_materials']
        }
      ],
      total_estimated_cost: opportunity.implementation_cost || 25000,
      expected_break_even_months: (opportunity.time_to_revenue || 6) + 3,
      success_metrics: [
        'customer_acquisition_cost < lifetime_value/3',
        'monthly_recurring_growth > 15%',
        'gross_margin > 70%'
      ]
    };
  }

  private analyzeCurrentPricing(payload: any): any {
    return {
      product_service_id: payload.product_service_id,
      current_price: payload.current_price || Math.random() * 100 + 50,
      cost_to_deliver: payload.cost_to_deliver || Math.random() * 30 + 20,
      competitor_pricing: [
        Math.random() * 80 + 40,
        Math.random() * 90 + 50,
        Math.random() * 110 + 60
      ],
      price_elasticity_estimate: -Math.random() * 1.5 - 0.5,
      market_position: Math.random() > 0.6 ? 'premium' : Math.random() > 0.3 ? 'competitive' : 'budget',
      current_margin: 0
    };
  }

  private generatePricingRecommendations(analysis: any): any[] {
    const recommendations: any[] = [];
    const currentPrice = analysis.current_price;
    const costToDeliver = analysis.cost_to_deliver;
    const competitorAvg = (analysis.competitor_pricing[0] + analysis.competitor_pricing[1] + analysis.competitor_pricing[2]) / 3;
    
    const currentMargin = (currentPrice - costToDeliver) / currentPrice;
    analysis.current_margin = currentMargin;
    
    if (Math.abs(currentPrice - competitorAvg) / competitorAvg > 0.2) {
      recommendations.push({
        type: 'competitive_adjustment',
        description: `Adjust price to match market average of $${competitorAvg.toFixed(2)}`,
        new_price: competitorAvg,
        expected_margin: (competitorAvg - costToDeliver) / competitorAvg,
        rationale: 'Better align with market expectations'
      });
    }
    
    if (Math.abs(analysis.price_elasticity_estimate) < 1.0) {
      recommendations.push({
        type: 'value_based_increase',
        description: 'Increase price based on value delivered (inelastic demand)',
        new_price: currentPrice * 1.15,
        expected_margin: (currentPrice * 1.15 - costToDeliver) / (currentPrice * 1.15),
        rationale: 'Customers less sensitive to price changes'
      });
    }
    
    if (Math.abs(analysis.price_elasticity_estimate) > 1.5 && analysis.market_position === 'budget') {
      recommendations.push({
        type: 'penetration_pricing',
        description: 'Decrease price to gain market share (elastic demand)',
        new_price: currentPrice * 0.85,
        expected_margin: (currentPrice * 0.85 - costToDeliver) / (currentPrice * 0.85),
        rationale: 'Price-sensitive market, opportunity to gain share'
      });
    }
    
    recommendations.push({
      type: 'cost_plus_baseline',
      description: 'Set price based on cost plus standard margin',
      new_price: costToDeliver * 2.5,
      expected_margin: 0.6,
      rationale: 'Ensure profitability while remaining competitive'
    });
    
    return recommendations;
  }

  private analyzeFinancialFlows(payload: any): any {
    return {
      period: payload.period,
      revenue_streams: [
        {
          id: 'stream_1',
          name: 'Product Sales',
          monthly_revenue: Math.random() * 10000 + 5000,
          growth_rate: `${(Math.random() * 20 - 5).toFixed(1)}%`,
          reliability: Math.random() * 0.4 + 0.6
        },
        {
          id: 'stream_2',
          name: 'Service Contracts',
          monthly_revenue: Math.random() * 8000 + 2000,
          growth_rate: `${(Math.random() * 15 + 5).toFixed(1)}%`,
          reliability: Math.random() * 0.3 + 0.7
        },
        {
          id: 'stream_3',
          name: 'Licensing/Royalties',
          monthly_revenue: Math.random() * 3000 + 1000,
          growth_rate: `${(Math.random() * 10).toFixed(1)}%`,
          reliability: Math.random() * 0.5 + 0.5
        }
      ],
      expense_categories: [
        {
          id: 'expense_1',
          name: 'Research & Development',
          monthly_cost: Math.random() * 15000 + 5000,
          trend: Math.random() > 0.5 ? 'increasing' : 'decreasing'
        },
        {
          id: 'expense_2',
          name: 'Sales & Marketing',
          monthly_cost: Math.random() * 10000 + 3000,
          trend: Math.random() > 0.5 ? 'increasing' : 'decreasing'
        },
        {
          id: 'expense_3',
          name: 'Operations & Infrastructure',
          monthly_cost: Math.random() * 8000 + 2000,
          trend: Math.random() > 0.5 ? 'increasing' : 'decreasing'
        }
      ],
      net_cash_flow: 0
    };
  }

  private generateFinancialFlowInsights(analysis: any): string[] {
    const insights: string[] = [];
    let totalRevenue = 0;
    let totalExpenses = 0;
    
    analysis.revenue_streams.forEach((stream: any) => { totalRevenue += stream.monthly_revenue; });
    analysis.expense_categories.forEach((expense: any) => { totalExpenses += expense.monthly_cost; });
    analysis.net_cash_flow = totalRevenue - totalExpenses;
    
    const growingStreams = analysis.revenue_streams.filter((s: any) =>
      parseFloat(s.growth_rate.replace('%', '')) > 0
    ).length;
    if (growingStreams > 0) insights.push(`${growingStreams} revenue streams showing growth`);
    
    const decliningStreams = analysis.revenue_streams.filter((s: any) =>
      parseFloat(s.growth_rate.replace('%', '')) < 0
    ).length;
    if (decliningStreams > 0) insights.push(`${decliningStreams} revenue streams declining - investigate causes`);
    
    const increasingExpenses = analysis.expense_categories.filter((e: any) =>
      e.trend === 'increasing'
    ).length;
    if (increasingExpenses > 0) insights.push(`${increasingExpenses} expense categories increasing - review for optimization`);
    
    if (analysis.net_cash_flow > 0) {
      insights.push(`Positive net cash flow: $${analysis.net_cash_flow.toFixed(0)}/month`);
    } else {
      insights.push(`Negative net cash flow: $${Math.abs(analysis.net_cash_flow).toFixed(0)}/month - requires attention`);
    }
    
    const lowReliabilityStreams = analysis.revenue_streams.filter((s: any) => s.reliability < 0.7).length;
    if (lowReliabilityStreams > 0) insights.push(`${lowReliabilityStreams} revenue streams have low reliability - consider diversification`);
    
    insights.push('Revenue typically highest in Q4 due to seasonal demand');
    insights.push('Service contracts provide most predictable revenue stream');
    insights.push('Customer acquisition cost should be recovered within 12 months');
    
    return insights;
  }

  private generateRevenueForecast(payload: any): any {
    const baseRevenue = payload.base_monthly_revenue || Math.random() * 10000 + 5000;
    const growthRate = payload.growth_rate || (Math.random() * 20 - 5) / 100;
    const months = payload.months || 12;
    const forecast = [];
    let cumulativeRevenue = 0;
    
    for (let i = 0; i < months; i++) {
      const monthRevenue = baseRevenue * Math.pow(1 + growthRate, i);
      cumulativeRevenue += monthRevenue;
      forecast.push({
        month: i + 1,
        month_revenue: `$${monthRevenue.toFixed(0)}`,
        cumulative_revenue: `$${cumulativeRevenue.toFixed(0)}`,
        growth_rate_applied: `${(growthRate * 100 * Math.pow(1 + growthRate, i)).toFixed(2)}%`
      });
    }
    
    return {
      monthly_breakdown: forecast,
      total_forecasted_revenue: `$${cumulativeRevenue.toFixed(0)}`,
      average_monthly_revenue: `$${(cumulativeRevenue / months).toFixed(0)}`,
      compound_monthly_growth_rate: `${(growthRate * 100).toFixed(2)}%`
    };
  }

  private getForecastAssumptions(_payload: any): string[] {
    return [
      'Market conditions remain stable',
      'No major competitive disruptions',
      'Pricing strategy remains constant',
      'Customer churn rate remains at current levels',
      'Seasonal patterns follow historical trends',
      'No significant changes in cost structure'
    ];
  }

  private evaluateMonetizationStrategy(_payload: any): any {
    const clarity = Math.random();
    const feasibility = Math.random();
    const scalability = Math.random();
    const marketFit = Math.random();
    const overallScore = (clarity + feasibility + scalability + marketFit) / 4;
    
    const revisions: string[] = [];
    if (clarity < 0.7) revisions.push('Define clearer value proposition and target audience');
    if (feasibility < 0.7) revisions.push('Assess technical and operational feasibility');
    if (scalability < 0.7) revisions.push('Ensure model can scale without linear cost increase');
    if (marketFit < 0.7) revisions.push('Validate market demand through customer interviews');
    
    return {
      sound: overallScore > 0.7,
      score: overallScore.toFixed(2),
      clarity: clarity.toFixed(2),
      feasibility: feasibility.toFixed(2),
      scalability: scalability.toFixed(2),
      market_fit: marketFit.toFixed(2),
      revisions: revisions.length > 0 ? revisions : ['Strategy appears sound - minor refinements possible']
    };
  }
}

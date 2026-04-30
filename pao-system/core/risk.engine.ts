export class RiskEngine {
  private riskFactors: Map<string, number> = new Map();

  constructor() {
    // Initialize risk factor weights
    this.initializeRiskFactors();
  }

  private initializeRiskFactors(): void {
    // Budget overrun probability weight
    this.riskFactors.set('budget_overrun', 0.3);
    // Vendor reliability score weight
    this.riskFactors.set('vendor_reliability', 0.2);
    // Structural integrity flags weight
    this.riskFactors.set('structural_integrity', 0.25);
    // AI confidence threshold weight
    this.riskFactors.set('ai_confidence', 0.25);
  }

  requiresApproval(event: any): boolean {
    const riskScore = this.calculateRiskScore(event);
    
    // Require approval for high or critical risk
    return riskScore >= 0.7; // Threshold for requiring approval
  }

  calculateRiskScore(event: any): number {
    let score = 0;
    
    // Budget overrun probability
    if (event.payload && event.payload.budget_overrun_probability !== undefined) {
      score += event.payload.budget_overrun_probability * (this.riskFactors.get('budget_overrun') || 0);
    }
    
    // Vendor reliability score (inverted - lower reliability = higher risk)
    if (event.payload && event.payload.vendor_reliability_score !== undefined) {
      const vendorRisk = 1 - event.payload.vendor_reliability_score; // Convert to risk
      score += vendorRisk * (this.riskFactors.get('vendor_reliability') || 0);
    }
    
    // Structural integrity flags
    if (event.payload && event.payload.structural_integrity_flags !== undefined) {
      score += event.payload.structural_integrity_flags.length * 0.1 * (this.riskFactors.get('structural_integrity') || 0);
    }
    
    // AI confidence threshold (lower confidence = higher risk)
    if (event.payload && event.payload.ai_confidence !== undefined) {
      const aiRisk = 1 - event.payload.ai_confidence; // Convert to risk
      score += aiRisk * (this.riskFactors.get('ai_confidence') || 0);
    }
    
    // Normalize score to 0-1 range
    return Math.min(score, 1.0);
  }

  getRiskLevel(event: any): 'SAFE' | 'WARNING' | 'CRITICAL' {
    const score = this.calculateRiskScore(event);
    
    if (score >= 0.8) {
      return 'CRITICAL';
    } else if (score >= 0.5) {
      return 'WARNING';
    } else {
      return 'SAFE';
    }
  }
}
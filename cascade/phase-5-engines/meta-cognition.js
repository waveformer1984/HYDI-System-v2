/**
 * HYDI Meta-Cognitive Loop
 * Phase 5.2 Implementation
 *
 * Purpose: Enable Hydi to evaluate and improve its own reasoning quality
 * Deployed: 5/19/2026 Session 5
 */

const crypto = require('crypto');
const EventEmitter = require('events');

class MetaCognitiveLoop extends EventEmitter {
  constructor(config = {}) {
    super();

    this.cascadeSystem = config.cascadeSystem || null;
    this.autonomousQueue = config.autonomousQueue || null;

    this.reasoningPatterns = new Map();
    this.evaluationHistory = [];
    this.qualityBaseline = {
      logicalConsistency: 0.85,
      sourceReliability: 0.80,
      argumentCoverage: 0.75,
      confidenceCalibration: 0.80,
      overallScore: 0.80
    };

    this.improvementLog = [];
  }

  /**
   * Evaluate the quality of reasoning from a /think execution
   */
  async evaluateReasoningQuality(thinkResult) {
    const evaluation = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      query: thinkResult.query,
      analyses: {
        logicalConsistency: await this.checkLogicalConsistency(thinkResult),
        sourceReliability: await this.evaluateSourceReliability(thinkResult),
        argumentCoverage: await this.evaluateArgumentCoverage(thinkResult),
        confidenceCalibration: await this.calibrateConfidence(thinkResult),
        biasDetection: await this.detectBias(thinkResult)
      }
    };

    // Compute overall quality score
    evaluation.overallQualityScore = this.computeQualityScore(evaluation.analyses);

    // Classify reasoning quality
    if (evaluation.overallQualityScore >= 0.85) {
      evaluation.qualityClassification = 'excellent';
    } else if (evaluation.overallQualityScore >= 0.70) {
      evaluation.qualityClassification = 'good';
    } else if (evaluation.overallQualityScore >= 0.55) {
      evaluation.qualityClassification = 'acceptable';
    } else {
      evaluation.qualityClassification = 'poor';
    }

    // Identify improvement areas
    evaluation.improvementAreas = this.identifyImprovementAreas(evaluation.analyses);

    // Store for analysis
    this.evaluationHistory.push(evaluation);

    // Learn from this reasoning
    await this.learnFromReasoning(thinkResult, evaluation);

    this.emit('reasoning-evaluated', {
      evaluationId: evaluation.id,
      qualityScore: evaluation.overallQualityScore,
      classification: evaluation.qualityClassification
    });

    return evaluation;
  }

  /**
   * Compute overall quality score from component analyses
   */
  computeQualityScore(analyses) {
    const weights = {
      logicalConsistency: 0.30,
      sourceReliability: 0.20,
      argumentCoverage: 0.25,
      confidenceCalibration: 0.15,
      biasDetection: 0.10
    };

    let totalScore = 0;
    let totalWeight = 0;

    for (const [key, weight] of Object.entries(weights)) {
      if (analyses[key] && typeof analyses[key].score === 'number') {
        totalScore += analyses[key].score * weight;
        totalWeight += weight;
      }
    }

    return totalWeight > 0 ? totalScore / totalWeight : 0;
  }

  /**
   * Check logical consistency of reasoning chain
   */
  async checkLogicalConsistency(thinkResult) {
    const consistency = {
      score: 0,
      issues: [],
      details: {}
    };

    try {
      if (!thinkResult.thinkingProcess || !Array.isArray(thinkResult.thinkingProcess)) {
        consistency.score = 0;
        consistency.issues.push('No thinking process provided');
        return consistency;
      }

      // Check for logical contradictions
      const statements = thinkResult.thinkingProcess;
      for (let i = 0; i < statements.length - 1; i++) {
        const current = statements[i];
        const next = statements[i + 1];

        // Detect obvious contradictions
        if (this.detectContradiction(current, next)) {
          consistency.issues.push(`Contradiction between step ${i} and ${i + 1}`);
        }
      }

      // Score based on issues found
      consistency.score = Math.max(0, 1 - (consistency.issues.length * 0.15));

      // Additional checks
      consistency.details = {
        stepsCount: statements.length,
        contradictionsFound: this.countContradictions(statements),
        reasoning_depth: await this.assessReasoningDepth(statements)
      };
    } catch (error) {
      consistency.score = 0.5;
      consistency.issues.push(`Error during evaluation: ${error.message}`);
    }

    return consistency;
  }

  /**
   * Evaluate source reliability
   */
  async evaluateSourceReliability(thinkResult) {
    const reliability = {
      score: 1.0,
      issues: [],
      sources: []
    };

    try {
      if (!thinkResult.cascadeLookups || !Array.isArray(thinkResult.cascadeLookups)) {
        reliability.score = 0.8; // No CASCADE info used; moderate score
        return reliability;
      }

      for (const lookup of thinkResult.cascadeLookups) {
        const source = {
          id: lookup.conceptId,
          confidence: lookup.confidence || 0,
          used: true
        };

        // Penalize low-confidence sources
        if (lookup.confidence < 0.6) {
          reliability.issues.push(`Low-confidence source: ${lookup.conceptId} (${lookup.confidence})`);
          reliability.score -= 0.10;
        }

        reliability.sources.push(source);
      }

      // Bonus for using multiple reliable sources
      const highConfidenceSources = reliability.sources.filter(s => s.confidence >= 0.8);
      if (highConfidenceSources.length > 0) {
        reliability.score = Math.min(1.0, reliability.score + 0.05);
      }
    } catch (error) {
      reliability.score = 0.5;
      reliability.issues.push(`Error during evaluation: ${error.message}`);
    }

    reliability.score = Math.max(0, Math.min(1, reliability.score));
    return reliability;
  }

  /**
   * Evaluate argument coverage
   */
  async evaluateArgumentCoverage(thinkResult) {
    const coverage = {
      score: 0.75,
      issues: [],
      aspectsCovered: [],
      aspectsMissing: []
    };

    try {
      const responseLength = thinkResult.response?.length || 0;
      const thinkingLength = JSON.stringify(thinkResult.thinkingProcess)?.length || 0;

      // Check for sufficient depth
      if (responseLength < 100) {
        coverage.issues.push('Response too brief; insufficient detail');
        coverage.score -= 0.20;
      }

      if (responseLength > 5000) {
        coverage.issues.push('Response overly verbose; possible redundancy');
        coverage.score -= 0.10;
      }

      // Check for coverage of main aspects
      const mainTopics = this.extractMainTopics(thinkResult.query);
      for (const topic of mainTopics) {
        if (thinkResult.response.toLowerCase().includes(topic.toLowerCase())) {
          coverage.aspectsCovered.push(topic);
        } else {
          coverage.aspectsMissing.push(topic);
        }
      }

      // Score based on coverage
      const coverageRatio = coverage.aspectsCovered.length / Math.max(1, mainTopics.length);
      coverage.score = Math.max(0.3, coverageRatio * 0.8 + 0.2);

    } catch (error) {
      coverage.score = 0.5;
      coverage.issues.push(`Error during evaluation: ${error.message}`);
    }

    return coverage;
  }

  /**
   * Calibrate confidence: does Hydi's stated confidence match actual accuracy?
   */
  async calibrateConfidence(thinkResult) {
    const calibration = {
      score: 0.8,
      statedConfidence: thinkResult.confidence || 0.5,
      issues: []
    };

    try {
      // If response is very short or generic, stated confidence should be lower
      if (thinkResult.response.length < 100 && thinkResult.confidence > 0.7) {
        calibration.issues.push('Confidence overstated for brief response');
        calibration.score -= 0.15;
      }

      // If many CASCADE lookups have low confidence, overall confidence should be lower
      const cascadeLookups = thinkResult.cascadeLookups || [];
      const avgCascadeConfidence = cascadeLookups.length > 0
        ? cascadeLookups.reduce((sum, l) => sum + (l.confidence || 0), 0) / cascadeLookups.length
        : 0.8;

      const confidenceMismatch = Math.abs(thinkResult.confidence - avgCascadeConfidence);
      if (confidenceMismatch > 0.3) {
        calibration.issues.push(`Confidence mismatch: stated ${thinkResult.confidence}, CASCADE avg ${avgCascadeConfidence}`);
        calibration.score -= 0.20;
      }

      calibration.score = Math.max(0, Math.min(1, calibration.score));
    } catch (error) {
      calibration.score = 0.5;
      calibration.issues.push(`Error during evaluation: ${error.message}`);
    }

    return calibration;
  }

  /**
   * Detect potential biases in reasoning
   */
  async detectBias(thinkResult) {
    const biasDetection = {
      score: 1.0,
      biasesDetected: [],
      issues: []
    };

    try {
      // Check for confirmation bias: does response only confirm the initial query assumption?
      if (this.detectConfirmationBias(thinkResult)) {
        biasDetection.biasesDetected.push('confirmation_bias');
        biasDetection.score -= 0.20;
      }

      // Check for availability bias: overuse of recent/popular concepts
      if (await this.detectAvailabilityBias(thinkResult)) {
        biasDetection.biasesDetected.push('availability_bias');
        biasDetection.score -= 0.15;
      }

      // Check for anchoring bias: over-reliance on first CASCADE lookup
      if (this.detectAnchoringBias(thinkResult)) {
        biasDetection.biasesDetected.push('anchoring_bias');
        biasDetection.score -= 0.10;
      }

      biasDetection.score = Math.max(0, Math.min(1, biasDetection.score));
    } catch (error) {
      biasDetection.score = 0.7;
      biasDetection.issues.push(`Error during evaluation: ${error.message}`);
    }

    return biasDetection;
  }

  /**
   * Learn from high-quality reasoning
   */
  async learnFromReasoning(thinkResult, evaluation) {
    // If high-quality: extract patterns for reuse
    if (evaluation.overallQualityScore >= 0.85) {
      await this.extractReasoningPattern(thinkResult, evaluation);
    }

    // If low-quality: analyze failure mode
    if (evaluation.overallQualityScore < 0.60) {
      await this.analyzeReasoningFailure(thinkResult, evaluation);
    }

    // Update baseline expectations
    this.updateQualityBaseline(evaluation);
  }

  /**
   * Extract high-quality reasoning patterns for future reuse
   */
  async extractReasoningPattern(thinkResult, evaluation) {
    const pattern = {
      id: crypto.randomUUID(),
      queryPattern: await this.generalizeQuery(thinkResult.query),
      cascadePath: (thinkResult.cascadeLookups || []).map(l => l.conceptId),
      reasoning: thinkResult.thinkingProcess,
      responseStructure: this.analyzeResponseStructure(thinkResult.response),
      qualityScore: evaluation.overallQualityScore,
      executionTime: thinkResult.executionTime,
      createdAt: Date.now(),
      applicability: 'general'
    };

    this.reasoningPatterns.set(pattern.id, pattern);

    // Enqueue task to store pattern in CASCADE
    if (this.autonomousQueue) {
      this.autonomousQueue.enqueueTask('synthesize_insights', {
        pattern: pattern,
        source: 'meta_cognition'
      }, 'normal');
    }

    this.emit('pattern-extracted', {
      patternId: pattern.id,
      qualityScore: pattern.qualityScore
    });

    return pattern;
  }

  /**
   * Analyze low-quality reasoning failures
   */
  async analyzeReasoningFailure(thinkResult, evaluation) {
    const failure = {
      id: crypto.randomUUID(),
      query: thinkResult.query,
      qualityScore: evaluation.overallQualityScore,
      improvementAreas: evaluation.improvementAreas,
      primaryIssue: evaluation.improvementAreas?.[0] || 'unknown',
      analysis: await this.diagnoseFailureMode(evaluation),
      suggestedFix: await this.suggestReasoningImprovement(evaluation),
      timestamp: Date.now()
    };

    this.improvementLog.push(failure);

    // Enqueue task to address this
    if (this.autonomousQueue) {
      this.autonomousQueue.enqueueTask('detect_reasoning_gaps', {
        failure: failure
      }, 'high');
    }

    this.emit('reasoning-failure-detected', {
      failureId: failure.id,
      primaryIssue: failure.primaryIssue,
      suggestedFix: failure.suggestedFix
    });

    return failure;
  }

  /**
   * Update quality baseline as system improves
   */
  updateQualityBaseline(evaluation) {
    // Moving average: give 90% weight to old baseline, 10% to new evaluation
    const alpha = 0.1;

    for (const [key, value] of Object.entries(evaluation.analyses)) {
      if (typeof value.score === 'number' && this.qualityBaseline[key] !== undefined) {
        this.qualityBaseline[key] = (this.qualityBaseline[key] * (1 - alpha)) + (value.score * alpha);
      }
    }

    this.qualityBaseline.overallScore = this.computeQualityScore(evaluation.analyses);
  }

  /**
   * Get meta-cognitive insights
   */
  getInsights() {
    const totalEvaluations = this.evaluationHistory.length;
    const excellentCount = this.evaluationHistory.filter(e => e.qualityClassification === 'excellent').length;
    const goodCount = this.evaluationHistory.filter(e => e.qualityClassification === 'good').length;
    const poorCount = this.evaluationHistory.filter(e => e.qualityClassification === 'poor').length;

    const avgQualityScore = totalEvaluations > 0
      ? this.evaluationHistory.reduce((sum, e) => sum + e.overallQualityScore, 0) / totalEvaluations
      : 0;

    return {
      totalEvaluations,
      averageQualityScore: avgQualityScore,
      qualityDistribution: {
        excellent: excellentCount,
        good: goodCount,
        acceptable: totalEvaluations - excellentCount - goodCount - poorCount,
        poor: poorCount
      },
      patternsExtracted: this.reasoningPatterns.size,
      improvementsLogged: this.improvementLog.length,
      estimatedImprovement: avgQualityScore - this.qualityBaseline.overallScore,
      currentBaseline: this.qualityBaseline,
      recentPatterns: Array.from(this.reasoningPatterns.values()).slice(-5)
    };
  }

  // ==================== Helper Methods ====================

  async generalizeQuery(query) {
    // Extract key concepts from query for pattern matching
    const words = query.toLowerCase().split(/\s+/);
    return words.filter(w => w.length > 4).slice(0, 5).join(' ');
  }

  detectContradiction(stmt1, stmt2) {
    const str1 = JSON.stringify(stmt1).toLowerCase();
    const str2 = JSON.stringify(stmt2).toLowerCase();

    // Simple heuristic: check for negation patterns
    const negations = ['not', 'cannot', 'impossible', 'fails', 'error'];
    const affirms = ['yes', 'true', 'possible', 'succeeds', 'valid'];

    const hasNegation = negations.some(w => str1.includes(w)) && affirms.some(w => str2.includes(w));
    const hasAffirm = affirms.some(w => str1.includes(w)) && negations.some(w => str2.includes(w));

    return hasNegation || hasAffirm;
  }

  countContradictions(statements) {
    let count = 0;
    for (let i = 0; i < statements.length - 1; i++) {
      if (this.detectContradiction(statements[i], statements[i + 1])) {
        count++;
      }
    }
    return count;
  }

  async assessReasoningDepth(statements) {
    return {
      stepsCount: statements.length,
      averageStepLength: statements.reduce((sum, s) => sum + JSON.stringify(s).length, 0) / statements.length,
      depth: statements.length > 5 ? 'deep' : statements.length > 2 ? 'moderate' : 'shallow'
    };
  }

  extractMainTopics(query) {
    // Extract key topics from query
    const words = query.toLowerCase().split(/\s+/);
    return words.filter(w => w.length > 4).slice(0, 3);
  }

  analyzeResponseStructure(response) {
    return {
      length: response.length,
      paragraphs: response.split('\n\n').length,
      hasBulletPoints: response.includes('•') || response.includes('-'),
      hasCodeBlocks: response.includes('```'),
      complexity: response.length > 2000 ? 'high' : response.length > 500 ? 'medium' : 'low'
    };
  }

  detectConfirmationBias(thinkResult) {
    // Check if response primarily affirms the query's premise
    const queryLower = thinkResult.query.toLowerCase();
    const responseLower = thinkResult.response.toLowerCase();

    const affirmationWords = ['yes', 'correct', 'true', 'agree', 'exactly', 'indeed'];
    const affirmationCount = affirmationWords.filter(w => responseLower.includes(w)).length;

    return affirmationCount > 2; // Simple heuristic
  }

  async detectAvailabilityBias(thinkResult) {
    // Check if response overuses frequently-accessed CASCADE concepts
    const cascadeIds = thinkResult.cascadeLookups?.map(l => l.conceptId) || [];
    const freqConcepts = new Map();

    for (const id of cascadeIds) {
      freqConcepts.set(id, (freqConcepts.get(id) || 0) + 1);
    }

    // If any single concept appears more than 50% of the time
    const maxFreq = Math.max(...Array.from(freqConcepts.values()));
    return maxFreq > cascadeIds.length * 0.5;
  }

  detectAnchoringBias(thinkResult) {
    // Check if first CASCADE lookup dominates the reasoning
    if (!thinkResult.cascadeLookups || thinkResult.cascadeLookups.length < 2) return false;

    const firstLookupId = thinkResult.cascadeLookups[0].conceptId;
    const responseLength = thinkResult.response.length;
    const firstConceptMentions = (thinkResult.response.match(new RegExp(firstLookupId, 'gi')) || []).length;

    return firstConceptMentions > responseLength / 100; // Mentioned more than 1% of chars
  }

  async diagnoseFailureMode(evaluation) {
    const poorAreas = evaluation.improvementAreas;
    if (!poorAreas || poorAreas.length === 0) return 'unknown';

    if (poorAreas.includes('logicalConsistency')) {
      return 'reasoning_chain_broken';
    } else if (poorAreas.includes('sourceReliability')) {
      return 'cascade_quality_issue';
    } else if (poorAreas.includes('argumentCoverage')) {
      return 'incomplete_analysis';
    } else if (poorAreas.includes('confidenceCalibration')) {
      return 'confidence_mismatch';
    }

    return 'multiple_issues';
  }

  async suggestReasoningImprovement(evaluation) {
    const suggestion = {
      focus: evaluation.improvementAreas?.[0] || 'general',
      approach: ''
    };

    switch(suggestion.focus) {
      case 'logicalConsistency':
        suggestion.approach = 'Implement step-by-step validation to catch contradictions early';
        break;
      case 'sourceReliability':
        suggestion.approach = 'Verify CASCADE confidence scores before using in reasoning';
        break;
      case 'argumentCoverage':
        suggestion.approach = 'Expand reasoning to cover all main topics in query';
        break;
      case 'confidenceCalibration':
        suggestion.approach = 'Calibrate stated confidence to match CASCADE data confidence';
        break;
      case 'biasDetection':
        suggestion.approach = 'Actively seek counter-evidence and alternative viewpoints';
        break;
      default:
        suggestion.approach = 'Review and refine overall reasoning approach';
    }

    return suggestion;
  }

  identifyImprovementAreas(analyses) {
    const areas = [];

    for (const [key, analysis] of Object.entries(analyses)) {
      if (analysis.score && analysis.score < 0.70) {
        areas.push(key);
      }
    }

    return areas.sort((a, b) => analyses[b].score - analyses[a].score);
  }
}

module.exports = MetaCognitiveLoop;

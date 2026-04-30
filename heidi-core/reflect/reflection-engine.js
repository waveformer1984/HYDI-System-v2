/**
 * HEIDI Reflection Engine
 * Simple, stripped down, no JWT drama
 */

class ReflectionEngine {
  constructor(memory, config = {}) {
    this.memory = memory;
    this.confidenceThreshold = config.confidenceThreshold || 0.7;
    this.reflectionHistory = [];
    this.lastReflectionTime = 0;
    this.minReflectionInterval = config.minReflectionInterval || 30000; // 30 seconds minimum between reflections
  }

  /**
   * Trigger reflection based on input/response
   */
  async reflect(input, response, confidence) {
    // Only reflect on high confidence interactions or patterns
    if (confidence < this.confidenceThreshold) {
      return null;
    }

    // Rate limiting: don't reflect too frequently
    const now = Date.now();
    if (now - this.lastReflectionTime < this.minReflectionInterval) {
      return null; // Too soon since last reflection
    }

    const insight = await this.generateInsight(input, response, confidence);
    
    if (insight) {
      // Store the reflection
      await this.memory.storeReflection(
        insight.insight,
        insight.confidence,
        insight.action,
        insight.pattern_type
      );

      this.reflectionHistory.push({
        ...insight,
        timestamp: new Date().toISOString()
      });

      this.lastReflectionTime = now;
      console.log(`[HEIDI Reflect] Generated insight: ${insight.insight.substring(0, 100)}...`);
      
      return insight;
    }

    return null;
  }

  /**
   * Generate insight from interaction
   */
  async generateInsight(input, response, confidence) {
    const lowerInput = input.toLowerCase();
    const lowerResponse = response.toLowerCase();

    // Pattern detection for insights
    
    // Error pattern detection
    if (lowerInput.includes('error') || lowerInput.includes('fail') || lowerResponse.includes('error')) {
      return {
        insight: `Error pattern detected: ${input.substring(0, 50)}`,
        confidence: Math.min(0.9, confidence + 0.1),
        action: 'monitor_error_pattern',
        pattern_type: 'error_pattern'
      };
    }

    // Repeated question pattern
    const recent = await this.memory.getRecentContext(10);
    const similarQuestions = recent.filter(r => {
      const similarity = this.calculateSimilarity(input, r.input);
      return similarity > 0.7;
    });

    if (similarQuestions.length >= 2) {
      return {
        insight: `Repeated pattern detected: "${input.substring(0, 40)}..." occurs ${similarQuestions.length} times`,
        confidence: 0.75,
        action: 'suggest_automation',
        pattern_type: 'repeated_pattern'
      };
    }

    // Success pattern
    if (lowerResponse.includes('success') || lowerResponse.includes('completed')) {
      return {
        insight: `Successful outcome: ${input.substring(0, 50)}`,
        confidence: confidence,
        action: 'record_success_pattern',
        pattern_type: 'success_pattern'
      };
    }

    // High confidence learning
    if (confidence > 0.85) {
      return {
        insight: `High confidence interaction: ${input.substring(0, 50)}`,
        confidence: confidence,
        action: 'store_as_best_practice',
        pattern_type: 'high_confidence_learning'
      };
    }

    return null;
  }

  /**
   * Simple string similarity (Jaccard index)
   */
  calculateSimilarity(str1, str2) {
    const set1 = new Set(str1.toLowerCase().split(' '));
    const set2 = new Set(str2.toLowerCase().split(' '));
    
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    
    return intersection.size / union.size;
  }

  /**
   * Batch reflection - analyze multiple interactions
   */
  async batchReflect(limit = 50) {
    const recent = await this.memory.getRecentContext(limit);
    const insights = [];

    // Group by patterns
    const errorCount = recent.filter(r => 
      r.input?.toLowerCase().includes('error') || 
      r.response?.toLowerCase().includes('error')
    ).length;

    if (errorCount >= 3) {
      const insight = {
        insight: `Multiple errors detected (${errorCount} in last ${limit} interactions). Consider systemic fix.`,
        confidence: 0.82,
        action: 'suggest_fix',
        pattern_type: 'multiple_errors'
      };
      
      await this.memory.storeReflection(
        insight.insight,
        insight.confidence,
        insight.action,
        insight.pattern_type
      );
      
      insights.push(insight);
    }

    // Check for slow responses
    const slowResponses = recent.filter(r => {
      // If we had timing data, we'd check it here
      return false;
    });

    return insights;
  }

  /**
   * Get reflection stats
   */
  async getStats() {
    const reflections = await this.memory.getRecentReflections(1000);
    
    return {
      total_reflections: reflections.length,
      high_confidence: reflections.filter(r => r.confidence > 0.7).length,
      by_pattern: reflections.reduce((acc, r) => {
        acc[r.pattern_type] = (acc[r.pattern_type] || 0) + 1;
        return acc;
      }, {})
    };
  }
}

module.exports = ReflectionEngine;

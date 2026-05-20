/**
 * HYDI Knowledge Synthesis Engine
 * Phase 5.3 Implementation
 *
 * Purpose: Actively synthesize new knowledge from existing reasoning patterns
 * Deployed: 5/19/2026 Session 5
 */

const crypto = require('crypto');
const EventEmitter = require('events');

class KnowledgeSynthesisEngine extends EventEmitter {
  constructor(config = {}) {
    super();

    this.cascadeSystem = config.cascadeSystem || null;
    this.autonomousQueue = config.autonomousQueue || null;
    this.metaCognition = config.metaCognition || null;

    this.synthesisLog = [];
    this.discoveredInsights = new Map();
    this.patternConnections = new Map();

    this.synthesisConfig = {
      minQualityScore: config.minQualityScore || 0.75,
      minPatternOccurrences: config.minPatternOccurrences || 2,
      similarityThreshold: config.similarityThreshold || 0.7,
      confidenceThreshold: config.confidenceThreshold || 0.75
    };
  }

  /**
   * Synthesize new insights from existing reasoning patterns
   */
  async synthesizeNewInsights(options = {}) {
    const startTime = Date.now();

    try {
      // Get high-quality reasoning patterns
      const patterns = await this.getQualityPatterns();

      if (patterns.length < 2) {
        return {
          success: true,
          synthesizedCount: 0,
          reason: 'Insufficient patterns for synthesis',
          executionTime: Date.now() - startTime
        };
      }

      const insights = [];

      // Pair patterns and synthesize connections
      for (let i = 0; i < patterns.length; i++) {
        for (let j = i + 1; j < patterns.length; j++) {
          const related = await this.findRelationship(patterns[i], patterns[j]);

          if (related && related.confidence >= this.synthesisConfig.confidenceThreshold) {
            const insight = await this.synthesizeConnection(
              patterns[i],
              patterns[j],
              related
            );

            if (insight && insight.confidence >= this.synthesisConfig.confidenceThreshold) {
              insights.push(insight);
            }
          }
        }
      }

      // Deduplicate and store insights
      const uniqueInsights = this.deduplicateInsights(insights);

      for (const insight of uniqueInsights) {
        await this.storeInsight(insight);
      }

      this.emit('synthesis-complete', {
        patternCount: patterns.length,
        insightCount: uniqueInsights.length,
        executionTime: Date.now() - startTime
      });

      return {
        success: true,
        synthesizedCount: uniqueInsights.length,
        insights: uniqueInsights.slice(0, 5), // Return top 5
        executionTime: Date.now() - startTime
      };

    } catch (error) {
      this.emit('synthesis-error', { error: error.message });
      return {
        success: false,
        error: error.message,
        executionTime: Date.now() - startTime
      };
    }
  }

  /**
   * Get high-quality patterns from meta-cognition system
   */
  async getQualityPatterns() {
    if (!this.metaCognition) {
      return [];
    }

    const insights = this.metaCognition.getInsights();
    return Array.from(this.metaCognition.reasoningPatterns.values())
      .filter(p => p.qualityScore >= this.synthesisConfig.minQualityScore)
      .sort((a, b) => b.qualityScore - a.qualityScore);
  }

  /**
   * Find conceptual relationship between two patterns
   */
  async findRelationship(pattern1, pattern2) {
    try {
      const cascade1 = new Set(pattern1.cascadePath || []);
      const cascade2 = new Set(pattern2.cascadePath || []);

      let similarity = 0;
      let sharedConcepts = [];

      if (cascade1.size > 0 || cascade2.size > 0) {
        // Primary: Jaccard similarity on shared CASCADE concepts
        const intersection = new Set([...cascade1].filter(x => cascade2.has(x)));
        const union = new Set([...cascade1, ...cascade2]);
        similarity = union.size > 0 ? intersection.size / union.size : 0;
        sharedConcepts = Array.from(intersection);
      } else {
        // Fallback: word-overlap on query text when CASCADE paths are empty.
        // Uses a lower threshold (0.15) than CASCADE Jaccard since these are
        // diverse queries about the same system — any shared keyword is signal.
        const words1 = new Set((pattern1.queryPattern || '').toLowerCase().split(/\s+/).filter(w => w.length > 3));
        const words2 = new Set((pattern2.queryPattern || '').toLowerCase().split(/\s+/).filter(w => w.length > 3));
        const wordIntersection = new Set([...words1].filter(x => words2.has(x)));
        const wordUnion = new Set([...words1, ...words2]);
        similarity = wordUnion.size > 0 ? wordIntersection.size / wordUnion.size : 0;
        sharedConcepts = Array.from(wordIntersection);

        if (similarity < 0.15) return null; // text-specific lower bound
        // Map text similarity [0.15,1.0] → confidence [0.75,1.0] so it clears
        // the synthesisConfig.confidenceThreshold (default 0.75) without inflating
        // the confidence for weakly-related pairs.
        const confidence = 0.75 + ((similarity - 0.15) / 0.85) * 0.25;
        return {
          sharedConcepts,
          similarity,
          confidence,
          type: this.classifyRelationship(pattern1, pattern2)
        };
      }

      if (similarity < this.synthesisConfig.similarityThreshold) {
        return null;
      }

      const confidence = Math.min(1.0, similarity * 1.2);

      return {
        sharedConcepts,
        similarity,
        confidence,
        type: this.classifyRelationship(pattern1, pattern2)
      };

    } catch (error) {
      return null;
    }
  }

  /**
   * Synthesize a new insight from two related patterns
   */
  async synthesizeConnection(pattern1, pattern2, relationship) {
    try {
      const insight = {
        id: crypto.randomUUID(),
        type: 'synthesized_insight',
        sourcePatterns: [pattern1.id, pattern2.id],
        relationshipType: relationship.type,
        sharedConcepts: relationship.sharedConcepts,
        content: await this.generateInsightContent(pattern1, pattern2, relationship),
        confidence: relationship.confidence,
        derivationPath: [pattern1.queryPattern, pattern2.queryPattern],
        timestamp: Date.now(),
        applicability: this.assessApplicability(pattern1, pattern2)
      };

      this.discoveredInsights.set(insight.id, insight);
      this.patternConnections.set(
        `${pattern1.id}--${pattern2.id}`,
        insight
      );

      this.synthesisLog.push({
        insightId: insight.id,
        timestamp: insight.timestamp,
        sourceCount: 2,
        confidence: insight.confidence,
        type: insight.relationshipType
      });

      this.emit('insight-synthesized', {
        insightId: insight.id,
        confidence: insight.confidence,
        relationshipType: insight.relationshipType
      });

      return insight;

    } catch (error) {
      return null;
    }
  }

  /**
   * Generate natural language description of synthesized insight
   */
  async generateInsightContent(pattern1, pattern2, relationship) {
    const baseContent = `Synthesized connection between patterns: ${pattern1.queryPattern} and ${pattern2.queryPattern}`;

    const sharedConcepts = relationship.sharedConcepts.length > 0
      ? `Shared concepts: ${relationship.sharedConcepts.join(', ')}`
      : '';

    const applicability = `This insight applies when reasoning about: ${pattern1.queryPattern} in context of ${pattern2.queryPattern}`;

    return [
      baseContent,
      sharedConcepts,
      applicability,
      `Confidence: ${(relationship.confidence * 100).toFixed(1)}%`
    ].filter(x => x).join('. ');
  }

  /**
   * Classify relationship type between patterns
   */
  classifyRelationship(pattern1, pattern2) {
    const p1 = pattern1.cascadePath || [];
    const p2 = pattern2.cascadePath || [];
    const maxLen = Math.max(p1.length, p2.length);

    if (maxLen === 0) return 'complementary';

    const shared = new Set([...p1].filter(x => p2.includes(x)));

    if (shared.size / maxLen > 0.6) return 'strongly_related';
    if (shared.size > 0) return 'partially_related';
    return 'complementary';
  }

  /**
   * Assess how broadly applicable a synthesized insight is
   */
  assessApplicability(pattern1, pattern2) {
    const queries = [pattern1.queryPattern, pattern2.queryPattern];
    const uniqueWords = new Set();

    for (const q of queries) {
      q.split(/\s+/).forEach(w => uniqueWords.add(w));
    }

    const generalityScore = Math.min(1.0, uniqueWords.size / 10);

    if (generalityScore > 0.7) return 'high';
    if (generalityScore > 0.4) return 'medium';
    return 'low';
  }

  /**
   * Deduplicate similar insights
   */
  deduplicateInsights(insights) {
    const unique = [];
    const seen = new Set();

    for (const insight of insights.sort((a, b) => b.confidence - a.confidence)) {
      const key = [
        ...insight.sharedConcepts.sort()
      ].join('|');

      if (!seen.has(key)) {
        unique.push(insight);
        seen.add(key);
      }
    }

    return unique;
  }

  /**
   * Store synthesized insight in CASCADE system
   */
  async storeInsight(insight) {
    if (!this.cascadeSystem) {
      return;
    }

    try {
      await this.cascadeSystem.addKnowledge?.({
        type: 'synthesized_insight',
        id: insight.id,
        content: insight.content,
        confidence: insight.confidence,
        sourcePatterns: insight.sourcePatterns,
        metadata: {
          relationshipType: insight.relationshipType,
          applicability: insight.applicability,
          synthesisTime: insight.timestamp
        }
      });

      this.emit('insight-stored', {
        insightId: insight.id,
        cascadeId: insight.id
      });

    } catch (error) {
      this.emit('storage-error', {
        insightId: insight.id,
        error: error.message
      });
    }
  }

  /**
   * Get synthesis statistics
   */
  getStatistics() {
    return {
      totalSynthesized: this.synthesisLog.length,
      discoveredInsights: this.discoveredInsights.size,
      patternConnections: this.patternConnections.size,
      averageConfidence: this.synthesisLog.length > 0
        ? this.synthesisLog.reduce((sum, s) => sum + s.confidence, 0) / this.synthesisLog.length
        : 0,
      recentInsights: Array.from(this.discoveredInsights.values())
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 5),
      relationshipDistribution: this.getRelationshipDistribution()
    };
  }

  /**
   * Get distribution of relationship types found
   */
  getRelationshipDistribution() {
    const distribution = {};

    for (const insight of this.discoveredInsights.values()) {
      const type = insight.relationshipType;
      distribution[type] = (distribution[type] || 0) + 1;
    }

    return distribution;
  }

  /**
   * Analyze insight evolution over time
   */
  getEvolutionAnalysis() {
    if (this.synthesisLog.length === 0) {
      return null;
    }

    const byTimeWindow = {};
    const oneHour = 3600000;

    for (const log of this.synthesisLog) {
      const window = Math.floor(log.timestamp / oneHour);
      if (!byTimeWindow[window]) {
        byTimeWindow[window] = {
          insightCount: 0,
          totalConfidence: 0
        };
      }
      byTimeWindow[window].insightCount++;
      byTimeWindow[window].totalConfidence += log.confidence;
    }

    // Calculate trend
    const windows = Object.keys(byTimeWindow).map(Number).sort();
    let trend = 'stable';

    if (windows.length > 1) {
      const recent = byTimeWindow[windows[windows.length - 1]];
      const older = byTimeWindow[windows[0]];

      if (recent.insightCount > older.insightCount * 1.2) {
        trend = 'accelerating';
      } else if (recent.insightCount < older.insightCount * 0.8) {
        trend = 'decelerating';
      }
    }

    return {
      trend,
      timeWindows: windows.length,
      totalInsights: this.synthesisLog.length,
      averagePerWindow: this.synthesisLog.length / windows.length,
      timeline: byTimeWindow
    };
  }

  /**
   * Find insights that could improve specific reasoning task
   */
  async findRelevantInsights(query, limit = 5) {
    // Retrieval is intentionally looser than synthesis pairing (0.25 vs 0.7).
    // Scored by query-recall (intersection / queryWords) not Jaccard, because
    // insight content is verbose — a single shared concept is still signal.
    const RETRIEVAL_THRESHOLD = 0.25;

    try {
      const queryWords = new Set(
        query.toLowerCase().split(/\s+/).filter(w => w.length > 3)
      );
      if (queryWords.size === 0) return [];

      const candidates = [];

      for (const insight of this.discoveredInsights.values()) {
        const insightWords = new Set(
          (insight.content + ' ' + (insight.sharedConcepts || []).join(' '))
            .toLowerCase().split(/\s+/).filter(w => w.length > 3)
        );

        const intersection = new Set([...queryWords].filter(x => insightWords.has(x)));
        // Query-recall: what fraction of the query's keywords appear in this insight
        const similarity = intersection.size / queryWords.size;

        if (similarity >= RETRIEVAL_THRESHOLD) {
          candidates.push({
            insightId: insight.id,
            similarity,
            confidence: insight.confidence,
            content: insight.content,
            applicability: insight.applicability
          });
        }
      }

      return candidates
        .sort((a, b) => (b.similarity * b.confidence) - (a.similarity * a.confidence))
        .slice(0, limit);

    } catch (error) {
      return [];
    }
  }

  /**
   * Export all discoveries as knowledge base update
   */
  exportDiscoveries() {
    return {
      discoveredInsights: Array.from(this.discoveredInsights.values()),
      synthesisStatistics: this.getStatistics(),
      evolutionAnalysis: this.getEvolutionAnalysis(),
      exportedAt: Date.now(),
      totalCount: this.discoveredInsights.size
    };
  }
}

module.exports = KnowledgeSynthesisEngine;

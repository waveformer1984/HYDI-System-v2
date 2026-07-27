'use strict';

class ExecutiveDashboard {
  constructor(runtime) {
    this.runtime = runtime;
  }

  snapshot() {
    const s = this.runtime.session;
    const status = this.runtime.getStatus();

    const auditVerified = s && s.auditLedger ? s.auditLedger.verify() : { ok: false };
    const learning = s && s.learningMetrics ? s.learningMetrics.computeMetrics({}) : null;
    const evidence = s && s.evidenceEngine ? {
      summary: s.evidenceEngine.getEvidenceSummary(),
      awaitingReview: s.evidenceEngine.getRecommendationsAwaitingReview().length,
      recentlyConfirmed: s.evidenceEngine.getRecentlyConfirmedOutcomes(5),
    } : null;
    const recentActivity = s && s.executiveOS ? s.executiveOS.recentActivitySummary(86400000) : null;
    const briefing = s && s.executiveOS ? s.executiveOS.morningBriefing() : null;

    return {
      timestamp: Date.now(),
      runtime: {
        state: status.state,
        uptime: status.uptime,
        eventsProcessed: status.eventsProcessed,
        recommendations: status.recommendations,
        pendingApprovals: status.pendingApprovals,
        awaitingMeasurements: status.awaitingMeasurements,
        auditEntries: status.auditEntries,
        learningUpdates: status.learningUpdates,
        lastVerifiedAction: status.lastVerifiedAction,
      },
      connectors: status.connectors || [],
      businessHealth: briefing,
      trust: {
        averageConfidence: learning ? learning.averageConfidence : null,
        recommendationSuccessRate: learning ? learning.recommendationSuccessRate : null,
        predictionAccuracy: learning ? learning.predictionAccuracy : null,
      },
      evidence,
      learning: {
        completed: learning ? learning.completed : 0,
        total: learning ? learning.total : 0,
        recentLessons: learning ? learning.recentLessons || [] : [],
      },
      audit: {
        entries: auditVerified.count || status.auditEntries,
        verified: auditVerified.ok,
      },
      recentActivity,
      measuredOutcomes: evidence ? evidence.recentlyConfirmed : [],
      learningBacklog: status.awaitingMeasurements,
    };
  }
}

module.exports = ExecutiveDashboard;

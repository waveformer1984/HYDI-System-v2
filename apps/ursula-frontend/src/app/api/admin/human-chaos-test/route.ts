import { NextRequest, NextResponse } from 'next/server';
import { HumanChaosTesting } from '@/lib/human-chaos-testing';

// POST /api/admin/human-chaos-test - Run human behavior chaos testing
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    console.log('[HUMAN-CHAOS] Starting human behavior chaos testing');
    
    const testing = new HumanChaosTesting();
    const results = await testing.runHumanChaosTests();
    
    const summary = {
      total: results.length,
      passed: results.filter(r => r.passed).length,
      failed: results.filter(r => !r.passed).length,
      totalDuration: results.reduce((sum, r) => sum + r.duration, 0),
      averageUserExperience: results.reduce((sum, r) => sum + r.userExperienceScore, 0) / results.length,
      userActions: results.flatMap(r => r.userActions),
      systemResponses: results.flatMap(r => r.systemResponses),
      issues: results.flatMap(r => r.issues),
      tests: results,
    };

    console.log(`[HUMAN-CHAOS] Results: ${summary.passed}/${summary.total} passed`);
    console.log(`[HUMAN-CHAOS] Average user experience: ${summary.averageUserExperience.toFixed(1)}/10`);
    
    if (summary.issues.length > 0) {
      console.error(`[HUMAN-CHAOS] Human issues detected: ${summary.issues.length}`);
      summary.issues.forEach(issue => console.error(`  - ${issue}`));
    }

    return NextResponse.json({
      success: true,
      summary,
      timestamp: new Date().toISOString(),
      readiness: {
        readyForRealUsers: summary.failed === 0 && summary.averageUserExperience >= 7,
        userExperienceScore: summary.averageUserExperience,
        concerns: [
          ...(summary.failed > 0 ? [`${summary.failed} tests failed`] : []),
          ...(summary.averageUserExperience < 7 ? [`Low user experience score: ${summary.averageUserExperience.toFixed(1)}/10`] : []),
          ...(summary.issues.length > 0 ? [`${summary.issues.length} user experience issues`] : []),
        ],
        recommendations: generateRecommendations(summary),
      },
    });

  } catch (error) {
    console.error('[HUMAN-CHAOS] Human chaos testing failed:', error);
    return NextResponse.json({
      success: false,
      error: 'Human chaos testing failed',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}

/**
 * Generate recommendations based on test results
 */
function generateRecommendations(summary: any): string[] {
  const recommendations: string[] = [];
  
  if (summary.averageUserExperience < 7) {
    recommendations.push('Improve user interface clarity and feedback');
    recommendations.push('Add better error messages and loading indicators');
  }
  
  if (summary.issues.some((issue: string) => issue.includes('duplicate'))) {
    recommendations.push('Strengthen duplicate prevention mechanisms');
  }
  
  if (summary.issues.some((issue: string) => issue.includes('confusion'))) {
    recommendations.push('Simplify user interface and terminology');
    recommendations.push('Add tooltips and help text for complex features');
  }
  
  if (summary.issues.some((issue: string) => issue.includes('support'))) {
    recommendations.push('Improve customer support tools and audit trails');
  }
  
  if (summary.issues.some((issue: string) => issue.includes('security'))) {
    recommendations.push('Review and strengthen security measures');
  }
  
  if (recommendations.length === 0) {
    recommendations.push('System handles human behavior well - consider beta testing with real users');
  }
  
  return recommendations;
}

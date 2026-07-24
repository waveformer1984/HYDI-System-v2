import { NextRequest, NextResponse } from 'next/server';
import { CrossCheckAlert, CrossCheckRule } from '@/lib/ucmrs/types';

// Mock database - replace with actual DB connection
const alerts: CrossCheckAlert[] = [];
let nextId = 1;

// GET /api/ucmrs/alerts - Get cross-check alerts with filtering
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const componentId = searchParams.get('componentId');
  const severity = searchParams.get('severity');
  const status = searchParams.get('status');
  const alertType = searchParams.get('alertType');
  const limit = parseInt(searchParams.get('limit') || '50');

  let filteredAlerts = alerts;

  if (componentId) {
    filteredAlerts = filteredAlerts.filter(a => a.component_id === componentId);
  }

  if (severity) {
    filteredAlerts = filteredAlerts.filter(a => a.severity === severity);
  }

  if (status) {
    filteredAlerts = filteredAlerts.filter(a => a.status === status);
  }

  if (alertType) {
    filteredAlerts = filteredAlerts.filter(a => a.alert_type === alertType);
  }

  // Sort by severity and creation date
  const severityOrder = { 'Critical': 4, 'Demo Risk': 3, 'Warning': 2, 'Info': 1 };
  filteredAlerts.sort((a, b) => {
    const severityDiff = severityOrder[b.severity] - severityOrder[a.severity];
    if (severityDiff !== 0) return severityDiff;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  const summary = generateAlertSummary(filteredAlerts);

  return NextResponse.json({
    alerts: filteredAlerts.slice(0, limit),
    summary,
    total: filteredAlerts.length
  });
}

// POST /api/ucmrs/alerts - Create new alert (usually called by cross-check system)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { component_id, alert_type, message, severity } = body;

    if (!component_id || !alert_type || !message || !severity) {
      return NextResponse.json(
        { error: 'Missing required fields: component_id, alert_type, message, severity' },
        { status: 400 }
      );
    }

    const newAlert: CrossCheckAlert = {
      id: (nextId++).toString(),
      component_id,
      alert_type,
      message,
      severity,
      status: 'Open',
      created_at: new Date().toISOString()
    };

    alerts.push(newAlert);

    // Auto-escalate critical alerts
    if (severity === 'Critical' || severity === 'Demo Risk') {
      await escalateAlert(newAlert);
    }

    return NextResponse.json({
      alert: newAlert,
      message: 'Alert created successfully'
    }, { status: 201 });

  } catch (error) {
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400 }
    );
  }
}

// PUT /api/ucmrs/alerts/[id]/acknowledge - Acknowledge alert
export async function ACKNOWLEDGE(request: NextRequest, { params }: { params: { id: string } }) {
  const alertIndex = alerts.findIndex(a => a.id === params.id);

  if (alertIndex === -1) {
    return NextResponse.json({ error: 'Alert not found' }, { status: 404 });
  }

  alerts[alertIndex].status = 'Acknowledged';

  return NextResponse.json({
    alert: alerts[alertIndex],
    message: 'Alert acknowledged'
  });
}

// PUT /api/ucmrs/alerts/[id]/resolve - Resolve alert
export async function RESOLVE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await request.json();
    const { resolution_notes } = body;

    const alertIndex = alerts.findIndex(a => a.id === params.id);

    if (alertIndex === -1) {
      return NextResponse.json({ error: 'Alert not found' }, { status: 404 });
    }

    alerts[alertIndex].status = 'Resolved';
    alerts[alertIndex].resolved_at = new Date().toISOString();

    return NextResponse.json({
      alert: alerts[alertIndex],
      message: 'Alert resolved successfully'
    });

  } catch (error) {
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400 }
    );
  }
}

// POST /api/ucmrs/alerts/bulk-resolve - Resolve multiple alerts
export async function BULK_RESOLVE(request: NextRequest) {
  try {
    const body = await request.json();
    const { alert_ids, resolution_notes } = body;

    if (!alert_ids || !Array.isArray(alert_ids)) {
      return NextResponse.json(
        { error: 'Missing required field: alert_ids (array)' },
        { status: 400 }
      );
    }

    const resolvedAlerts: CrossCheckAlert[] = [];
    const now = new Date().toISOString();

    alert_ids.forEach(id => {
      const alertIndex = alerts.findIndex(a => a.id === id);
      if (alertIndex !== -1) {
        alerts[alertIndex].status = 'Resolved';
        alerts[alertIndex].resolved_at = now;
        resolvedAlerts.push(alerts[alertIndex]);
      }
    });

    return NextResponse.json({
      resolved_alerts: resolvedAlerts,
      count: resolvedAlerts.length,
      message: `${resolvedAlerts.length} alerts resolved`
    });

  } catch (error) {
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400 }
    );
  }
}

// GET /api/ucmrs/alerts/dashboard - Alert dashboard summary
export async function GET_DASHBOARD(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const timeframe = searchParams.get('timeframe') || '7d'; // 7d, 30d, 90d

  const now = new Date();
  const cutoffDate = new Date();

  switch (timeframe) {
    case '7d':
      cutoffDate.setDate(now.getDate() - 7);
      break;
    case '30d':
      cutoffDate.setDate(now.getDate() - 30);
      break;
    case '90d':
      cutoffDate.setDate(now.getDate() - 90);
      break;
  }

  const recentAlerts = alerts.filter(a => new Date(a.created_at) >= cutoffDate);
  const dashboard = generateDashboardData(recentAlerts, timeframe);

  return NextResponse.json(dashboard);
}

// GET /api/ucmrs/alerts/run-cross-check - Trigger cross-check on all components
export async function RUN_CROSS_CHECK(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const componentId = searchParams.get('componentId');

    // This would normally query all components and run cross-check rules
    // For now, we'll simulate the process

    const mockComponents = [
      {
        component_id: 'LASER_HARP_01',
        physical_status: 'Tested',
        ursula_status: 'Streaming Data',
        monetization_class: 'Core Product',
        failure_risk_level: 'Medium',
        solves_real_problem: true,
        would_pay_today: true,
        can_demo_60_seconds: false,
        input_type: 'Laser beam break',
        output_type: 'MIDI note',
        protocol: 'Custom'
      }
    ];

    const newAlerts = [];

    for (const component of mockComponents) {
      if (!componentId || component.component_id === componentId) {
        const componentAlerts = await runCrossCheckRules(component);
        newAlerts.push(...componentAlerts);
      }
    }

    return NextResponse.json({
      alerts_generated: newAlerts.length,
      alerts: newAlerts,
      summary: {
        critical: newAlerts.filter(a => a.severity === 'Critical').length,
        demo_risks: newAlerts.filter(a => a.severity === 'Demo Risk').length,
        warnings: newAlerts.filter(a => a.severity === 'Warning').length,
        info: newAlerts.filter(a => a.severity === 'Info').length
      }
    });

  } catch (error) {
    return NextResponse.json(
      { error: 'Cross-check failed' },
      { status: 500 }
    );
  }
}

// GET /api/ucmrs/alerts/nagging-summary - The annoying project manager report
export async function GET_NAGGING_SUMMARY(request: NextRequest) {
  const openAlerts = alerts.filter(a => a.status === 'Open');
  const criticalAlerts = openAlerts.filter(a => a.severity === 'Critical');
  const demoRisks = openAlerts.filter(a => a.severity === 'Demo Risk');

  const naggingReport = {
    attention_required: criticalAlerts.length + demoRisks.length > 0,
    total_open_issues: openAlerts.length,
    critical_issues: criticalAlerts.length,
    demo_risks: demoRisks.length,

    brutal_honesty: {
      system_health: criticalAlerts.length === 0 ? 'Stable' : 'Critical Issues Detected',
      readiness_for_demo: demoRisks.length === 0 ? 'Demo Ready' : 'WILL FAIL PUBLICLY',
      monetization_progress: openAlerts.filter(a => a.alert_type === 'NO_REVENUE_PATH').length === 0 ? 'On Track' : 'No Revenue Path'
    },

    immediate_actions: [
      criticalAlerts.length > 0 && `Resolve ${criticalAlerts.length} critical issues immediately`,
      demoRisks.length > 0 && `Address ${demoRisks.length} demo risks before any presentation`,
      openAlerts.length > 10 && 'Too many open alerts - focus on high-priority items'
    ].filter(Boolean),

    component_health: generateComponentHealthReport(openAlerts),

    next_review: 'Schedule review when critical issues are resolved'
  };

  return NextResponse.json(naggingReport);
}

// Helper functions

function generateAlertSummary(alerts: CrossCheckAlert[]) {
  const total = alerts.length;
  const byStatus = {
    Open: alerts.filter(a => a.status === 'Open').length,
    Acknowledged: alerts.filter(a => a.status === 'Acknowledged').length,
    Resolved: alerts.filter(a => a.status === 'Resolved').length,
    Ignored: alerts.filter(a => a.status === 'Ignored').length
  };

  const bySeverity = {
    Critical: alerts.filter(a => a.severity === 'Critical').length,
    'Demo Risk': alerts.filter(a => a.severity === 'Demo Risk').length,
    Warning: alerts.filter(a => a.severity === 'Warning').length,
    Info: alerts.filter(a => a.severity === 'Info').length
  };

  return {
    total,
    by_status: byStatus,
    by_severity: bySeverity,
    open_rate: total > 0 ? Math.round((byStatus.Open / total) * 100) : 0,
    critical_rate: total > 0 ? Math.round((bySeverity.Critical / total) * 100) : 0
  };
}

async function escalateAlert(alert: CrossCheckAlert) {
  // This would normally send notifications, create tickets, etc.
  console.log(`ESCALATING ALERT: ${alert.alert_type} - ${alert.message}`);

  // Could integrate with:
  // - Email notifications
  // - Slack/Discord alerts
  // - Jira ticket creation
  // - PagerDuty escalation
}

async function runCrossCheckRules(component: any): Promise<CrossCheckAlert[]> {
  const newAlerts: CrossCheckAlert[] = [];

  // Rule: Non-validated hardware
  if (component.physical_status !== 'Tested') {
    newAlerts.push({
      id: (nextId++).toString(),
      component_id: component.component_id,
      alert_type: 'NON_VALIDATED_HARDWARE',
      message: 'Non-validated hardware - this will break at demo',
      severity: 'Critical',
      status: 'Open',
      created_at: new Date().toISOString()
    });
  }

  // Rule: Integration gap
  if (!['Addressable', 'Streaming Data', 'Controlled'].includes(component.ursula_status)) {
    newAlerts.push({
      id: (nextId++).toString(),
      component_id: component.component_id,
      alert_type: 'INTEGRATION_GAP',
      message: 'Integration gap - component not addressable',
      severity: 'Warning',
      status: 'Open',
      created_at: new Date().toISOString()
    });
  }

  // Rule: No revenue path
  if (!component.monetization_class) {
    newAlerts.push({
      id: (nextId++).toString(),
      component_id: component.component_id,
      alert_type: 'NO_REVENUE_PATH',
      message: 'No revenue path - this is a hobby, not a product',
      severity: 'Critical',
      status: 'Open',
      created_at: new Date().toISOString()
    });
  }

  // Rule: Demo risk
  if (component.failure_risk_level === 'High' || component.failure_risk_level === 'this will absolutely break at demo') {
    newAlerts.push({
      id: (nextId++).toString(),
      component_id: component.component_id,
      alert_type: 'DEMO_RISK',
      message: 'Demo risk - this component will fail publicly',
      severity: 'Demo Risk',
      status: 'Open',
      created_at: new Date().toISOString()
    });
  }

  // Rule: Reality filter failure
  if (!component.solves_real_problem || !component.would_pay_today || !component.can_demo_60_seconds) {
    newAlerts.push({
      id: (nextId++).toString(),
      component_id: component.component_id,
      alert_type: 'REALITY_FILTER',
      message: 'Reality filter failed - this is R&D, not a product',
      severity: 'Warning',
      status: 'Open',
      created_at: new Date().toISOString()
    });
  }

  return newAlerts;
}

function generateDashboardData(alerts: CrossCheckAlert[], timeframe: string) {
  const dailyCounts = new Map<string, number>();

  alerts.forEach(alert => {
    const date = new Date(alert.created_at).toISOString().split('T')[0];
    dailyCounts.set(date, (dailyCounts.get(date) || 0) + 1);
  });

  const trend = Array.from(dailyCounts.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));

  const topAlertTypes = alerts.reduce((acc, alert) => {
    acc[alert.alert_type] = (acc[alert.alert_type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const topComponents = alerts.reduce((acc, alert) => {
    acc[alert.component_id] = (acc[alert.component_id] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return {
    timeframe,
    total_alerts: alerts.length,
    trend,
    top_alert_types: Object.entries(topAlertTypes)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([type, count]) => ({ alert_type: type, count })),
    top_components: Object.entries(topComponents)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([component, count]) => ({ component_id: component, count })),
    resolution_rate: alerts.filter(a => a.status === 'Resolved').length / alerts.length
  };
}

function generateComponentHealthReport(alerts: CrossCheckAlert[]) {
  const componentAlerts = alerts.reduce((acc, alert) => {
    if (!acc[alert.component_id]) {
      acc[alert.component_id] = [];
    }
    acc[alert.component_id].push(alert);
    return acc;
  }, {} as Record<string, CrossCheckAlert[]>);

  return Object.entries(componentAlerts).map(([componentId, componentAlerts]) => {
    const critical = componentAlerts.filter(a => a.severity === 'Critical').length;
    const demoRisks = componentAlerts.filter(a => a.severity === 'Demo Risk').length;

    return {
      component_id: componentId,
      total_alerts: componentAlerts.length,
      critical_issues: critical,
      demo_risks: demoRisks,
      health_status: critical > 0 ? 'Critical' : demoRisks > 0 ? 'At Risk' : 'Stable'
    };
  }).sort((a, b) => b.critical_issues - a.critical_issues);
}

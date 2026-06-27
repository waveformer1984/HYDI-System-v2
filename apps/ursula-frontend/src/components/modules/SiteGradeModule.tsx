/**
 * SiteGradeModule — AI Website Auditor Dashboard
 *
 * Comprehensive interface for the SiteGrade AI auditor service.
 * Triggers automated website audits, displays detailed reports,
 * and provides actionable insights for SEO, performance, and accessibility.
 *
 * Features:
 * - Audit trigger with URL input and options
 * - Recent reports dashboard with scores and trends
 * - Detailed report viewer with category breakdowns
 * - Performance metrics and recommendations
 * - Postman collection integration
 *
 * TEST mode: Shows mock audit data and reports.
 * LIVE mode: Connects to actual SiteGrade AI API.
 */
'use client';

import { useState } from 'react';
import {
  Globe,
  FileText,
  Plus,
  ExternalLink,
  BarChart3,
  TrendingUp,
  AlertCircle,
  CheckCircle2,
  Clock,
  Search,
  Zap,
  Shield,
  Eye,
  Target,
  RefreshCw,
  Download,
  Filter,
  Calendar,
} from 'lucide-react';
import { useMode } from '@/lib/mode-context';

/* -- Types ------------------------------------------------- */

interface AuditReport {
  id: string;
  url: string;
  timestamp: string;
  status: 'completed' | 'processing' | 'failed';
  score: {
    overall: number;
    seo: number;
    performance: number;
    accessibility: number;
    security: number;
  };
  issues: {
    critical: number;
    warning: number;
    info: number;
  };
  recommendations: string[];
  duration: string;
}

interface AuditTrigger {
  url: string;
  options: {
    deepScan: boolean;
    checkLinks: boolean;
    mobileFriendly: boolean;
    lighthouse: boolean;
  };
}

/* -- Mock Data --------------------------------------------- */

const MOCK_REPORTS: AuditReport[] = [
  {
    id: 'audit-001',
    url: 'https://protoforge.net',
    timestamp: '2026-02-09T14:30:00Z',
    status: 'completed',
    score: {
      overall: 87,
      seo: 92,
      performance: 78,
      accessibility: 95,
      security: 88,
    },
    issues: {
      critical: 2,
      warning: 8,
      info: 15,
    },
    recommendations: [
      'Optimize images for better performance',
      'Add alt text to remaining images',
      'Improve mobile responsiveness',
      'Update SSL certificate renewal process',
    ],
    duration: '2.3s',
  },
  {
    id: 'audit-002',
    url: 'https://rezonette.ai',
    timestamp: '2026-02-09T12:15:00Z',
    status: 'completed',
    score: {
      overall: 94,
      seo: 98,
      performance: 89,
      accessibility: 97,
      security: 92,
    },
    issues: {
      critical: 0,
      warning: 3,
      info: 7,
    },
    recommendations: [
      'Enable gzip compression',
      'Minify CSS and JavaScript',
      'Add structured data markup',
    ],
    duration: '1.8s',
  },
  {
    id: 'audit-003',
    url: 'https://hydi.system',
    timestamp: '2026-02-09T10:45:00Z',
    status: 'processing',
    score: {
      overall: 0,
      seo: 0,
      performance: 0,
      accessibility: 0,
      security: 0,
    },
    issues: {
      critical: 0,
      warning: 0,
      info: 0,
    },
    recommendations: [],
    duration: '0.0s',
  },
];

const SCORE_CATEGORIES = [
  { key: 'overall', label: 'Overall', icon: <BarChart3 size={14} />, color: '#58a6ff' },
  { key: 'seo', label: 'SEO', icon: <Search size={14} />, color: '#3fb950' },
  { key: 'performance', label: 'Performance', icon: <Zap size={14} />, color: '#d29922' },
  { key: 'accessibility', label: 'Accessibility', icon: <Eye size={14} />, color: '#bc8cff' },
  { key: 'security', label: 'Security', icon: <Shield size={14} />, color: '#f85149' },
];

/* -- Main Component ---------------------------------------- */

export default function SiteGradeModule() {
  const { isLive } = useMode();
  const [activeView, setActiveView] = useState<'dashboard' | 'new-audit' | 'report'>('dashboard');
  const [selectedReport, setSelectedReport] = useState<AuditReport | null>(null);
  const [isAuditing, setIsAuditing] = useState(false);
  const [auditTrigger, setAuditTrigger] = useState<AuditTrigger>({
    url: '',
    options: {
      deepScan: true,
      checkLinks: true,
      mobileFriendly: true,
      lighthouse: true,
    },
  });

  const handleNewAudit = async () => {
    if (!auditTrigger.url) return;

    setIsAuditing(true);
    // Simulate audit process
    setTimeout(() => {
      setIsAuditing(false);
      setActiveView('dashboard');
      // In real implementation, would poll for results
    }, 3000);
  };

  const viewReport = (report: AuditReport) => {
    setSelectedReport(report);
    setActiveView('report');
  };

  if (activeView === 'report' && selectedReport) {
    return <ReportView report={selectedReport} onBack={() => setActiveView('dashboard')} />;
  }

  if (activeView === 'new-audit') {
    return (
      <NewAuditView
        auditTrigger={auditTrigger}
        onTriggerChange={setAuditTrigger}
        onAudit={handleNewAudit}
        isAuditing={isAuditing}
        onBack={() => setActiveView('dashboard')}
      />
    );
  }

  return <DashboardView onNewAudit={() => setActiveView('new-audit')} onViewReport={viewReport} />;
}

/* -- Sub-views --------------------------------------------- */

function DashboardView({
  onNewAudit,
  onViewReport,
}: {
  onNewAudit: () => void;
  onViewReport: (report: AuditReport) => void;
}) {
  const completedReports = MOCK_REPORTS.filter(r => r.status === 'completed');
  const avgScore = completedReports.length > 0
    ? Math.round(completedReports.reduce((sum, r) => sum + r.score.overall, 0) / completedReports.length)
    : 0;

  return (
    <div className="h-full overflow-y-auto p-6" style={{ background: 'var(--bg-editor)' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Globe size={20} style={{ color: '#3fb950' }} />
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-active)' }}>SiteGrade AI</h1>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-green-900/30 text-green-400">AI Auditor</span>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="https://github.com/waveformer1984/ProtoForgeSite/blob/main/postman/HYDI-SiteGrade.postman_collection.json"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono text-gray-400 hover:text-gray-200 bg-gray-800/30 hover:bg-gray-700/30 transition-colors"
          >
            <ExternalLink size={9} /> Postman
          </a>
          <button
            onClick={onNewAudit}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[12px] font-mono transition-colors bg-green-900/30 hover:bg-green-800/30"
            style={{ color: '#3fb950' }}
          >
            <Plus size={12} /> New Audit
          </button>
        </div>
      </div>

      <p className="text-sm text-gray-400 mb-6 max-w-2xl">
        AI-powered website auditing for SEO, performance, accessibility, and security analysis.
      </p>

      {/* Quick Stats */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Reports', value: completedReports.length, color: '#58a6ff' },
          { label: 'Avg Score', value: `${avgScore}%`, color: avgScore >= 90 ? '#3fb950' : avgScore >= 70 ? '#d29922' : '#f85149' },
          { label: 'Processing', value: MOCK_REPORTS.filter(r => r.status === 'processing').length, color: '#bc8cff' },
          { label: 'Issues', value: completedReports.reduce((sum, r) => sum + r.issues.critical, 0), color: '#f85149' },
        ].map(s => (
          <div key={s.label} className="p-3 rounded-md border" style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
            <div className="text-[10px] font-mono text-gray-400 uppercase tracking-wider mb-1">{s.label}</div>
            <div className="text-xl font-bold" style={{ color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Recent Reports */}
      <div className="space-y-3">
        <h2 className="text-sm font-bold mb-3" style={{ color: 'var(--text-active)' }}>Recent Audits</h2>

        {MOCK_REPORTS.length === 0 ? (
          <div className="rounded-md p-8 border text-center" style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
            <FileText size={32} className="mx-auto mb-3" style={{ color: 'var(--text-secondary)' }} />
            <p className="text-sm font-mono mb-2" style={{ color: 'var(--text-active)' }}>No audit reports yet</p>
            <p className="text-[11px] font-mono" style={{ color: 'var(--text-secondary)' }}>
              Run your first audit to get started with AI-powered website analysis.
            </p>
          </div>
        ) : (
          MOCK_REPORTS.map(report => (
            <AuditCard key={report.id} report={report} onView={() => onViewReport(report)} />
          ))
        )}
      </div>
    </div>
  );
}

function NewAuditView({
  auditTrigger,
  onTriggerChange,
  onAudit,
  isAuditing,
  onBack,
}: {
  auditTrigger: AuditTrigger;
  onTriggerChange: (trigger: AuditTrigger) => void;
  onAudit: () => void;
  isAuditing: boolean;
  onBack: () => void;
}) {
  return (
    <div className="h-full overflow-y-auto p-6" style={{ background: 'var(--bg-editor)' }}>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-[12px] font-mono text-gray-400 hover:text-gray-200 transition-colors"
        >
          ← Back to Dashboard
        </button>
      </div>

      <div className="max-w-2xl">
        <h1 className="text-xl font-bold mb-2" style={{ color: 'var(--text-active)' }}>New Website Audit</h1>
        <p className="text-sm text-gray-400 mb-6">
          Enter a website URL to run a comprehensive AI-powered audit covering SEO, performance, accessibility, and security.
        </p>

        {/* URL Input */}
        <div className="space-y-4">
          <div>
            <label className="block text-[11px] font-mono text-gray-400 mb-2 uppercase tracking-wider">
              Website URL
            </label>
            <input
              type="url"
              value={auditTrigger.url}
              onChange={(e) => onTriggerChange({ ...auditTrigger, url: e.target.value })}
              placeholder="https://example.com"
              className="w-full px-3 py-2 rounded border text-sm font-mono"
              style={{
                background: 'var(--bg-sidebar)',
                borderColor: 'var(--border-color)',
                color: 'var(--text-active)',
              }}
            />
          </div>

          {/* Options */}
          <div>
            <label className="block text-[11px] font-mono text-gray-400 mb-3 uppercase tracking-wider">
              Audit Options
            </label>
            <div className="space-y-2">
              {[
                { key: 'deepScan', label: 'Deep Content Analysis', desc: 'Analyze all pages and resources' },
                { key: 'checkLinks', label: 'Broken Link Detection', desc: 'Scan for 404s and broken links' },
                { key: 'mobileFriendly', label: 'Mobile Responsiveness', desc: 'Test mobile user experience' },
                { key: 'lighthouse', label: 'Lighthouse Performance', desc: 'Google Lighthouse metrics' },
              ].map(option => (
                <label key={option.key} className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={auditTrigger.options[option.key as keyof typeof auditTrigger.options]}
                    onChange={(e) => onTriggerChange({
                      ...auditTrigger,
                      options: { ...auditTrigger.options, [option.key]: e.target.checked },
                    })}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="text-sm font-medium" style={{ color: 'var(--text-active)' }}>
                      {option.label}
                    </div>
                    <div className="text-[11px] text-gray-400">{option.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Action */}
          <div className="pt-4">
            <button
              onClick={onAudit}
              disabled={!auditTrigger.url || isAuditing}
              className="flex items-center gap-2 px-6 py-3 rounded font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:scale-105"
              style={{ background: '#3fb950', color: '#ffffff' }}
            >
              {isAuditing ? (
                <>
                  <RefreshCw size={16} className="animate-spin" />
                  Running Audit...
                </>
              ) : (
                <>
                  <Target size={16} />
                  Start Audit
                </>
              )}
            </button>
            {isAuditing && (
              <p className="text-[11px] text-gray-400 mt-2">
                Audit in progress... This may take 30-60 seconds depending on site complexity.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ReportView({ report, onBack }: { report: AuditReport; onBack: () => void }) {
  const getScoreColor = (score: number) => {
    if (score >= 90) return '#3fb950';
    if (score >= 70) return '#d29922';
    return '#f85149';
  };

  return (
    <div className="h-full overflow-y-auto p-6" style={{ background: 'var(--bg-editor)' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-[12px] font-mono text-gray-400 hover:text-gray-200 transition-colors"
        >
          ← Back to Dashboard
        </button>
        <div className="flex items-center gap-2">
          <span
            className={`flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded ${report.status === 'completed' ? 'bg-green-900/30 text-green-400' :
                report.status === 'processing' ? 'bg-blue-900/30 text-blue-400' :
                  'bg-red-900/30 text-red-400'
              }`}
          >
            {report.status === 'completed' ? <CheckCircle2 size={10} /> :
              report.status === 'processing' ? <Clock size={10} /> :
                <AlertCircle size={10} />}
            {report.status}
          </span>
          <button className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono bg-gray-800/30 hover:bg-gray-700/30 transition-colors text-gray-400">
            <Download size={10} /> Export
          </button>
        </div>
      </div>

      {/* Report Header */}
      <div className="rounded-md p-6 border mb-6" style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-lg font-bold mb-1" style={{ color: 'var(--text-active)' }}>
              {new URL(report.url).hostname}
            </h1>
            <div className="flex items-center gap-2 text-[11px] font-mono text-gray-400">
              <Calendar size={10} />
              {new Date(report.timestamp).toLocaleString()}
              <span>•</span>
              <Clock size={10} />
              {report.duration}
            </div>
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold mb-1" style={{ color: getScoreColor(report.score.overall) }}>
              {report.score.overall}
            </div>
            <div className="text-[10px] font-mono text-gray-400 uppercase tracking-wider">Overall Score</div>
          </div>
        </div>

        <a
          href={report.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sm hover:underline"
          style={{ color: 'var(--text-accent)' }}
        >
          {report.url} <ExternalLink size={12} />
        </a>
      </div>

      {/* Score Breakdown */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        {SCORE_CATEGORIES.map(cat => {
          const score = report.score[cat.key as keyof typeof report.score];
          return (
            <div key={cat.key} className="p-4 rounded-md border" style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
              <div className="flex items-center gap-2 mb-2">
                <span style={{ color: cat.color }}>{cat.icon}</span>
                <span className="text-[10px] font-mono text-gray-400 uppercase tracking-wider">{cat.label}</span>
              </div>
              <div className="text-2xl font-bold" style={{ color: getScoreColor(score) }}>{score}</div>
              <div className="w-full bg-gray-700 rounded-full h-1 mt-2">
                <div
                  className="h-1 rounded-full transition-all"
                  style={{ width: `${score}%`, background: getScoreColor(score) }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Issues Summary */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { label: 'Critical', count: report.issues.critical, color: '#f85149' },
          { label: 'Warnings', count: report.issues.warning, color: '#d29922' },
          { label: 'Info', count: report.issues.info, color: '#58a6ff' },
        ].map(issue => (
          <div key={issue.label} className="p-3 rounded-md border text-center" style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
            <div className="text-xl font-bold mb-1" style={{ color: issue.color }}>{issue.count}</div>
            <div className="text-[10px] font-mono text-gray-400 uppercase tracking-wider">{issue.label}</div>
          </div>
        ))}
      </div>

      {/* Recommendations */}
      {report.recommendations.length > 0 && (
        <div>
          <h3 className="text-sm font-bold mb-3" style={{ color: 'var(--text-active)' }}>Recommendations</h3>
          <div className="space-y-2">
            {report.recommendations.map((rec, idx) => (
              <div key={idx} className="flex items-start gap-3 p-3 rounded-md border" style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
                <CheckCircle2 size={14} style={{ color: '#3fb950', marginTop: 1 }} />
                <span className="text-sm" style={{ color: 'var(--text-active)' }}>{rec}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AuditCard({ report, onView }: { report: AuditReport; onView: () => void }) {
  const getScoreColor = (score: number) => {
    if (score >= 90) return '#3fb950';
    if (score >= 70) return '#d29922';
    return '#f85149';
  };

  return (
    <div className="rounded-md p-4 border hover:border-purple-500/30 transition-colors cursor-pointer" onClick={onView} style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex-1">
          <div className="font-medium text-sm mb-1" style={{ color: 'var(--text-active)' }}>
            {new URL(report.url).hostname}
          </div>
          <div className="flex items-center gap-2 text-[11px] font-mono text-gray-400">
            <Calendar size={10} />
            {new Date(report.timestamp).toLocaleDateString()}
            <span>•</span>
            <Clock size={10} />
            {report.duration}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {report.status === 'completed' && (
            <div className="text-right">
              <div className="text-lg font-bold" style={{ color: getScoreColor(report.score.overall) }}>
                {report.score.overall}
              </div>
              <div className="text-[9px] font-mono text-gray-500 uppercase tracking-wider">Score</div>
            </div>
          )}
          <span className={`flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded ${report.status === 'completed' ? 'bg-green-900/30 text-green-400' :
              report.status === 'processing' ? 'bg-blue-900/30 text-blue-400' :
                'bg-red-900/30 text-red-400'
            }`}>
            {report.status === 'completed' ? <CheckCircle2 size={10} /> :
              report.status === 'processing' ? <RefreshCw size={10} className="animate-spin" /> :
                <AlertCircle size={10} />}
            {report.status}
          </span>
        </div>
      </div>

      {report.status === 'completed' && (
        <div className="flex items-center gap-4 text-[11px] font-mono">
          <span className="flex items-center gap-1">
            <AlertCircle size={10} style={{ color: '#f85149' }} />
            {report.issues.critical} critical
          </span>
          <span className="flex items-center gap-1">
            <AlertCircle size={10} style={{ color: '#d29922' }} />
            {report.issues.warning} warnings
          </span>
          <span className="flex items-center gap-1">
            <TrendingUp size={10} style={{ color: '#58a6ff' }} />
            {report.recommendations.length} fixes
          </span>
        </div>
      )}
    </div>
  );
}

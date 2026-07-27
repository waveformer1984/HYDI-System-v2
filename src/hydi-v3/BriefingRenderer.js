'use strict';

/**
 * BriefingRenderer is the single source of truth for how an executive briefing
 * is presented to a human operator.
 *
 * ExecutiveOperatingSystem.morningBriefing() produces a structured briefing
 * object. This module turns that object into a neutral section model, and then
 * renders that model as plain text, ANSI-coloured terminal text, or HTML.
 *
 * Every operator surface (readline CLI, local dashboard route, future
 * integrations) must render through here. Adding a section to the briefing
 * means editing `toSections` once — no surface can drift out of sync, and no
 * surface may invent content the briefing object does not contain.
 */

const ANSI = {
  reset: '\u001b[0m',
  bold: '\u001b[1m',
  dim: '\u001b[2m',
  red: '\u001b[31m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  cyan: '\u001b[36m',
};

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 };

function pct(n) {
  return `${(Number(n || 0) * 100).toFixed(0)}%`;
}

function num(n) {
  return Number(n || 0);
}

function fixed(n, digits = 2) {
  const value = Number(n);
  return Number.isFinite(value) ? value.toFixed(digits) : '0.00';
}

function escapeHtml(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Overall health derived only from the briefing's own risk list, so text, ANSI
 * and HTML can never disagree about whether the business is healthy.
 */
function healthOf(briefing) {
  const risks = briefing && Array.isArray(briefing.risks) ? briefing.risks : [];
  if (risks.some((r) => r.severity === 'high')) return 'degraded';
  if (risks.length > 0) return 'watch';
  return 'stable';
}

/**
 * Convert a briefing into an ordered, format-neutral section model.
 *
 * @returns {{ health: string, generatedAt: number, sections: Array<{id: string, title: string, tone: string, lines: string[]}> }}
 */
function toSections(briefing) {
  if (!briefing || typeof briefing !== 'object') {
    throw new Error('BriefingRenderer requires a briefing object');
  }

  const reports = briefing.agentReports || {};
  const sales = reports['Sales Manager'] || {};
  const ops = reports['Operations Manager'] || {};
  const manufacturing = reports['Manufacturing Manager'] || {};
  const research = reports['Research Manager'] || {};
  const creative = reports['Creative Director'] || {};
  const finance = reports['Finance Analyst'] || {};

  const objectives = Array.isArray(briefing.strategicObjectives) ? briefing.strategicObjectives : [];
  const risks = (Array.isArray(briefing.risks) ? briefing.risks : [])
    .slice()
    .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3));
  const actions = Array.isArray(briefing.priorityActions) ? briefing.priorityActions : [];
  const recommendations = Array.isArray(briefing.recommendations) ? briefing.recommendations : [];
  const missingData = Array.isArray(briefing.missingData) ? briefing.missingData : [];
  const recentActivity = Array.isArray(briefing.recentActivity) ? briefing.recentActivity : [];
  const flagship = briefing.resonateStatus || { tracked: false };

  const sections = [
    {
      id: 'executive-summary',
      title: 'Executive Summary',
      tone: 'primary',
      lines: [briefing.executiveSummary || 'No executive summary generated.'],
    },
    {
      id: 'recent-activity',
      title: 'Recent Activity',
      tone: 'neutral',
      lines: recentActivity.length ? recentActivity : ['No recent project activity.'],
    },
    {
      id: 'strategic-objectives',
      title: 'Strategic Objectives',
      tone: 'neutral',
      lines: objectives.length
        ? objectives.map((o) => `${o.name}: ${num(o.activeEntities)} active, ${num(o.completedEntities)} completed, health ${o.health}`)
        : ['No strategic objectives configured.'],
    },
    {
      id: 'flagship-status',
      title: flagship.name ? `${flagship.name} Status` : 'Flagship Status',
      tone: 'neutral',
      lines: flagship.tracked
        ? [
          `Progress ${pct(flagship.progress)}, ${num((flagship.blockers || []).length)} blocker(s), `
            + `${num((flagship.opportunities || []).length)} opportunity(ies), `
            + `${num(flagship.customerSignals)} customer signal(s), release ready: ${!!flagship.releaseReady}.`,
          ...(flagship.blockers || []).map((b) => `Blocker: ${b.name}${b.reason ? ` — ${b.reason}` : ''}`),
        ]
        : ['Flagship product is not tracked in memory yet.'],
    },
    {
      id: 'operations',
      title: 'Operations',
      tone: 'neutral',
      lines: [`Active tasks: ${num(ops.activeTaskCount)}, blocked: ${num(ops.blockedTaskCount)}.`],
    },
    {
      id: 'sales',
      title: 'Sales',
      tone: 'neutral',
      lines: [
        `Open opportunities: ${num(sales.openOpportunities)} (${num(sales.pipelineValue)} value), `
        + `active leads: ${num(sales.activeLeads)}, customers: ${num(sales.activeCustomers)}.`,
      ],
    },
    {
      id: 'manufacturing',
      title: 'Manufacturing',
      tone: 'neutral',
      lines: [`Active equipment: ${num(manufacturing.activeEquipment)}, needs maintenance: ${num((manufacturing.needsMaintenance || []).length)}.`],
    },
    {
      id: 'research',
      title: 'Research',
      tone: 'neutral',
      lines: [`Active experiments: ${num(research.activeExperiments)}, completed: ${num(research.completedExperiments)}.`],
    },
    {
      id: 'creative',
      title: 'Creative',
      tone: 'neutral',
      lines: [`Active creative projects: ${num(creative.activeCreativeProjects)}, prototypes: ${num(creative.prototypeCount)}.`],
    },
    {
      id: 'financial',
      title: 'Financial Overview',
      tone: 'neutral',
      lines: [
        `Revenue opportunity value: ${num(finance.revenueOpportunityValue)}, `
        + `tracked expenses: ${num(finance.trackedExpenses)}, projected net: ${num(finance.projectedNet)}.`,
      ],
    },
    {
      id: 'risks',
      title: 'Critical Risks',
      tone: risks.some((r) => r.severity === 'high') ? 'danger' : 'warning',
      lines: risks.length
        ? risks.map((r) => `[${r.severity}] ${r.name}: ${r.detail}`)
        : ['None identified.'],
    },
    {
      id: 'opportunities',
      title: 'Top Opportunities',
      tone: 'success',
      lines: actions.length
        ? actions.map((a, i) => `${i + 1}. ${a.name} (score ${fixed(a.score)}): ${a.reason}`)
        : ['No scored opportunities available.'],
    },
    {
      id: 'recommendations',
      title: 'Recommended Actions',
      tone: 'primary',
      lines: recommendations.length
        ? recommendations.map((r) => `${r.action}: ${r.reason}`)
        : ['No specific recommendations.'],
    },
    {
      id: 'learning-summary',
      title: 'Learning Summary',
      tone: 'neutral',
      lines: briefing.learningSummary && Array.isArray(briefing.learningSummary.lines) && briefing.learningSummary.lines.length
        ? briefing.learningSummary.lines
        : ['Learning system still building historical baseline.'],
    },
    {
      id: 'missing-data',
      title: 'Missing Data Sources',
      tone: 'dim',
      lines: missingData.length ? missingData.slice() : ['All expected data sources available.'],
    },
  ];

  return {
    health: healthOf(briefing),
    generatedAt: briefing.generatedAt || Date.now(),
    sections,
  };
}

/**
 * Plain text rendering. This is the canonical format the ExecutiveOperatingSystem
 * exposes via toText(), kept byte-stable for scripts and snapshot tests.
 */
function toText(briefing) {
  const model = toSections(briefing);
  const lines = [`ProtoForge status: ${model.health}.`];
  for (const section of model.sections) {
    lines.push('', `=== ${section.title} ===`, ...section.lines);
  }
  return lines.join('\n');
}

/**
 * ANSI rendering for the readline operator CLI. Identical content to toText,
 * only colour is added — never extra or omitted information.
 */
function toAnsi(briefing, options = {}) {
  const colour = options.colour !== false;
  const model = toSections(briefing);
  const paint = (code, text) => (colour ? `${code}${text}${ANSI.reset}` : text);

  const healthColour = { degraded: ANSI.red, watch: ANSI.yellow, stable: ANSI.green }[model.health] || ANSI.green;
  const out = [`${paint(ANSI.bold, 'ProtoForge status:')} ${paint(healthColour, model.health)}`];

  const toneColour = {
    primary: ANSI.cyan,
    danger: ANSI.red,
    warning: ANSI.yellow,
    success: ANSI.green,
    dim: ANSI.dim,
    neutral: ANSI.bold,
  };

  for (const section of model.sections) {
    out.push('', paint(toneColour[section.tone] || ANSI.bold, `── ${section.title} ──`));
    for (const line of section.lines) {
      out.push(`  ${section.tone === 'dim' ? paint(ANSI.dim, line) : line}`);
    }
  }
  return out.join('\n');
}

/**
 * Optional command console for the local dashboard. Posts the same natural
 * language commands the readline CLI accepts to `commandEndpoint`, and prints
 * the cockpit's `text` reply verbatim — the browser never reformats a response.
 */
function commandConsoleHtml(commandEndpoint) {
  const endpoint = escapeHtml(commandEndpoint);
  return `
  <section class="console">
    <h2>Command</h2>
    <form id="cockpit-form" autocomplete="off">
      <input id="cockpit-input" type="text" placeholder='try: focus, status, approvals, workflows, priority resonate' aria-label="Cockpit command">
      <button type="submit">Send</button>
    </form>
    <pre id="cockpit-output" aria-live="polite"></pre>
  </section>
  <script>
    (function () {
      var form = document.getElementById('cockpit-form');
      var input = document.getElementById('cockpit-input');
      var output = document.getElementById('cockpit-output');
      form.addEventListener('submit', function (event) {
        event.preventDefault();
        var text = input.value.trim();
        if (!text) return;
        output.textContent = 'Working...';
        fetch('${endpoint}', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: text })
        }).then(function (r) { return r.json(); }).then(function (data) {
          output.textContent = data.text || data.message || JSON.stringify(data, null, 2);
        }).catch(function (err) {
          output.textContent = 'Error: ' + err.message;
        });
        input.value = '';
      });
    }());
  </script>`;
}

/**
 * HTML rendering for the local dashboard route. Self-contained: no external
 * assets, and readable with scripting disabled.
 */
function toHtml(briefing, options = {}) {
  const model = toSections(briefing);
  const title = options.title || 'ProtoForge Executive Cockpit';
  const generated = new Date(model.generatedAt).toISOString();
  const consoleBlock = options.commandEndpoint ? commandConsoleHtml(options.commandEndpoint) : '';

  const body = model.sections.map((section) => {
    const items = section.lines.map((line) => `        <li>${escapeHtml(line)}</li>`).join('\n');
    return `      <section class="card tone-${escapeHtml(section.tone)}" id="${escapeHtml(section.id)}">
        <h2>${escapeHtml(section.title)}</h2>
        <ul>
${items}
        </ul>
      </section>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; padding: 2rem; background: #0d1117; color: #e6edf3;
         font: 15px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace; }
  header { margin-bottom: 1.5rem; }
  h1 { font-size: 1.3rem; margin: 0 0 .35rem; }
  .meta { color: #8b949e; font-size: .82rem; }
  .health { font-weight: 700; text-transform: uppercase; letter-spacing: .06em; }
  .health.stable { color: #3fb950; }
  .health.watch { color: #d29922; }
  .health.degraded { color: #f85149; }
  main { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); }
  .card { background: #161b22; border: 1px solid #30363d; border-left-width: 3px; border-radius: 6px; padding: .9rem 1.1rem; }
  .card h2 { font-size: .82rem; text-transform: uppercase; letter-spacing: .08em; margin: 0 0 .6rem; color: #8b949e; }
  .card ul { margin: 0; padding-left: 1.1rem; }
  .card li { margin: .22rem 0; word-break: break-word; }
  .tone-primary { border-left-color: #58a6ff; }
  .tone-danger { border-left-color: #f85149; }
  .tone-warning { border-left-color: #d29922; }
  .tone-success { border-left-color: #3fb950; }
  .tone-neutral { border-left-color: #30363d; }
  .tone-dim { border-left-color: #30363d; color: #8b949e; }
  .console { margin-top: 1.5rem; background: #161b22; border: 1px solid #30363d;
             border-left: 3px solid #58a6ff; border-radius: 6px; padding: .9rem 1.1rem; }
  .console h2 { font-size: .82rem; text-transform: uppercase; letter-spacing: .08em; margin: 0 0 .6rem; color: #8b949e; }
  .console form { display: flex; gap: .5rem; }
  .console input { flex: 1; background: #0d1117; color: #e6edf3; border: 1px solid #30363d;
                   border-radius: 4px; padding: .5rem .6rem; font: inherit; }
  .console button { background: #238636; color: #fff; border: 0; border-radius: 4px;
                    padding: .5rem 1rem; font: inherit; cursor: pointer; }
  .console pre { margin: .8rem 0 0; white-space: pre-wrap; word-break: break-word; color: #e6edf3; }
  footer { margin-top: 1.5rem; color: #8b949e; font-size: .8rem; }
</style>
</head>
<body>
  <header>
    <h1>${escapeHtml(title)}</h1>
    <div class="meta">Status <span class="health ${escapeHtml(model.health)}">${escapeHtml(model.health)}</span> &middot; generated ${escapeHtml(generated)}</div>
  </header>
  <main>
${body}
  </main>${consoleBlock}
  <footer>Rendered by BriefingRenderer from ExecutiveOperatingSystem.morningBriefing(). Local access only.</footer>
</body>
</html>`;
}

module.exports = {
  toSections,
  toText,
  toAnsi,
  toHtml,
  healthOf,
  escapeHtml,
  ANSI,
};

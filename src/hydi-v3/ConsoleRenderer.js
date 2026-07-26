'use strict';

const BriefingRenderer = require('./BriefingRenderer');

const { escapeHtml } = BriefingRenderer;

/**
 * ConsoleRenderer renders the Local Operations Console web interface: one
 * self-contained HTML page (no build step, no external assets) with panels
 * for conversation, the approval center, the executive timeline, business
 * health, the agent workspace, and the command palette.
 *
 * Every panel is populated first from server-rendered initial state (so the
 * page is readable even with scripting disabled) and then kept live by
 * fetch() calls against the pages/api/console/* routes — the exact same
 * ConsoleAPI methods the CLI calls. No panel invents its own data shape.
 */
function renderApprovalCard(a) {
  return `<div class="approval-card" data-id="${escapeHtml(a.id)}">
    <div class="approval-title">${escapeHtml(a.title)} <span class="tag">${escapeHtml(a.kind)}</span></div>
    <div class="approval-meta">Value: ${escapeHtml(a.businessValue)} &middot; Risk: ${escapeHtml(a.risk)} &middot; Agent: ${escapeHtml(a.responsibleAgent)}</div>
    <div class="approval-meta">${escapeHtml(a.expectedImpact)}</div>
    <div class="approval-actions">
      <button data-action="approve" data-id="${escapeHtml(a.id)}">Approve</button>
      <button data-action="reject" data-id="${escapeHtml(a.id)}">Reject</button>
      <button data-action="simulate" data-id="${escapeHtml(a.id)}">Simulate</button>
      <button data-action="explain" data-id="${escapeHtml(a.id)}">Explain</button>
    </div>
  </div>`;
}

function renderAgentCard(a) {
  return `<div class="agent-card">
    <div class="agent-name">${escapeHtml(a.name)}</div>
    ${a.available
    ? `<div class="agent-headline">${escapeHtml(a.headline)}</div>
       <div class="agent-meta">Confidence ${Math.round(a.confidence * 100)}% &middot; Pending ${a.pendingCount} &middot; Risks ${a.riskCount}</div>`
    : `<div class="agent-meta">${escapeHtml(a.reason)}</div>`}
  </div>`;
}

function renderTimelineItem(i) {
  return `<div class="timeline-item tone-${escapeHtml(i.category)}">
    <span class="timeline-time">${escapeHtml(new Date(i.at).toLocaleString())}</span>
    <span class="timeline-category">${escapeHtml(i.category)}</span>
    <span class="timeline-summary">${escapeHtml(i.summary)}</span>
  </div>`;
}

function renderHealthSection(health) {
  return `
    <div class="health-grid">
      <div class="health-card"><h3>Revenue</h3><p>${health.revenue.openOpportunities} opportunities &middot; ${health.revenue.pipelineValue} pipeline value</p></div>
      <div class="health-card"><h3>Manufacturing</h3><p>${health.manufacturing.activeEquipment} active &middot; ${health.manufacturing.needsMaintenance} need maintenance</p></div>
      <div class="health-card"><h3>Research</h3><p>${health.research.activeExperiments} active &middot; ${health.research.completedExperiments} completed</p></div>
      <div class="health-card"><h3>Creative</h3><p>${health.creative.activeProjects} active &middot; ${health.creative.prototypes} prototypes</p></div>
      <div class="health-card"><h3>Financial</h3><p>Revenue ${health.financial.revenue} &middot; Expenses ${health.financial.expenses} &middot; Net ${health.financial.net}</p></div>
      <div class="health-card"><h3>Data Gaps</h3><p>${health.dataGaps.length ? health.dataGaps.map(escapeHtml).join('<br>') : 'None identified.'}</p></div>
    </div>`;
}

function renderCommandPalette(commands) {
  return commands.map((c) => `<div class="palette-item"><code>${escapeHtml(c.command)}</code><span>${escapeHtml(c.description)}</span></div>`).join('\n');
}

/**
 * @param {object} state - { briefingSections, approvals, timeline, health, agents, commandPalette, sessionState }
 * @param {object} options - { title, commandEndpoint }
 */
function toHtml(state = {}, options = {}) {
  const title = options.title || 'ProtoForge Local Operations Console';
  const commandEndpoint = options.commandEndpoint || '/api/console/command';
  const briefingSections = state.briefingSections || { health: 'stable', sections: [] };
  const approvals = state.approvals || [];
  const timeline = state.timeline || [];
  const health = state.health || { revenue: {}, manufacturing: {}, research: {}, creative: {}, financial: {}, dataGaps: [] };
  const agents = state.agents || [];
  const commandPalette = state.commandPalette || [];
  const sessionState = state.sessionState || {};

  const briefingHtml = briefingSections.sections.map((s) => `
    <section class="card tone-${escapeHtml(s.tone)}">
      <h2>${escapeHtml(s.title)}</h2>
      <ul>${s.lines.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>
    </section>`).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 0; background: #0d1117; color: #e6edf3;
         font: 15px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace; }
  header { padding: 1rem 1.5rem; border-bottom: 1px solid #30363d; display: flex; align-items: center; justify-content: space-between; }
  header h1 { font-size: 1.1rem; margin: 0; }
  .focus-pill { color: #8b949e; font-size: .8rem; }
  nav.tabs { display: flex; gap: .25rem; padding: 0 1.5rem; border-bottom: 1px solid #30363d; }
  nav.tabs button { background: none; border: none; color: #8b949e; padding: .7rem .9rem; cursor: pointer; font: inherit; border-bottom: 2px solid transparent; }
  nav.tabs button.active { color: #e6edf3; border-bottom-color: #58a6ff; }
  main { padding: 1.5rem; }
  .panel { display: none; }
  .panel.active { display: block; }
  .card { background: #161b22; border: 1px solid #30363d; border-left-width: 3px; border-radius: 6px; padding: .9rem 1.1rem; margin-bottom: 1rem; }
  .card h2 { font-size: .82rem; text-transform: uppercase; letter-spacing: .08em; margin: 0 0 .6rem; color: #8b949e; }
  .card ul { margin: 0; padding-left: 1.1rem; }
  .card li { margin: .22rem 0; word-break: break-word; }
  .tone-primary { border-left-color: #58a6ff; }
  .tone-danger { border-left-color: #f85149; }
  .tone-warning { border-left-color: #d29922; }
  .tone-success { border-left-color: #3fb950; }
  .tone-neutral { border-left-color: #30363d; }
  .tone-dim { border-left-color: #30363d; color: #8b949e; }
  .grid { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); }
  .chat-log { height: 320px; overflow-y: auto; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; padding: .8rem; margin-bottom: .8rem; }
  .chat-turn { margin-bottom: .8rem; }
  .chat-you { color: #58a6ff; }
  .chat-response { white-space: pre-wrap; margin-top: .2rem; }
  .chat-form { display: flex; gap: .5rem; }
  .chat-form input { flex: 1; background: #0d1117; color: #e6edf3; border: 1px solid #30363d; border-radius: 4px; padding: .55rem .7rem; font: inherit; }
  .chat-form button, .approval-actions button, .refresh-btn { background: #238636; color: #fff; border: 0; border-radius: 4px; padding: .5rem .9rem; font: inherit; cursor: pointer; }
  .approval-actions button[data-action="reject"] { background: #da3633; }
  .approval-actions button[data-action="simulate"], .approval-actions button[data-action="explain"] { background: #30363d; }
  .approval-card { background: #0d1117; border: 1px solid #30363d; border-radius: 6px; padding: .8rem; margin-bottom: .7rem; }
  .approval-title { font-weight: 700; }
  .approval-meta { color: #8b949e; font-size: .82rem; margin: .2rem 0; }
  .approval-actions { display: flex; gap: .4rem; margin-top: .5rem; flex-wrap: wrap; }
  .tag { font-size: .7rem; background: #30363d; padding: .1rem .4rem; border-radius: 3px; margin-left: .4rem; }
  .agent-card { background: #0d1117; border: 1px solid #30363d; border-radius: 6px; padding: .8rem; }
  .agent-name { font-weight: 700; }
  .agent-meta, .agent-headline { color: #8b949e; font-size: .85rem; margin-top: .2rem; }
  .timeline-item { display: flex; gap: .6rem; padding: .4rem 0; border-bottom: 1px solid #21262d; font-size: .85rem; }
  .timeline-time { color: #8b949e; min-width: 150px; }
  .timeline-category { color: #58a6ff; min-width: 90px; text-transform: uppercase; font-size: .7rem; }
  .health-grid { display: grid; gap: .8rem; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
  .health-card { background: #0d1117; border: 1px solid #30363d; border-radius: 6px; padding: .7rem .9rem; }
  .health-card h3 { margin: 0 0 .3rem; font-size: .82rem; color: #8b949e; text-transform: uppercase; }
  .palette-item { display: flex; justify-content: space-between; gap: 1rem; padding: .4rem 0; border-bottom: 1px solid #21262d; }
  .palette-item code { color: #3fb950; white-space: nowrap; }
  .palette-item span { color: #8b949e; text-align: right; }
  footer { padding: 1rem 1.5rem; color: #8b949e; font-size: .8rem; border-top: 1px solid #30363d; }
</style>
</head>
<body>
  <header>
    <h1>${escapeHtml(title)}</h1>
    <span class="focus-pill" id="focus-pill">Focus: ${escapeHtml(sessionState.focus || 'none')} &middot; Priority: ${escapeHtml(sessionState.ownerPriority || 'default')}</span>
  </header>
  <nav class="tabs">
    <button data-tab="chat" class="active">Conversation</button>
    <button data-tab="approvals">Approval Center</button>
    <button data-tab="timeline">Timeline</button>
    <button data-tab="health">Business Health</button>
    <button data-tab="agents">Agent Workspace</button>
    <button data-tab="palette">Command Palette</button>
  </nav>
  <main>
    <section class="panel active" id="panel-chat">
      <div class="card tone-primary"><h2>Executive Briefing</h2>${briefingHtml || '<p>Say "good morning" to generate the briefing.</p>'}</div>
      <div class="card">
        <h2>Talk to HYDI</h2>
        <div class="chat-log" id="chat-log"></div>
        <form id="chat-form" class="chat-form" autocomplete="off">
          <input id="chat-input" type="text" placeholder='try: good morning, what changed, focus resonate, show approvals'>
          <button type="submit">Send</button>
        </form>
      </div>
    </section>

    <section class="panel" id="panel-approvals">
      <div class="card"><h2>Pending Approvals</h2><div id="approvals-list">${approvals.map(renderApprovalCard).join('') || '<p>No pending approvals.</p>'}</div></div>
    </section>

    <section class="panel" id="panel-timeline">
      <div class="card"><h2>Executive Timeline</h2><div id="timeline-list">${timeline.map(renderTimelineItem).join('') || '<p>No timeline events yet.</p>'}</div></div>
    </section>

    <section class="panel" id="panel-health">
      <div class="card"><h2>Business Health</h2><div id="health-panel">${renderHealthSection(health)}</div></div>
    </section>

    <section class="panel" id="panel-agents">
      <div class="card"><h2>Agent Workspace</h2><div class="grid" id="agents-grid">${agents.map(renderAgentCard).join('')}</div></div>
    </section>

    <section class="panel" id="panel-palette">
      <div class="card"><h2>Command Palette</h2><div id="palette-list">${renderCommandPalette(commandPalette)}</div></div>
    </section>
  </main>
  <footer>Local console only &middot; every approval routes through ExecutionGateway / BusinessWorkflowEngine &middot; rendered by ConsoleRenderer.</footer>
  <script>
    (function () {
      var tabs = document.querySelectorAll('nav.tabs button');
      tabs.forEach(function (btn) {
        btn.addEventListener('click', function () {
          tabs.forEach(function (b) { b.classList.remove('active'); });
          document.querySelectorAll('.panel').forEach(function (p) { p.classList.remove('active'); });
          btn.classList.add('active');
          document.getElementById('panel-' + btn.dataset.tab).classList.add('active');
        });
      });

      var log = document.getElementById('chat-log');
      var form = document.getElementById('chat-form');
      var input = document.getElementById('chat-input');

      function appendTurn(text, responseText) {
        var turn = document.createElement('div');
        turn.className = 'chat-turn';
        turn.innerHTML = '<div class="chat-you">You: ' + text.replace(/[<>&]/g, function(c){return {'<':'&lt;','>':'&gt;','&':'&amp;'}[c];}) + '</div>' +
          '<div class="chat-response">' + responseText.replace(/[<>&]/g, function(c){return {'<':'&lt;','>':'&gt;','&':'&amp;'}[c];}) + '</div>';
        log.appendChild(turn);
        log.scrollTop = log.scrollHeight;
      }

      function send(text) {
        appendTurn(text, 'Working...');
        fetch('${escapeHtml(commandEndpoint)}', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: text }),
        }).then(function (r) { return r.json(); }).then(function (data) {
          log.lastChild.querySelector('.chat-response').textContent = data.text || JSON.stringify(data);
          var pill = document.getElementById('focus-pill');
          fetch('/api/console/state').then(function (r) { return r.json(); }).then(function (s) {
            pill.textContent = 'Focus: ' + (s.focus || 'none') + ' · Priority: ' + (s.ownerPriority || 'default');
          }).catch(function () {});
        }).catch(function (err) {
          log.lastChild.querySelector('.chat-response').textContent = 'Error: ' + err.message;
        });
      }

      form.addEventListener('submit', function (event) {
        event.preventDefault();
        var text = input.value.trim();
        if (!text) return;
        send(text);
        input.value = '';
      });

      document.body.addEventListener('click', function (event) {
        var btn = event.target.closest('[data-action]');
        if (!btn) return;
        var action = btn.dataset.action;
        var id = btn.dataset.id;
        var verb = action === 'approve' ? 'approve ' + id
          : action === 'reject' ? 'reject ' + id
          : action === 'simulate' ? 'simulate ' + id
          : 'explain ' + id;
        send(verb);
      });
    }());
  </script>
</body>
</html>`;
}

module.exports = { toHtml };

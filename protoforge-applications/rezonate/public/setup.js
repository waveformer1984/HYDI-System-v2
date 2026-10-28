/* Setup wizard — reads the live app, never fakes a check.
   Progress persists in localStorage (setup progress only — the
   authoritative readiness report is recomputed from /audit each run). */
(function () {
  const $ = (id) => document.getElementById(id);
  const LS = 'rezonate-setup-v1';
  const load = () => { try { return JSON.parse(localStorage.getItem(LS)) || { step: 0, done: {} }; } catch { return { step: 0, done: {} }; } };
  const save = (s) => localStorage.setItem(LS, JSON.stringify(s));
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const api = (p, o) => fetch(p, o).then((r) => r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` })));
  const S = load();
  let report = null;

  function renderChecks(host, checks) {
    host.innerHTML = checks.map((c) =>
      `<div class="chk"><span class="st-${c.status}">${c.status}</span> <strong>${esc(c.id)}</strong><small>${esc(c.evidence || '')}</small></div>`).join('');
  }
  function flat() { return report ? Object.values(report.checks).flat() : []; }

  function show(n) {
    document.querySelectorAll('.step').forEach((el) => el.classList.toggle('on', +el.dataset.step === n));
    $('dots').innerHTML = Array.from({ length: 7 }, (_, i) => `<span class="${i <= n ? 'on' : ''}"></span>`).join('');
    S.step = n; save(S);
    if (n === 6) finish();
    window.scrollTo(0, 0);
  }
  function next() { show(Math.min(6, S.step + 1)); }

  async function sys() {
    $('sys').innerHTML = '<div class="chk">checking…</div>';
    const r = await api('/audit'); report = r.report || null;
    if (!report) { $('sys').innerHTML = `<div class="chk"><span class="st-FAIL">FAIL</span> audit unreachable<small>${esc(r.error || '')}</small></div>`; return; }
    renderChecks($('sys'), [...report.checks.service, ...report.checks.engine, ...report.checks.resources]);
    S.done.sys = report.counts; save(S);
  }

  async function cop() {
    $('cop').innerHTML = '<div class="chk">testing…</div>';
    const r = await api('/audit'); report = r.report || report;
    renderChecks($('cop'), (r.report || report).checks.copilot);
  }

  async function proj() {
    $('proj').innerHTML = '<div class="chk">loading…</div>';
    const r = await api('/projects');
    const list = r.projects || [];
    if (!list.length) { $('proj').innerHTML = '<div class="chk"><span class="st-BLOCKED">BLOCKED</span> no projects yet — create one in the studio first</div>'; return; }
    const p = list[0];
    const t = await api(`/copilot/suggest?projectId=${encodeURIComponent(p.id)}`);
    $('proj').innerHTML = `<div class="chk"><strong>${esc(p.title || p.id)}</strong>
      <small>${(t.suggestions || []).length} co-pilot suggestion(s) available</small></div>` +
      (t.suggestions || []).map((s) => `<div class="chk"><strong>${esc(s.title)}</strong><small>${esc(s.detail)}</small></div>`).join('');
    S.done.project = p.id; save(S);
  }

  function audio() {
    const mem = report && report.checks.resources.find((c) => c.id === 'resource.memory');
    const disk = report && report.checks.resources.find((c) => c.id === 'resource.disk');
    $('aud').innerHTML = [
      `<div class="chk"><span class="st-${mem ? mem.status : 'NOT_TESTED'}">${mem ? mem.status : 'NOT_TESTED'}</span> memory<small>${esc(mem ? mem.evidence : 'run system check first')}</small></div>`,
      `<div class="chk"><span class="st-${disk ? disk.status : 'NOT_TESTED'}">${disk ? disk.status : 'NOT_TESTED'}</span> disk<small>${esc(disk ? disk.evidence : 'run system check first')}</small></div>`,
    ].join('');
    const safe = mem && disk && mem.status === 'PASS' && disk.status === 'PASS';
    $('audctl').hidden = !safe;
    $('audwarn').textContent = safe
      ? 'This submits ONE segment-swap job through the real engine (~80 s CPU). Your call.'
      : 'Audio test blocked — resources below the safe floor. Free memory, re-run the system check, and this unlocks.';
    if (safe) {
      // Human-confirmed single job — same path remix.html uses.
      fetch('/processing/jobs', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ task_type: 'segment_swap', metadata: { stemsDir: 'C:\Users\Owner\HYDI-System-v2\rezonate\stems\Bad Decision Club', stem: 'drums', bars: '4-8', segmentBars: 1, samples: 'drums', maxReplacements: 4 } }) })
        .then((r) => r.json()).then((j) => {
          if (!j.ok) throw new Error(j.error || 'job create failed');
          $('audwarn').textContent = `job ${j.job.id.slice(0, 8)} queued — starting…`;
          return fetch(`/processing/jobs/${j.job.id}/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
        }).then((r) => r && r.json()).then((j) => {
          if (j) $('audwarn').textContent = j.ok ? `done — output registered (check swaps/ and the Result card)` : `failed: ${j.error || 'unknown'}`;
        }).catch((e) => { $('audwarn').textContent = `error: ${e.message}`; });
    }
  }

  function finish() {
    const f = flat();
    const counts = (report && report.counts) || { PASS: 0, FAIL: 0, BLOCKED: 0, 'NOT_TESTED': f.filter((c) => true).length };
    $('final').innerHTML = `<div class="chk">PASS ${counts.PASS} · FAIL ${counts.FAIL} · BLOCKED ${counts.BLOCKED} · NOT TESTED ${counts['NOT_TESTED']}</div>` +
      `<p class="prog">Last verified ${report ? report.at : 'never'}${report && report.version ? ` · ${report.version}` : ''}.</p>` +
      renderRecovery();
  }
  function renderRecovery() {
    const f = flat().filter((c) => c.status === 'FAIL' || c.status === 'BLOCKED');
    return f.map((c) => `<div class="chk"><span class="st-${c.status}">${c.status}</span> ${esc(c.id)}<small>${esc(c.evidence)}</small></div>`).join('') ||
      '<div class="chk"><span class="st-PASS">PASS</span> all checks green — make music</div>';
  }

  window.W = { next, sys, cop, proj, audio, show };
  show(Math.min(6, S.step || 0));
})();

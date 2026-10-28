/* Rezonate Co-Pilot — suggestion cards bound to real project state.
   Every suggestion carries a ready-made /processing/jobs payload; the
   human clicks Apply and the existing job flow does the work. */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  async function api(path, opts) {
    const r = await fetch(path, opts);
    return r.json();
  }

  async function apply(action, btn) {
    btn.disabled = true; btn.textContent = 'Running…';
    try {
      const jr = await api('/processing/jobs', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(action),
      });
      if (!jr.ok) throw new Error(jr.error || 'job create failed');
      const sr = await api(`/processing/jobs/${jr.job.id}/start`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
      });
      if (!sr.ok) throw new Error(sr.error || 'job failed');
      btn.textContent = 'Done — see Result below';
      const card = $('result-card');
      if (card && sr.result) {
        card.hidden = false;
        $('result-body').textContent = JSON.stringify(sr.result, null, 2);
      }
    } catch (e) {
      btn.textContent = `Failed: ${e.message}`;
      btn.disabled = false;
    }
  }

  function renderSuggestions(list) {
    const host = $('copilot-suggestions');
    host.innerHTML = '';
    for (const s of list) {
      const el = document.createElement('div');
      el.className = 'copilot-suggestion';
      el.innerHTML = `<strong>${esc(s.title)}</strong><p>${esc(s.detail)}</p>`;
      if (s.action) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = 'Apply';
        btn.addEventListener('click', () => apply(s.action, btn));
        el.appendChild(btn);
      }
      host.appendChild(el);
    }
  }

  async function refresh() {
    try {
      const s = await api('/copilot/suggest');
      $('copilot-context').textContent =
        `project: ${s.context.tracks} tracks · ${s.context.assets} assets · ${s.context.jobs} jobs`;
      renderSuggestions(s.suggestions || []);
      const m = await api('/copilot/memory');
      $('copilot-memory').innerHTML = (m.entries || []).slice(-8)
        .map((e) => `<li><small>${esc(e.at || '')}</small> ${esc(e.note)}</li>`).join('');
    } catch (e) {
      $('copilot-context').textContent = `co-pilot unavailable: ${e.message}`;
    }
  }

  $('copilot-note-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const note = $('copilot-note').value.trim();
    if (!note) return;
    await api('/copilot/note', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ note }),
    });
    $('copilot-note').value = '';
    refresh();
  });

  refresh();
})();

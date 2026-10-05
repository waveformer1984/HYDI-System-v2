(function () {
  const $ = (id) => document.getElementById(id);

  function meta(plan) {
    const m = {
      stem: $('f-stem').value,
      bars: $('f-bars').value.trim(),
      segmentBars: parseInt($('f-segbars').value, 10) || 1,
      samples: $('f-samples').value.trim() || $('f-stem').value,
      maxReplacements: parseInt($('f-max').value, 10) || 4
    };
    const stems = $('f-stems').value.trim();
    if (/\.(wav|mp3|flac|ogg)$/i.test(stems)) m.input = stems; else m.stemsDir = stems;
    const bpm = parseFloat($('f-bpm').value);
    if (bpm) m.bpm = bpm;
    if (plan) m.plan = true;
    return m;
  }

  async function run(plan) {
    const err = $('swap-error'); err.hidden = true;
    const btn = plan ? $('preview-btn') : $('swap-btn');
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = plan ? 'Matching…' : 'Rendering… (stem analysis can take a minute)';
    try {
      const jr = await fetch('/processing/jobs', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ task_type: 'segment_swap', metadata: meta(plan) })
      }).then(r => r.json());
      if (!jr.ok) throw new Error(jr.error || 'job create failed');
      const sr = await fetch(`/processing/jobs/${jr.job.id}/start`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
      }).then(r => r.json());
      if (!sr.ok) throw new Error(sr.error || 'swap failed');
      return sr;
    } catch (e) {
      err.textContent = e.message; err.hidden = false;
      return null;
    } finally {
      btn.disabled = false; btn.textContent = label;
    }
  }

  $('preview-btn').addEventListener('click', async () => {
    const r = await run(true);
    if (!r || !r.plan) return;
    const p = r.plan;
    $('preview-card').hidden = false;
    $('preview-body').innerHTML =
      `<p>${(p.segments || []).length} segment(s), bpm ${p.bpm ?? '?'}, key ${p.key ?? 'unknown'}</p>` +
      '<ul>' + (p.replacements || []).map(x =>
        `<li>bar ${(p.segments[x.segment] || {}).bar ?? x.segment}: <b>${x.plannedSample || x.sourceSample || '?'}</b> — score ${x.score}</li>`).join('') + '</ul>';
  });

  $('swap-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await run(false);
    if (!r || !r.result) return;
    const res = r.result;
    $('result-card').hidden = false;
    $('result-body').innerHTML =
      `<p>${res.replacements} segment(s) replaced — bpm ${res.bpm}, key ${res.key || 'unknown'}</p>` +
      (r.asset ? `<p><a class="button" href="/assets/${r.asset.id}/file">Download remix</a></p>` : '') +
      `<p class="note">manifest: ${res.manifest}</p>`;
  });
})();

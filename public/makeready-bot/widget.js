(function () {
  'use strict';

  const script = document.currentScript;
  const slug = script && script.getAttribute('data-slug');
  const apiBase = (script && script.getAttribute('data-api')) || '';
  if (!slug) {
    console.error('[MakeReady Bot] data-slug is required');
    return;
  }

  const root = document.createElement('div');
  root.id = 'makeready-bot-root';
  root.setAttribute('data-demo', 'true');
  document.body.appendChild(root);

  const style = document.createElement('style');
  style.textContent = `
    #makeready-bot-root{font-family:system-ui,-apple-system,sans-serif;max-width:420px;margin:0 auto;font-size:16px;line-height:1.4}
    #makeready-bot-root *{box-sizing:border-box}
    .mrb-card{border:1px solid #d0d7de;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,.08);background:#fff}
    .mrb-header{background:#0f4c5c;color:#fff;padding:12px 14px;font-weight:600;font-size:15px}
    .mrb-demo{font-size:11px;opacity:.9;font-weight:500}
    .mrb-chat{height:220px;overflow-y:auto;padding:10px;background:#f6f8fa}
    .mrb-msg{margin:6px 0;padding:8px 10px;border-radius:8px;max-width:92%;word-break:break-word}
    .mrb-msg.bot{background:#e7f3f8;align-self:flex-start}
    .mrb-msg.user{background:#daf5e8;margin-left:auto;text-align:right}
    .mrb-row{display:flex;gap:8px;padding:8px;border-top:1px solid #eee}
    .mrb-row input,.mrb-row textarea,.mrb-row select{flex:1;width:100%;padding:10px;border:1px solid #ccc;border-radius:8px;font-size:16px}
    .mrb-btn{padding:10px 14px;border:0;border-radius:8px;background:#0f4c5c;color:#fff;font-weight:600;font-size:15px;cursor:pointer}
    .mrb-btn:disabled{opacity:.5}
    .mrb-form{padding:10px;display:none;flex-direction:column;gap:8px;border-top:1px solid #eee}
    .mrb-form.open{display:flex}
    .mrb-label{font-size:12px;color:#555}
    .mrb-estimate{font-size:13px;background:#fff8e1;padding:8px;border-radius:8px}
    .mrb-tabs{display:flex;gap:4px;padding:6px 8px;background:#f0f0f0}
    .mrb-tab{flex:1;padding:8px;border:0;background:transparent;font-size:13px;border-radius:6px}
    .mrb-tab.active{background:#fff;font-weight:600}
  `;
  document.head.appendChild(style);

  root.innerHTML = `
    <div class="mrb-card">
      <div class="mrb-header">MakeReady assistant <span class="mrb-demo">DEMO</span></div>
      <div class="mrb-tabs">
        <button type="button" class="mrb-tab active" data-tab="chat">Chat</button>
        <button type="button" class="mrb-tab" data-tab="form">Request / estimate</button>
      </div>
      <div class="mrb-chat" id="mrb-chat"></div>
      <div class="mrb-row" id="mrb-chat-row">
        <input id="mrb-input" type="text" placeholder="Ask about services or area…" autocomplete="off" />
        <button type="button" class="mrb-btn" id="mrb-send">Send</button>
      </div>
      <form class="mrb-form" id="mrb-form">
        <span class="mrb-label">Builder / shared</span>
        <input name="builder_company" placeholder="Builder company" required />
        <input name="contact_name" placeholder="Contact name" required />
        <input name="phone" type="tel" placeholder="Phone" required />
        <input name="email" type="email" placeholder="Email" required />
        <input name="community" placeholder="Community / subdivision" required />
        <input name="po_number" placeholder="PO # (optional)" />
        <span class="mrb-label">Lot</span>
        <input name="lot_number" placeholder="Lot #" required />
        <input name="address" placeholder="Address" required />
        <input name="sq_ft" type="number" min="1" placeholder="Sq ft" required />
        <input name="stories" type="number" min="1" value="1" placeholder="Stories" required />
        <input name="target_date" type="date" required />
        <input name="closing_date" type="date" required />
        <select name="phases" id="mrb-phases" multiple size="4" required></select>
        <textarea name="notes" rows="2" placeholder="Notes (no lockbox or gate codes)"></textarea>
        <div class="mrb-estimate" id="mrb-estimate">Estimate appears here.</div>
        <button type="button" class="mrb-btn" id="mrb-est-btn">Get estimate</button>
        <button type="submit" class="mrb-btn">Submit lot request</button>
      </form>
    </div>
  `;

  const chatEl = root.querySelector('#mrb-chat');
  const inputEl = root.querySelector('#mrb-input');
  const formEl = root.querySelector('#mrb-form');
  const phasesEl = root.querySelector('#mrb-phases');
  const estEl = root.querySelector('#mrb-estimate');

  function api(path, options) {
    const base = apiBase.replace(/\/$/, '');
    return fetch(`${base}/api/makeready-bot/${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options && options.headers) },
    }).then((r) => r.json().then((j) => ({ status: r.status, body: j })));
  }

  function addMsg(text, who) {
    const d = document.createElement('div');
    d.className = `mrb-msg ${who}`;
    d.textContent = text;
    chatEl.appendChild(d);
    chatEl.scrollTop = chatEl.scrollHeight;
  }

  function loadConfig() {
    return api(`config?company=${encodeURIComponent(slug)}`, { method: 'GET' }).then((res) => {
      if (res.status !== 200) throw new Error('config');
      const phases = res.body.config.phases_available || [];
      phasesEl.innerHTML = '';
      phases.forEach((p) => {
        const opt = document.createElement('option');
        opt.value = p;
        opt.textContent = p.replace(/_/g, ' ');
        opt.selected = p === 'final_clean';
        phasesEl.appendChild(opt);
      });
      addMsg(`Hi — I'm the demo assistant for ${res.body.config.display_name}. Ask about services, area, or use Request / estimate to submit a lot.`, 'bot');
      return res.body.config;
    });
  }

  function sendChat() {
    const message = inputEl.value.trim();
    if (!message) return;
    addMsg(message, 'user');
    inputEl.value = '';
    api('chat', { method: 'POST', body: JSON.stringify({ company: slug, message }) }).then((res) => {
      if (res.body.mode === 'form') {
        formEl.classList.add('open');
        root.querySelector('[data-tab="form"]').click();
      }
      addMsg(res.body.reply || 'the owner will confirm', 'bot');
    });
  }

  root.querySelector('#mrb-send').addEventListener('click', sendChat);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendChat();
  });

  root.querySelectorAll('.mrb-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      root.querySelectorAll('.mrb-tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      const chatOn = tab.dataset.tab === 'chat';
      root.querySelector('#mrb-chat-row').style.display = chatOn ? 'flex' : 'none';
      chatEl.style.display = chatOn ? 'block' : 'none';
      formEl.classList.toggle('open', !chatOn);
    });
  });

  root.querySelector('#mrb-est-btn').addEventListener('click', () => {
    const fd = new FormData(formEl);
    const phases = Array.from(phasesEl.selectedOptions).map((o) => o.value);
    api('estimate', {
      method: 'POST',
      body: JSON.stringify({
        company: slug,
        sq_ft: Number(fd.get('sq_ft')),
        stories: Number(fd.get('stories')),
        phases,
      }),
    }).then((res) => {
      if (!res.body.ok) {
        estEl.textContent = res.body.error === 'missing_rate'
          ? 'Pricing not available for that phase — the owner will confirm.'
          : 'Could not estimate — check sq ft and phases.';
        return;
      }
      estEl.textContent = `Estimate: $${res.body.estimate_usd.toFixed(2)} (${res.body.label})`;
    });
  });

  formEl.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(formEl);
    const phases = Array.from(phasesEl.selectedOptions).map((o) => o.value);
    const payload = {
      company: slug,
      builder_company: fd.get('builder_company'),
      contact_name: fd.get('contact_name'),
      phone: fd.get('phone'),
      email: fd.get('email'),
      community: fd.get('community'),
      po_number: fd.get('po_number'),
      lots: [
        {
          lot_number: fd.get('lot_number'),
          address: fd.get('address'),
          sq_ft: Number(fd.get('sq_ft')),
          stories: Number(fd.get('stories')),
          target_date: fd.get('target_date'),
          closing_date: fd.get('closing_date'),
          phases,
          notes: fd.get('notes'),
        },
      ],
    };
    api('submit', { method: 'POST', body: JSON.stringify(payload) }).then((res) => {
      if (res.status === 201) {
        addMsg(`Request saved (${res.body.request_id}). ${res.body.estimate_label}`, 'bot');
        if (res.body.access_note) addMsg(res.body.access_note, 'bot');
        formEl.reset();
      } else {
        estEl.textContent = 'Submit failed — check required fields.';
      }
    });
  });

  loadConfig().catch(() => addMsg('Could not load config. Form mode only.', 'bot'));
})();
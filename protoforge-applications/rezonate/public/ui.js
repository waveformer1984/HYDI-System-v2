(function () {
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const orderId = params.get('order');

  const STATES = {
    awaiting_payment: 'Waiting for payment',
    paid: 'Payment confirmed',
    generating: 'Generating your track…',
    ready: 'Ready to download',
    failed: 'Failed'
  };

  async function api(path, opts) {
    const r = await fetch(path, opts);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `request failed (${r.status})`);
    return j;
  }

  // ── Order form ────────────────────────────────────────────────────
  const form = $('order-form');
  if (form && !orderId) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('order-btn'); const err = $('order-error');
      err.hidden = true; btn.disabled = true; btn.textContent = 'Creating checkout…';
      try {
        const { order } = await api('/orders', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            customer_email: $('f-email').value.trim(),
            customer_name: $('f-name').value.trim() || undefined,
            prompt: $('f-prompt').value.trim(),
            duration: parseInt($('f-duration').value, 10),
            mood: $('f-mood').value || undefined
          })
        });
        // Redirect to the real hosted checkout. The payment itself is
        // confirmed only by Stripe's webhook — never by this page.
        location.href = order.checkout_url;
      } catch (ex) {
        err.textContent = ex.message; err.hidden = false;
        btn.disabled = false; btn.textContent = 'Continue to secure checkout — $29';
      }
    });
  }

  // ── Status view ───────────────────────────────────────────────────
  async function renderStatus() {
    const card = $('step-status');
    $('step-order').hidden = true;
    card.hidden = false;
    try {
      const { order } = await api(`/orders/${orderId}`);
      $('status-fields').innerHTML = `
        <dt>Order</dt><dd>${order.id.slice(0, 8)}…</dd>
        <dt>Track</dt><dd>${order.prompt}</dd>
        <dt>Payment</dt><dd>${order.payment_status}</dd>
        <dt>Status</dt><dd>${STATES[order.status] || order.status}</dd>`;
      const actions = $('status-actions'); const note = $('status-note');
      actions.innerHTML = '';
      if (order.status === 'ready' && order.asset_id) {
        const a = document.createElement('a');
        a.className = 'button'; a.href = `/orders/${order.id}/download`;
        a.textContent = 'Download your track'; a.download = '';
        actions.appendChild(a);
        note.textContent = 'Your generated audio package is ready.';
        return true;
      }
      if (order.status === 'awaiting_payment') {
        const a = document.createElement('a');
        a.className = 'button'; a.href = order.checkout_url;
        a.textContent = 'Complete payment';
        actions.appendChild(a);
        note.textContent = 'Payment is not complete yet.';
      } else if (order.status === 'failed') {
        note.textContent = `Something failed honestly: ${order.error || 'unknown'}. Contact support with your order id.`;
      } else {
        note.textContent = 'This updates automatically — keep this page open.';
      }
      return false;
    } catch (ex) {
      $('status-fields').innerHTML = '';
      $('status-note').textContent = ex.message;
      return true;
    }
  }

  if (orderId) {
    (async function poll() {
      const done = await renderStatus();
      if (!done) setTimeout(poll, 4000);
    })();
  }
})();

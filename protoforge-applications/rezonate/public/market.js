(function () {
  const $ = (id) => document.getElementById(id);
  const api = (p, m, body) => fetch(p, {
    method: m || 'GET',
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined
  }).then(r => r.json());

  let EXPLORER = null;

  const txLink = (hash) => hash && EXPLORER
    ? `<a href="${EXPLORER}/tx/${hash}" target="_blank" rel="noopener">${hash.slice(0, 14)}…</a>`
    : `<code>${hash ? hash.slice(0, 14) + '…' : '—'}</code>`;

  const addrLink = (addr) => addr && EXPLORER
    ? `<a href="${EXPLORER}/address/${addr}" target="_blank" rel="noopener">${addr.slice(0, 10)}…</a>`
    : `<code>${addr || '—'}</code>`;

  const REV_LABEL = {
    SALE_DETECTED: 'sale detected', CHAIN_VERIFIED: 'chain verified',
    COMMERCIAL_EVENT_CREATED: 'commercial event', REVENUE_RECORDED: 'revenue recorded',
    RECONCILED: 'RECONCILED', SALE_FAILED: 'FAILED', PURCHASE_PENDING: 'pending'
  };

  async function refresh() {
    const st = await api('/nft/status');
    EXPLORER = st.chain.explorer || null;
    const modeTag = st.chain.mode === 'local' ? 'local EVM proving chain' : st.chain.mode;
    $('chain-tag').innerHTML =
      `chain: <b>${modeTag}</b> (id ${st.chain.chainId}) · nft ${addrLink(st.chain.nft)} · market ${addrLink(st.chain.market)}` +
      ` · block ${st.blockNumber}` + (EXPLORER ? ` · <a href="${EXPLORER}" target="_blank" rel="noopener">explorer</a>` : ' · no public explorer');

    const [assets, listings, sales] = await Promise.all([
      api('/nft/assets'), api('/nft/listings'), api('/nft/sales')
    ]);
    const byId = Object.fromEntries((assets.nftAssets || []).map(a => [a.id, a]));

    $('market-list').innerHTML = (assets.nftAssets || []).map(a => {
      const l = (listings.listings || []).find(x => x.asset_id === a.id && x.status === 'listed');
      return `<div class="row" style="justify-content:space-between">
        <div><b>${a.title}</b><br><small>${a.status} · token ${a.token_id ?? '—'} · <a href="/nft/assets/${a.id}/metadata.json">metadata</a> · <a href="/nft/assets/${a.id}/verify">verify</a></small></div>
        <div>${l ? `<span>${l.price_eth} ETH</span> <button data-buy="${l.id}">Buy</button> <button data-cancel="${l.id}">Cancel</button>`
          : a.status === 'minted' ? `<button data-list="${a.id}">List for sale</button>` : ''}</div>
      </div>`;
    }).join('') || '<p class="note">No NFT assets yet.</p>';

    $('sales-list').innerHTML = (sales.sales || []).map(s =>
      `<div class="row"><div><b>${s.price_eth} ETH</b> — ${REV_LABEL[s.revenue_status] || s.revenue_status}<br>
       <small>buyer ${s.buyer_wallet} · tx ${txLink(s.transaction_hash)}` +
      (s.commercial_event_id ? ` · event <code>${s.commercial_event_id.slice(0, 8)}…</code>` : '') +
      `</small></div></div>`).join('')
      || '<p class="note">No sales yet.</p>';

    document.querySelectorAll('[data-buy]').forEach(b => b.onclick = async () => {
      const w = prompt('Buyer wallet (0x…)'); if (!w) return;
      const r = await api(`/nft/listings/${b.dataset.buy}/purchase`, 'POST', { buyerWallet: w });
      if (!r.ok) alert(r.error); refresh();
    });
    document.querySelectorAll('[data-cancel]').forEach(b => b.onclick = async () => {
      const w = prompt('Seller wallet (0x…)'); if (!w) return;
      const r = await api(`/nft/listings/${b.dataset.cancel}/cancel`, 'POST', { wallet: w });
      if (!r.ok) alert(r.error); refresh();
    });
    document.querySelectorAll('[data-list]').forEach(b => b.onclick = async () => {
      const a = byId[b.dataset.list];
      const w = prompt('Seller wallet (0x…)', a ? a.creator_id : ''); if (!w) return;
      const p = prompt('Price in ETH', '0.1'); if (!p) return;
      const r = await api('/nft/listings', 'POST', { nftAssetId: b.dataset.list, sellerWallet: w, priceEth: p });
      if (!r.ok) alert(r.error); refresh();
    });
  }

  $('mint-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('mint-err').hidden = true;
    $('mint-result').innerHTML = '<p>submitting…</p>';
    const created = await api('/nft/assets', 'POST', {
      sourceAssetId: $('m-asset').value.trim(), creatorWallet: $('m-wallet').value.trim(),
      title: $('m-title').value.trim() || undefined
    });
    if (!created.ok) { $('mint-err').textContent = created.error; $('mint-err').hidden = false; $('mint-result').innerHTML = ''; return; }
    const minted = await api(`/nft/assets/${created.nftAsset.id}/mint`, 'POST', { wallet: $('m-wallet').value.trim() });
    if (!minted.ok) { $('mint-result').innerHTML = `<p class="error">${minted.error}</p>`; refresh(); return; }
    // Never claim green from the submit alone — confirm via the verify endpoint.
    const v = await api(`/nft/assets/${created.nftAsset.id}/verify`);
    const ok = v.verification && v.verification.verified;
    $('mint-result').innerHTML = ok
      ? `<p>✓ CHAIN-VERIFIED — token ${minted.mint.token_id} · tx ${txLink(minted.mint.transaction_hash)} · owner ${v.verification.owner}</p>`
      : `<p class="error">mint submitted (tx ${txLink(minted.mint.transaction_hash)}) but verification ${v.verification ? 'did not confirm' : 'unavailable'}</p>`;
    refresh();
  });

  refresh();
})();

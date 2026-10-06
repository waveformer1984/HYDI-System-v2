/**
 * Shared deterministic Rezonate NFT-commerce status answers.
 *
 * Single source for both chat surfaces (api/chat/route.js + pages/api/chat.ts)
 * so the two can never drift. Reads only durable Rezonate state — never the
 * LLM, never invents verification. Optionally receives a `sync` function that
 * bridges chain-verified sales into the ProtoForge commercial fabric before
 * answering (best-effort; failures degrade to stale-but-honest answers).
 */

const { normalizeRezonateIntent } = require('./intent');
const { getNftStatus } = require('./rezonate-client');

const VERIFIED = ['CHAIN_VERIFIED', 'SALE_CONFIRMED', 'COMMERCIAL_EVENT_CREATED', 'REVENUE_RECORDED', 'RECONCILED'];

function saleLine(x) {
  return `token sale ${x.price_eth} ETH, tx ${x.transaction_hash}, ` +
    `chain verified: yes, ProtoForge revenue: ${x.revenue_status === 'REVENUE_RECORDED' || x.revenue_status === 'RECONCILED' ? 'RECORDED' : 'pending'}, ` +
    `reconciled: ${x.revenue_status === 'RECONCILED' ? 'yes' : 'no'}`;
}

/**
 * Returns { text } when this is an NFT-commerce question we can answer from
 * durable state (or a clearly-NFT mutation request we refuse), else null.
 */
async function tryNftStatusAnswer(message, opts = {}) {
  const intent = normalizeRezonateIntent(message);

  if (!intent.ok) {
    // Refuse clearly-NFT mutations in generic chat too — "sell my nft" must
    // not silently fall through to an LLM that might claim it happened.
    if (intent.reason && intent.reason.startsWith('forbidden_intent') && /\bnfts?\b/i.test(message)) {
      return { text: `🎵 Rezonate NFT: I cannot do that through chat — mint/sell/buy go through the market UI/API (${intent.reason.split('—')[0].trim()}).` };
    }
    return null;
  }
  if (intent.taskType !== 'REZONATE_NFT_STATUS') return null;

  try { if (opts.sync) await opts.sync(); } catch { /* bridge is best-effort */ }

  try {
    const s = await getNftStatus();
    const kind = intent.parameters.kind;
    const minted = s.mints.filter((m) => m.status === 'minted');
    const listed = s.listings.filter((l) => l.status === 'listed');
    const sold = s.sales.filter((x) => VERIFIED.includes(x.revenue_status));
    const tag = `chain mode: ${s.chainMode}${s.chainMode === 'local' ? ' (local EVM proving chain — not a public testnet)' : ''}`;

    if (kind === 'minted' || kind === 'verify' || kind === 'status') {
      if (!minted.length) return { text: `🎵 Rezonate NFT (${tag}): nothing minted yet.` };
      return { text: `🎵 Rezonate NFT (${tag}): ${minted.length} minted — ` + minted.map((m) =>
        `token ${m.token_id} on ${m.contract_address} (tx ${m.transaction_hash}, owner ${m.wallet_address}, verified ${m.verified_at ? 'yes' : 'no'})`).join('; ') };
    }
    if (kind === 'listed') {
      if (!listed.length) return { text: `🎵 Rezonate NFT (${tag}): nothing currently listed.` };
      return { text: `🎵 Rezonate NFT (${tag}): ${listed.length} listed — ` + listed.map((l) =>
        `token ${l.token_id} @ ${l.price_eth} ETH (listing tx ${l.listing_tx})`).join('; ') };
    }
    if (kind === 'sold' || kind === 'latest') {
      if (!sold.length) return { text: `🎵 Rezonate NFT (${tag}): no confirmed sales yet.` };
      const latest = sold[sold.length - 1];
      if (kind === 'latest') return { text: `🎵 Rezonate NFT (${tag}) — latest NFT transaction: ${saleLine(latest)}.` };
      const total = sold.reduce((a, x) => a + Number(x.price_eth || 0), 0);
      return { text: `🎵 Rezonate NFT (${tag}): ${sold.length} sale(s), ${total} ETH gross — ` +
        sold.map(saleLine).join('; ') + `. Note: ${s.chainMode} chain — not fiat revenue.` };
    }
    if (kind === 'revenue' || kind === 'reconciled') {
      const target = kind === 'reconciled' ? sold.filter((x) => x.revenue_status === 'RECONCILED') : sold;
      if (!target.length) return { text: `🎵 Rezonate NFT (${tag}): ${kind === 'reconciled' ? 'no reconciled sales' : 'no verified NFT revenue'} yet.` };
      const gross = target.reduce((a, x) => a + Number(x.price_eth || 0), 0);
      const proceeds = target.reduce((a, x) => a + (x.creator_proceeds_wei ? Number(x.creator_proceeds_wei) / 1e18 : 0), 0);
      return { text: `🎵 Rezonate NFT (${tag}) ${kind === 'reconciled' ? 'reconciled sales' : 'NFT revenue'}: ` +
        `${target.length} sale(s), ${gross} ETH gross, ${proceeds} ETH creator proceeds — ` +
        target.map(saleLine).join('; ') + `. ETH on ${s.chainMode} chain, not USD.` };
    }
    if (kind === 'blocker') {
      const blockers = [];
      if (s.chainMode === 'local') blockers.push('public testnet credentials (REZONATE_CHAIN_RPC + funded REZONATE_DEPLOYER_KEY) are not set — all NFT commerce is on the local proving chain only');
      const unreported = sold.filter((x) => !x.commercial_event_id);
      if (unreported.length) blockers.push(`${unreported.length} verified sale(s) not yet bridged to ProtoForge revenue`);
      const pending = s.sales.filter((x) => x.status === 'purchase_pending' || x.status === 'sale_submitted');
      if (pending.length) blockers.push(`${pending.length} purchase(s) awaiting chain confirmation`);
      if (!blockers.length) blockers.push('nothing blocking — all verified sales are bridged and reconciled');
      return { text: `🎵 Rezonate NFT (${tag}) blockers: ${blockers.join('; ')}.` };
    }
    return { text: `🎵 Rezonate NFT (${tag}): ${minted.length} minted, ${listed.length} listed, ${sold.length} verified sale(s).` };
  } catch (e) {
    return { text: `🎵 Rezonate NFT: VERIFICATION_BLOCKED — could not read durable state (${e.message})` };
  }
}

module.exports = { tryNftStatusAnswer };

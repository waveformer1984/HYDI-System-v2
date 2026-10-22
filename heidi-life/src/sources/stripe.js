// Read-only revenue pull. Use a Stripe *restricted* key with only "Charges: Read".
import { matchDivision, DAY } from '../util.js';

export async function syncStripe(db, cfg, days = 45) {
  const key = cfg.sources?.stripe?.restrictedKey;
  if (!key) return 0;
  if (key.startsWith('sk_live_')) throw new Error('Refusing a full secret key — create a restricted read-only key (rk_live_…)');
  const metaKey = cfg.sources.stripe.divisionFromMetadataKey || 'division';
  const since = Math.floor((Date.now() - days * DAY) / 1000);
  const up = db.prepare('INSERT OR REPLACE INTO revenue (id, ts, amount_cents, currency, description, division) VALUES (?,?,?,?,?,?)');
  let after = null, count = 0;
  for (let page = 0; page < 20; page++) {
    const qs = new URLSearchParams({ limit: '100', 'created[gte]': String(since) });
    if (after) qs.set('starting_after', after);
    const res = await fetch(`https://api.stripe.com/v1/charges?${qs}`, { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) throw new Error(`stripe ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = await res.json();
    for (const c of body.data) {
      if (c.status !== 'succeeded') continue;
      const net = c.amount - (c.amount_refunded || 0);
      const div = c.metadata?.[metaKey] || matchDivision(`${c.description || ''} ${c.statement_descriptor || ''}`, cfg.divisionKeywords);
      up.run(c.id, c.created * 1000, net, c.currency, c.description || '', div);
      count++;
    }
    if (!body.has_more || !body.data.length) break;
    after = body.data.at(-1).id;
  }
  return count;
}

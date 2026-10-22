// Optional: Frank's local Ollama turns the day's numbers + insights into a short digest in Heidi's voice.
// If Ollama is down, the plain rule text is used — nothing depends on the model.
// The prompt carries your day's location/revenue summary, so only send it to a model on this machine,
// the LAN or the tailnet — never to an internet host, even if config.json is edited to point at one.
export function isPrivateModelUrl(raw) {
  let u; try { u = new URL(raw); } catch { return false; }
  if (!['http:', 'https:'].includes(u.protocol)) return false;
  const h = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h === '::1' || h.endsWith('.ts.net')) return true;
  const m = h.match(/^(\d+)\.(\d+)\.\d+\.\d+$/);
  if (!m) return !h.includes('.'); // bare LAN hostname like "frank"
  const [a, b] = [+m[1], +m[2]];
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 100 && b >= 64 && b <= 127);
}

export async function digest(cfg, rollup, insights) {
  const fallback = insights.length
    ? insights.map(i => `• ${i.text}`).join('\n')
    : 'Nothing stood out today.';
  if (!cfg.ollama?.enabled || !isPrivateModelUrl(cfg.ollama.url)) return { text: fallback, source: 'rules' };
  const prompt = `You are Heidi, Jordan's operations agent. Write a 3-5 sentence evening digest. Be direct, specific, no fluff, no medical claims. Only use these facts:
DAY: ${JSON.stringify(rollup)}
INSIGHTS: ${insights.map(i => i.text).join(' | ') || 'none'}`;
  try {
    const res = await fetch(new URL('/api/generate', cfg.ollama.url), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: cfg.ollama.model, prompt, stream: false, options: { temperature: 0.3, num_ctx: 4096 } }),
      signal: AbortSignal.timeout(90_000)
    });
    if (!res.ok) throw new Error(String(res.status));
    const { response } = await res.json();
    return { text: response.trim(), source: cfg.ollama.model };
  } catch {
    return { text: fallback, source: 'rules' };
  }
}

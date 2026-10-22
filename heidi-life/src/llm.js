// Optional: Frank's local Ollama turns the day's numbers + insights into a short digest in Heidi's voice.
// If Ollama is down, the plain rule text is used — nothing depends on the model.
export async function digest(cfg, rollup, insights) {
  const fallback = insights.length
    ? insights.map(i => `• ${i.text}`).join('\n')
    : 'Nothing stood out today.';
  if (!cfg.ollama?.enabled) return { text: fallback, source: 'rules' };
  const prompt = `You are Heidi, Jordan's operations agent. Write a 3-5 sentence evening digest. Be direct, specific, no fluff, no medical claims. Only use these facts:
DAY: ${JSON.stringify(rollup)}
INSIGHTS: ${insights.map(i => i.text).join(' | ') || 'none'}`;
  try {
    const res = await fetch(`${cfg.ollama.url}/api/generate`, {
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

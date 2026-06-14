/**
 * Heidi Planner — multi-step task decomposition
 * Detects complex intent, generates a step plan via Ollama,
 * then runs each step sequentially with tool access.
 */

'use strict';

// Keywords that suggest a multi-step planning request
const PLAN_TRIGGERS = [
    /\b(plan|roadmap|strategy|steps? (to|for)|how (do i|should i|can i)|walk me through|outline|break down)\b/i,
    /\b(set up|build|create|launch|deploy|implement|integrate|migrate)\b.*\b(and|then|also|with|plus)\b/i,
    /\b(first|second|third|next|after that|finally)\b/i,
    /\b(automate|workflow|process|pipeline|system)\b/i,
];

const PLAN_AVOID = [
    /\b(what is|what are|define|explain|describe|tell me about)\b/i,  // pure Q&A, not tasks
];

/**
 * Detect whether a user message warrants a multi-step plan.
 */
function needsPlan(message) {
    if (message.length < 30) return false;
    if (PLAN_AVOID.some(re => re.test(message))) return false;
    return PLAN_TRIGGERS.some(re => re.test(message));
}

/**
 * Ask Ollama to generate a numbered step plan for the given goal.
 * Returns an array of step strings, or null if plan generation failed.
 */
async function generatePlan(goal, ollamaUrl, model, systemContext = '') {
    const sysNote = systemContext ? `\nSYSTEM: ${systemContext.slice(0, 300)}` : '';
    const prompt = `${sysNote}

The operator wants to accomplish: "${goal}"

Generate a concise numbered action plan (3-7 steps). Each step should be specific and actionable. Format:
1. [step]
2. [step]
...

Plan:`;

    try {
        const r = await fetch(`${ollamaUrl}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model,
                prompt,
                stream: false,
                options: { temperature: 0.3, num_predict: 300 }
            }),
            signal: AbortSignal.timeout(20000)
        });
        if (!r.ok) return null;
        const text = ((await r.json()).response || '').trim();
        if (!text) return null;

        const steps = text
            .split('\n')
            .map(l => l.replace(/^\d+\.\s*/, '').trim())
            .filter(l => l.length > 10 && !l.match(/^(plan|here|step|note):/i));

        return steps.length >= 2 ? steps : null;
    } catch { return null; }
}

/**
 * Format a plan array as a Markdown checklist string for injection into the chat reply.
 */
function formatPlan(steps) {
    return '**Action Plan:**\n' + steps.map((s, i) => `${i + 1}. ${s}`).join('\n');
}

/**
 * Core planning endpoint handler — generates plan and returns it.
 * Called from /api/plan route in launch-heidi-mobile.js.
 */
async function planEndpoint(req, res, ollamaUrl, model, buildSystemPrompt) {
    const { goal, deviceId } = req.body;
    if (!goal) return res.status(400).json({ error: 'goal required' });

    const steps = await generatePlan(goal, ollamaUrl, model, buildSystemPrompt ? buildSystemPrompt().slice(0, 400) : '');
    if (!steps) return res.status(503).json({ error: 'Model unavailable or could not generate plan' });

    res.json({ goal, steps, formatted: formatPlan(steps) });
}

module.exports = { needsPlan, generatePlan, formatPlan, planEndpoint };

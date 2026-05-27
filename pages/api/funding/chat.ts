import type { NextApiRequest, NextApiResponse } from 'next';
import type { Campaign } from '../../../lib/zlabs/types';

interface ChatContext {
  campaigns?: Campaign[];
  stats?: {
    totalPipeline: number;
    totalGrants: number;
    totalCorporate: number;
    expectedGrants: number;
    expectedCorporate: number;
    annualRevenue: number;
    revenueContracted: number;
  };
}

function formatCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n}`;
}

function daysUntilDeadline(deadline: string): number {
  const today = new Date('2026-05-23');
  const due = new Date(deadline);
  return Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function buildFallbackResponse(message: string, context: ChatContext): string {
  const campaigns = context.campaigns ?? [];
  const stats = context.stats;
  const lower = message.toLowerCase();

  if (lower.includes('prioritize') || lower.includes('today')) {
    const urgent = campaigns
      .filter((c) => daysUntilDeadline(c.deadline) <= 14)
      .sort((a, b) => daysUntilDeadline(a.deadline) - daysUntilDeadline(b.deadline));

    if (urgent.length === 0) {
      return 'No campaigns are due within 14 days. Focus on advancing your high-priority planned campaigns.';
    }

    const lines = urgent.map((c) => {
      const days = daysUntilDeadline(c.deadline);
      const items = c.missingItems?.length ? `\n   Missing: ${c.missingItems.slice(0, 2).join(', ')}` : '';
      return `• ${c.name} (${formatCurrency(c.amount)}) — ${days} days left at ${c.completionPct}% complete${items}`;
    });

    return `Top priorities for today:\n\n${lines.join('\n\n')}\n\nStart with the campaign closest to its deadline that has missing items to resolve.`;
  }

  if (lower.includes('due soon') || lower.includes('deadline') || lower.includes('urgent')) {
    const sorted = [...campaigns]
      .sort((a, b) => daysUntilDeadline(a.deadline) - daysUntilDeadline(b.deadline))
      .slice(0, 5);

    const lines = sorted.map((c) => {
      const days = daysUntilDeadline(c.deadline);
      return `• ${c.name} — ${days} days (${c.deadline}) · ${formatCurrency(c.amount)} · ${c.status.replace('_', ' ')}`;
    });

    return `Upcoming deadlines:\n\n${lines.join('\n')}`;
  }

  if (lower.includes('toyota')) {
    const toyota = campaigns.find((c) => c.id === 'toyota-usa');
    if (!toyota) return 'Toyota USA Foundation campaign not found in pipeline.';

    const days = daysUntilDeadline(toyota.deadline);
    const missing = toyota.missingItems?.join('\n• ') ?? 'None';
    const contacts = toyota.contacts?.join(', ') ?? 'None on file';

    return `Toyota USA Foundation — ${formatCurrency(toyota.amount)}\n\nDeadline: ${toyota.deadline} (${days} days)\nStatus: ${toyota.status.replace(/_/g, ' ')}\nCompletion: ${toyota.completionPct}%\nProbability: ${toyota.probability}%\n\nMissing items:\n• ${missing}\n\nKey contacts: ${contacts}\n\nRecommendation: Reach out to Toyota TMMTX Partnerships today to request the partnership letter and begin collecting the 10 required school district letters.`;
  }

  if (lower.includes('email') || lower.includes('draft')) {
    return `Subject: Partnership Request — Z-Labs Community Safety Initiative\n\nDear [Partnership Contact],\n\nI am writing on behalf of Z-Labs to request your organization's partnership for our Toyota USA Foundation grant application (${formatCurrency(50000)} — deadline June 15, 2026).\n\nZ-Labs is building community safety infrastructure across Fayette County. Your partnership letter would confirm your commitment to collaborate on this initiative, helping us meet grant requirements and serve the community.\n\nWe need your letter by June 8, 2026 to allow time for final review.\n\nPlease reply to confirm your availability for a brief call this week.\n\nThank you,\nJordan A.\nZ-Labs`;
  }

  if (lower.includes('pipeline') || lower.includes('total')) {
    if (!stats) return 'Pipeline stats unavailable.';

    return `Pipeline Summary:\n\n• Total Pipeline: ${formatCurrency(stats.totalPipeline)}\n• Grants: ${formatCurrency(stats.totalGrants)} (expected ${formatCurrency(stats.expectedGrants)})\n• Corporate: ${formatCurrency(stats.totalCorporate)} (expected ${formatCurrency(stats.expectedCorporate)})\n• Annual Revenue Target: ${formatCurrency(stats.annualRevenue)} (${formatCurrency(stats.revenueContracted)} contracted)\n\nOverall weighted expected value: ~$7.6M across ${campaigns.length} active campaigns.`;
  }

  if (lower.includes('probability') || lower.includes('success')) {
    const top = [...campaigns]
      .sort((a, b) => b.probability - a.probability)
      .slice(0, 5);

    const lines = top.map((c) => `• ${c.name} — ${c.probability}% · ${formatCurrency(c.amount)}`);
    return `Top campaigns by probability of success:\n\n${lines.join('\n')}\n\nFocus effort on Danos GIVES (95%) and Toyota USA (85%) first — they're also your most urgent deadlines.`;
  }

  const urgentCount = campaigns.filter((c) => daysUntilDeadline(c.deadline) <= 14).length;
  const totalExpected = stats ? formatCurrency(stats.expectedGrants + stats.expectedCorporate) : 'N/A';

  return `Z-Labs Funding Pipeline Overview:\n\n• ${campaigns.length} active campaigns totaling ${stats ? formatCurrency(stats.totalPipeline) : '$11.7M'}\n• ${urgentCount} campaign(s) due within 14 days\n• Total expected funding: ${totalExpected}\n\nAsk me about specific campaigns, deadlines, priorities, or request a draft email for partnership outreach.`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { message, context } = req.body as { message?: string; context?: ChatContext };

  if (!message) {
    return res.status(400).json({ error: 'Message required' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (apiKey) {
    try {
      const Anthropic = (await import('@anthropic-ai/sdk')).default;
      const client = new Anthropic({ apiKey });

      const systemPrompt = [
        'You are Hydi, Z-Labs\' AI funding assistant. Be specific, actionable, and concise.',
        '',
        'Current pipeline context:',
        JSON.stringify(context ?? {}, null, 2),
      ].join('\n');

      const response = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: message }],
      });

      const text = response.content
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map((b) => b.text)
        .join('');

      return res.status(200).json({ response: text });
    } catch (err) {
      const fallback = buildFallbackResponse(message, context ?? {});
      return res.status(200).json({ response: fallback });
    }
  }

  const fallback = buildFallbackResponse(message, context ?? {});
  return res.status(200).json({ response: fallback });
}

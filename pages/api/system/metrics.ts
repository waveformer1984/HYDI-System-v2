import type { NextApiRequest, NextApiResponse } from 'next';
import { getMetricsService } from '../../../lib/metrics';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'POST') {
    try {
      const payload = req.body;
      const metric = getMetricsService().record({
        requestId: payload.requestId || 'manual',
        conversationId: payload.conversationId,
        provider: payload.provider || 'unknown',
        selectedModel: payload.selectedModel || 'unknown',
        promptLength: payload.promptLength ?? 0,
        responseLength: payload.responseLength ?? 0,
        latencyMs: payload.latencyMs ?? 0,
        loadDurationMs: payload.loadDurationMs ?? null,
        evalDurationMs: payload.evalDurationMs ?? null,
        memoryLookupDurationMs: payload.memoryLookupDurationMs ?? null,
        actionExecutionDurationMs: payload.actionExecutionDurationMs ?? null,
        promptTokens: payload.promptTokens ?? null,
        completionTokens: payload.completionTokens ?? null,
        totalTokens: payload.totalTokens ?? null,
        errors: payload.errors,
        retryCount: payload.retryCount ?? 0,
        fallbackReason: payload.fallbackReason ?? null,
      });
      return res.status(201).json(metric);
    } catch (error) {
      console.error('[api/system/metrics] Failed to record metric:', error instanceof Error ? error.message : 'Unknown error');
      return res.status(500).json({ error: 'Failed to record metric' });
    }
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const query: Record<string, unknown> = {};

    if (req.query.startTime && typeof req.query.startTime === 'string') {
      query.startTime = req.query.startTime;
    }
    if (req.query.endTime && typeof req.query.endTime === 'string') {
      query.endTime = req.query.endTime;
    }
    if (req.query.provider && typeof req.query.provider === 'string') {
      query.provider = req.query.provider;
    }
    if (req.query.model && typeof req.query.model === 'string') {
      query.model = req.query.model;
    }
    if (req.query.conversationId && typeof req.query.conversationId === 'string') {
      query.conversationId = req.query.conversationId;
    }
    if (req.query.status && typeof req.query.status === 'string') {
      query.status = req.query.status as 'success' | 'failure';
    }

    const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : undefined;
    if (limit && Number.isFinite(limit) && limit > 0) {
      query.limit = limit;
    }

    const metricsService = getMetricsService();

    if (req.query.aggregate !== undefined) {
      const aggregation = metricsService.aggregate(query);
      return res.status(200).json({ query, aggregation });
    }

    const metrics = metricsService.query(query);
    return res.status(200).json({ query, count: metrics.length, metrics });
  } catch (error) {
    console.error('[api/system/metrics] Failed to query metrics:', error instanceof Error ? error.message : 'Unknown error');
    return res.status(500).json({ error: 'Failed to query metrics' });
  }
}

import { ReplayEngine } from '../lib/replay-engine'
import baseLogger from '../lib/structured-logger.js'

const engine = new ReplayEngine()
const logger = baseLogger.child({ component: 'Traces' })

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const sampleSize = Math.min(parseInt(req.query.sample || '20', 10), 100)
      const report = await engine.validateDeterminism(sampleSize)
      return res.status(200).json(report)
    }

    if (req.method === 'POST') {
      const { eventId } = req.body || {}
      if (!eventId || typeof eventId !== 'string') {
        return res.status(400).json({ error: 'eventId is required' })
      }
      const result = await engine.replayEvent(eventId)
      return res.status(200).json(result)
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (error) {
    logger.error('[TRACES] Request failed', { error })
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' })
  }
}

import { NextApiRequest, NextApiResponse } from 'next';
import { SecretScanner } from '../../../lib/operational/SecretScanner';

/**
 * POST /api/keys/scan — Scan repository for leaked secrets
 * GET /api/keys/scan — Same (scan is read-only)
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const scanner = new SecretScanner(process.cwd());
    const result = await scanner.scan({
      maxFiles: req.body?.maxFiles ?? 10000,
    });

    // Only return non-allowlisted findings by default
    const newFindings = result.findings.filter(f => !f.allowlisted);

    return res.status(200).json({
      summary: {
        scannedFiles: result.scannedFiles,
        scannedLines: result.scannedLines,
        totalFindings: result.findings.length,
        newFindings: result.newFindingsCount,
        allowlisted: result.allowlistedCount,
        scanDurationMs: result.scanDurationMs,
        timestamp: result.timestamp,
      },
      findings: newFindings,
    });
  } catch (error) {
    console.error('Key scan API error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'unknown',
    });
  }
}

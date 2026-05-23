/**
 * api/rezonate/capture.js — Vercel Serverless Function (CJS)
 *
 * Saves a Beat Box capture session submitted from pages/rezonate/beatbox.tsx.
 *
 * Request (POST, JSON):
 *   {
 *     projectId?:  string,
 *     pads:        Array<{ padIndex, label, durationMs, mimeType, audioBase64 }>,
 *     capturedAt:  string  // ISO timestamp from the client
 *   }
 *
 * For each pad:
 *   - Inserts a row into `rezonate_audio_files` with filename, file_path,
 *     storage_bucket, duration_seconds, track_id, and project_id.
 *   - audioBase64 is NOT stored in the DB — it is acknowledged client-side only.
 *
 * After all pad rows are inserted, one `actions` row is logged with
 * task_name='beatbox_capture', status='completed'.
 *
 * Response (201): { data: { saved: number, files: Array<object> }, error: null }
 * Validation failures → 400.  Supabase errors → 500.  Non-POST → 405.
 *
 * Pattern: CJS module.exports handler (internal service route, no auth middleware).
 */

const { createClient } = require('@supabase/supabase-js');

// Initialise Supabase client using service-role key (server-side only).
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Validate a single pad object from the request body.
 *
 * Rules:
 *  - padIndex must be a number in the range 0–7 (8-pad beatbox layout).
 *  - durationMs must be a number.
 *  - mimeType must be a string starting with "audio/".
 *
 * Returns an error string if invalid, or null if valid.
 *
 * @param {object} pad
 * @param {number} index - Position in the pads array (for error messages).
 * @returns {string|null}
 */
function validatePad(pad, index) {
  if (typeof pad.padIndex !== 'number' || pad.padIndex < 0 || pad.padIndex > 7) {
    return `pads[${index}].padIndex must be a number between 0 and 7`;
  }
  if (typeof pad.durationMs !== 'number') {
    return `pads[${index}].durationMs must be a number`;
  }
  if (typeof pad.mimeType !== 'string' || !pad.mimeType.startsWith('audio/')) {
    return `pads[${index}].mimeType must be a string starting with 'audio/'`;
  }
  return null;
}

/**
 * Main handler — accepts POST only.
 *
 * @param {import('http').IncomingMessage & { body: any }} req
 * @param {import('http').ServerResponse} res
 */
async function handler(req, res) {
  // ── method gate ──────────────────────────────────────────────────────────────
  if (req.method !== 'POST') {
    return res.status(405).json({ data: null, error: 'Method not allowed' });
  }

  // ── parse body ────────────────────────────────────────────────────────────────
  const { projectId, pads, capturedAt } = req.body || {};

  // ── validate pads array ───────────────────────────────────────────────────────
  if (!Array.isArray(pads) || pads.length < 1) {
    return res.status(400).json({ data: null, error: 'pads must be a non-empty array' });
  }

  for (let i = 0; i < pads.length; i++) {
    const padError = validatePad(pads[i], i);
    if (padError) {
      return res.status(400).json({ data: null, error: padError });
    }
  }

  // ── build rezonate_audio_files rows ──────────────────────────────────────────
  // audioBase64 is intentionally NOT stored in the DB.
  const now = Date.now();
  const fileRows = pads.map((pad) => {
    // Derive extension from mimeType, stripping any codec suffix (e.g. "webm;codecs=opus").
    const ext = (pad.mimeType.split('/')[1] || 'webm').split(';')[0].trim();
    const filename = `beatbox_pad_${pad.padIndex + 1}_${now}.${ext}`;
    const filePath = `beatbox/${capturedAt}/${filename}`;

    return {
      project_id: projectId || null,
      filename,
      file_path: filePath,
      storage_bucket: 'rezonate-audio',
      duration_seconds: pad.durationMs / 1000,
      track_id: null,  // No track assigned at capture time.
    };
  });

  // ── insert audio file metadata ────────────────────────────────────────────────
  const { data: insertedFiles, error: filesError } = await supabase
    .from('rezonate_audio_files')
    .insert(fileRows)
    .select();

  if (filesError) {
    console.error('[Rezonate/Capture] rezonate_audio_files insert error:', filesError);
    return res.status(500).json({ data: null, error: filesError.message });
  }

  // ── log capture action ────────────────────────────────────────────────────────
  // Use projectId as session_id when available, otherwise generate a unique key.
  const sessionId = projectId || `beatbox-${now}`;

  const { error: actionError } = await supabase
    .from('actions')
    .insert({
      task_name: 'beatbox_capture',
      status: 'completed',
      payload: {
        pad_count: pads.length,
        project_id: projectId || null,
        captured_at: capturedAt,
      },
      session_id: sessionId,
    });

  if (actionError) {
    console.error('[Rezonate/Capture] actions insert error:', actionError);
    return res.status(500).json({ data: null, error: actionError.message });
  }

  // ── success ───────────────────────────────────────────────────────────────────
  return res.status(201).json({
    data: {
      saved: pads.length,
      files: insertedFiles,
    },
    error: null,
  });
}

module.exports = handler;

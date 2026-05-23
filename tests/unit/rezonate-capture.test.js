/**
 * Unit tests for api/rezonate/capture.js
 *
 * Covers:
 *  - Valid POST with one or more pads -> 201 with correct saved count and files
 *  - Missing / empty pads array -> 400, no Supabase calls
 *  - Pad with mimeType not starting with 'audio/' -> 400, no Supabase calls
 *  - Pad with padIndex outside 0-7 -> 400, no Supabase calls
 *  - Non-POST HTTP methods (GET, PUT, DELETE, PATCH) -> 405, no Supabase calls
 *  - Supabase insert error on rezonate_audio_files -> 500
 *  - Supabase insert error on actions -> 500
 *
 * No live services required -- @supabase/supabase-js is fully mocked.
 *
 * Mock design notes:
 *   - Variables referenced inside jest.mock() factories must be prefixed with
 *     "mock" (case-insensitive) per Jest's hoisting safety rules.
 *   - The handler issues ONE batch insert(fileRows) on rezonate_audio_files then
 *     chains .select().  The mock returns a chainable {select} object so the
 *     chain resolves correctly.
 *   - The actions insert() is awaited directly without a .select() chain.
 *   - mockInsertedRows tracks raw args passed to insert() per table.
 *     mockInsertedRows['rezonate_audio_files'][0] is the array of file row objects
 *     because the handler passes all rows in a single insert() call.
 */

// ── Supabase mock ─────────────────────────────────────────────────────────────

let mockInsertedRows = {};
let mockInsertResults = {};

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn(function mockFrom(tableName) {
      if (!mockInsertedRows[tableName]) {
        mockInsertedRows[tableName] = [];
      }

      if (tableName === 'rezonate_audio_files') {
        return {
          insert: jest.fn(function mockInsert(rows) {
            mockInsertedRows[tableName].push(rows);
            var preset = mockInsertResults[tableName];
            var result = preset !== undefined
              ? preset
              : { data: rows, error: null };
            return { select: jest.fn(function mockSelect() { return Promise.resolve(result); }) };
          }),
        };
      }

      if (tableName === 'actions') {
        return {
          insert: jest.fn(function mockInsert(row) {
            mockInsertedRows[tableName].push(row);
            var preset = mockInsertResults[tableName];
            var result = preset !== undefined ? preset : { error: null };
            return Promise.resolve(result);
          }),
        };
      }

      return {
        insert: jest.fn().mockReturnThis(),
        select: jest.fn(function() { return Promise.resolve({ data: null, error: null }); }),
      };
    }),
  })),
}));

// ── environment variables ──────────────────────────────────────────────────────

beforeAll(() => {
  process.env.SUPABASE_URL = 'https://fake.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake_service_key';
});

// ── reset mock state between tests ────────────────────────────────────────────

beforeEach(() => {
  mockInsertedRows = {};
  mockInsertResults = {};
  jest.clearAllMocks();
});

// ── handler ───────────────────────────────────────────────────────────────────

const handler = require('../../api/rezonate/capture.js');

// ── req/res mock ───────────────────────────────────────────────────────────────

function buildReqRes(opts) {
  var method = (opts && opts.method) || 'POST';
  var body   = (opts && opts.body)   || {};
  var req = { method: method, body: body };
  var res = {
    _status: 200,
    _body: null,
    status: function(code) { this._status = code; return this; },
    json: function(payload) { this._body = payload; return this; },
    end: function() { return this; },
  };
  return { req: req, res: res };
}

var VALID_PAD = {
  padIndex: 0,
  label: 'Kick',
  durationMs: 250,
  mimeType: 'audio/webm;codecs=opus',
  audioBase64: 'AAABBB==',
};

function validBody(pads, capturedAt) {
  return {
    pads: pads || [VALID_PAD],
    capturedAt: capturedAt || '2026-05-23T12:00:00.000Z',
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// Happy path
// ══════════════════════════════════════════════════════════════════════════════

describe('POST with valid body', () => {
  it('returns 201 with data.saved equal to the number of pads', async () => {
    var pads = [
      { padIndex: 0, label: 'Kick',  durationMs: 200, mimeType: 'audio/webm', audioBase64: 'AAA=' },
      { padIndex: 3, label: 'Snare', durationMs: 180, mimeType: 'audio/ogg',  audioBase64: 'BBB=' },
    ];
    var pair = buildReqRes({ body: validBody(pads) });
    await handler(pair.req, pair.res);

    expect(pair.res._status).toBe(201);
    expect(pair.res._body.error).toBeNull();
    expect(pair.res._body.data.saved).toBe(pads.length);
  });

  it('returns data.files as an array with one entry per pad', async () => {
    var pads = [
      { padIndex: 1, label: 'Hi-Hat', durationMs: 100, mimeType: 'audio/wav', audioBase64: 'CCC=' },
      { padIndex: 5, label: 'Clap',   durationMs: 120, mimeType: 'audio/mp4', audioBase64: 'DDD=' },
    ];
    var pair = buildReqRes({ body: validBody(pads) });
    await handler(pair.req, pair.res);

    expect(Array.isArray(pair.res._body.data.files)).toBe(true);
    expect(pair.res._body.data.files).toHaveLength(pads.length);
  });

  it('calls rezonate_audio_files insert once with all pad rows in a single array', async () => {
    var pads = [VALID_PAD, Object.assign({}, VALID_PAD, { padIndex: 2, label: 'Snare' })];
    var pair = buildReqRes({ body: validBody(pads) });
    await handler(pair.req, pair.res);

    // One insert() call, carrying an array of length pads.length.
    expect(mockInsertedRows['rezonate_audio_files']).toHaveLength(1);
    expect(mockInsertedRows['rezonate_audio_files'][0]).toHaveLength(pads.length);
  });

  it('inserts into actions exactly once with task_name beatbox_capture', async () => {
    var pair = buildReqRes({ body: validBody([VALID_PAD]) });
    await handler(pair.req, pair.res);

    var actionRows = mockInsertedRows['actions'];
    expect(actionRows).toHaveLength(1);
    expect(actionRows[0].task_name).toBe('beatbox_capture');
  });

  it('action row has status completed', async () => {
    var pair = buildReqRes({ body: validBody([VALID_PAD]) });
    await handler(pair.req, pair.res);

    expect(mockInsertedRows['actions'][0].status).toBe('completed');
  });

  it('action payload contains the correct pad_count', async () => {
    var pads = [VALID_PAD, Object.assign({}, VALID_PAD, { padIndex: 4, label: 'Tom' })];
    var pair = buildReqRes({ body: validBody(pads) });
    await handler(pair.req, pair.res);

    expect(mockInsertedRows['actions'][0].payload.pad_count).toBe(pads.length);
  });

  it('works with a single pad at padIndex 0 (lower boundary)', async () => {
    var pair = buildReqRes({ body: validBody([VALID_PAD]) });
    await handler(pair.req, pair.res);

    expect(pair.res._status).toBe(201);
    expect(pair.res._body.data.saved).toBe(1);
  });

  it('works with a single pad at padIndex 7 (upper boundary)', async () => {
    var pad = { padIndex: 7, label: 'Bell', durationMs: 90, mimeType: 'audio/wav', audioBase64: 'GGG=' };
    var pair = buildReqRes({ body: validBody([pad]) });
    await handler(pair.req, pair.res);

    expect(pair.res._status).toBe(201);
  });

  it('does not store audioBase64 in any rezonate_audio_files row', async () => {
    var pair = buildReqRes({ body: validBody([VALID_PAD]) });
    await handler(pair.req, pair.res);

    var fileRows = mockInsertedRows['rezonate_audio_files'][0];
    fileRows.forEach(function(row) {
      expect(row).not.toHaveProperty('audioBase64');
      expect(JSON.stringify(row)).not.toContain('AAABBB==');
    });
  });

  it('sets storage_bucket to "rezonate-audio" on every file row', async () => {
    var pads = [
      { padIndex: 0, label: 'Kick',  durationMs: 200, mimeType: 'audio/webm', audioBase64: 'A=' },
      { padIndex: 1, label: 'Snare', durationMs: 180, mimeType: 'audio/ogg',  audioBase64: 'B=' },
    ];
    var pair = buildReqRes({ body: validBody(pads) });
    await handler(pair.req, pair.res);

    var fileRows = mockInsertedRows['rezonate_audio_files'][0];
    fileRows.forEach(function(row) {
      expect(row.storage_bucket).toBe('rezonate-audio');
    });
  });

  it('converts durationMs to duration_seconds (ms / 1000)', async () => {
    var pad = { padIndex: 2, label: 'HH', durationMs: 3500, mimeType: 'audio/webm', audioBase64: 'X=' };
    var pair = buildReqRes({ body: validBody([pad]) });
    await handler(pair.req, pair.res);

    var row = mockInsertedRows['rezonate_audio_files'][0][0];
    expect(row.duration_seconds).toBeCloseTo(3.5);
  });

  it('derives file extension from the mimeType subtype', async () => {
    var pad = { padIndex: 3, label: 'Tom', durationMs: 100, mimeType: 'audio/ogg', audioBase64: 'Y=' };
    var pair = buildReqRes({ body: validBody([pad]) });
    await handler(pair.req, pair.res);

    var row = mockInsertedRows['rezonate_audio_files'][0][0];
    expect(row.filename).toMatch(/\.ogg$/);
  });

  it('strips codec suffix from mimeType when deriving the file extension', async () => {
    var pad = { padIndex: 0, label: 'Kick', durationMs: 200, mimeType: 'audio/webm;codecs=opus', audioBase64: 'Z=' };
    var pair = buildReqRes({ body: validBody([pad]) });
    await handler(pair.req, pair.res);

    var row = mockInsertedRows['rezonate_audio_files'][0][0];
    expect(row.filename).toMatch(/\.webm$/);
  });

  it('sets track_id to null at capture time', async () => {
    var pair = buildReqRes({ body: validBody([VALID_PAD]) });
    await handler(pair.req, pair.res);

    var row = mockInsertedRows['rezonate_audio_files'][0][0];
    expect(row.track_id).toBeNull();
  });

  it('includes capturedAt in the file_path', async () => {
    var capturedAt = '2026-05-23T10:00:00Z';
    var pair = buildReqRes({ body: validBody([VALID_PAD], capturedAt) });
    await handler(pair.req, pair.res);

    var row = mockInsertedRows['rezonate_audio_files'][0][0];
    expect(row.file_path).toContain(capturedAt);
  });

  it('uses projectId as project_id in file rows when provided', async () => {
    var body = Object.assign({ projectId: 'proj_abc' }, validBody([VALID_PAD]));
    var pair = buildReqRes({ body: body });
    await handler(pair.req, pair.res);

    var row = mockInsertedRows['rezonate_audio_files'][0][0];
    expect(row.project_id).toBe('proj_abc');
  });

  it('sets project_id to null in file rows when projectId is absent', async () => {
    var pair = buildReqRes({ body: validBody([VALID_PAD]) });
    await handler(pair.req, pair.res);

    var row = mockInsertedRows['rezonate_audio_files'][0][0];
    expect(row.project_id).toBeNull();
  });

  it('uses projectId as session_id in the actions row when provided', async () => {
    var body = Object.assign({ projectId: 'proj_xyz' }, validBody([VALID_PAD]));
    var pair = buildReqRes({ body: body });
    await handler(pair.req, pair.res);

    expect(mockInsertedRows['actions'][0].session_id).toBe('proj_xyz');
  });

  it('falls back to a "beatbox-<timestamp>" session_id when projectId is absent', async () => {
    var pair = buildReqRes({ body: validBody([VALID_PAD]) });
    await handler(pair.req, pair.res);

    expect(mockInsertedRows['actions'][0].session_id).toMatch(/^beatbox-\d+$/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Validation -- missing / empty pads
// ══════════════════════════════════════════════════════════════════════════════

describe('POST with missing or empty pads', () => {
  it('returns 400 when pads is absent from the body', async () => {
    var pair = buildReqRes({ body: { capturedAt: '2026-05-23T00:00:00.000Z' } });
    await handler(pair.req, pair.res);

    expect(pair.res._status).toBe(400);
    expect(pair.res._body.error).toBeTruthy();
    expect(pair.res._body.data).toBeNull();
  });

  it('returns 400 when pads is null', async () => {
    var pair = buildReqRes({ body: { pads: null } });
    await handler(pair.req, pair.res);

    expect(pair.res._status).toBe(400);
    expect(pair.res._body.error).toBeTruthy();
  });

  it('returns 400 when pads is an empty array', async () => {
    var pair = buildReqRes({ body: { pads: [] } });
    await handler(pair.req, pair.res);

    expect(pair.res._status).toBe(400);
    expect(pair.res._body.error).toBeTruthy();
  });

  it('returns 400 when pads is a string instead of an array', async () => {
    var pair = buildReqRes({ body: { pads: 'not-an-array' } });
    await handler(pair.req, pair.res);

    expect(pair.res._status).toBe(400);
  });

  it('makes no Supabase calls when pads is missing', async () => {
    var pair = buildReqRes({ body: {} });
    await handler(pair.req, pair.res);

    expect(Object.keys(mockInsertedRows)).toHaveLength(0);
  });

  it('makes no Supabase calls when pads is an empty array', async () => {
    var pair = buildReqRes({ body: { pads: [] } });
    await handler(pair.req, pair.res);

    expect(Object.keys(mockInsertedRows)).toHaveLength(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Validation -- invalid mimeType
// ══════════════════════════════════════════════════════════════════════════════

describe('POST with pad mimeType not starting with "audio/"', () => {
  it('returns 400 when mimeType is "video/mp4"', async () => {
    var pad = { padIndex: 0, label: 'Kick', durationMs: 200, mimeType: 'video/mp4', audioBase64: 'AAA=' };
    var pair = buildReqRes({ body: validBody([pad]) });
    await handler(pair.req, pair.res);

    expect(pair.res._status).toBe(400);
    expect(pair.res._body.error).toBeTruthy();
    expect(pair.res._body.data).toBeNull();
  });

  it('returns 400 when mimeType is an empty string', async () => {
    var pad = { padIndex: 0, label: 'Kick', durationMs: 200, mimeType: '', audioBase64: 'AAA=' };
    var pair = buildReqRes({ body: validBody([pad]) });
    await handler(pair.req, pair.res);

    expect(pair.res._status).toBe(400);
  });

  it('returns 400 when mimeType is absent (undefined)', async () => {
    var pad = { padIndex: VALID_PAD.padIndex, label: VALID_PAD.label, durationMs: VALID_PAD.durationMs, audioBase64: VALID_PAD.audioBase64 };
    var pair = buildReqRes({ body: validBody([pad]) });
    await handler(pair.req, pair.res);

    expect(pair.res._status).toBe(400);
  });

  it('returns 400 when mimeType is "application/json"', async () => {
    var pad = { padIndex: 1, label: 'Snare', durationMs: 150, mimeType: 'application/json', audioBase64: 'AAA=' };
    var pair = buildReqRes({ body: validBody([pad]) });
    await handler(pair.req, pair.res);

    expect(pair.res._status).toBe(400);
  });

  it('returns 400 when mimeType is "image/png"', async () => {
    var pad = { padIndex: 2, label: 'HH', durationMs: 80, mimeType: 'image/png', audioBase64: 'AAA=' };
    var pair = buildReqRes({ body: validBody([pad]) });
    await handler(pair.req, pair.res);

    expect(pair.res._status).toBe(400);
  });

  it('makes no Supabase calls when mimeType is invalid', async () => {
    var pad = { padIndex: 1, label: 'Snare', durationMs: 150, mimeType: 'video/webm', audioBase64: 'AAA=' };
    var pair = buildReqRes({ body: validBody([pad]) });
    await handler(pair.req, pair.res);

    expect(Object.keys(mockInsertedRows)).toHaveLength(0);
  });

  it('returns 400 when only the second pad has an invalid mimeType', async () => {
    var pads = [
      VALID_PAD,
      { padIndex: 1, label: 'Snare', durationMs: 100, mimeType: 'application/octet-stream', audioBase64: 'B=' },
    ];
    var pair = buildReqRes({ body: validBody(pads) });
    await handler(pair.req, pair.res);

    expect(pair.res._status).toBe(400);
    expect(pair.res._body.error).toMatch(/pads\[1\]/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Validation -- padIndex outside 0-7
// ══════════════════════════════════════════════════════════════════════════════

describe('POST with pad padIndex outside 0-7', () => {
  it('returns 400 when padIndex is 8 (one above upper bound)', async () => {
    var pad = { padIndex: 8, label: 'Extra', durationMs: 100, mimeType: 'audio/webm', audioBase64: 'AAA=' };
    var pair = buildReqRes({ body: validBody([pad]) });
    await handler(pair.req, pair.res);

    expect(pair.res._status).toBe(400);
    expect(pair.res._body.error).toBeTruthy();
    expect(pair.res._body.data).toBeNull();
  });

  it('returns 400 when padIndex is -1 (below lower bound)', async () => {
    var pad = { padIndex: -1, label: 'Under', durationMs: 100, mimeType: 'audio/webm', audioBase64: 'AAA=' };
    var pair = buildReqRes({ body: validBody([pad]) });
    await handler(pair.req, pair.res);

    expect(pair.res._status).toBe(400);
  });

  it('returns 400 when padIndex is 100', async () => {
    var pad = { padIndex: 100, label: 'Way out', durationMs: 100, mimeType: 'audio/mp4', audioBase64: 'AAA=' };
    var pair = buildReqRes({ body: validBody([pad]) });
    await handler(pair.req, pair.res);

    expect(pair.res._status).toBe(400);
  });

  it('returns 400 when padIndex is a non-numeric string', async () => {
    var pad = { padIndex: 'A', label: 'Alpha', durationMs: 100, mimeType: 'audio/webm', audioBase64: 'AAA=' };
    var pair = buildReqRes({ body: validBody([pad]) });
    await handler(pair.req, pair.res);

    expect(pair.res._status).toBe(400);
  });

  it('makes no Supabase calls when padIndex is out of range', async () => {
    var pad = { padIndex: 99, label: 'Bad', durationMs: 100, mimeType: 'audio/webm', audioBase64: 'AAA=' };
    var pair = buildReqRes({ body: validBody([pad]) });
    await handler(pair.req, pair.res);

    expect(Object.keys(mockInsertedRows)).toHaveLength(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Unsupported HTTP methods
// ══════════════════════════════════════════════════════════════════════════════

describe('unsupported HTTP methods', () => {
  ['GET', 'PUT', 'DELETE', 'PATCH'].forEach(function(method) {
    it('returns 405 for ' + method, async () => {
      var pair = buildReqRes({ method: method, body: validBody() });
      await handler(pair.req, pair.res);

      expect(pair.res._status).toBe(405);
      expect(pair.res._body.data).toBeNull();
      expect(pair.res._body.error).toBeTruthy();
    });
  });

  it('makes no Supabase calls for unsupported methods', async () => {
    var pair = buildReqRes({ method: 'DELETE', body: validBody() });
    await handler(pair.req, pair.res);

    expect(Object.keys(mockInsertedRows)).toHaveLength(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Supabase error paths
// ══════════════════════════════════════════════════════════════════════════════

describe('Supabase insert error -- rezonate_audio_files', () => {
  beforeEach(() => {
    mockInsertResults['rezonate_audio_files'] = { data: null, error: { message: 'DB error' } };
  });

  it('returns 500', async () => {
    var pair = buildReqRes({ body: validBody([VALID_PAD]) });
    await handler(pair.req, pair.res);

    expect(pair.res._status).toBe(500);
  });

  it('returns { data: null, error: <Supabase message> }', async () => {
    var pair = buildReqRes({ body: validBody([VALID_PAD]) });
    await handler(pair.req, pair.res);

    expect(pair.res._body.data).toBeNull();
    expect(pair.res._body.error).toBe('DB error');
  });

  it('does not attempt to insert into actions after the files error', async () => {
    var pair = buildReqRes({ body: validBody([VALID_PAD]) });
    await handler(pair.req, pair.res);

    expect(mockInsertedRows['actions']).toBeUndefined();
  });

  it('propagates the exact Supabase error message verbatim', async () => {
    mockInsertResults['rezonate_audio_files'] = {
      data: null,
      error: { message: 'unique constraint violation' },
    };

    var pair = buildReqRes({ body: validBody([VALID_PAD]) });
    await handler(pair.req, pair.res);

    expect(pair.res._body.error).toBe('unique constraint violation');
  });
});

describe('Supabase insert error -- actions', () => {
  beforeEach(() => {
    // rezonate_audio_files succeeds (uses the default); actions fails.
    mockInsertResults['actions'] = { error: { message: 'Actions table unavailable' } };
  });

  it('returns 500', async () => {
    var pair = buildReqRes({ body: validBody([VALID_PAD]) });
    await handler(pair.req, pair.res);

    expect(pair.res._status).toBe(500);
  });

  it('returns { data: null, error: <Supabase message> }', async () => {
    var pair = buildReqRes({ body: validBody([VALID_PAD]) });
    await handler(pair.req, pair.res);

    expect(pair.res._body.data).toBeNull();
    expect(pair.res._body.error).toBe('Actions table unavailable');
  });

  it('still inserted into rezonate_audio_files before the actions failure', async () => {
    var pair = buildReqRes({ body: validBody([VALID_PAD]) });
    await handler(pair.req, pair.res);

    expect(mockInsertedRows['rezonate_audio_files']).toBeDefined();
    expect(mockInsertedRows['rezonate_audio_files']).toHaveLength(1);
  });
});

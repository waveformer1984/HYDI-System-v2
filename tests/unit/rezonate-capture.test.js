/**
 * Unit tests for api/rezonate/capture.js
 *
 * Covers: valid POST, missing/empty pads, bad mimeType, padIndex out of range,
 * unsupported HTTP methods, and Supabase insert errors.
 *
 * No live services required — @supabase/supabase-js is fully mocked.
 */

jest.mock('@supabase/supabase-js');

const { createClient } = require('@supabase/supabase-js');

// ── Tracking state ─────────────────────────────────────────────────────────────
// insertTracker[tableName] = array of row objects passed to insert()
// insertErrors[tableName]  = { message } to simulate a Supabase error on that table
const insertTracker = {};
let insertErrors = {};

// ── Mock Supabase client ───────────────────────────────────────────────────────
// Built once so `supabase = createClient(...)` in capture.js gets this object.
// `from()` returns { insert: fn }; insert() returns a thenable that also exposes
// .select() — matching the two call patterns in capture.js:
//   supabase.from('...').insert([...]).select()   (rezonate_audio_files)
//   supabase.from('...').insert({...})            (actions)
const mockClient = {
  from: jest.fn().mockImplementation((tableName) => ({
    insert: jest.fn().mockImplementation((rows) => {
      const err = insertErrors[tableName] || null;

      if (!err) {
        if (!insertTracker[tableName]) insertTracker[tableName] = [];
        const rowArray = Array.isArray(rows) ? rows : [rows];
        rowArray.forEach(r => insertTracker[tableName].push(r));
      }

      const resolved = err
        ? { data: null, error: err }
        : { data: Array.isArray(rows) ? rows : [rows], error: null };

      const p = Promise.resolve(resolved);
      p.select = jest.fn(() => Promise.resolve(resolved));
      return p;
    }),
  })),
};

createClient.mockReturnValue(mockClient);

// Load handler ONCE — module-level `supabase` in capture.js captures mockClient.
const handler = require('../../api/rezonate/capture.js');

// ── Environment & reset ────────────────────────────────────────────────────────

beforeAll(() => {
  process.env.SUPABASE_URL = 'https://fake.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake_service_key';
});

beforeEach(() => {
  Object.keys(insertTracker).forEach(k => delete insertTracker[k]);
  insertErrors = {};
  mockClient.from.mockClear();
});

// ── Helpers ────────────────────────────────────────────────────────────────────

function buildReqRes({ method = 'POST', body = {} } = {}) {
  const req = { method, body };
  const res = {
    _status: 200,
    _body: null,
    status(code) { this._status = code; return this; },
    json(payload) { this._body = payload; return this; },
    end() { return this; },
  };
  return { req, res };
}

const VALID_PAD = {
  padIndex: 0,
  label: 'Kick',
  durationMs: 250,
  mimeType: 'audio/webm;codecs=opus',
  audioBase64: 'AAABBB==',
};

function validBody(pads = [VALID_PAD], capturedAt = '2026-05-23T12:00:00.000Z') {
  return { pads, capturedAt };
}

// ── Happy path ─────────────────────────────────────────────────────────────────

describe('POST with valid body', () => {
  it('returns 201 with data.saved equal to the number of pads', async () => {
    const pads = [
      { padIndex: 0, label: 'Kick',  durationMs: 200, mimeType: 'audio/webm', audioBase64: 'AAA=' },
      { padIndex: 3, label: 'Snare', durationMs: 180, mimeType: 'audio/ogg',  audioBase64: 'BBB=' },
    ];
    const { req, res } = buildReqRes({ body: validBody(pads) });
    await handler(req, res);

    expect(res._status).toBe(201);
    expect(res._body.error).toBeNull();
    expect(res._body.data.saved).toBe(pads.length);
  });

  it('returns data.files with entries', async () => {
    const { req, res } = buildReqRes({ body: validBody([VALID_PAD]) });
    await handler(req, res);

    expect(res._body.data.files).toBeDefined();
  });

  it('inserts into rezonate_audio_files once per pad', async () => {
    const pads = [VALID_PAD, { ...VALID_PAD, padIndex: 2, label: 'Snare' }];
    const { req, res } = buildReqRes({ body: validBody(pads) });
    await handler(req, res);

    expect(insertTracker['rezonate_audio_files']).toHaveLength(pads.length);
  });

  it('inserts into actions exactly once with task_name beatbox_capture', async () => {
    const { req, res } = buildReqRes({ body: validBody([VALID_PAD]) });
    await handler(req, res);

    const actionRows = insertTracker['actions'];
    expect(actionRows).toHaveLength(1);
    expect(actionRows[0].task_name).toBe('beatbox_capture');
  });

  it('records the correct pad count in the actions row payload', async () => {
    const pads = [VALID_PAD, { ...VALID_PAD, padIndex: 2 }];
    const { req, res } = buildReqRes({ body: validBody(pads) });
    await handler(req, res);

    expect(insertTracker['actions'][0].payload.pad_count).toBe(2);
  });

  it('works with a single pad at padIndex 0', async () => {
    const { req, res } = buildReqRes({ body: validBody([VALID_PAD]) });
    await handler(req, res);

    expect(res._status).toBe(201);
    expect(res._body.data.saved).toBe(1);
  });

  it('works with a single pad at padIndex 7 (upper boundary)', async () => {
    const pad = { padIndex: 7, label: 'Bell', durationMs: 90, mimeType: 'audio/wav', audioBase64: 'GGG=' };
    const { req, res } = buildReqRes({ body: validBody([pad]) });
    await handler(req, res);

    expect(res._status).toBe(201);
  });

  it('sets storage_bucket to rezonate-audio on each file row', async () => {
    const { req, res } = buildReqRes({ body: validBody([VALID_PAD]) });
    await handler(req, res);

    expect(insertTracker['rezonate_audio_files'][0].storage_bucket).toBe('rezonate-audio');
  });
});

// ── Missing / empty pads ───────────────────────────────────────────────────────

describe('POST with missing or empty pads', () => {
  it('returns 400 when pads is absent from body', async () => {
    const { req, res } = buildReqRes({ body: { capturedAt: '2026-05-23T00:00:00.000Z' } });
    await handler(req, res);

    expect(res._status).toBe(400);
    expect(res._body.error).toBeTruthy();
  });

  it('returns 400 when pads is null', async () => {
    const { req, res } = buildReqRes({ body: { pads: null } });
    await handler(req, res);

    expect(res._status).toBe(400);
  });

  it('returns 400 when pads is an empty array', async () => {
    const { req, res } = buildReqRes({ body: { pads: [] } });
    await handler(req, res);

    expect(res._status).toBe(400);
  });

  it('returns 400 when pads is not an array', async () => {
    const { req, res } = buildReqRes({ body: { pads: 'not-an-array' } });
    await handler(req, res);

    expect(res._status).toBe(400);
  });

  it('makes no Supabase calls when pads is missing', async () => {
    const { req, res } = buildReqRes({ body: {} });
    await handler(req, res);

    expect(mockClient.from).not.toHaveBeenCalled();
  });

  it('makes no Supabase calls when pads is empty', async () => {
    const { req, res } = buildReqRes({ body: { pads: [] } });
    await handler(req, res);

    expect(mockClient.from).not.toHaveBeenCalled();
  });
});

// ── Invalid mimeType ───────────────────────────────────────────────────────────

describe('POST with pad missing valid mimeType', () => {
  it('returns 400 when mimeType does not start with audio/', async () => {
    const pad = { padIndex: 0, label: 'Kick', durationMs: 200, mimeType: 'video/mp4', audioBase64: 'AAA=' };
    const { req, res } = buildReqRes({ body: validBody([pad]) });
    await handler(req, res);

    expect(res._status).toBe(400);
    expect(res._body.error).toBeTruthy();
  });

  it('returns 400 when mimeType is an empty string', async () => {
    const pad = { padIndex: 0, label: 'Kick', durationMs: 200, mimeType: '', audioBase64: 'AAA=' };
    const { req, res } = buildReqRes({ body: validBody([pad]) });
    await handler(req, res);

    expect(res._status).toBe(400);
  });

  it('returns 400 when mimeType is absent', async () => {
    const { padIndex, label, durationMs, audioBase64 } = VALID_PAD;
    const pad = { padIndex, label, durationMs, audioBase64 };
    const { req, res } = buildReqRes({ body: validBody([pad]) });
    await handler(req, res);

    expect(res._status).toBe(400);
  });

  it('makes no Supabase calls when mimeType is invalid', async () => {
    const pad = { padIndex: 1, label: 'Snare', durationMs: 150, mimeType: 'application/json', audioBase64: 'AAA=' };
    const { req, res } = buildReqRes({ body: validBody([pad]) });
    await handler(req, res);

    expect(mockClient.from).not.toHaveBeenCalled();
  });

  it('rejects mimeType image/png', async () => {
    const pad = { padIndex: 2, label: 'HH', durationMs: 80, mimeType: 'image/png', audioBase64: 'AAA=' };
    const { req, res } = buildReqRes({ body: validBody([pad]) });
    await handler(req, res);

    expect(res._status).toBe(400);
  });
});

// ── padIndex out of range ──────────────────────────────────────────────────────

describe('POST with padIndex outside 0-7', () => {
  it('returns 400 when padIndex is 8 (one above upper bound)', async () => {
    const pad = { padIndex: 8, label: 'Extra', durationMs: 100, mimeType: 'audio/webm', audioBase64: 'AAA=' };
    const { req, res } = buildReqRes({ body: validBody([pad]) });
    await handler(req, res);

    expect(res._status).toBe(400);
    expect(res._body.error).toBeTruthy();
  });

  it('returns 400 when padIndex is -1', async () => {
    const pad = { padIndex: -1, label: 'Under', durationMs: 100, mimeType: 'audio/webm', audioBase64: 'AAA=' };
    const { req, res } = buildReqRes({ body: validBody([pad]) });
    await handler(req, res);

    expect(res._status).toBe(400);
  });

  it('returns 400 when padIndex is 100', async () => {
    const pad = { padIndex: 100, label: 'Way out', durationMs: 100, mimeType: 'audio/mp4', audioBase64: 'AAA=' };
    const { req, res } = buildReqRes({ body: validBody([pad]) });
    await handler(req, res);

    expect(res._status).toBe(400);
  });

  it('makes no Supabase calls when padIndex is out of range', async () => {
    const pad = { padIndex: 99, label: 'Bad', durationMs: 100, mimeType: 'audio/webm', audioBase64: 'AAA=' };
    const { req, res } = buildReqRes({ body: validBody([pad]) });
    await handler(req, res);

    expect(mockClient.from).not.toHaveBeenCalled();
  });

  it('returns 400 when padIndex is a non-numeric string', async () => {
    const pad = { padIndex: 'A', label: 'Alpha', durationMs: 100, mimeType: 'audio/webm', audioBase64: 'AAA=' };
    const { req, res } = buildReqRes({ body: validBody([pad]) });
    await handler(req, res);

    expect(res._status).toBe(400);
  });
});

// ── Unsupported HTTP methods ───────────────────────────────────────────────────

describe('unsupported HTTP methods', () => {
  ['GET', 'PUT', 'DELETE', 'PATCH'].forEach(method => {
    it(`returns 405 for ${method}`, async () => {
      const { req, res } = buildReqRes({ method, body: validBody() });
      await handler(req, res);

      expect(res._status).toBe(405);
      expect(res._body.error).toBeTruthy();
    });
  });

  it('makes no Supabase calls for unsupported methods', async () => {
    const { req, res } = buildReqRes({ method: 'DELETE', body: validBody() });
    await handler(req, res);

    expect(mockClient.from).not.toHaveBeenCalled();
  });
});

// ── Supabase error path ────────────────────────────────────────────────────────

describe('Supabase insert error', () => {
  it('returns 500 when rezonate_audio_files insert fails', async () => {
    insertErrors['rezonate_audio_files'] = { message: 'DB error' };

    const { req, res } = buildReqRes({ body: validBody([VALID_PAD]) });
    await handler(req, res);

    expect(res._status).toBe(500);
    expect(res._body.data).toBeNull();
    expect(res._body.error).toBe('DB error');
  });

  it('returns 500 when actions insert fails', async () => {
    insertErrors['actions'] = { message: 'Actions table unavailable' };

    const { req, res } = buildReqRes({ body: validBody([VALID_PAD]) });
    await handler(req, res);

    expect(res._status).toBe(500);
    expect(res._body.data).toBeNull();
    expect(res._body.error).toBe('Actions table unavailable');
  });

  it('surfaces the Supabase error message verbatim', async () => {
    insertErrors['rezonate_audio_files'] = { message: 'unique constraint violation' };

    const { req, res } = buildReqRes({ body: validBody([VALID_PAD]) });
    await handler(req, res);

    expect(res._body.error).toBe('unique constraint violation');
  });

  it('does not call actions insert when the audio files insert fails', async () => {
    insertErrors['rezonate_audio_files'] = { message: 'DB error' };

    const { req, res } = buildReqRes({ body: validBody([VALID_PAD]) });
    await handler(req, res);

    expect(insertTracker['actions']).toBeUndefined();
  });
});

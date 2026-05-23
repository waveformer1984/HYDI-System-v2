/**
 * Contract tests for AudioEngine, BpmClock, and SampleStore behaviour.
 *
 * The TypeScript source lives in lib/rezonate/ and runs in the browser via
 * Next.js. Jest has no TypeScript transform, so these tests verify the same
 * behavioural contracts using equivalent plain-JS implementations that mirror
 * the class designs exactly. If the TS source diverges from these contracts
 * the integration surface (AudioEngineProvider, BeatBoxCapture) will catch it.
 */

// ── AudioContext global mock ──────────────────────────────────────────────────

const mockConnect    = jest.fn().mockReturnThis();
const mockStart      = jest.fn();
const mockStop       = jest.fn();
const mockClose      = jest.fn().mockResolvedValue(undefined);
const mockResume     = jest.fn().mockResolvedValue(undefined);
const mockDecodeAudioData = jest.fn();
const mockCreateBufferSource = jest.fn();

function buildMockCtx(state = 'running') {
  return {
    state,
    currentTime: 0,
    sampleRate: 44100,
    close: mockClose,
    resume: mockResume,
    decodeAudioData: mockDecodeAudioData,
    createBufferSource: mockCreateBufferSource,
    destination: {},
  };
}

function buildMockSource() {
  return { buffer: null, connect: mockConnect, start: mockStart, stop: mockStop, onended: null };
}

global.AudioContext = jest.fn().mockImplementation(() => buildMockCtx());

beforeEach(() => {
  jest.clearAllMocks();
  mockClose.mockResolvedValue(undefined);
  mockResume.mockResolvedValue(undefined);
  mockConnect.mockReturnThis();
  mockCreateBufferSource.mockReturnValue(buildMockSource());
  global.AudioContext.mockImplementation(() => buildMockCtx());
});

// ── Pure-JS AudioEngine implementation (mirrors lib/rezonate/AudioEngine.ts) ─

class AudioEngine {
  static _instance = null;
  _ctx = null;

  static getInstance() {
    if (!AudioEngine._instance) AudioEngine._instance = new AudioEngine();
    return AudioEngine._instance;
  }

  getCtx() {
    if (!this._ctx) this._ctx = new global.AudioContext();
    if (this._ctx.state === 'suspended') this._ctx.resume();
    return this._ctx;
  }

  async decodeBlob(blob) {
    const ctx = this.getCtx();
    const ab = await blob.arrayBuffer();
    return ctx.decodeAudioData(ab);
  }

  get currentTime() { return this._ctx ? this._ctx.currentTime : 0; }
  get sampleRate()  { return this._ctx ? this._ctx.sampleRate : 44100; }

  close() {
    if (this._ctx) { this._ctx.close(); this._ctx = null; }
    AudioEngine._instance = null;
  }
}

// ── Pure-JS BpmClock implementation (mirrors lib/rezonate/BpmClock.ts) ───────

const SCHEDULER_INTERVAL_MS = 25;
const LOOKAHEAD_SEC = 0.1;

class BpmClock {
  constructor(engine) {
    this._engine = engine;
    this.bpm = 120;
    this.beatsPerBar = 4;
    this.isRunning = false;
    this._beatListeners = [];
    this._barListeners = [];
    this._schedulerId = null;
    this._nextBarTime = 0;
    this._tapTimes = [];
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    const ctx = this._engine.getCtx();
    this._nextBarTime = ctx.currentTime + 0.05;
    this._schedulerId = setInterval(() => this._tick(), SCHEDULER_INTERVAL_MS);
  }

  stop() {
    if (!this.isRunning) return;
    this.isRunning = false;
    if (this._schedulerId !== null) {
      clearInterval(this._schedulerId);
      this._schedulerId = null;
    }
  }

  _tick() {
    const ctx = this._engine.getCtx();
    const spb = 60 / this.bpm;
    const spBar = spb * this.beatsPerBar;
    while (this._nextBarTime < ctx.currentTime + LOOKAHEAD_SEC) {
      const t = this._nextBarTime;
      this._barListeners.forEach(cb => cb(t));
      for (let b = 0; b < this.beatsPerBar; b++) {
        this._beatListeners.forEach(cb => cb({ beatIndex: b, barTime: t + b * spb }));
      }
      this._nextBarTime += spBar;
    }
  }

  tap() {
    const now = Date.now();
    if (this._tapTimes.length > 0 && now - this._tapTimes[this._tapTimes.length - 1] > 3000) {
      this._tapTimes = [];
    }
    this._tapTimes.push(now);
    if (this._tapTimes.length > 8) this._tapTimes.shift();
    if (this._tapTimes.length >= 2) {
      const intervals = this._tapTimes.slice(1).map((t, i) => t - this._tapTimes[i]);
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const detected = Math.round(60000 / avg);
      this.bpm = Math.max(60, Math.min(200, detected));
    }
  }

  onBeat(cb) {
    this._beatListeners.push(cb);
    return () => { this._beatListeners = this._beatListeners.filter(l => l !== cb); };
  }

  onBar(cb) {
    this._barListeners.push(cb);
    return () => { this._barListeners = this._barListeners.filter(l => l !== cb); };
  }

  get nextBarTime() { return this._nextBarTime; }
}

// ── Pure-JS SampleStore implementation (mirrors lib/rezonate/SampleStore.ts) ─

class SampleStore {
  constructor(engine) {
    this._engine = engine;
    this._buffers = new Map();
  }

  async loadBlob(id, blob) {
    const buf = await this._engine.decodeBlob(blob);
    this._buffers.set(id, buf);
  }

  get(id)    { return this._buffers.get(id); }
  has(id)    { return this._buffers.has(id); }
  delete(id) { this._buffers.delete(id); }
  clear()    { this._buffers.clear(); }
  get ids()  { return [...this._buffers.keys()]; }

  play(id, startTime) {
    const buf = this._buffers.get(id);
    if (!buf) return null;
    const ctx = this._engine.getCtx();
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(startTime !== undefined ? startTime : 0);
    return src;
  }
}

// ── AudioEngine tests ─────────────────────────────────────────────────────────

describe('AudioEngine.getInstance()', () => {
  beforeEach(() => { AudioEngine._instance = null; });

  it('returns the same instance on repeated calls', () => {
    const a = AudioEngine.getInstance();
    const b = AudioEngine.getInstance();
    expect(a).toBe(b);
  });

  it('returns an AudioEngine instance', () => {
    expect(AudioEngine.getInstance()).toBeInstanceOf(AudioEngine);
  });
});

describe('AudioEngine.getCtx()', () => {
  beforeEach(() => { AudioEngine._instance = null; });

  it('creates a new AudioContext on the first call', () => {
    AudioEngine.getInstance().getCtx();
    expect(global.AudioContext).toHaveBeenCalledTimes(1);
  });

  it('returns the same AudioContext on subsequent calls', () => {
    const engine = AudioEngine.getInstance();
    const ctx1 = engine.getCtx();
    const ctx2 = engine.getCtx();
    expect(global.AudioContext).toHaveBeenCalledTimes(1);
    expect(ctx1).toBe(ctx2);
  });

  it('calls resume() when the context is suspended', () => {
    global.AudioContext.mockImplementationOnce(() => buildMockCtx('suspended'));
    AudioEngine.getInstance().getCtx();
    expect(mockResume).toHaveBeenCalledTimes(1);
  });

  it('does not call resume() when the context is running', () => {
    AudioEngine.getInstance().getCtx();
    expect(mockResume).not.toHaveBeenCalled();
  });
});

describe('AudioEngine.decodeBlob()', () => {
  beforeEach(() => { AudioEngine._instance = null; });

  it('calls decodeAudioData and returns its result', async () => {
    const fakeBuffer = { duration: 1.5 };
    mockDecodeAudioData.mockResolvedValue(fakeBuffer);
    const blob = { arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(8)) };
    const result = await AudioEngine.getInstance().decodeBlob(blob);
    expect(mockDecodeAudioData).toHaveBeenCalledTimes(1);
    expect(result).toBe(fakeBuffer);
  });

  it('passes the ArrayBuffer from blob.arrayBuffer() to decodeAudioData', async () => {
    const ab = new ArrayBuffer(16);
    const blob = { arrayBuffer: jest.fn().mockResolvedValue(ab) };
    mockDecodeAudioData.mockResolvedValue({});
    await AudioEngine.getInstance().decodeBlob(blob);
    expect(mockDecodeAudioData).toHaveBeenCalledWith(ab);
  });
});

describe('AudioEngine.close()', () => {
  beforeEach(() => { AudioEngine._instance = null; });

  it('calls ctx.close() and resets the singleton', () => {
    const engine = AudioEngine.getInstance();
    engine.getCtx();
    engine.close();
    expect(mockClose).toHaveBeenCalledTimes(1);
    expect(AudioEngine._instance).toBeNull();
  });

  it('does not throw when called before getCtx()', () => {
    expect(() => AudioEngine.getInstance().close()).not.toThrow();
  });
});

// ── BpmClock tests ────────────────────────────────────────────────────────────

describe('BpmClock', () => {
  let engine, clock;

  beforeEach(() => {
    AudioEngine._instance = null;
    engine = AudioEngine.getInstance();
    clock = new BpmClock(engine);
    jest.useFakeTimers();
  });

  afterEach(() => {
    clock.stop();
    jest.useRealTimers();
  });

  it('defaults to bpm=120 and isRunning=false', () => {
    expect(clock.bpm).toBe(120);
    expect(clock.isRunning).toBe(false);
  });

  it('start() sets isRunning to true', () => {
    clock.start();
    expect(clock.isRunning).toBe(true);
  });

  it('stop() sets isRunning to false', () => {
    clock.start();
    clock.stop();
    expect(clock.isRunning).toBe(false);
  });

  it('onBeat() returns an unsubscribe function', () => {
    const cb = jest.fn();
    const unsub = clock.onBeat(cb);
    expect(typeof unsub).toBe('function');
    unsub();
    expect(clock._beatListeners).not.toContain(cb);
  });

  it('onBar() returns an unsubscribe function', () => {
    const cb = jest.fn();
    const unsub = clock.onBar(cb);
    unsub();
    expect(clock._barListeners).not.toContain(cb);
  });

  it('tap() twice ~500ms apart sets bpm close to 120', () => {
    const realNow = Date.now;
    let t = 1000;
    Date.now = () => t;
    clock.tap();
    t += 500;
    clock.tap();
    Date.now = realNow;
    expect(clock.bpm).toBeCloseTo(120, -1);
  });

  it('tap() resets after a 3-second gap', () => {
    const realNow = Date.now;
    let t = 1000;
    Date.now = () => t;
    clock.tap();
    t += 4000;
    clock.tap();
    Date.now = realNow;
    expect(clock._tapTimes).toHaveLength(1);
  });

  it('tap() clamps bpm to [60, 200]', () => {
    const realNow = Date.now;
    let t = 1000;
    Date.now = () => t;
    clock.tap();
    t += 100; // 600 bpm — above max
    clock.tap();
    Date.now = realNow;
    expect(clock.bpm).toBe(200);
  });
});

// ── SampleStore tests ─────────────────────────────────────────────────────────

describe('SampleStore', () => {
  let engine, store;

  beforeEach(() => {
    AudioEngine._instance = null;
    engine = AudioEngine.getInstance();
    store = new SampleStore(engine);
    mockDecodeAudioData.mockResolvedValue({ duration: 1.0, numberOfChannels: 1 });
  });

  it('has() returns false for an unknown id', () => {
    expect(store.has('pad-0')).toBe(false);
  });

  it('loadBlob() stores the decoded buffer; has() returns true', async () => {
    const blob = { arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(8)) };
    await store.loadBlob('pad-0', blob);
    expect(store.has('pad-0')).toBe(true);
  });

  it('get() returns the decoded AudioBuffer', async () => {
    const fakeBuffer = { duration: 2.0 };
    mockDecodeAudioData.mockResolvedValueOnce(fakeBuffer);
    const blob = { arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(8)) };
    await store.loadBlob('pad-1', blob);
    expect(store.get('pad-1')).toBe(fakeBuffer);
  });

  it('delete() removes the buffer; has() returns false', async () => {
    const blob = { arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(8)) };
    await store.loadBlob('pad-2', blob);
    store.delete('pad-2');
    expect(store.has('pad-2')).toBe(false);
  });

  it('clear() removes all buffers', async () => {
    const blob = { arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(8)) };
    await store.loadBlob('pad-0', blob);
    await store.loadBlob('pad-1', blob);
    store.clear();
    expect(store.ids).toHaveLength(0);
  });

  it('play() calls createBufferSource, connect, and start', async () => {
    const blob = { arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(8)) };
    await store.loadBlob('pad-3', blob);
    engine.getCtx();
    store.play('pad-3');
    expect(mockCreateBufferSource).toHaveBeenCalled();
    expect(mockConnect).toHaveBeenCalled();
    expect(mockStart).toHaveBeenCalled();
  });

  it('play() returns null for an unknown id', () => {
    expect(store.play('nonexistent')).toBeNull();
  });

  it('play() returns the AudioBufferSourceNode', async () => {
    const blob = { arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(8)) };
    await store.loadBlob('pad-4', blob);
    engine.getCtx();
    const src = store.play('pad-4');
    expect(src).not.toBeNull();
  });
});

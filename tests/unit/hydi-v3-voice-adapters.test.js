'use strict';

const SpeechToTextAdapter = require('../../src/hydi-v3/SpeechToTextAdapter');
const TextToSpeechAdapter = require('../../src/hydi-v3/TextToSpeechAdapter');
const VoiceCommandRouter = require('../../src/hydi-v3/VoiceCommandRouter');

describe('HYDI V3 voice adapters', () => {
  it('STT timeout returns ok:false without throwing', async () => {
    const http = {
      getJson: async () => ({ ok: true, json: { ok: true } }),
      postMultipart: async () => ({ ok: false, error: 'timeout' }),
      postJson: async () => ({ ok: false, error: 'unused' }),
    };
    const stt = new SpeechToTextAdapter({ endpoint: 'http://127.0.0.1:9000', http });
    const r = await stt.transcribe(Buffer.from('RIFF'));
    expect(r).toEqual({ ok: false, text: '', error: 'timeout' });
  });

  it('TTS uses JSON POST and returns wav bytes', async () => {
    const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(8)]);
    const http = {
      getJson: async () => ({ ok: true, json: { ok: true } }),
      postMultipart: async () => ({ ok: false }),
      postJson: async () => ({ ok: true, status: 200, body: wav }),
    };
    const tts = new TextToSpeechAdapter({ endpoint: 'http://127.0.0.1:9001', http });
    const r = await tts.synthesize('hello');
    expect(r.ok).toBe(true);
    expect(r.audio.slice(0, 4).toString()).toBe('RIFF');
  });

  it('TTS timeout → ok:false', async () => {
    const http = {
      getJson: async () => ({ ok: true, json: { ok: true } }),
      postMultipart: async () => ({ ok: false }),
      postJson: async () => ({ ok: false, error: 'timeout' }),
    };
    const tts = new TextToSpeechAdapter({ http, timeoutMs: 15 });
    const r = await tts.synthesize('hi');
    expect(r).toMatchObject({ ok: false, error: 'timeout', audio: null });
  });

  it('healthCheck hits /health on configured ports', async () => {
    const seen = [];
    const http = {
      getJson: async (url) => {
        seen.push(url);
        return { ok: true, json: { ok: true, service: url.includes('9001') ? 'tts' : 'stt' } };
      },
      postMultipart: async () => ({ ok: false }),
      postJson: async () => ({ ok: false }),
    };
    await new SpeechToTextAdapter({ http }).healthCheck();
    await new TextToSpeechAdapter({ http }).healthCheck();
    expect(seen).toEqual(['http://127.0.0.1:9000/health', 'http://127.0.0.1:9001/health']);
  });
});

describe('VoiceCommandRouter safety', () => {
  it('approval phrase never reaches executeTask or handleAdvisoryAction', async () => {
    const executeTask = jest.fn();
    const handleAdvisoryAction = jest.fn();
    const router = new VoiceCommandRouter({
      executeTask,
      handleAdvisoryAction,
      conversationEngine: { ask: jest.fn().mockResolvedValue({ text: 'should not run' }) },
    });
    const r = await router.handleText('Please approve the Stripe charge');
    expect(r.ok).toBe(true);
    expect(r.requires_typed_confirmation).toBe(true);
    expect(executeTask).not.toHaveBeenCalled();
    expect(handleAdvisoryAction).not.toHaveBeenCalled();
    expect(router.conversationEngine.ask).not.toHaveBeenCalled();
  });

  it('allows status read without exec hooks', async () => {
    const executeTask = jest.fn();
    const router = new VoiceCommandRouter({
      executeTask,
      readHealth: async () => ({ ok: true, summary: 'API healthy' }),
      readAgentStatus: async () => ({ ok: true, summary: 'agent cycles=3' }),
    });
    const r = await router.handleText('What is the system health?');
    expect(r.mode).toBe('status_read');
    expect(r.response).toContain('API healthy');
    expect(executeTask).not.toHaveBeenCalled();
  });

  it('createProposal uses proposed_only', async () => {
    const createProposal = jest.fn().mockResolvedValue({ ok: true, message: 'queued' });
    const router = new VoiceCommandRouter({ createProposal });
    const r = await router.handleText('propose restart heidi-web');
    expect(createProposal).toHaveBeenCalledWith(expect.objectContaining({ status: 'proposed_only', source: 'voice' }));
    expect(r.mode).toBe('proposed_only');
  });
});
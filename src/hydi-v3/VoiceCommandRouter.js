'use strict';

const DANGEROUS_PATTERNS = [
  /\bapprov(e|al|ing)\b/i,
  /\bexecut(e|ion|ing)\b/i,
  /\bpay(ment|ing)?\b/i,
  /\bcharg(e|ing)\b/i,
  /\bsend\s+money\b/i,
  /\btransfer(ring)?\b/i,
  /\bconfirm(ation|ing)?\b/i,
];

const HEALTH_QUERY = /\b(health|status|how\s+are\s+you|system\s+state)\b/i;
const PROPOSAL_QUERY = /\b(propos(e|al)|suggest|mission|task)\b/i;

function transcriptRequiresTypedConfirmation(transcript) {
  if (!transcript || typeof transcript !== 'string') return false;
  const normalized = transcript.replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
  return DANGEROUS_PATTERNS.some((re) => re.test(normalized) || re.test(transcript));
}

class VoiceCommandRouter {
  constructor(config = {}) {
    this.stt = config.stt || null;
    this.conversationEngine = config.conversationEngine || null;
    this.readHealth = config.readHealth || null;
    this.readAgentStatus = config.readAgentStatus || null;
    this.createProposal = config.createProposal || null;
    this.executeTask = config.executeTask || null;
    this.handleAdvisoryAction = config.handleAdvisoryAction || null;
    this.logger = config.logger || console;
  }

  async handleAudio(audioBuffer, opts = {}) {
    if (!this.stt) return { ok: false, error: 'STT not configured' };
    const transcribed = await this.stt.transcribe(audioBuffer, opts);
    if (!transcribed.ok) return { ok: false, error: transcribed.error || 'stt_failed', transcript: '' };
    return this.route(transcribed.text, { transcript: transcribed.text });
  }

  async handleText(text) {
    return this.route(text, { transcript: text });
  }

  /**
   * Voice-safe routing — never calls executeTask / handleAdvisoryAction on dangerous phrases.
   */
  async route(transcript, meta = {}) {
    const text = (transcript || '').trim();
    if (!text) return { ok: false, error: 'empty_transcript' };

    if (transcriptRequiresTypedConfirmation(text)) {
      return {
        ok: true,
        requires_typed_confirmation: true,
        transcript: text,
        response:
          'Voice cannot approve or execute actions. Type the same request in Heidi chat or Tasks to confirm.',
        mode: 'blocked_exec',
      };
    }

    if (HEALTH_QUERY.test(text) && (this.readHealth || this.readAgentStatus)) {
      const parts = [];
      if (this.readHealth) {
        const h = await this.readHealth();
        if (h && h.ok === false) parts.push(`Health: ${h.error || 'unavailable'}`);
        else parts.push(typeof h?.summary === 'string' ? h.summary : JSON.stringify(h?.data || h));
      }
      if (this.readAgentStatus) {
        const a = await this.readAgentStatus();
        if (a && a.ok === false) parts.push(`Agent: ${a.error || 'unavailable'}`);
        else parts.push(typeof a?.summary === 'string' ? a.summary : JSON.stringify(a?.data || a));
      }
      return { ok: true, transcript: text, mode: 'status_read', response: parts.filter(Boolean).join(' · ') };
    }

    if (PROPOSAL_QUERY.test(text) && this.createProposal) {
      const proposal = await this.createProposal({ text, status: 'proposed_only', source: 'voice' });
      if (proposal && proposal.ok === false) {
        return { ok: false, error: proposal.error || 'proposal_failed', transcript: text };
      }
      return {
        ok: true,
        transcript: text,
        mode: 'proposed_only',
        response: proposal?.message || 'Recorded as a proposal only — nothing was executed.',
        proposal,
      };
    }

    if (this.conversationEngine && typeof this.conversationEngine.ask === 'function') {
      try {
        const response = await this.conversationEngine.ask(text);
        const reply = response && typeof response.text === 'string' ? response.text : String(response || '');
        return { ok: true, transcript: text, mode: 'question', response: reply };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : 'conversation_failed', transcript: text };
      }
    }

    return { ok: true, transcript: text, mode: 'echo', response: text };
  }
}

module.exports = VoiceCommandRouter;
module.exports.transcriptRequiresTypedConfirmation = transcriptRequiresTypedConfirmation;
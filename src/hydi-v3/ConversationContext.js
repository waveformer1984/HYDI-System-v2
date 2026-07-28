'use strict';

/**
 * ConversationContext is a thin wrapper over SessionMemory focused on the
 * local AI layer. It exposes the recent turns and focus in a format the
 * model orchestration layer can consume without directly coupling to
 * SessionMemory's persistence concerns.
 */
class ConversationContext {
  constructor(sessionMemory) {
    this.sessionMemory = sessionMemory || null;
  }

  recent({ limit = 10, includeSystem = true } = {}) {
    if (!this.sessionMemory || typeof this.sessionMemory.getContext !== 'function') return [];
    const ctx = this.sessionMemory.getContext();
    const history = (ctx.conversationHistory || []).slice(-limit);
    const out = history.map((h) => ({ role: h.role || 'user', content: h.text || h.content || '' }));
    if (includeSystem) {
      out.unshift({ role: 'system', content: 'You are a local executive operating system assistant. Be concise and fact-based.' });
    }
    return out;
  }

  currentFocus() {
    if (!this.sessionMemory || typeof this.sessionMemory.getContext !== 'function') return null;
    return this.sessionMemory.getContext().focus || null;
  }
}

module.exports = ConversationContext;

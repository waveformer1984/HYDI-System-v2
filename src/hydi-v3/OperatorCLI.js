'use strict';

const BriefingRenderer = require('./BriefingRenderer');

const BANNER = [
  'ProtoForge Executive Cockpit',
  'Type "good morning" for the full executive briefing, "help" for commands, "exit" to quit.',
].join('\n');

const EXIT_PATTERN = /^(exit|quit|bye|:q)$/;
const BRIEFING_PATTERN = /^(good morning|morning|briefing|brief|full briefing)$/;

/**
 * OperatorCLI holds the CLI's logic with no I/O, so it can be unit-tested
 * without spawning a terminal. scripts/operator-cli.js is a thin readline
 * wrapper around this class.
 *
 * The CLI adds exactly two intents on top of ExecutiveCockpit.parseCommand:
 * `exit` (terminal-only concern) and `briefing` (the full multi-section
 * ExecutiveOperatingSystem briefing rather than the cockpit's short summary).
 * Everything else is delegated to the cockpit so the CLI cannot develop its own
 * parallel command vocabulary.
 */
class OperatorCLI {
  constructor(session, options = {}) {
    if (!session) throw new Error('OperatorCLI requires an OperatorSession');
    this.session = session;
    this.colour = options.colour !== false;
    this.banner = options.banner || BANNER;
  }

  /**
   * Classify raw operator input.
   * @returns {{intent: 'exit'|'briefing'|'empty'|'cockpit', text: string}}
   */
  parse(input) {
    const text = String(input === undefined || input === null ? '' : input).trim();
    const normalized = text.toLowerCase().replace(/[.!?]+$/, '');
    if (normalized === '') return { intent: 'empty', text };
    if (EXIT_PATTERN.test(normalized)) return { intent: 'exit', text };
    if (BRIEFING_PATTERN.test(normalized)) return { intent: 'briefing', text };
    return { intent: 'cockpit', text };
  }

  /**
   * Handle one line of operator input.
   * @returns {Promise<{output: string, done: boolean, intent: string}>}
   */
  async handle(input) {
    const parsed = this.parse(input);

    if (parsed.intent === 'empty') {
      return { output: '', done: false, intent: parsed.intent };
    }
    if (parsed.intent === 'exit') {
      return { output: 'Shutting down cockpit.', done: true, intent: parsed.intent };
    }

    try {
      if (parsed.intent === 'briefing') {
        const briefing = this.session.briefing();
        const output = this.colour
          ? BriefingRenderer.toAnsi(briefing)
          : BriefingRenderer.toText(briefing);
        return { output, done: false, intent: parsed.intent };
      }

      const response = await this.session.ask(parsed.text);
      return {
        output: (response && response.text) || 'No response.',
        done: false,
        intent: parsed.intent,
        response,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { output: `Error: ${message}`, done: false, intent: parsed.intent, error: message };
    }
  }
}

module.exports = OperatorCLI;
module.exports.BANNER = BANNER;

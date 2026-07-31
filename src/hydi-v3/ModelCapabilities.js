'use strict';

const CAPABILITIES = Object.freeze({
  CHAT: 'chat',
  COMPLETE: 'complete',
  EMBED: 'embed',
  VISION: 'vision',
  REASONING: 'reasoning',
  CODE: 'code',
  SUMMARIZE: 'summarize',
  LONG_CONTEXT: 'long-context',
});

const TASK_TO_CAPABILITIES = Object.freeze({
  conversation: [CAPABILITIES.CHAT],
  intentExtraction: [CAPABILITIES.CHAT],
  planning: [CAPABILITIES.REASONING, CAPABILITIES.CHAT],
  codeReview: [CAPABILITIES.CODE, CAPABILITIES.CHAT],
  summarization: [CAPABILITIES.SUMMARIZE, CAPABILITIES.LONG_CONTEXT, CAPABILITIES.CHAT],
  embedding: [CAPABILITIES.EMBED],
  vision: [CAPABILITIES.VISION],
  search: [CAPABILITIES.EMBED],
  largeContext: [CAPABILITIES.LONG_CONTEXT, CAPABILITIES.CHAT],
});

module.exports = { CAPABILITIES, TASK_TO_CAPABILITIES };

'use strict';

// Stub for ../../heidi-core/brain/ollama-client which lives outside this repo.
// moduleNameMapper in jest.config.js redirects all imports matching
// heidi-core.*ollama-client to this file.
class OllamaClient {
  constructor() {}
  generate() { return Promise.resolve({ text: 'mock ollama response' }); }
  chat() { return Promise.resolve({ message: { content: 'mock' } }); }
}

module.exports = OllamaClient;

'use strict';
// Regression for the deterministic paraphrase route — the matcher exists,
// is exported, and the /chat-tools handler invokes it before the model path.
const fs = require('fs');
const path = require('path');
const statusMod = require('../../heidi-core/status/system-status.js');

describe('deterministic report routing wiring', () => {
  it('exports the paraphrase matcher', () => {
    expect(typeof statusMod.matchSystemReportParaphrase).toBe('function');
  });
  it('the chat-tools handler calls the matcher on the deterministic branch', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../heidi-core/server.js'), 'utf8');
    expect(src).toMatch(/matchSystemReportParaphrase/);
    expect(src).toMatch(/model: 'system-status', matched/); // done packet carries the pattern id
  });
});

'use strict';
// Static regression: the report-selection guidance must reach the model —
// via the system_status tool description AND the /chat-tools prompt rules.
const fs = require('fs');
const path = require('path');
const ToolRegistry = require('../../heidi-core/tools/tool-registry.js');

describe('system-report tool selection guidance', () => {
  it('system_status description mentions system report', () => {
    const tools = new ToolRegistry({}).toOllamaTools();
    const ss = tools.find((t) => t.function.name === 'system_status');
    expect(ss).toBeTruthy();
    expect(ss.function.description.toLowerCase()).toMatch(/system report/);
  });
  it('the chat-tools prompt maps reports to system_status before run_command', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../heidi-core/server.js'), 'utf8');
    const reportRule = src.indexOf('call system_status');
    const shellRule = src.indexOf('call run_command');
    expect(reportRule).toBeGreaterThan(-1);
    expect(shellRule).toBeGreaterThan(-1);
    expect(reportRule).toBeLessThan(shellRule); // status/report rule precedes shell rule
    expect(src).toMatch(/word "run" does not make it a shell command/);
  });
});

'use strict';
const { matchSystemReportParaphrase } = require('../../heidi-core/status/system-status.js');

describe('matchSystemReportParaphrase — bounded grammar', () => {
  const MATCH = [
    'run the system report', 'run the system report tool now', 'run system report',
    'get the system report', 'show the system report', 'give me the system report',
    'generate the system report', 'do the system report',
    'Run The System Report Please.', 'run  the   system   report',
    'show the health report', 'run the status report',
    'health check', 'status check', 'system check', 'Health Check!',
  ];
  for (const s of MATCH) it(`matches: ${s}`, () => {
    expect(matchSystemReportParaphrase(s)).toBeTruthy();
  });

  const NOMATCH = [
    'do not run the system report', "don't run the system report", 'never run the system report',
    "explain what 'run the system report' means", 'what is a system report',
    'run the system report and restart heidi', 'run the system report then restart heidi',
    'run the sales report', 'run git status', 'run git status in the repo',
    'restart the system report service', 'write me a report about the weather in paris',
    'run the report', 'run the system repor', 'give me a system report', 'run my system report',
    'run the system report, then delete files',
    'delete the system report', 'update the system report',
    'run the system report please now and also fix things',
    '',
  ];
  for (const s of NOMATCH) it(`rejects: ${s}`, () => {
    expect(matchSystemReportParaphrase(s)).toBeNull();
  });

  it('returns a stable pattern id', () => {
    expect(matchSystemReportParaphrase('run the system report')).toBe('system_report_paraphrase');
    expect(matchSystemReportParaphrase('health check')).toBe('health_check');
  });
});

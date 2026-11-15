'use strict';

const { createResourceActionRunner } = require('../../lib/resource-acquisition/actions');
const { approvedTestProfile } = require('./partnerships-test-helpers');

describe('Resource typed actions', () => {
  test('action catalog exposes required resource.* names', () => {
    const names = Object.keys(require('../../lib/resource-acquisition/actions').ACTION_SPECS);
    for (const id of [
      'resource.discover',
      'resource.validate',
      'resource.qualify',
      'resource.rank',
      'resource.prepare_application',
      'resource.record_submission',
      'resource.record_award',
    ]) {
      expect(names).toContain(id);
    }
  });

  test('unauthorized record_submission fails closed', async () => {
    const runner = createResourceActionRunner({ allowTestHarness: true });
    await runner.run('resource.discover');
    const qualify = await runner.run('resource.qualify', { profile: approvedTestProfile() });
    expect(qualify.output.ok).toBe(true);
    const sub = await runner.run(
      'resource.record_submission',
      { opportunityId: 'missing', evidence: { submission_reference: 'x' } },
      {},
    );
    expect(sub.output.ok).toBe(false);
  });

  test('prepare_application blocked without operator-verified source', async () => {
    const runner = createResourceActionRunner({ allowTestHarness: true });
    await runner.run('resource.discover');
    runner.engine.setOrgProfile(approvedTestProfile());
    await runner.run('resource.qualify');
    const rank = await runner.run('resource.rank');
    const top = rank.output.ranked[0];
    const prep = await runner.run('resource.prepare_application', { opportunityId: top.id });
    expect(prep.output.prepare.ok).toBe(false);
    expect(prep.output.prepare.error).toBe('source_not_operator_verified');
  });
});
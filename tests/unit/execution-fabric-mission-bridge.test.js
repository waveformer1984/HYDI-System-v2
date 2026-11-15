'use strict';

const {
  missionStateToFabric,
  fabricStateToMission,
  describeUnifiedLifecycle,
} = require('../../lib/execution-fabric/mission-bridge');

describe('execution-fabric mission-bridge', () => {
  it('maps mission awaiting_approval to fabric AWAITING_APPROVAL', () => {
    expect(missionStateToFabric('awaiting_approval')).toBe('AWAITING_APPROVAL');
  });

  it('round-trips common states', () => {
    expect(fabricStateToMission(missionStateToFabric('verifying'))).toBe('verifying');
  });

  it('describeUnifiedLifecycle exposes public alias', () => {
    const d = describeUnifiedLifecycle({ status: 'running', source: 'mission' });
    expect(d.fabric_state).toBe('RUNNING');
    expect(d.mission_state).toBe('running');
    expect(d.fabric_public).toBe('running');
  });
});
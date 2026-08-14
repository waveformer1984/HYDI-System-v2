/**
 * HEIDI Operational Control Plane — Task State Machine
 */

const VALID_STATES = [
  'PROPOSED',
  'VALIDATING',
  'AWAITING_APPROVAL',
  'AUTHORIZED',
  'EXECUTING',
  'VERIFYING',
  'COMPLETED',
  'FAILED',
  'RECOVERY',
  'CANCELLED',
];

const ALLOWED_TRANSITIONS = {
  PROPOSED: ['VALIDATING', 'CANCELLED'],
  VALIDATING: ['AWAITING_APPROVAL', 'AUTHORIZED', 'FAILED', 'CANCELLED'],
  AWAITING_APPROVAL: ['AUTHORIZED', 'CANCELLED', 'FAILED'],
  AUTHORIZED: ['EXECUTING', 'CANCELLED'],
  EXECUTING: ['VERIFYING', 'FAILED', 'RECOVERY'],
  VERIFYING: ['COMPLETED', 'FAILED', 'RECOVERY'],
  RECOVERY: ['EXECUTING', 'FAILED', 'CANCELLED'],
  COMPLETED: [],
  FAILED: ['RECOVERY', 'CANCELLED'],
  CANCELLED: [],
};

class TaskStateMachine {
  static isValid(state) {
    return VALID_STATES.includes(state);
  }

  static canTransition(from, to) {
    return TaskStateMachine.isValid(from)
      && TaskStateMachine.isValid(to)
      && ALLOWED_TRANSITIONS[from].includes(to);
  }

  transition(task, to) {
    const from = task.state;
    if (!TaskStateMachine.isValid(from)) throw new Error(`Invalid source state: ${from}`);
    if (!TaskStateMachine.isValid(to)) throw new Error(`Invalid target state: ${to}`);
    if (!ALLOWED_TRANSITIONS[from].includes(to)) {
      throw new Error(`Illegal transition: ${from} -> ${to}`);
    }
    task.state = to;
    if (!task.history) task.history = [];
    task.history.push({ from, to, at: Date.now() });
    return task;
  }

  getAllowedTransitions(state) {
    return ALLOWED_TRANSITIONS[state] || [];
  }
}

module.exports = { TaskStateMachine, VALID_STATES };

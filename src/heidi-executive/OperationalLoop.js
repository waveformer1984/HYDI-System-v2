/**
 * HEIDI Operational Loop — Bounded live decision/execution cycles.
 */

const fs = require('fs');
const path = require('path');

class OperationalLoop {
  constructor(executive, options = {}) {
    this.executive = executive;
    this.reportDir = options.reportDir || path.join(process.cwd(), 'reports', 'phase13');
    this.cycleIntervalMs = options.cycleIntervalMs || 30000;
    this.maxCycles = options.maxCycles || 120;
    this.maxActionsPerCycle = options.maxActionsPerCycle || 2;
    this.missionTimeoutMs = options.missionTimeoutMs || 300000;
    this.emergencyStop = false;
    this.cycles = [];
    this.actionsTaken = 0;
    fs.mkdirSync(this.reportDir, { recursive: true });
  }

  stop() {
    this.emergencyStop = true;
  }

  async run(mode = 'DECISION_ONLY', durationMs = 0) {
    this.emergencyStop = false;
    const start = Date.now();
    let cycle = 0;

    while (cycle < this.maxCycles) {
      if (this.emergencyStop) {
        this.cycles.push({ cycle, status: 'STOPPED_BY_OPERATOR' });
        break;
      }
      if (durationMs > 0 && Date.now() - start > durationMs) {
        this.cycles.push({ cycle, status: 'DURATION_REACHED' });
        break;
      }

      const cycleId = `cycle-${Date.now()}`;
      const result = await this.executive.operationalCycle(mode, { cycleId });

      if (mode === 'CONTROLLED' || mode === 'AUTONOMY') {
        const executed = result.decisions.filter(d => d.execution_result && d.execution_result.status === 'COMPLETED').length;
        this.actionsTaken += executed;
        if (executed > this.maxActionsPerCycle) {
          this.cycles.push({ ...result, status: 'MAX_ACTIONS_EXCEEDED' });
          break;
        }
      }

      this.cycles.push(result);
      cycle++;

      const file = path.join(this.reportDir, `operational-loop-${mode}.jsonl`);
      fs.appendFileSync(file, JSON.stringify(result) + '\n');

      if (this.cycleIntervalMs > 0 && cycle < this.maxCycles) {
        await this.sleep(this.cycleIntervalMs);
      }
    }

    const summary = {
      mode,
      startedAt: new Date(start).toISOString(),
      endedAt: new Date().toISOString(),
      cycles: this.cycles.length,
      actionsTaken: this.actionsTaken,
      escalations: this.cycles.filter(c => c.escalation).length,
      healthyCycles: this.cycles.filter(c => c.finalState && c.finalState.state === 'STABLE').length,
      stopped: this.emergencyStop,
    };

    fs.writeFileSync(path.join(this.reportDir, `operational-loop-${mode}-summary.json`), JSON.stringify(summary, null, 2));
    return { summary, cycles: this.cycles };
  }

  sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
}

module.exports = { OperationalLoop };

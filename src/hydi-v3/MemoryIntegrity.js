'use strict';

const { EventEmitter } = require('events');

/**
 * MemoryIntegrity verifies reflection, mission, agent, task, and conversation memory.
 *
 * It checks for duplicate IDs, corrupted Maps, invalid timestamps, and orphan records,
 * and repairs them where possible. It supports a nightly integrity scan.
 */
class MemoryIntegrity extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      scanIntervalMs: config.scanIntervalMs || 24 * 60 * 60 * 1000,
      ...config,
    };

    this.scanTimer = null;
    this._destroyed = false;
  }

  start() {
    if (this._destroyed) return;
    if (this.scanTimer) return;
    this.scanTimer = setInterval(() => this.runScan(), this.config.scanIntervalMs);
    if (this.scanTimer.unref) this.scanTimer.unref();
  }

  stop() {
    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }
  }

  destroy() {
    this._destroyed = true;
    this.stop();
  }

  async runScan(memoryStores = {}) {
    if (this._destroyed) return null;
    this.emit('scan_started');
    const result = this.verify(memoryStores);
    this.emit('scan_completed', result);
    return result;
  }

  verify(memoryStores = {}) {
    const issues = [];
    const repairs = [];

    this.verifyReflectionMemory(memoryStores, issues, repairs);
    this.verifyMissionMemory(memoryStores, issues, repairs);
    this.verifyAgentMemory(memoryStores, issues, repairs);
    this.verifyTaskMemory(memoryStores, issues, repairs);
    this.verifyConversationMemory(memoryStores, issues, repairs);

    return {
      timestamp: new Date().toISOString(),
      passed: issues.length === 0,
      issueCount: issues.length,
      repairCount: repairs.length,
      issues,
      repairs,
    };
  }

  verifyReflectionMemory(stores, issues, repairs) {
    const reflective = stores.reflectiveMemory;
    if (!reflective) return;

    if (reflective.whatWorked && !(reflective.whatWorked instanceof Map)) {
      issues.push('reflective.whatWorked is not a Map');
      reflective.whatWorked = new Map(Object.entries(reflective.whatWorked));
      repairs.push('rehydrated_reflective_whatWorked');
    }
    if (reflective.whatFailed && !(reflective.whatFailed instanceof Map)) {
      issues.push('reflective.whatFailed is not a Map');
      reflective.whatFailed = new Map(Object.entries(reflective.whatFailed));
      repairs.push('rehydrated_reflective_whatFailed');
    }

    const ids = new Set();
    for (const [key, value] of (reflective.whatWorked || new Map()).entries()) {
      if (ids.has(key)) {
        issues.push(`duplicate_reflection_id:${key}`);
      } else {
        ids.add(key);
      }
      if (!this.isValidTimestamp(value?.timestamp)) {
        issues.push(`invalid_timestamp:whatWorked.${key}`);
      }
    }

    if (!Array.isArray(reflective.confidenceReality)) {
      issues.push('reflective.confidenceReality is not an Array');
      reflective.confidenceReality = [];
      repairs.push('reset_reflective_confidenceReality');
    }
  }

  verifyMissionMemory(stores, issues, repairs) {
    const missions = stores.missions;
    if (!missions) return;

    const missionList = Array.isArray(missions) ? missions : Object.values(missions);
    const ids = new Set();
    for (const mission of missionList) {
      if (!mission.id) {
        issues.push('mission_missing_id');
        continue;
      }
      if (ids.has(mission.id)) {
        issues.push(`duplicate_mission_id:${mission.id}`);
      } else {
        ids.add(mission.id);
      }
      if (!this.isValidTimestamp(mission.createdAt)) {
        issues.push(`invalid_timestamp:mission.${mission.id}`);
      }
      if (mission.tasks && !Array.isArray(mission.tasks) && !(mission.tasks instanceof Map)) {
        issues.push(`mission_tasks_not_map:${mission.id}`);
        mission.tasks = new Map(Object.entries(mission.tasks));
        repairs.push(`rehydrated_mission_tasks:${mission.id}`);
      }
    }
  }

  verifyAgentMemory(stores, issues) {
    const agents = stores.agents;
    if (!agents) return;

    const ids = new Set();
    for (const agent of Array.isArray(agents) ? agents : Object.values(agents)) {
      if (!agent.id) {
        issues.push('agent_missing_id');
        continue;
      }
      if (ids.has(agent.id)) {
        issues.push(`duplicate_agent_id:${agent.id}`);
      } else {
        ids.add(agent.id);
      }
      if (!this.isValidTimestamp(agent.lastHeartbeat) && !this.isValidTimestamp(agent.createdAt)) {
        issues.push(`invalid_timestamp:agent.${agent.id}`);
      }
    }
  }

  verifyTaskMemory(stores, issues) {
    const tasks = stores.tasks;
    if (!tasks) return;

    const ids = new Set();
    const missionIds = stores.missionIds ? new Set(stores.missionIds) : null;
    for (const task of Array.isArray(tasks) ? tasks : Object.values(tasks)) {
      if (!task.id) {
        issues.push('task_missing_id');
        continue;
      }
      if (ids.has(task.id)) {
        issues.push(`duplicate_task_id:${task.id}`);
      } else {
        ids.add(task.id);
      }
      if (missionIds && task.missionId && !missionIds.has(task.missionId)) {
        issues.push(`orphan_task:${task.id}`);
      }
      if (!this.isValidTimestamp(task.createdAt)) {
        issues.push(`invalid_timestamp:task.${task.id}`);
      }
    }
  }

  verifyConversationMemory(stores, issues) {
    const conversations = stores.conversations;
    if (!conversations) return;

    const ids = new Set();
    for (const conv of Array.isArray(conversations) ? conversations : Object.values(conversations)) {
      if (!conv.id) {
        issues.push('conversation_missing_id');
        continue;
      }
      if (ids.has(conv.id)) {
        issues.push(`duplicate_conversation_id:${conv.id}`);
      } else {
        ids.add(conv.id);
      }
      if (!this.isValidTimestamp(conv.timestamp) && !this.isValidTimestamp(conv.createdAt)) {
        issues.push(`invalid_timestamp:conversation.${conv.id}`);
      }
    }
  }

  isValidTimestamp(value) {
    if (value === null || value === undefined) return true; // optional
    if (value instanceof Date) return true;
    if (typeof value === 'number') return value > 0 && value < 8640000000000000;
    const parsed = new Date(value).getTime();
    return !isNaN(parsed) && parsed > 0;
  }

  getStatus() {
    return {
      scanning: this.scanTimer !== null,
      intervalMs: this.config.scanIntervalMs,
    };
  }
}

module.exports = MemoryIntegrity;

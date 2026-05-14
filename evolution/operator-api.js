/**
 * Operator API — Your Unified Command Center
 *
 * One Express router that gives the operator (you) a single interface
 * to command, query, and direct the entire system.
 *
 * Mount in any Express app:
 *   const { createOperatorRouter } = require('./evolution/operator-api');
 *   app.use('/nexus', createOperatorRouter({ nexus, goalEngine, forecast }));
 *
 * Endpoints:
 *   GET  /nexus/brief           — Plain-English system status
 *   GET  /nexus/status          — Full JSON system state
 *   GET  /nexus/agents          — Registered agents and liveness
 *   POST /nexus/goal            — Set a goal for Heidi { objective, priority? }
 *   GET  /nexus/goals           — All goals and task progress
 *   GET  /nexus/goals/:id       — Single goal detail
 *   POST /nexus/goals/:id/task  — Complete/fail a task { taskId, status, result? }
 *   GET  /nexus/forecast        — Ursula's 6-hour prediction
 *   GET  /nexus/health          — Current health alerts
 *   POST /nexus/health/record   — Push a health snapshot { metrics }
 *   POST /nexus/command         — Route a command to an agent { agent, action, payload? }
 *   GET  /nexus/messages        — Recent inter-agent message log
 */

const express = require('express');

function createOperatorRouter({ nexus, goalEngine, forecast } = {}) {
  const router = express.Router();

  // ─── Brief ──────────────────────────────────────────────────────────────

  router.get('/brief', async (req, res) => {
    try {
      const agentBriefs = {};
      if (goalEngine) agentBriefs['heidi'] = goalEngine.getSummary();
      if (forecast) agentBriefs['ursula'] = forecast.generateBriefing();
      const brief = nexus
        ? nexus.getSystemBrief(agentBriefs)
        : Object.entries(agentBriefs).map(([k, v]) => `[${k}] ${v}`).join('\n\n');
      res.type('text/plain').send(brief);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Status ─────────────────────────────────────────────────────────────

  router.get('/status', (req, res) => {
    try {
      res.json({
        nexus: nexus ? nexus.getFullStatus() : null,
        goals: goalEngine ? { active: goalEngine.getActiveGoals().length, all: goalEngine.getAllGoals().length } : null,
        health: forecast ? forecast.getSnapshot() : null,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Agents ─────────────────────────────────────────────────────────────

  router.get('/agents', (req, res) => {
    if (!nexus) return res.status(503).json({ error: 'Nexus not connected' });
    res.json(nexus.getAllAgentStatuses());
  });

  // ─── Goals ──────────────────────────────────────────────────────────────

  router.post('/goal', async (req, res) => {
    if (!goalEngine) return res.status(503).json({ error: 'Goal engine not connected' });
    const { objective, priority } = req.body || {};
    if (!objective || typeof objective !== 'string' || !objective.trim()) {
      return res.status(400).json({ error: 'objective is required' });
    }
    try {
      const goal = await goalEngine.addGoal(objective.trim(), priority || 'normal');
      if (nexus) nexus.send('operator', 'heidi', 'goal:added', { goalId: goal.id, objective });
      res.status(201).json(goal);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/goals', (req, res) => {
    if (!goalEngine) return res.status(503).json({ error: 'Goal engine not connected' });
    const { status } = req.query;
    const goals = status
      ? goalEngine.getAllGoals().filter(g => g.status === status)
      : goalEngine.getAllGoals();
    res.json({ goals, summary: goalEngine.getSummary() });
  });

  router.get('/goals/:id', (req, res) => {
    if (!goalEngine) return res.status(503).json({ error: 'Goal engine not connected' });
    const goal = goalEngine.getGoal(req.params.id);
    if (!goal) return res.status(404).json({ error: 'Goal not found' });
    res.json(goal);
  });

  router.post('/goals/:id/task', (req, res) => {
    if (!goalEngine) return res.status(503).json({ error: 'Goal engine not connected' });
    const { taskId, status, result, reason } = req.body || {};
    if (!taskId) return res.status(400).json({ error: 'taskId is required' });
    try {
      let goal;
      if (status === 'failed') {
        goal = goalEngine.failTask(req.params.id, taskId, reason || 'unspecified');
      } else {
        goal = goalEngine.completeTask(req.params.id, taskId, result || {});
      }
      if (nexus) nexus.send('operator', 'heidi', 'goal:task_updated', { goalId: req.params.id, taskId, status });
      res.json(goal);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // ─── Forecast & Health ───────────────────────────────────────────────────

  router.get('/forecast', (req, res) => {
    if (!forecast) return res.status(503).json({ error: 'Forecast engine not connected' });
    const hours = Math.min(parseInt(req.query.hours) || 6, 48);
    res.json({
      hoursAhead: hours,
      predictions: forecast.forecast(hours),
      proactiveAlerts: forecast.getProactiveAlerts(hours),
      briefing: forecast.generateBriefing(),
    });
  });

  router.get('/health', (req, res) => {
    if (!forecast) return res.status(503).json({ error: 'Forecast engine not connected' });
    res.json({
      currentAlerts: forecast.getCurrentAlerts(),
      snapshot: forecast.getSnapshot(),
    });
  });

  router.post('/health/record', (req, res) => {
    if (!forecast) return res.status(503).json({ error: 'Forecast engine not connected' });
    const { metrics } = req.body || {};
    if (!metrics || typeof metrics !== 'object') {
      return res.status(400).json({ error: 'metrics object is required' });
    }
    forecast.record(metrics);
    if (nexus) nexus.send('ursula', '*', 'health:snapshot', { metrics });
    res.json({ recorded: true, dataPoints: forecast.snapshots.length });
  });

  // ─── Command ────────────────────────────────────────────────────────────

  router.post('/command', (req, res) => {
    if (!nexus) return res.status(503).json({ error: 'Nexus not connected' });
    const { agent, action, payload } = req.body || {};
    if (!agent || !action) {
      return res.status(400).json({ error: 'agent and action are required' });
    }
    const msg = nexus.send('operator', agent, action, payload || {});
    res.json({ sent: true, message: msg });
  });

  // ─── Message Log ─────────────────────────────────────────────────────────

  router.get('/messages', (req, res) => {
    if (!nexus) return res.status(503).json({ error: 'Nexus not connected' });
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const messages = nexus.messageLog.slice(-limit);
    res.json({ messages, total: nexus.messageLog.length });
  });

  return router;
}

module.exports = { createOperatorRouter };

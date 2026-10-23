/**
 * HEIDI Operational Decision Engine
 *
 * Bounded operational autonomy: observe → understand → correlate → assess →
 * plan → authorize → execute → verify → record → escalate.
 */

const { OperationalState } = require('./OperationalState');
const { IncidentCorrelator } = require('./IncidentCorrelator');
const { ImpactAssessor } = require('./ImpactAssessor');
const { ActionSelector } = require('./ActionSelector');
const { AutonomyPolicy } = require('./AutonomyPolicy');
const { MissionEngine } = require('./MissionEngine');
const { DecisionRecord } = require('./DecisionRecord');
const { PredictiveIntelligence } = require('./PredictiveIntelligence');
const { MaintenanceMode } = require('./MaintenanceMode');
const { FailureClassifier } = require('./FailureClassifier');

class HeidiDecisionEngine {
  constructor(options = {}) {
    this.registry = options.registry || null;
    this.audit = options.audit || null;
    this.decisions = new DecisionRecord({ dataDir: options.dataDir, redactor: options.redactor });
    this.impact = new ImpactAssessor({ dependencyGraph: options.dependencyGraph });
    this.correlator = new IncidentCorrelator({ dependencyGraph: options.dependencyGraph });
    this.actions = new ActionSelector({ history: options.recoveryHistory || [], registry: this.registry });
    this.dependencyGraph = options.dependencyGraph || {};
    this.policy = new AutonomyPolicy(options.autonomyLevels);
    this.missions = new MissionEngine({ policy: this.policy, audit: this.audit, maxActions: options.maxActions || 10 });
    this.predictive = new PredictiveIntelligence(options.predictive);
    this.maintenance = new MaintenanceMode();
    this.classifier = new FailureClassifier();
    this.state = new OperationalState('STABLE');
    this.escalation = null;
  }

  async decide(observations, candidates, missionOptions = {}) {
    const maintenance = this.maintenance.list();
    const filtered = {};
    for (const [comp, state] of Object.entries(observations)) {
      const m = this.maintenance.isUnderMaintenance(comp);
      if (m.active) {
        this.state.transition('MAINTENANCE', { source: 'maintenance', reason: `component ${comp} under maintenance`, evidence: m.maintenance });
        continue;
      }
      filtered[comp] = state;
    }

    const correlated = this.correlator.correlate(filtered);
    const records = [];

    for (const root of correlated.roots) {
      const impact = this.impact.assess(root.component, root.state, { durationMinutes: 0 });
      const classified = this.classifier.classify(root.state);
      const available = candidates.filter(c => c.allowedComponents.includes(root.component) || c.allowedComponents.includes('*'));
      const ranked = this.actions.select(available, {
        registry: this.registry,
        dependencies: this.dependencyHealth(root.component, observations),
        recentFailures: [],
        maintenance: false,
      });

      const chosenCandidate = ranked.selected ? available.find(c => c.id === ranked.selected.action) : null;
      let selected = null;
      if (chosenCandidate) {
        const auth = this.policy.canExecute(chosenCandidate.capabilityId);
        if (!auth.ok) {
          this.escalation = {
            component: root.component,
            impact,
            reason: `action ${ranked.selected.action} (${chosenCandidate.capabilityId}) requires approval or is forbidden`,
            evidence: ranked,
          };
        } else {
          selected = ranked.selected;
        }
      }

      const authResult = this.policy.canExecute(selected ? selected.action : null);
      const decision = this.decisions.record({
        mission_id: missionOptions.missionId || null,
        incident_id: root.component,
        observations: root.state,
        classification: classified,
        impact,
        candidate_actions: ranked.alternatives,
        selected_action: selected,
        policy_result: authResult,
        authorization_result: selected ? 'AUTO' : 'ESCALATE',
        confidence: classified.confidence,
        final_state: this.state.current().state,
      });
      // Preserve selected action on the returned record even if redaction restructured it.
      decision.selected_action = selected ? {
        action: selected.action,
        capabilityId: chosenCandidate.capabilityId,
        parameters: chosenCandidate.parameters || {},
        score: selected.score,
        reasons: selected.reasons,
      } : null;
      records.push(decision);

      if (selected && chosenCandidate && missionOptions.execute !== false) {
        const mission = {
          id: `mission-${Date.now()}-${root.component}`,
          objective: `recover ${root.component}`,
          steps: [
            { capabilityId: chosenCandidate.capabilityId, parameters: { ...(chosenCandidate.parameters || {}), component: root.component }, verify: true },
          ],
        };
        const result = await this.missions.execute(
          mission,
          async (step) => this._execute(step),
          async (step) => this._verify(step, observations)
        );
        decision.execution_result = result;
        decision.verification_result = result.status === 'SUCCESS';
      }
    }

    return {
      state: this.state.current(),
      correlated,
      decisions: records,
      maintenance,
      escalation: this.escalation,
    };
  }

  setDependencyGraph(graph) {
    this.dependencyGraph = graph || {};
    this.impact.dependencyGraph = this.dependencyGraph;
    this.correlator.dependencyGraph = this.dependencyGraph;
  }

  dependencyHealth(component, observations) {
    const deps = this.dependencyGraph[component] || [];
    const out = {};
    for (const d of deps) {
      out[d] = observations[d]?.status || 'UNKNOWN';
    }
    return out;
  }

  _execute(_step) {
    if (!this.registry || !this.registry.has(_step.capabilityId)) {
      return { status: 'NOOP', reason: 'no executor configured' };
    }
    return { status: 'EXECUTED', capability: _step.capabilityId };
  }

  _verify() {
    return true;
  }
}

module.exports = { HeidiDecisionEngine };

/**
 * Contract validation — the forcing function.
 *
 * This is where "is this capability trustworthy?" stops being a judgment
 * call made at 2am and becomes a schema question answered at registration.
 *
 * The rule that does the work:
 *
 *   A capability that cannot state its own success predicate is capped at
 *   R1 (recommend-only), permanently, regardless of how safe it looks.
 *
 * That cap is not a punishment. It is the honest consequence of not being
 * able to tell whether the thing worked. Anything HYDI cannot check, HYDI
 * can only suggest.
 */

import type { RiskLevel } from '../operational/types';
import type { CapabilityContract } from './types';
import { minTier, tierIndex } from './types';
import { findVacuousConditions } from './Verification';

export type ValidationSeverity = 'error' | 'warning';

export interface ValidationIssue {
  severity: ValidationSeverity;
  code: string;
  message: string;
  /** The tier ceiling this issue imposes, if any. */
  imposesCeiling?: RiskLevel;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  /** The ceiling the contract is allowed to operate under after validation. */
  effectiveMaxTier: RiskLevel;
}

const SEMVER = /^\d+\.\d+\.\d+$/;
const CAPABILITY_ID = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

export function validateContract(contract: CapabilityContract): ValidationResult {
  const issues: ValidationIssue[] = [];
  let ceiling: RiskLevel = contract.maxTier ?? 'R5';

  const impose = (tier: RiskLevel, issue: ValidationIssue): void => {
    issues.push({ ...issue, imposesCeiling: tier });
    ceiling = minTier(ceiling, tier);
  };

  // --- Identity -----------------------------------------------------------
  if (!CAPABILITY_ID.test(contract.identity.id)) {
    issues.push({
      severity: 'error',
      code: 'IDENTITY_ID_FORMAT',
      message: `Capability id "${contract.identity.id}" must be dotted lower_snake, e.g. "process.restart".`,
    });
  }
  if (!SEMVER.test(contract.identity.version)) {
    issues.push({
      severity: 'error',
      code: 'IDENTITY_VERSION',
      message: `Contract version "${contract.identity.version}" must be semver (x.y.z).`,
    });
  }
  if (!contract.identity.owner.trim()) {
    issues.push({
      severity: 'error',
      code: 'IDENTITY_OWNER',
      message: 'Every capability needs an accountable owner. Unowned capabilities rot.',
    });
  }

  // --- Signature ----------------------------------------------------------
  const seen = new Set<string>();
  for (const param of contract.signature.params) {
    if (seen.has(param.name)) {
      issues.push({
        severity: 'error',
        code: 'SIGNATURE_DUPLICATE_PARAM',
        message: `Duplicate parameter "${param.name}".`,
      });
    }
    seen.add(param.name);
    if (param.pattern) {
      try {
        new RegExp(param.pattern);
      } catch {
        issues.push({
          severity: 'error',
          code: 'SIGNATURE_BAD_PATTERN',
          message: `Parameter "${param.name}" has an invalid regex pattern.`,
        });
      }
    }
  }

  // --- Effects ------------------------------------------------------------
  if (contract.effects.length === 0) {
    issues.push({
      severity: 'error',
      code: 'EFFECTS_EMPTY',
      message:
        'A capability with no declared effects cannot have its blast radius computed. ' +
        'A read-only capability should declare a `read` effect, not none.',
    });
  }

  const mutating = contract.effects.filter((e) => e.verb !== 'read');
  for (const effect of mutating) {
    if (effect.resourcePatterns.length === 0) {
      issues.push({
        severity: 'warning',
        code: 'EFFECTS_UNBOUNDED',
        message:
          `Mutating effect "${effect.verb}" on ${effect.resourceKind} declares no resource ` +
          'patterns. It will be treated as system-scope on every invocation.',
      });
    }
  }

  const mutatesResources = mutating.length > 0;
  const hasResourceRef = contract.signature.params.some((p) => p.resourceRef);
  if (mutatesResources && !hasResourceRef) {
    issues.push({
      severity: 'warning',
      code: 'SIGNATURE_NO_RESOURCE_REF',
      message:
        'No parameter is marked `resourceRef`, so blast radius cannot be narrowed by ' +
        'argument. The capability will always be assessed at its declared worst case.',
    });
  }

  // --- Verification: the forcing function ---------------------------------
  if (contract.verification.conditions.length === 0) {
    impose('R1', {
      severity: 'error',
      code: 'VERIFICATION_ABSENT',
      message:
        `${contract.identity.id} declares no verification conditions. ` +
        'Capped at R1 (recommend-only): HYDI can suggest this action but must not ' +
        'perform it autonomously, because it cannot tell whether it worked.',
    });
  } else if (contract.verification.observation.source === 'none') {
    impose('R1', {
      severity: 'error',
      code: 'VERIFICATION_NO_OBSERVATION',
      message:
        `${contract.identity.id} declares conditions but no way to observe them. ` +
        'Capped at R1.',
    });
  }

  const vacuous = findVacuousConditions(contract.verification.conditions);
  for (const problem of vacuous) {
    impose('R1', {
      severity: 'error',
      code: 'VERIFICATION_VACUOUS',
      message: `${contract.identity.id}: ${problem}. A predicate that cannot fail is not a predicate.`,
    });
  }

  if (contract.verification.maxRetries < 0) {
    issues.push({
      severity: 'error',
      code: 'VERIFICATION_RETRIES',
      message: 'maxRetries must be >= 0.',
    });
  }

  // --- Reversibility ------------------------------------------------------
  if (
    contract.reversibility.kind === 'inverse_capability' &&
    !contract.reversibility.inverseCapabilityId
  ) {
    issues.push({
      severity: 'error',
      code: 'REVERSIBILITY_NO_INVERSE',
      message:
        'Reversibility claims an inverse capability but names none. ' +
        'A boolean `reversible: true` with no undo path is the most expensive kind of lie.',
    });
  }

  // --- Cost ---------------------------------------------------------------
  if (contract.cost.timeoutMs <= 0) {
    issues.push({
      severity: 'error',
      code: 'COST_NO_TIMEOUT',
      message: 'timeoutMs must be positive. An action without a timeout can never fail, only hang.',
    });
  }
  if (contract.cost.estimatedMs > contract.cost.timeoutMs) {
    issues.push({
      severity: 'warning',
      code: 'COST_TIMEOUT_TOO_TIGHT',
      message: `estimatedMs (${contract.cost.estimatedMs}) exceeds timeoutMs (${contract.cost.timeoutMs}).`,
    });
  }

  // --- Physical safety ----------------------------------------------------
  const physical = contract.effects.filter((e) => e.resourceKind === 'physical_machine');
  if (physical.length > 0) {
    const independent = contract.interlocks.filter((i) => i.mechanism !== 'software_only');
    if (independent.length === 0) {
      impose('R1', {
        severity: 'error',
        code: 'SAFETY_NO_INDEPENDENT_INTERLOCK',
        message:
          `${contract.identity.id} actuates a physical machine but declares no interlock ` +
          'that holds independently of this software. Software watches; hardware stops. ' +
          'Capped at R1 until an independent interlock is declared.',
      });
    }
    const softwareOnly = contract.interlocks.filter((i) => i.mechanism === 'software_only');
    if (softwareOnly.length > 0 && independent.length === 0) {
      issues.push({
        severity: 'warning',
        code: 'SAFETY_SOFTWARE_ONLY_INTERLOCK',
        message:
          'Software-only interlocks do not hold when HYDI is crashed, wedged, or ' +
          'confidently wrong — which is exactly when they are needed.',
      });
    }
  }

  // --- Money --------------------------------------------------------------
  const money = contract.effects.filter(
    (e) => e.resourceKind === 'money' || e.verb === 'transact',
  );
  if (money.length > 0 && tierIndex(ceiling) < tierIndex('R4')) {
    issues.push({
      severity: 'warning',
      code: 'MONEY_LOW_CEILING',
      message:
        `${contract.identity.id} moves money but carries a ceiling of ${ceiling}. ` +
        'Confirm this is intentional.',
    });
  }

  // --- Simulation ---------------------------------------------------------
  if (!contract.simulation.supported && !contract.simulation.unsupportedReason) {
    issues.push({
      severity: 'warning',
      code: 'SIMULATION_UNEXPLAINED',
      message:
        'Simulation is unsupported and no reason is given. The planner cannot explain ' +
        'to a human why it could not dry-run the action.',
    });
  }
  if (contract.simulation.supported && !contract.simulation.dryRun) {
    issues.push({
      severity: 'error',
      code: 'SIMULATION_MISSING_FN',
      message: 'simulation.supported is true but no dryRun function is provided.',
    });
  }

  // --- Observability ------------------------------------------------------
  if (!contract.observability.eventType.trim()) {
    issues.push({
      severity: 'error',
      code: 'OBSERVABILITY_NO_EVENT',
      message: 'Every capability must emit a named event type to the journal.',
    });
  }
  const secretish = contract.signature.params.filter((p) =>
    /password|secret|token|key|credential/i.test(p.name),
  );
  for (const param of secretish) {
    if (contract.observability.redactParams.indexOf(param.name) === -1) {
      issues.push({
        severity: 'error',
        code: 'OBSERVABILITY_UNREDACTED_SECRET',
        message: `Parameter "${param.name}" looks like secret material but is not in redactParams.`,
      });
    }
  }

  const errors = issues.filter((i) => i.severity === 'error');
  return {
    valid: errors.length === 0,
    issues,
    effectiveMaxTier: ceiling,
  };
}

export function formatValidation(
  contract: CapabilityContract,
  result: ValidationResult,
): string {
  const lines: string[] = [
    `${contract.identity.id}@${contract.identity.version} — ${result.valid ? 'VALID' : 'INVALID'} (ceiling ${result.effectiveMaxTier})`,
  ];
  for (const issue of result.issues) {
    const tag = issue.severity === 'error' ? 'ERROR' : 'WARN ';
    const cap = issue.imposesCeiling ? ` [caps at ${issue.imposesCeiling}]` : '';
    lines.push(`  ${tag} ${issue.code}${cap}: ${issue.message}`);
  }
  return lines.join('\n');
}

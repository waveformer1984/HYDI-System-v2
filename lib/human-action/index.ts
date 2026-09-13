/**
 * HYDI Human Action Engine — Module Index
 *
 * Public API for the Human Action Engine subsystem.
 */

// Types
export type {
  ActionCategory,
  AuthorizationScope,
  ActionState,
  LifecycleCapability,
  HumanActionIntent,
  ActionParameters,
  HumanAction,
  ActionRiskLabel,
  Reversibility,
  AuthorizationMode,
  RetryPolicy,
  RollbackStrategy,
  VerificationStrategy,
  HumanActionResult,
  ActionEvidence,
  RollbackResult,
  HumanInterventionRequest,
  InterventionType,
  HumanGoal,
  ActionGraph,
  ActionGraphNode,
  ActionGraphEdge,
  ActionJournalEntry,
  ActionCapabilityDescriptor,
  ActionCapabilityStatus,
  TargetPattern,
  ActionAdapter,
  ActionExecutionContext,
  ActionExecutionResult,
  ActionVerificationResult,
  ActionObservation,
  ActionPolicyEvaluation,
} from './HumanActionTypes';

// Core engine
export { HumanActionEngine, riskLevelToLabel, createHumanActionEngine } from './HumanActionEngine';
export type { HumanActionEngineOptions } from './HumanActionEngine';

// Capability registry
export {
  ActionCapabilityRegistry,
  createDefaultActionCapabilityRegistry,
  SYSTEM_CAPABILITIES,
  NETWORK_CAPABILITIES,
  BROWSER_CAPABILITIES,
  DEVELOPMENT_CAPABILITIES,
  INFRASTRUCTURE_CAPABILITIES,
  CREDENTIAL_CAPABILITIES,
  COMMUNICATION_CAPABILITIES,
  FINANCIAL_CAPABILITIES,
} from './ActionCapabilityRegistry';
export type { CapabilityDefinition } from './ActionCapabilityRegistry';

// Authority
export {
  AuthorityManager,
  STRICT_CONFIRMATION,
  BALANCED_CONFIRMATION,
  PERMISSIVE_CONFIRMATION,
  createOwnerAuthority,
} from './AuthorityManager';
export type {
  DelegatedAuthority,
  ResourcePattern,
  TimeConstraint,
  ConfirmationPolicy,
  AuthorizationCheckResult,
} from './AuthorityManager';

// Journal
export { ActionJournal, redactParameters, createActionJournal } from './ActionJournal';

// Goal decomposer
export { GoalDecomposer } from './GoalDecomposer';

// Bridge
export { createHumanActionBridge } from './HumanActionBridge';
export type { HumanActionBridge } from './HumanActionBridge';

// Adapters
export { FilesystemAdapter } from './adapters/FilesystemAdapter';
export { ProcessAdapter } from './adapters/ProcessAdapter';
export { HttpAdapter } from './adapters/HttpAdapter';
export { BrowserAdapter } from './adapters/BrowserAdapter';
export { DevelopmentAdapter } from './adapters/DevelopmentAdapter';
export { InfrastructureAdapter } from './adapters/InfrastructureAdapter';
export { CredentialAdapter } from './adapters/CredentialAdapter';
export type { CredentialAdapterDeps } from './adapters/CredentialAdapter';
export { CommunicationAdapter } from './adapters/CommunicationAdapter';
export type { CommunicationAdapterDeps } from './adapters/CommunicationAdapter';

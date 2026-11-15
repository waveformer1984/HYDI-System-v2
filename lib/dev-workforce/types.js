'use strict';

/** Typed dev-workforce agent roles (mission Agent 07). */
const AGENT_ROLES = Object.freeze({
  CHIEF_ARCHITECT: 'chief_architect',
  SOFTWARE_ENGINEER: 'software_engineer',
  SECURITY_ENGINEER: 'security_engineer',
  RESEARCH_ANALYST: 'research_analyst',
  BUSINESS_DEVELOPMENT: 'business_development',
  FINANCE_ANALYST: 'finance_analyst',
  FREELANCE_DISCOVERY: 'freelance_discovery',
  QUALITY_ASSURANCE: 'quality_assurance',
  INFRASTRUCTURE: 'infrastructure_engineer',
  OPERATIONS: 'operations_manager',
  DOCUMENTATION: 'documentation_engineer',
  EXECUTIVE_ORCHESTRATOR: 'executive_orchestrator',
});

/** Capability permissions — not full system access. */
const PERMISSIONS = Object.freeze({
  FABRIC_SUBMIT: 'fabric:submit',
  FABRIC_CONTROL: 'fabric:control',
  STATUS_VIEW: 'status:view',
  OPS_DIAGNOSTICS: 'ops:diagnostics',
  REVENUE_READ: 'revenue:read',
  EXTERNAL_DRAFT: 'external:draft',
});

const DEFAULT_ROLE_PERMISSIONS = Object.freeze({
  [AGENT_ROLES.EXECUTIVE_ORCHESTRATOR]: [PERMISSIONS.STATUS_VIEW, PERMISSIONS.FABRIC_CONTROL],
  [AGENT_ROLES.SOFTWARE_ENGINEER]: [PERMISSIONS.FABRIC_SUBMIT, PERMISSIONS.OPS_DIAGNOSTICS],
  [AGENT_ROLES.SECURITY_ENGINEER]: [PERMISSIONS.STATUS_VIEW, PERMISSIONS.OPS_DIAGNOSTICS],
  [AGENT_ROLES.QUALITY_ASSURANCE]: [PERMISSIONS.FABRIC_SUBMIT, PERMISSIONS.OPS_DIAGNOSTICS],
  [AGENT_ROLES.FREELANCE_DISCOVERY]: [PERMISSIONS.REVENUE_READ, PERMISSIONS.EXTERNAL_DRAFT],
  [AGENT_ROLES.DOCUMENTATION]: [PERMISSIONS.STATUS_VIEW],
});

module.exports = { AGENT_ROLES, PERMISSIONS, DEFAULT_ROLE_PERMISSIONS };
/**
 * IRREVERSIBILITY TAGGING
 * 
 * Every action must declare its risk profile upfront
 */

export interface ActionTags {
  reversibility: 'reversible' | 'irreversible' | 'partially_reversible';
  scope: 'local' | 'external' | 'mixed';
  financial: 'financial' | 'non_financial';
  identity: 'identity_impacting' | 'identity_safe';
  data: 'data_reading' | 'data_writing' | 'data_modifying' | 'data_destructive';
  permissions: 'read_only' | 'write_only' | 'admin_only' | 'user_only';
}

export interface ActionDeclaration {
  action: string;
  tags: ActionTags;
  description: string;
  rollbackPlan?: string;
  simulationAvailable: boolean;
}

export function validateActionDeclaration(declaration: ActionDeclaration): {
  valid: boolean;
  violations: string[];
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
} {
  const violations: string[] = [];
  const { tags } = declaration;
  
  // Critical combinations that require extra scrutiny
  if (tags.reversibility === 'irreversible' && tags.financial === 'financial') {
    violations.push('Irreversible financial action - requires human approval');
  }
  
  if (tags.scope === 'external' && tags.data === 'data_destructive') {
    violations.push('External destructive data action - requires sandbox');
  }
  
  if (tags.identity === 'identity_impacting' && tags.permissions !== 'admin_only') {
    violations.push('Identity impact requires admin permissions');
  }
  
  if (tags.reversibility === 'irreversible' && !declaration.rollbackPlan) {
    violations.push('Irreversible actions must have rollback plan');
  }
  
  // Calculate risk level
  let riskLevel: 'low' | 'medium' | 'high' | 'critical' = 'low';
  
  if (tags.reversibility === 'irreversible') riskLevel = 'high';
  if (tags.financial === 'financial') riskLevel = 'high';
  if (tags.scope === 'external') riskLevel = 'medium';
  if (tags.data === 'data_destructive') riskLevel = 'critical';
  if (tags.identity === 'identity_impacting') riskLevel = 'high';
  
  // Escalate for combinations
  if (violations.length > 0) riskLevel = 'critical';
  
  return {
    valid: violations.length === 0,
    violations,
    riskLevel
  };
}

export function createStandardActionDeclaration(
  action: string,
  tags: Partial<ActionTags>,
  description: string,
  rollbackPlan?: string
): ActionDeclaration {
  const defaultTags: ActionTags = {
    reversibility: 'reversible',
    scope: 'local',
    financial: 'non_financial',
    identity: 'identity_safe',
    data: 'data_reading',
    permissions: 'read_only'
  };
  
  return {
    action,
    tags: { ...defaultTags, ...tags },
    description,
    rollbackPlan,
    simulationAvailable: true
  };
}

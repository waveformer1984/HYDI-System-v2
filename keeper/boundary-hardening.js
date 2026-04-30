// KEEPER Boundary Hardening - LLM Enforcement & Circuit Override Handling
const { createClient } = require('@supabase/supabase-js');

class KeeperBoundaryHardening {
  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL || 'https://akbnfovjdcobifeupvbn.supabase.co',
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
  }

  // LLM Sensitive Data Enforcement
  sanitizeLLMResponse(response, context = {}) {
    console.log('🧹 LLM Sensitive Data Enforcement');
    
    if (!response || typeof response !== 'object') {
      return response;
    }

    const sensitivePatterns = [
      /sk_[a-zA-Z0-9]{24,}/g, // Stripe keys
      /sb_secret_[a-zA-Z0-9_]+/g, // Supabase secrets
      /ey[a-zA-Z0-9._-]+/g, // JWT tokens
      /-----BEGIN [A-Z]+-----[\s\S]*?-----END [A-Z]+-----/g, // Certificates/keys
      /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g, // Credit cards
      /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, // Emails
      /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g // Phone numbers
    ];

    const redactedResponse = JSON.parse(JSON.stringify(response));
    
    const redact = (obj) => {
      for (const key in obj) {
        if (typeof obj[key] === 'string') {
          let value = obj[key];
          sensitivePatterns.forEach(pattern => {
            value = value.replace(pattern, '[REDACTED_SENSITIVE]');
          });
          obj[key] = value;
        } else if (typeof obj[key] === 'object' && obj[key] !== null) {
          redact(obj[key]);
        }
      }
    };
    
    redact(redactedResponse);
    
    // Remove internal/debug fields
    const safeFields = ['id', 'status', 'result', 'message', 'data'];
    const sanitized = {};
    
    safeFields.forEach(field => {
      if (redactedResponse[field]) {
        sanitized[field] = redactedResponse[field];
      }
    });
    
    console.log('✅ LLM response sanitized');
    return sanitized;
  }

  // Circuit Override Expiry Handler
  async handleCircuitOverrideExpiry() {
    console.log('⏰ Checking circuit override expiry...');
    
    try {
      const { data: circuitState, error } = await this.supabase
        .from('keeper_circuit_state')
        .select('*')
        .eq('id', 1)
        .single();
      
      if (error) throw error;
      
      const now = new Date();
      const expires = new Date(circuitState.expires_at);
      
      if (circuitState.expires_at && now > expires) {
        console.log('🔄 Circuit override expired, resetting...');
        
        // Reset circuit to normal level
        const { data: resetResult, error: resetError } = await this.supabase
          .from('keeper_circuit_state')
          .update({
            level: 0,
            reason: 'Auto-reset: Override expired',
            set_by: 'system:auto_expiry',
            expires_at: null,
            updated_at: now.toISOString()
          })
          .eq('id', 1)
          .select();
        
        if (resetError) throw resetError;
        
        // Log the auto-reset
        const { error: auditError } = await this.supabase
          .from('keeper_audit_log')
          .insert({
            request_id: crypto.randomUUID(),
            agent_id: 'system',
            agent_role: 'governor',
            action: 'circuit:auto_reset',
            target: 'keeper_circuit_state',
            status: 'success',
            risk_level: 0,
            details: {
              action: 'auto_expiry_reset',
              previous_level: circuitState.level,
              new_level: 0,
              expired_at: circuitState.expires_at,
              reset_at: now.toISOString()
            },
            sensitive: false
          });
        
        if (auditError) {
          console.error('⚠️  Failed to log auto-reset:', auditError.message);
        }
        
        console.log('✅ Circuit auto-reset completed');
        return { reset: true, previousLevel: circuitState.level };
      }
      
      console.log('✅ Circuit override still active');
      return { reset: false, currentLevel: circuitState.level };
      
    } catch (error) {
      console.error('❌ Circuit expiry check failed:', error.message);
      return { error: error.message };
    }
  }

  // Enhanced Circuit Breaker with Override Awareness
  async executeWithCircuitProtection(actionId, action, context = {}) {
    console.log(`🛡️  Executing action: ${actionId}`);
    
    try {
      // Check for expired overrides first
      const expiryCheck = await this.handleCircuitOverrideExpiry();
      if (expiryCheck.error) {
        throw new Error(`Circuit expiry check failed: ${expiryCheck.error}`);
      }
      
      // Get current circuit state
      const { data: circuitState, error } = await this.supabase
        .from('keeper_circuit_state')
        .select('*')
        .eq('id', 1)
        .single();
      
      if (error) throw error;
      
      // Check if action is allowed at current level
      const actionRisk = this.assessActionRisk(actionId, context);
      
      // Block actions with risk >= circuit level (more restrictive)
      if (actionRisk >= circuitState.level && circuitState.level > 0) {
        const error = new Error(`Action blocked by circuit breaker (Level ${circuitState.level})`);
        error.code = 'CIRCUIT_BLOCKED';
        error.circuitLevel = circuitState.level;
        error.actionRisk = actionRisk;
        throw error;
      }
      
      // Execute the action
      console.log(`✅ Action approved (Risk: ${actionRisk}, Circuit: ${circuitState.level})`);
      const result = await action();
      
      // Sanitize if it's an LLM response
      if (context.isLLMResponse) {
        return this.sanitizeLLMResponse(result, context);
      }
      
      return result;
      
    } catch (error) {
      console.error(`❌ Action failed: ${error.message}`);
      
      // Log the failure
      await this.supabase
        .from('keeper_audit_log')
        .insert({
          request_id: `circuit_block_${Date.now()}`,
          agent_id: context.agentId || 'unknown',
          agent_role: context.agentRole || 'unknown',
          action: 'circuit:block',
          target: actionId,
          status: 'denied',
          risk_level: context.riskLevel || 1,
          details: {
            action_id: actionId,
            circuit_level: error.circuitLevel,
            action_risk: error.actionRisk,
            error: error.message,
            context: context
          },
          sensitive: false
        });
      
      throw error;
    }
  }

  assessActionRisk(actionId, context) {
    // Define risk levels for different actions
    const riskMap = {
      'stripe:transfer': 3,
      'stripe:create_account': 2,
      'database:delete': 4,
      'database:update': 1,
      'llm:generate': 2,
      'system:restart': 4,
      'admin:access': 3
    };
    
    return riskMap[actionId] || 1;
  }

  // Memory Separator - Prevent sensitive data re-ingestion
  separateMemory(data, context = {}) {
    console.log('🧠 Memory separation active...');
    
    const sensitiveFields = ['api_key', 'secret', 'token', 'password', 'key'];
    const cleanMemory = {};
    
    const clean = (obj, path = '') => {
      for (const key in obj) {
        const currentPath = path ? `${path}.${key}` : key;
        
        if (sensitiveFields.some(field => key.toLowerCase().includes(field))) {
          cleanMemory[currentPath] = '[REDACTED]';
        } else if (typeof obj[key] === 'object' && obj[key] !== null) {
          clean(obj[key], currentPath);
        } else {
          cleanMemory[currentPath] = obj[key];
        }
      }
    };
    
    clean(data);
    
    console.log('✅ Memory separated and cleaned');
    return cleanMemory;
  }
}

module.exports = KeeperBoundaryHardening;

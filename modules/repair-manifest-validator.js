// Repair Manifest Validator - STRICT validation with no flexibility
// Rejects any manifest that doesn't exactly match required structure

class RepairManifestValidator {
  constructor() {
    // REQUIRED structure - IMMUTABLE
    this.requiredSchema = {
      issue_type: {
        type: 'string',
        required: true,
        enum: ['INFRA_FAILURE', 'ROUTE_FAILURE', 'DEPLOYMENT_MISMATCH', 'DATA_INTEGRITY_RISK', 'STREAM_BREAK', 'UNKNOWN_ANOMALY']
      },
      affected_module: {
        type: 'string',
        required: true,
        minLength: 1
      },
      root_cause_hypothesis: {
        type: 'string',
        required: true,
        minLength: 1
      },
      verification_steps: {
        type: 'array',
        required: true,
        minItems: 1,
        items: { type: 'string' }
      },
      recommended_fix_steps: {
        type: 'array',
        required: true,
        minItems: 1,
        items: { type: 'string' }
      },
      risk_level: {
        type: 'string',
        required: true,
        enum: ['low', 'medium', 'high']
      },
      rollback_option: {
        type: 'boolean',
        required: true
      },
      confidence: {
        type: 'number',
        required: true,
        minimum: 0.0,
        maximum: 1.0
      }
    };
    
    // Optional but tracked fields
    this.optionalFields = [
      'manifest_id',
      'generated_by',
      'generated_at',
      'metadata',
      'repair_type',
      'estimated_duration',
      'dependencies'
    ];
    
    // Statistics
    this.stats = {
      validated: 0,
      rejected: 0,
      rejectionReasons: {}
    };
    
    console.log('[REPAIR MANIFEST VALIDATOR] Initialized - STRICT validation only');
  }

  // Validate manifest - NO FLEXIBILITY
  validate(manifest) {
    this.stats.validated++;
    
    const errors = [];
    const warnings = [];
    
    // Check if manifest is an object
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
      errors.push('Manifest must be an object');
      return this.createValidationResult(false, errors, warnings);
    }
    
    // Check for unexpected fields
    const manifestFields = Object.keys(manifest);
    const allowedFields = Object.keys(this.requiredSchema).concat(this.optionalFields);
    const unexpectedFields = manifestFields.filter(field => !allowedFields.includes(field));
    
    if (unexpectedFields.length > 0) {
      errors.push(`Unexpected fields: ${unexpectedFields.join(', ')}`);
    }
    
    // Validate each required field
    for (const [fieldName, rules] of Object.entries(this.requiredSchema)) {
      const fieldError = this.validateField(fieldName, manifest[fieldName], rules);
      if (fieldError) {
        errors.push(fieldError);
      }
    }
    
    // Additional business logic validations
    const businessErrors = this.validateBusinessLogic(manifest);
    errors.push(...businessErrors);
    
    // Track rejection reasons
    if (errors.length > 0) {
      this.stats.rejected++;
      errors.forEach(error => {
        this.stats.rejectionReasons[error] = (this.stats.rejectionReasons[error] || 0) + 1;
      });
    }
    
    return this.createValidationResult(errors.length === 0, errors, warnings);
  }

  // Validate individual field
  validateField(fieldName, value, rules) {
    // Check required
    if (rules.required && (value === undefined || value === null)) {
      return `Missing required field: ${fieldName}`;
    }
    
    // Skip further validation if not required and not present
    if (!rules.required && (value === undefined || value === null)) {
      return null;
    }
    
    // Type validation
    if (rules.type === 'string' && typeof value !== 'string') {
      return `Field ${fieldName} must be string, got ${typeof value}`;
    }
    
    if (rules.type === 'number' && typeof value !== 'number') {
      return `Field ${fieldName} must be number, got ${typeof value}`;
    }
    
    if (rules.type === 'boolean' && typeof value !== 'boolean') {
      return `Field ${fieldName} must be boolean, got ${typeof value}`;
    }
    
    if (rules.type === 'array' && !Array.isArray(value)) {
      return `Field ${fieldName} must be array, got ${typeof value}`;
    }
    
    // String validations
    if (rules.type === 'string') {
      if (rules.minLength && value.length < rules.minLength) {
        return `Field ${fieldName} must be at least ${rules.minLength} characters`;
      }
      
      if (rules.enum && !rules.enum.includes(value)) {
        return `Field ${fieldName} must be one of: ${rules.enum.join(', ')}`;
      }
    }
    
    // Array validations
    if (rules.type === 'array') {
      if (rules.minItems && value.length < rules.minItems) {
        return `Field ${fieldName} must have at least ${rules.minItems} items`;
      }
      
      if (rules.maxItems && value.length > rules.maxItems) {
        return `Field ${fieldName} must have at most ${rules.maxItems} items`;
      }
      
      // Validate array items
      if (rules.items) {
        for (let i = 0; i < value.length; i++) {
          if (rules.items.type === 'string' && typeof value[i] !== 'string') {
            return `Field ${fieldName}[${i}] must be string, got ${typeof value[i]}`;
          }
        }
      }
    }
    
    // Number validations
    if (rules.type === 'number') {
      if (rules.minimum !== undefined && value < rules.minimum) {
        return `Field ${fieldName} must be >= ${rules.minimum}`;
      }
      
      if (rules.maximum !== undefined && value > rules.maximum) {
        return `Field ${fieldName} must be <= ${rules.maximum}`;
      }
    }
    
    return null;
  }

  // Validate business logic
  validateBusinessLogic(manifest) {
    const errors = [];
    
    // High risk must have rollback option
    if (manifest.risk_level === 'high' && !manifest.rollback_option) {
      errors.push('High risk repairs must have rollback option enabled');
    }
    
    // Low confidence repairs should be marked high risk
    if (manifest.confidence < 0.6 && manifest.risk_level !== 'high') {
      errors.push('Low confidence repairs (< 0.6) must be marked as high risk');
    }
    
    // Verification steps should be reasonable
    if (manifest.verification_steps.length > 10) {
      errors.push('Too many verification steps (> 10), consider simplifying');
    }
    
    // Fix steps should be reasonable
    if (manifest.recommended_fix_steps.length > 20) {
      errors.push('Too many fix steps (> 20), consider breaking into multiple repairs');
    }
    
    // Check for empty steps
    const emptyVerification = manifest.verification_steps.some(step => !step.trim());
    if (emptyVerification) {
      errors.push('Verification steps cannot be empty');
    }
    
    const emptyFixes = manifest.recommended_fix_steps.some(step => !step.trim());
    if (emptyFixes) {
      errors.push('Recommended fix steps cannot be empty');
    }
    
    return errors;
  }

  // Create validation result
  createValidationResult(isValid, errors, warnings) {
    return {
      valid: isValid,
      errors: errors,
      warnings: warnings,
      validated_at: new Date().toISOString(),
      validator_version: 'strict_v1'
    };
  }

  // Validate and throw if invalid
  validateOrThrow(manifest) {
    const result = this.validate(manifest);
    
    if (!result.valid) {
      const error = new Error(`Repair manifest validation failed: ${result.errors.join('; ')}`);
      error.code = 'MANIFEST_VALIDATION_FAILED';
      error.errors = result.errors;
      error.manifest = manifest;
      throw error;
    }
    
    return result;
  }

  // Get validation statistics
  getStats() {
    const total = this.stats.validated;
    
    return {
      ...this.stats,
      validation_rate: total > 0 ? ((this.stats.validated - this.stats.rejected) / total * 100).toFixed(2) + '%' : '0%',
      rejection_rate: total > 0 ? (this.stats.rejected / total * 100).toFixed(2) + '%' : '0%',
      top_rejection_reasons: Object.entries(this.stats.rejectionReasons)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 5)
        .map(([reason, count]) => ({ reason, count }))
    };
  }

  // Reset statistics
  resetStats() {
    this.stats = {
      validated: 0,
      rejected: 0,
      rejectionReasons: {}
    };
  }

  // Get required schema (for documentation)
  getRequiredSchema() {
    return {
      required_fields: Object.keys(this.requiredSchema),
      schema: this.requiredSchema,
      optional_fields: this.optionalFields,
      validation_mode: 'STRICT'
    };
  }
}

// Create singleton instance
const repairManifestValidator = new RepairManifestValidator();

// Export the validator
module.exports = repairManifestValidator;

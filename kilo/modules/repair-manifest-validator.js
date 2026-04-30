// Repair Manifest Validator - Enforces strict repair manifest schema
// Rejects any manifest that doesn't conform to the required structure

class RepairManifestValidator {
  constructor() {
    this.requiredFields = [
      'issue_type',
      'affected_module',
      'root_cause_hypothesis',
      'verification_steps',
      'recommended_fix_steps',
      'risk_level',
      'rollback_option',
      'confidence'
    ];
    
    this.validRiskLevels = ['low', 'medium', 'high'];
    this.validIssueTypes = [
      'INFRA_FAILURE',
      'ROUTE_FAILURE',
      'DEPLOYMENT_MISMATCH',
      'DATA_INTEGRITY_RISK',
      'STREAM_BREAK',
      'UNKNOWN_ANOMALY'
    ];
  }
  
  // Validate a repair manifest against the strict schema
  validateManifest(manifest) {
    const errors = [];
    
    // Check for missing required fields
    for (const field of this.requiredFields) {
      if (!(field in manifest)) {
        errors.push(`Missing required field: ${field}`);
      }
    }
    
    // If we have missing fields, reject immediately
    if (errors.length > 0) {
      return {
        valid: false,
        errors: errors,
        reason: 'Manifest missing required fields'
      };
    }
    
    // Validate field types and values
    errors.push(...this.validateFieldTypes(manifest));
    errors.push(...this.validateFieldValues(manifest));
    
    if (errors.length > 0) {
      return {
        valid: false,
        errors: errors,
        reason: 'Manifest contains invalid field values'
      };
    }
    
    // Validate verification_steps and recommended_fix_steps are arrays of strings
    if (!Array.isArray(manifest.verification_steps)) {
      errors.push('verification_steps must be an array');
    } else {
      for (let i = 0; i < manifest.verification_steps.length; i++) {
        if (typeof manifest.verification_steps[i] !== 'string') {
          errors.push(`verification_steps[${i}] must be a string`);
        }
      }
    }
    
    if (!Array.isArray(manifest.recommended_fix_steps)) {
      errors.push('recommended_fix_steps must be an array');
    } else {
      for (let i = 0; i < manifest.recommended_fix_steps.length; i++) {
        if (typeof manifest.recommended_fix_steps[i] !== 'string') {
          errors.push(`recommended_fix_steps[${i}] must be a string`);
        }
      }
    }
    
    // Validate confidence is a number between 0 and 1
    if (typeof manifest.confidence !== 'number' || 
        manifest.confidence < 0 || 
        manifest.confidence > 1 ||
        Number.isNaN(manifest.confidence)) {
      errors.push('confidence must be a number between 0 and 1');
    }
    
    if (errors.length > 0) {
      return {
        valid: false,
        errors: errors,
        reason: 'Manifest contains invalid field values'
      };
    }
    
    // All validations passed
    return {
      valid: true,
      errors: [],
      reason: 'Manifest is valid'
    };
  }
  
  validateFieldTypes(manifest) {
    const errors = [];
    
    // Check string fields
    const stringFields = ['issue_type', 'affected_module', 'root_cause_hypothesis'];
    for (const field of stringFields) {
      if (typeof manifest[field] !== 'string') {
        errors.push(`${field} must be a string`);
      }
    }
    
    // Check boolean field
    if (typeof manifest.rollback_option !== 'boolean') {
      errors.push('rollback_option must be a boolean');
    }
    
    return errors;
  }
  
  validateFieldValues(manifest) {
    const errors = [];
    
    // Validate issue_type
    if (!this.validIssueTypes.includes(manifest.issue_type)) {
      errors.push(`issue_type must be one of: ${this.validIssueTypes.join(', ')}`);
    }
    
    // Validate risk_level
    if (!this.validRiskLevels.includes(manifest.risk_level)) {
      errors.push(`risk_level must be one of: ${this.validRiskLevels.join(', ')}`);
    }
    
    // Check that arrays are not empty
    if (manifest.verification_steps.length === 0) {
      errors.push('verification_steps must not be empty');
    }
    
    if (manifest.recommended_fix_steps.length === 0) {
      errors.push('recommended_fix_steps must not be empty');
    }
    
    return errors;
  }
  
  // Sanitize and normalize a manifest (if possible)
  sanitizeManifest(manifest) {
    const sanitized = { ...manifest };
    
    // Ensure confidence is a number with 2 decimal places
    if (typeof sanitized.confidence === 'number') {
      sanitized.confidence = parseFloat(sanitized.confidence.toFixed(2));
    }
    
    // Ensure arrays are actually arrays
    if (!Array.isArray(sanitized.verification_steps)) {
      sanitized.verification_steps = Array.isArray(sanitized.verification_steps) ? 
        sanitized.verification_steps : [];
    }
    
    if (!Array.isArray(sanitized.recommended_fix_steps)) {
      sanitized.recommended_fix_steps = Array.isArray(sanitized.recommended_fix_steps) ? 
        sanitized.recommended_fix_steps : [];
    }
    
    // Ensure boolean is actually boolean
    if (typeof sanitized.rollback_option !== 'boolean') {
      sanitized.rollback_option = !!sanitized.rollback_option;
    }
    
    return sanitized;
  }
}

// Factory function
function createRepairManifestValidator() {
  return new RepairManifestValidator();
}

module.exports = { RepairManifestValidator, createRepairManifestValidator };
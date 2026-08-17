const WILDCARD = '*';

function isStringArray(v) {
  return Array.isArray(v) && v.every(item => typeof item === 'string');
}

function inSet(value, set) {
  if (set === null || set === undefined) return false;
  if (set === WILDCARD) return true;
  if (!Array.isArray(set)) return false;
  return set.includes(value);
}

function isNamespaced(eventType) {
  return typeof eventType === 'string' && eventType.includes('.');
}

function checkForbidden(eventType) {
  const lower = eventType.toLowerCase();
  const dangerous = ['delete', 'remove', 'drop', 'destroy', 'wipe', 'purge', 'kill'];
  return !dangerous.some(d => lower.includes(`system.${d}`) || lower.endsWith(`.${d}.everything`));
}

class CapabilityPolicy {
  constructor(rules = {}) {
    this.rules = rules;
  }

  addRule(appName, rule) {
    this.rules[appName.toLowerCase()] = rule;
  }

  getRule(appName) {
    return this.rules[appName.toLowerCase()] || null;
  }

  validate(manifest) {
    if (!manifest || typeof manifest !== 'object') {
      return { ok: false, errors: ['manifest is required'] };
    }
    const name = manifest.name || '';
    const rule = this.getRule(name);
    const errors = [];

    if (!rule) {
      return { ok: false, errors: [`No capability policy defined for ${name}`] };
    }

    if (manifest.deprecated) {
      if (rule.rejectDeprecated) {
        errors.push('deprecated applications are not allowed by policy');
      }
    }

    for (const ev of manifest.eventsProduced || []) {
      if (!isNamespaced(ev)) {
        errors.push(`produced event "${ev}" must be dot-namespaced`);
      }
      if (!checkForbidden(ev)) {
        errors.push(`produced event "${ev}" is forbidden by safety policy`);
      }
      if (!inSet(ev, rule.allowedEventsProduced)) {
        errors.push(`produced event "${ev}" is not allowed for ${name}`);
      }
    }

    for (const ev of manifest.eventsConsumed || []) {
      if (!isNamespaced(ev)) {
        errors.push(`consumed event "${ev}" must be dot-namespaced`);
      }
      if (!inSet(ev, rule.allowedEventsConsumed || rule.allowedEventsProduced)) {
        errors.push(`consumed event "${ev}" is not allowed for ${name}`);
      }
    }

    const declaredServices = new Set([
      ...(manifest.providers || []),
      ...(manifest.dependencies?.services || [])
    ]);
    for (const svc of rule.requiredServices || []) {
      if (!declaredServices.has(svc)) {
        errors.push(`required service "${svc}" is not declared by ${name}`);
      }
    }

    for (const cap of rule.requiredCapabilities || []) {
      if (!(manifest.capabilities || []).includes(cap)) {
        errors.push(`required capability "${cap}" is missing from ${name}`);
      }
    }

    return { ok: errors.length === 0, errors };
  }

  validateAll(manifests) {
    const results = [];
    for (const manifest of manifests) {
      const result = this.validate(manifest);
      results.push({ name: manifest.name, ...result });
    }
    return results;
  }
}

module.exports = {
  CapabilityPolicy,
  WILDCARD,
  isNamespaced,
  checkForbidden
};

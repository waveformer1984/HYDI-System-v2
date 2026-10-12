'use strict';

/**
 * Typed billing error. `code` is a stable machine-readable string that API
 * routes return verbatim (see docs/billing/REVENUE_STREAMS_MODULE.md §E);
 * `status` is the HTTP status the route should use.
 */
class BillingError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {number} [status]
   * @param {Record<string, unknown>} [details]
   */
  constructor(code, message, status = 400, details = undefined) {
    super(message);
    this.name = 'BillingError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function isBillingError(err) {
  return err instanceof BillingError;
}

module.exports = { BillingError, isBillingError };

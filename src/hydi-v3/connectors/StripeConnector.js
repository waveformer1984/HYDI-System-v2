'use strict';

const BaseConnector = require('./BaseConnector');

class StripeConnector extends BaseConnector {
  constructor(config = {}) {
    super(config);
    this.capabilities = ['RevenueReceived', 'RevenueRefunded', 'InvoicePaid', 'InvoiceOverdue'];
    this._requiredCredentials = ['STRIPE_SECRET_KEY'];
  }

  async start() {
    if (!this._isEnabled()) {
      this._notConfigured('disabled');
      return;
    }
    if (!this._hasCredentials(this._requiredCredentials)) {
      this._notConfigured('STRIPE_SECRET_KEY not configured');
      return;
    }
    this.state = 'configured';
  }

  async stop() {
    this.state = 'stopped';
  }
}

module.exports = StripeConnector;

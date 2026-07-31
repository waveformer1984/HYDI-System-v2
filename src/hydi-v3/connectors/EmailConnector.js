'use strict';

const BaseConnector = require('./BaseConnector');

class EmailConnector extends BaseConnector {
  constructor(config = {}) {
    super(config);
    this.capabilities = ['EmailReceived', 'EmailSent'];
    this._requiredCredentials = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'];
  }

  async start() {
    if (!this._isEnabled()) {
      this._notConfigured('disabled');
      return;
    }
    if (!this._hasCredentials(this._requiredCredentials)) {
      this._notConfigured('SMTP credentials not configured');
      return;
    }
    this.state = 'configured';
  }

  async stop() {
    this.state = 'stopped';
  }
}

module.exports = EmailConnector;

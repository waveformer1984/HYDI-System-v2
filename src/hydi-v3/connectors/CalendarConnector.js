'use strict';

const BaseConnector = require('./BaseConnector');

class CalendarConnector extends BaseConnector {
  constructor(config = {}) {
    super(config);
    this.capabilities = ['CalendarEventCreated', 'CalendarEventUpdated', 'CalendarEventDeleted'];
    this._requiredCredentials = ['GOOGLE_CALENDAR_CREDENTIALS'];
  }

  async start() {
    if (!this._isEnabled()) {
      this._notConfigured('disabled');
      return;
    }
    if (!this._hasCredentials(this._requiredCredentials)) {
      this._notConfigured('GOOGLE_CALENDAR_CREDENTIALS not configured');
      return;
    }
    this.state = 'configured';
  }

  async stop() {
    this.state = 'stopped';
  }
}

module.exports = CalendarConnector;

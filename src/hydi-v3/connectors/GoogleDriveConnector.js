'use strict';

const BaseConnector = require('./BaseConnector');

class GoogleDriveConnector extends BaseConnector {
  constructor(config = {}) {
    super(config);
    this.capabilities = ['DriveFileCreated', 'DriveFileModified', 'DriveFileDeleted'];
    this._requiredCredentials = ['GOOGLE_DRIVE_CREDENTIALS'];
  }

  async start() {
    if (!this._isEnabled()) {
      this._notConfigured('disabled');
      return;
    }
    if (!this._hasCredentials(this._requiredCredentials)) {
      this._notConfigured('GOOGLE_DRIVE_CREDENTIALS not configured');
      return;
    }
    this.state = 'configured';
  }

  async stop() {
    this.state = 'stopped';
  }
}

module.exports = GoogleDriveConnector;

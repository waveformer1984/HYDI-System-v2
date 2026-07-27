'use strict';

const ConnectorRegistry = require('./ConnectorRegistry');
const ConnectorManager = require('./ConnectorManager');
const BaseConnector = require('./BaseConnector');
const FilesystemConnector = require('./FilesystemConnector');
const GitConnector = require('./GitConnector');
const LocalProcessConnector = require('./LocalProcessConnector');
const LocalPrinterConnector = require('./LocalPrinterConnector');
const GitHubConnector = require('./GitHubConnector');
const StripeConnector = require('./StripeConnector');
const EmailConnector = require('./EmailConnector');
const GoogleDriveConnector = require('./GoogleDriveConnector');
const CalendarConnector = require('./CalendarConnector');

ConnectorRegistry.register('filesystem', FilesystemConnector);
ConnectorRegistry.register('git', GitConnector);
ConnectorRegistry.register('local-process', LocalProcessConnector);
ConnectorRegistry.register('local-printer', LocalPrinterConnector);
ConnectorRegistry.register('github', GitHubConnector);
ConnectorRegistry.register('stripe', StripeConnector);
ConnectorRegistry.register('email', EmailConnector);
ConnectorRegistry.register('google-drive', GoogleDriveConnector);
ConnectorRegistry.register('calendar', CalendarConnector);

module.exports = {
  ConnectorRegistry,
  ConnectorManager,
  BaseConnector,
  FilesystemConnector,
  GitConnector,
  LocalProcessConnector,
  LocalPrinterConnector,
  GitHubConnector,
  StripeConnector,
  EmailConnector,
  GoogleDriveConnector,
  CalendarConnector,
};

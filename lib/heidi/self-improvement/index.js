'use strict';

module.exports = {
  ...require('./history'),
  ...require('./fingerprints'),
  ...require('./duplicates'),
  ...require('./regression'),
  ...require('./scoring'),
  ...require('./verification'),
  ...require('./dashboard'),
  redactRecord: require('./redact').redactRecord,
};
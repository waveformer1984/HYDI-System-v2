'use strict';

/** Strip CR/LF and other control characters so request-derived values can't forge log lines. */
function logSafe(value) {
  return String(value)
    .replace(/[\r\n]+/g, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .slice(0, 200);
}

module.exports = { logSafe };

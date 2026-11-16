'use strict';

const SECRET_RE = /(sk_|xoxb-|ghp_|SUPABASE_SERVICE|password\s*[:=])/i;

function redactRecord(record) {
  return JSON.parse(
    JSON.stringify(record, (k, v) => {
      if (typeof v === 'string' && SECRET_RE.test(v)) return '[REDACTED]';
      return v;
    }),
  );
}

module.exports = { redactRecord, SECRET_RE };
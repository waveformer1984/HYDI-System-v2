'use strict';

const DEFAULT_RETENTION_MS = 15 * 60 * 1000;

function ensureCache(state) {
  if (!state.auth_replay_used || typeof state.auth_replay_used !== 'object') {
    state.auth_replay_used = {};
  }
}

function pruneReplayCache(state, now = Date.now()) {
  ensureCache(state);
  for (const [jti, exp] of Object.entries(state.auth_replay_used)) {
    if (Number(exp) <= now) delete state.auth_replay_used[jti];
  }
}

function isReplayed(state, jti, now = Date.now()) {
  ensureCache(state);
  pruneReplayCache(state, now);
  return Boolean(state.auth_replay_used[jti]);
}

function markConsumed(state, jti, now = Date.now(), retentionMs = DEFAULT_RETENTION_MS) {
  ensureCache(state);
  state.auth_replay_used[jti] = now + retentionMs;
  pruneReplayCache(state, now);
}

module.exports = {
  DEFAULT_RETENTION_MS,
  ensureCache,
  pruneReplayCache,
  isReplayed,
  markConsumed,
};
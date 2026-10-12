'use strict';

/**
 * Billing acceptance scenarios on the in-memory store (Tier 1, hermetic).
 * The same scenarios run on real Postgres in acceptance.pg.test.js (Tier 2).
 */
const { defineAcceptanceScenarios } = require('./acceptance.scenarios');

describe('billing acceptance (memory store)', () => {
  defineAcceptanceScenarios('memory');
});

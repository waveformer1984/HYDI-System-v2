'use strict';

/** Independent verification dimensions — never collapse reachability into benefits. */
const VERIFICATION_DIMENSIONS = Object.freeze({
  SOURCE_REACHABLE: 'source_reachable',
  PROGRAM_CONFIRMED: 'program_confirmed',
  BENEFITS_CONFIRMED: 'benefits_confirmed',
  ELIGIBILITY_CONFIRMED: 'eligibility_confirmed',
  APPLICATION_READY: 'application_ready',
});

function emptyFlags() {
  return {
    source_reachable: false,
    program_confirmed: false,
    benefits_confirmed: false,
    eligibility_confirmed: false,
    application_ready: false,
  };
}

module.exports = { VERIFICATION_DIMENSIONS, emptyFlags };
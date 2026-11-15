'use strict';

/** Automated probe dimensions — never collapse into operator or award states. */
const VERIFICATION_DIMENSIONS = Object.freeze({
  SOURCE_REACHABLE: 'source_reachable',
  WEAK_PAGE_SIGNAL: 'weak_page_signal',
  /** Deprecated alias — use weak_page_signal; never implies benefits. */
  PROGRAM_CONFIRMED: 'program_confirmed',
  BENEFITS_CONFIRMED: 'benefits_confirmed',
  ELIGIBILITY_CONFIRMED: 'eligibility_confirmed',
  APPLICATION_READY: 'application_ready',
});

function emptyFlags() {
  return {
    source_reachable: false,
    weak_page_signal: false,
    program_confirmed: false,
    benefits_confirmed: false,
    eligibility_confirmed: false,
    application_ready: false,
  };
}

module.exports = { VERIFICATION_DIMENSIONS, emptyFlags };
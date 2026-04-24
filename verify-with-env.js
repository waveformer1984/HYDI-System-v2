require('dotenv').config();

const DeploymentVerifier = require('./verify-deployment');
const verifier = new DeploymentVerifier();

verifier.runFullVerification()
  .then(results => {
    const allPassed = Object.values(results).every(r => r.success);
    process.exit(allPassed ? 0 : 1);
  })
  .catch(error => {
    console.error('Verification failed:', error.message);
    process.exit(1);
  });

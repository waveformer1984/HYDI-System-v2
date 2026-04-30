const axios = require('axios');

async function debugDrift() {
  try {
    const response = await axios.get('http://localhost:3458/revenue/drift/evaluate');
    console.log('Response status:', response.status);
    
    const driftEval = response.data.drift_evaluation;
    console.log('Drift score:', driftEval.drift_score);
    console.log('Drift analysis:', JSON.stringify(driftEval.drift_analysis, null, 2));
    console.log('Drift patterns:', JSON.stringify(driftEval.drift_patterns, null, 2));
    console.log('System health:', JSON.stringify(driftEval.system_health, null, 2));
    
    if (driftEval.error) {
      console.log('Error found:', driftEval.error);
    }
  } catch (error) {
    console.error('Error:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
    }
  }
}

debugDrift();

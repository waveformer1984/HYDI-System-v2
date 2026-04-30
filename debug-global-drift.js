const axios = require('axios');

async function debugGlobalDrift() {
  try {
    const response = await axios.get('http://localhost:3458/revenue/global-drift/execution-cap');
    console.log('Response status:', response.status);
    console.log('Response data:', JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.error('Error:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
    }
  }
}

debugGlobalDrift();

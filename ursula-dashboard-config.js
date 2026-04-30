// Environment-aware configuration for Ursula Dashboard
// Fixes the hardcoded localhost issue

const config = {
  // Detect if we're in development or production
  isDevelopment: process.env.NODE_ENV === 'development' || window.location.hostname === 'localhost',
  
  // Set the correct EventSource URL based on environment
  getEventSourceUrl: () => {
    if (config.isDevelopment) {
      // Local development - connect to local server
      return 'http://localhost:3005/events/stream';
    } else {
      // Production - connect to the same host but different path
      // Vercel deployment should have the API route
      return `${window.location.protocol}//${window.location.host}/events/stream`;
    }
  },
  
  // Get API base URL
  getApiUrl: () => {
    if (config.isDevelopment) {
      return 'http://localhost:3005';
    } else {
      return `${window.location.protocol}//${window.location.host}`;
    }
  }
};

// Export for use in HTML
if (typeof module !== 'undefined' && module.exports) {
  module.exports = config;
} else {
  window.UrsulaConfig = config;
}

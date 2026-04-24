// Test script for opportunity detection system
// Tests various event types to validate opportunity classification

const { cascade } = require('./modules/cascade');
const { v4: uuidv4 } = require('uuid');

function testOpportunityDetection() {
  console.log('=== TESTING OPPORTUNITY DETECTION SYSTEM ===\n');
  
  const testCases = [
    {
      name: 'High Value: Purchase Intent',
      event: {
        event_id: uuidv4(),
        type: 'purchase_intent',
        source: 'website',
        timestamp: new Date().toISOString(),
        payload: {
          user_id: 'user_123',
          product: 'enterprise_plan',
          budget: 50000,
          timeline: 'urgent'
        }
      },
      expected_type: 'high_value',
      expected_min_confidence: 0.8
    },
    
    {
      name: 'High Value: RFP Request',
      event: {
        event_id: uuidv4(),
        type: 'rfp_request',
        source: 'email',
        timestamp: new Date().toISOString(),
        payload: {
          company: 'Acme Corp',
          contact: 'john@acme.com',
          requirements: ['API integration', 'SSO', 'SLA']
        }
      },
      expected_type: 'high_value',
      expected_min_confidence: 0.8
    },
    
    {
      name: 'Medium Value: Demo Request',
      event: {
        event_id: uuidv4(),
        type: 'demo_request',
        source: 'landing_page',
        timestamp: new Date().toISOString(),
        payload: {
          email: 'lead@example.com',
          company_size: '50-100',
          preferred_time: 'next_week'
        }
      },
      expected_type: 'medium_value',
      expected_min_confidence: 0.5
    },
    
    {
      name: 'Medium Value: Trial Signup',
      event: {
        event_id: uuidv4(),
        type: 'trial_signup',
        source: 'app',
        timestamp: new Date().toISOString(),
        payload: {
          user_email: 'trial@example.com',
          plan: 'professional',
          trial_days: 14
        }
      },
      expected_type: 'medium_value',
      expected_min_confidence: 0.5
    },
    
    {
      name: 'Low Value: Page View',
      event: {
        event_id: uuidv4(),
        type: 'page_view',
        source: 'website',
        timestamp: new Date().toISOString(),
        payload: {
          page: '/pricing',
          duration: 45,
          referrer: 'google'
        }
      },
      expected_type: 'low_value',
      expected_min_confidence: 0.3
    },
    
    {
      name: 'No Opportunity: System Event',
      event: {
        event_id: uuidv4(),
        type: 'system_health_check',
        source: 'monitoring',
        timestamp: new Date().toISOString(),
        payload: {
          status: 'healthy',
          cpu_usage: 25,
          memory_usage: 60
        }
      },
      expected_type: 'none',
      expected_min_confidence: 0
    },
    
    {
      name: 'Complex: Multiple Indicators',
      event: {
        event_id: uuidv4(),
        type: 'contact_form',
        source: 'partnership_page',
        timestamp: new Date().toISOString(),
        payload: {
          message: 'We are interested in partnership opportunities and have budget approved for Q3',
          contact_info: 'partnership@enterprise.com',
          company_size: '1000+',
          decision_maker: true
        }
      },
      expected_type: 'high_value',
      expected_min_confidence: 0.8
    }
  ];
  
  let passedTests = 0;
  let totalTests = testCases.length;
  
  // Set up event listener for opportunity detection
  let opportunityEventsDetected = 0;
  cascade.on('hyve_opportunity_detected', (opportunityEvent) => {
    opportunityEventsDetected++;
    console.log(`\n--- OPPORTUNITY EVENT DETECTED ---`);
    console.log(`Type: ${opportunityEvent.payload.opportunity_classification.opportunity_type}`);
    console.log(`Confidence: ${opportunityEvent.payload.opportunity_classification.confidence}`);
    console.log(`Score: ${opportunityEvent.payload.opportunity_classification.score}`);
    console.log(`Indicators: ${opportunityEvent.payload.opportunity_classification.indicators.join(', ')}`);
    console.log(`Action Required: ${opportunityEvent.payload.action_required}`);
  });
  
  // Run each test case
  for (const testCase of testCases) {
    console.log(`\n--- Testing: ${testCase.name} ---`);
    
    const result = cascade.validateEvent(testCase.event);
    
    console.log(`Validation Status: ${result.status}`);
    
    if (result.status === 'accepted' && result.opportunity) {
      const opportunity = result.opportunity;
      console.log(`Opportunity Type: ${opportunity.opportunity_type}`);
      console.log(`Confidence: ${opportunity.confidence}`);
      console.log(`Score: ${opportunity.score}`);
      console.log(`Indicators: ${opportunity.indicators.join(', ')}`);
      
      // Check if results match expectations
      const typeMatch = opportunity.opportunity_type === testCase.expected_type;
      const confidenceMatch = opportunity.confidence >= testCase.expected_min_confidence;
      
      if (typeMatch && confidenceMatch) {
        console.log(`\u2705 PASS`);
        passedTests++;
      } else {
        console.log(`\u274c FAIL`);
        console.log(`Expected type: ${testCase.expected_type}, got: ${opportunity.opportunity_type}`);
        console.log(`Expected min confidence: ${testCase.expected_min_confidence}, got: ${opportunity.confidence}`);
      }
    } else if (testCase.expected_type === 'none') {
      if (!result.opportunity || result.opportunity.opportunity_type === 'none') {
        console.log(`\u2705 PASS (no opportunity detected as expected)`);
        passedTests++;
      } else {
        console.log(`\u274c FAIL (unexpected opportunity detected)`);
      }
    } else {
      console.log(`\u274c FAIL (validation rejected or missing opportunity)`);
    }
  }
  
  // Summary
  console.log(`\n=== TEST SUMMARY ===`);
  console.log(`Tests Passed: ${passedTests}/${totalTests}`);
  console.log(`Opportunity Events Emitted: ${opportunityEventsDetected}`);
  console.log(`Success Rate: ${((passedTests/totalTests) * 100).toFixed(1)}%`);
  
  if (passedTests === totalTests) {
    console.log(`\u2702b\ufe0f All tests passed! Opportunity detection system is working correctly.`);
  } else {
    console.log(`\u26a0\ufe0f Some tests failed. Review the opportunity classification rules.`);
  }
  
  return {
    passed: passedTests,
    total: totalTests,
    success_rate: (passedTests/totalTests) * 100,
    opportunity_events: opportunityEventsDetected
  };
}

// Run the test if this file is executed directly
if (require.main === module) {
  testOpportunityDetection();
}

module.exports = { testOpportunityDetection };

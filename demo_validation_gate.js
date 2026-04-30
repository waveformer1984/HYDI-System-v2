// Demo script showing validation gate with opportunity detection
// DISABLED - Integration moved to ProtoForge event bus
// This demonstrates the complete flow without requiring database setup

const { cascade } = require('./modules/cascade');
const { v4: uuidv4 } = require('uuid');

async function runValidationGateDemo() {
  console.log('=== HYVE VALIDATION GATE DEMO ===\n');
  
  // Sample incoming events that would come from various sources
  const incomingEvents = [
    {
      name: 'High-Value Lead from Website',
      source: 'CRM Webhook',
      event: {
        event_id: uuidv4(),
        type: 'purchase_intent',
        source: 'enterprise_landing_page',
        timestamp: new Date().toISOString(),
        payload: {
          contact_email: 'director@acme-corp.com',
          company_size: '1000+',
          budget_range: '$100k+',
          timeline: 'immediate',
          decision_maker: true
        }
      }
    },
    
    {
      name: 'Medium-Value Trial Signup',
      source: 'App Event',
      event: {
        event_id: uuidv4(),
        type: 'trial_signup',
        source: 'saas_application',
        timestamp: new Date().toISOString(),
        payload: {
          user_email: 'user@company.com',
          plan_type: 'professional',
          company_size: '50-100',
          integration_needed: 'slack'
        }
      }
    },
    
    {
      name: 'Low-Value Content Download',
      source: 'Marketing Analytics',
      event: {
        event_id: uuidv4(),
        type: 'content_download',
        source: 'blog',
        timestamp: new Date().toISOString(),
        payload: {
          content_type: 'whitepaper',
          topic: 'industry_trends',
          email: 'reader@example.com'
        }
      }
    },
    
    {
      name: 'Invalid Event (Missing Fields)',
      source: 'Buggy Integration',
      event: {
        event_id: 'invalid-id-format',
        type: '',
        source: '',
        payload: null
      }
    }
  ];
  
  console.log('Processing incoming events through validation gate...\n');
  
  // Set up event listeners
  let validationEvents = 0;
  let opportunityEvents = 0;
  
  cascade.on('validation_event', (validationEvent) => {
    validationEvents++;
    console.log(`\n--- VALIDATION EVENT #${validationEvents} ---`);
    console.log(`Status: ${validationEvent.status.toUpperCase()}`);
    console.log(`Event ID: ${validationEvent.event_id}`);
    console.log(`Confidence: ${validationEvent.confidence}`);
    
    if (validationEvent.status === 'rejected') {
      console.log(`Errors: ${validationEvent.errors.join(', ')}`);
      console.log(`Suggested Actions: ${validationEvent.actions.join(', ')}`);
    }
  });
  
  cascade.on('hyve_opportunity_detected', (opportunityEvent) => {
    opportunityEvents++;
    console.log(`\n--- OPPORTUNITY DETECTED #${opportunityEvents} ---`);
    console.log(`Opportunity Type: ${opportunityEvent.payload.opportunity_classification.opportunity_type}`);
    console.log(`Confidence: ${(opportunityEvent.payload.opportunity_classification.confidence * 100).toFixed(1)}%`);
    console.log(`Score: ${opportunityEvent.payload.opportunity_classification.score}`);
    console.log(`Indicators: ${opportunityEvent.payload.opportunity_classification.indicators.join(', ')}`);
    console.log(`Action Required: ${opportunityEvent.payload.action_required ? 'YES' : 'NO'}`);
    console.log(`Original Event Type: ${opportunityEvent.payload.original_event.type}`);
  });
  
  // Process each event
  const results = [];
  
  async function processEvents() {
    for (const incomingEvent of incomingEvents) {
      console.log(`\n=== ${incomingEvent.name} ===`);
      console.log(`Source: ${incomingEvent.source}`);
      
      const result = cascade.validateEvent(incomingEvent.event);
      
      results.push({
        name: incomingEvent.name,
        validation_status: result.status,
        opportunity_type: result.opportunity?.opportunity_type || 'none',
        confidence: result.opportunity?.confidence || 0,
        action_required: result.opportunity?.opportunity_type !== 'none'
      });
      
      // Small delay to show event flow
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  await processEvents();
  
  // Summary
  console.log(`\n=== VALIDATION GATE SUMMARY ===`);
  console.log(`Total Events Processed: ${incomingEvents.length}`);
  console.log(`Validation Events Emitted: ${validationEvents}`);
  console.log(`Opportunity Events Emitted: ${opportunityEvents}`);
  
  console.log(`\n--- Event-by-Event Results ---`);
  results.forEach(result => {
    const status = result.validation_status === 'accepted' ? 'PASS' : 'REJECT';
    const opportunity = result.opportunity_type !== 'none' ? `${result.opportunity_type} (${(result.confidence * 100).toFixed(1)}%)` : 'none';
    const action = result.action_required ? 'ACTION' : 'logged';
    
    console.log(`${result.name}: ${status} | Opportunity: ${opportunity} | ${action}`);
  });
  
  console.log(`\n--- Key Achievements ---`);
  console.log(`\u2702b\ufe0f Validation gate enforced on ALL incoming events`);
  console.log(`\u2702b\ufe0f Opportunities classified and emitted as "hyve_opportunity_detected" events`);
  console.log(`\u2702b\ufe0f Invalid events rejected with actionable feedback`);
  console.log(`\u2702b\ufe0f High-value opportunities prioritized with confidence scores`);
  
  return results;
}

// Run the demo
if (require.main === module) {
  runValidationGateDemo();
}

module.exports = { runValidationGateDemo };

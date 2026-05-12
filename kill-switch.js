require('dotenv').config({ path: '.env.production' });
const fs = require('fs');
const path = require('path');

// Kill Switch Controller - Emergency Data Protection
class KillSwitchController {
  constructor() {
    this.killSwitchFile = path.join(process.env.FALLBACK_LOG_PATH || '/tmp', 'hydi-kill-switch.flag');
    this.fallbackLogPath = process.env.FALLBACK_LOG_PATH || '/tmp/hydi-emergency.log';
    this.isActive = false;
    this.fallbackBuffer = [];
    this.maxBufferSize = 10000;
  }

  // Check if kill switch is activated
  isActivated() {
    try {
      return fs.existsSync(this.killSwitchFile);
    } catch (error) {
      console.log('Error checking kill switch:', error.message);
      return false;
    }
  }

  // Activate kill switch
  async activate(reason = 'Manual activation') {
    if (this.isActive) {
      console.log('Kill switch already active');
      return;
    }

    try {
      // Create kill switch flag file
      fs.writeFileSync(this.killSwitchFile, JSON.stringify({
        activated: true,
        timestamp: new Date().toISOString(),
        reason: reason
      }));

      this.isActive = true;
      console.log(`KILL SWITCH ACTIVATED: ${reason}`);
      console.log(`Fallback log: ${this.fallbackLogPath}`);
      
      // Send alert
      this.sendEmergencyAlert('KILL_SWITCH_ACTIVATED', reason);
      
      // Start fallback logging
      this.startFallbackLogging();
      
    } catch (error) {
      console.log('Error activating kill switch:', error.message);
    }
  }

  // Deactivate kill switch
  async deactivate() {
    if (!this.isActive) {
      console.log('Kill switch not active');
      return;
    }

    try {
      // Remove kill switch flag file
      if (fs.existsSync(this.killSwitchFile)) {
        fs.unlinkSync(this.killSwitchFile);
      }

      this.isActive = false;
      console.log('KILL SWITCH DEACTIVATED');
      
      // Send alert
      this.sendEmergencyAlert('KILL_SWITCH_DEACTIVATED', 'System returning to normal operation');
      
      // Attempt to replay buffered events
      await this.replayBufferedEvents();
      
    } catch (error) {
      console.log('Error deactivating kill switch:', error.message);
    }
  }

  // Emergency event logging (when kill switch is active)
  async logEmergencyEvent(event) {
    if (!this.isActive) {
      return false; // Kill switch not active, normal processing
    }

    try {
      const logEntry = {
        timestamp: new Date().toISOString(),
        event: event,
        status: 'buffered'
      };

      // Add to memory buffer
      this.fallbackBuffer.push(logEntry);

      // Write to fallback log file
      const logLine = JSON.stringify(logEntry) + '\n';
      fs.appendFileSync(this.fallbackLogPath, logLine);

      // Prevent buffer from growing too large
      if (this.fallbackBuffer.length > this.maxBufferSize) {
        this.fallbackBuffer = this.fallbackBuffer.slice(-this.maxBufferSize);
      }

      console.log(`EMERGENCY LOG: Event buffered (${this.fallbackBuffer.length} in buffer)`);
      return true;

    } catch (error) {
      console.log('Error logging emergency event:', error.message);
      return false;
    }
  }

  // Start fallback logging system
  startFallbackLogging() {
    console.log('Starting emergency fallback logging...');
    
    // Ensure log directory exists
    const logDir = path.dirname(this.fallbackLogPath);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    // Write header to log file
    const header = {
      timestamp: new Date().toISOString(),
      event: 'KILL_SWITCH_ACTIVATED',
      message: 'Emergency fallback logging started'
    };
    
    fs.writeFileSync(this.fallbackLogPath, JSON.stringify(header) + '\n');
  }

  // Replay buffered events when system recovers
  async replayBufferedEvents() {
    if (this.fallbackBuffer.length === 0) {
      console.log('No buffered events to replay');
      return;
    }

    console.log(`Replaying ${this.fallbackBuffer.length} buffered events...`);
    
    const { processEvent } = require('./hydi-processor');
    let successCount = 0;
    let failureCount = 0;

    for (const logEntry of this.fallbackBuffer) {
      try {
        const result = await processEvent(
          logEntry.event.source,
          logEntry.event.type,
          logEntry.event.payload
        );

        if (result.success) {
          successCount++;
        } else {
          failureCount++;
          console.log(`Replay failed: ${result.error}`);
        }

      } catch (error) {
        failureCount++;
        console.log(`Replay error: ${error.message}`);
      }

      // Small delay to prevent overwhelming the system
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    console.log(`Replay complete: ${successCount} success, ${failureCount} failed`);
    
    // Clear buffer
    this.fallbackBuffer = [];
    
    // Write completion to log
    const completion = {
      timestamp: new Date().toISOString(),
      event: 'BUFFER_REPLAY_COMPLETE',
      successCount,
      failureCount
    };
    
    fs.appendFileSync(this.fallbackLogPath, JSON.stringify(completion) + '\n');
    
    // Send alert about replay results
    this.sendEmergencyAlert('BUFFER_REPLAY_COMPLETE', `${successCount} success, ${failureCount} failed`);
  }

  // Send emergency alert
  sendEmergencyAlert(type, message) {
    const alert = {
      type,
      message,
      timestamp: new Date().toISOString(),
      bufferSize: this.fallbackBuffer.length,
      isActive: this.isActive
    };

    console.log(`EMERGENCY ALERT: ${type} - ${message}`);
    
    // In production, this would:
    // - Send to PagerDuty
    // - Post to emergency Slack channel
    // - Send SMS to on-call engineer
    // - Create incident in tracking system
  }

  // Get kill switch status
  getStatus() {
    const status = {
      isActive: this.isActive,
      isActivated: this.isActivated(),
      bufferSize: this.fallbackBuffer.length,
      maxBufferSize: this.maxBufferSize,
      fallbackLogPath: this.fallbackLogPath,
      killSwitchFile: this.killSwitchFile
    };

    if (fs.existsSync(this.killSwitchFile)) {
      try {
        const flagContent = fs.readFileSync(this.killSwitchFile, 'utf8');
        status.activationInfo = JSON.parse(flagContent);
      } catch (error) {
        status.activationError = error.message;
      }
    }

    return status;
  }

  // Get fallback log statistics
  getLogStats() {
    try {
      if (!fs.existsSync(this.fallbackLogPath)) {
        return { exists: false };
      }

      const stats = fs.statSync(this.fallbackLogPath);
      const content = fs.readFileSync(this.fallbackLogPath, 'utf8');
      const lines = content.split('\n').filter(line => line.trim());

      return {
        exists: true,
        size: stats.size,
        lines: lines.length,
        lastModified: stats.mtime.toISOString(),
        path: this.fallbackLogPath
      };

    } catch (error) {
      return { exists: false, error: error.message };
    }
  }
}

// Wrapper for processEvent that respects kill switch
async function safeProcessEvent(source, type, payload) {
  const killSwitch = new KillSwitchController();
  
  // Check if kill switch is active
  if (killSwitch.isActivated()) {
    // Buffer the event for later replay
    const event = { source, type, payload };
    await killSwitch.logEmergencyEvent(event);
    
    return {
      success: false,
      error: 'Kill switch active - event buffered',
      buffered: true
    };
  }

  // Normal processing
  const { processEvent } = require('./hydi-processor');
  return await processEvent(source, type, payload);
}

// CLI interface
if (require.main === module) {
  const killSwitch = new KillSwitchController();
  
  const command = process.argv[2] || 'status';
  
  switch (command) {
    case 'activate':
      const reason = process.argv[3] || 'Manual activation';
      killSwitch.activate(reason);
      break;
      
    case 'deactivate':
      killSwitch.deactivate();
      break;
      
    case 'status':
      console.log(JSON.stringify(killSwitch.getStatus(), null, 2));
      break;
      
    case 'logs':
      console.log(JSON.stringify(killSwitch.getLogStats(), null, 2));
      break;
      
    case 'test':
      // Test emergency logging
      killSwitch.activate('Test activation');
      
      const testEvent = {
        source: 'test',
        type: 'error',
        payload: { message: 'Test emergency event' }
      };
      
      killSwitch.logEmergencyEvent(testEvent).then(() => {
        console.log('Test event logged');
        console.log('Status:', JSON.stringify(killSwitch.getStatus(), null, 2));
        
        // Clean up
        setTimeout(() => {
          killSwitch.deactivate();
        }, 2000);
      });
      break;
      
    default:
      console.log('Usage: node kill-switch.js [activate|deactivate|status|logs|test]');
      process.exit(1);
  }
}

module.exports = { 
  KillSwitchController, 
  safeProcessEvent 
};

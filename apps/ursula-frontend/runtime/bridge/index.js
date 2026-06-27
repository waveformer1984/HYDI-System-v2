/**
 * RUNTIME BRIDGE
 * 
 * Coordinates between decision and execution runtimes
 */

import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';

class RuntimeBridge {
  constructor() {
    this.decisionRuntime = null;
    this.executionRuntime = null;
    
    this.initializeRuntimes();
  }
  
  initializeRuntimes() {
    // Start runtimes
    this.decisionRuntime = new Worker(
      fileURLToPath(new URL('../decision-runtime/index.js', import.meta.url)),
      { eval: false }
    );
    
    this.executionRuntime = new Worker(
      fileURLToPath(new URL('../execution-runtime/index.js', import.meta.url)),
      { eval: false }
    );
    
    // Set up communication
    this.decisionRuntime.on('message', this.handleDecisionMessage.bind(this));
    this.executionRuntime.on('message', this.handleExecutionMessage.bind(this));
  }
  
  async handleDecisionMessage(msg) {
    // Forward to execution runtime
    this.executionRuntime.postMessage(msg);
  }
  
  async handleExecutionMessage(msg) {
    // Forward back to decision runtime
    this.decisionRuntime.postMessage(msg);
  }
  
  async processRequest(input, context = {}) {
    // Send to decision runtime
    const decisionMessage = {
      type: 'process',
      requestId: `bridge_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      input,
      context
    };
    
    this.decisionRuntime.postMessage(decisionMessage);
    
    // Wait for full cycle completion
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve({ status: 'timeout' });
      }, 30000);
      
      let decisionComplete = false;
      let executionComplete = false;
      
      const decisionHandler = (msg) => {
        if (msg.type === 'result') {
          decisionComplete = true;
        }
      };
      
      const executionHandler = (msg) => {
        if (msg.type === 'execution_complete') {
          executionComplete = true;
        }
      };
      
      this.decisionRuntime.on('message', decisionHandler);
      this.executionRuntime.on('message', executionHandler);
      
      // Wait for both runtimes to complete
      const checkComplete = () => {
        if (decisionComplete && executionComplete) {
          clearTimeout(timeout);
          resolve({ status: 'completed' });
        } else {
          setTimeout(checkComplete, 100);
        }
      };
      
      setTimeout(checkComplete, 100);
    });
  }
  
  getStatus() {
    return {
      decisionRuntime: this.decisionRuntime ? 'running' : 'stopped',
      executionRuntime: this.executionRuntime ? 'running' : 'stopped'
    };
  }
  
  stop() {
    if (this.decisionRuntime) {
      this.decisionRuntime.terminate();
      this.decisionRuntime = null;
    }
    
    if (this.executionRuntime) {
      this.executionRuntime.terminate();
      this.executionRuntime = null;
    }
  }
}

export default RuntimeBridge;

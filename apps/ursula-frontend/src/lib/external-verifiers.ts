// EXTERNAL VERIFIERS - Binding to Real Economic Systems
// No more internal witnesses - only external truth

import { BaseRealityVerifier, VerificationRequest, VerificationResult } from './reality-verifier.js';
import { createHash } from 'crypto';

/**
 * Payment Processor Verifier - Binds to actual payment confirmations
 */
export class PaymentProcessorVerifier extends BaseRealityVerifier {
  private apiKeys: Map<string, string> = new Map();
  
  constructor(verifierId: string, apiKeys: Record<string, string>) {
    super(verifierId, 'payment_processor');
    
    // Store API keys for different processors
    Object.entries(apiKeys).forEach(([processor, key]) => {
      this.apiKeys.set(processor, key);
    });
  }

  async verify(request: VerificationRequest): Promise<VerificationResult> {
    console.log(`   [${this.verifierId}] 🔍 Verifying EXTERNAL payment: ${request.executionId}`);
    
    const paymentData = request.expectedState;
    const processor = paymentData.processor || 'stripe';
    const transactionId = paymentData.transactionId;
    
    if (!transactionId) {
      return this.createFailureResult(request, 'No transaction ID provided');
    }

    // Query ACTUAL payment processor
    const externalConfirmation = await this.queryPaymentProcessor(
      processor, 
      transactionId
    );

    const verified = externalConfirmation.exists && 
                    externalConfirmation.amount === paymentData.amount &&
                    externalConfirmation.status === 'succeeded';

    const result: VerificationResult = {
      executionId: request.executionId,
      uek: request.uek,
      verified,
      expectedState: request.expectedState,
      observedState: {
        ...externalConfirmation,
        verifiedAt: Date.now(),
        source: `${processor}_api`
      },
      verifierId: this.verifierId,
      timestamp: Date.now(),
      verificationProof: ''
    };

    result.verificationProof = this.generateProof(result);

    if (!verified) {
      result.mismatchReason = this.getPaymentMismatchReason(
        paymentData, 
        externalConfirmation
      );
    }

    console.log(`   [${this.verifierId}] ${verified ? '✅' : '❌'} EXTERNAL payment: ${verified ? 'CONFIRMED' : 'NOT FOUND'}`);
    
    return result;
  }

  private async queryPaymentProcessor(
    processor: string, 
    transactionId: string
  ): Promise<any> {
    const apiKey = this.apiKeys.get(processor);
    
    if (!apiKey) {
      throw new Error(`No API key for processor: ${processor}`);
    }

    switch (processor) {
      case 'stripe':
        return await this.queryStripe(transactionId, apiKey);
      case 'paypal':
        return await this.queryPayPal(transactionId, apiKey);
      case 'square':
        return await this.querySquare(transactionId, apiKey);
      default:
        throw new Error(`Unsupported processor: ${processor}`);
    }
  }

  private async queryStripe(transactionId: string, apiKey: string): Promise<any> {
    // REAL Stripe API call
    const url = `https://api.stripe.com/v1/charges/${transactionId}`;
    
    try {
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${apiKey}`
        }
      });

      if (!response.ok) {
        return { exists: false, error: 'Charge not found' };
      }

      const charge = await response.json();
      
      return {
        exists: true,
        id: charge.id,
        amount: charge.amount / 100, // Convert from cents
        status: charge.status,
        currency: charge.currency,
        created: charge.created,
        source: charge.source?.type || 'unknown'
      };
    } catch (error) {
      console.error(`   [${this.verifierId}] Stripe API error:`, error);
      return { exists: false, error: (error as Error).message };
    }
  }

  private async queryPayPal(transactionId: string, apiKey: string): Promise<any> {
    // REAL PayPal API call
    // Implementation would depend on PayPal API version
    return {
      exists: false,
      error: 'PayPal verifier not implemented yet'
    };
  }

  private async querySquare(transactionId: string, apiKey: string): Promise<any> {
    // REAL Square API call
    return {
      exists: false,
      error: 'Square verifier not implemented yet'
    };
  }

  private getPaymentMismatchReason(expected: any, actual: any): string {
    if (!actual.exists) {
      return `Payment ${expected.transactionId} not found in ${expected.processor}`;
    }
    if (actual.amount !== expected.amount) {
      return `Amount mismatch: expected $${expected.amount}, got $${actual.amount}`;
    }
    if (actual.status !== 'succeeded') {
      return `Payment status: ${actual.status} (not succeeded)`;
    }
    return 'Unknown payment verification failure';
  }

  private createFailureResult(request: VerificationRequest, reason: string): VerificationResult {
    return {
      executionId: request.executionId,
      uek: request.uek,
      verified: false,
      expectedState: request.expectedState,
      observedState: { error: reason },
      verifierId: this.verifierId,
      timestamp: Date.now(),
      verificationProof: createHash('sha256').update(reason).digest('hex'),
      mismatchReason: reason
    };
  }
}

/**
 * Hardware Sensor Verifier - Binds to physical world sensors
 */
export class HardwareSensorVerifier extends BaseRealityVerifier {
  private sensorEndpoints: Map<string, string> = new Map();

  constructor(verifierId: string, sensorEndpoints: Record<string, string>) {
    super(verifierId, 'hardware_sensor');
    
    Object.entries(sensorEndpoints).forEach(([sensor, endpoint]) => {
      this.sensorEndpoints.set(sensor, endpoint);
    });
  }

  async verify(request: VerificationRequest): Promise<VerificationResult> {
    console.log(`   [${this.verifierId}] 🔍 Verifying PHYSICAL state: ${request.executionId}`);
    
    const expectedState = request.expectedState;
    const sensorId = expectedState.sensorId;
    const endpoint = this.sensorEndpoints.get(sensorId);
    
    if (!endpoint) {
      return this.createFailureResult(request, `No endpoint for sensor: ${sensorId}`);
    }

    // Query ACTUAL hardware sensor
    const sensorData = await this.querySensor(endpoint, expectedState.query);
    
    const verified = this.compareSensorData(expectedState, sensorData);
    
    const result: VerificationResult = {
      executionId: request.executionId,
      uek: request.uek,
      verified,
      expectedState: request.expectedState,
      observedState: {
        ...sensorData,
        verifiedAt: Date.now(),
        source: `sensor_${sensorId}`
      },
      verifierId: this.verifierId,
      timestamp: Date.now(),
      verificationProof: ''
    };

    result.verificationProof = this.generateProof(result);

    if (!verified) {
      result.mismatchReason = `Sensor mismatch: expected ${JSON.stringify(expectedState.values)}, got ${JSON.stringify(sensorData.values)}`;
    }

    console.log(`   [${this.verifierId}] ${verified ? '✅' : '❌'} PHYSICAL state: ${verified ? 'CONFIRMED' : 'MISMATCH'}`);
    
    return result;
  }

  private async querySensor(endpoint: string, query: any): Promise<any> {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query })
      });

      if (!response.ok) {
        throw new Error(`Sensor query failed: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error(`   [${this.verifierId}] Sensor error:`, error);
      return {
        exists: false,
        error: (error as Error).message,
        values: {}
      };
    }
  }

  private compareSensorData(expected: any, actual: any): boolean {
    if (!actual.values) return false;
    
    for (const [key, expectedValue] of Object.entries(expected.values || {})) {
      const actualValue = actual.values[key];
      
      if (typeof expectedValue === 'number') {
        // Allow tolerance for sensor readings
        const tolerance = expected.tolerance || 0.1;
        if (Math.abs(actualValue - expectedValue) > tolerance) {
          return false;
        }
      } else {
        // Exact match for other types
        if (actualValue !== expectedValue) {
          return false;
        }
      }
    }
    
    return true;
  }

  private createFailureResult(request: VerificationRequest, reason: string): VerificationResult {
    return {
      executionId: request.executionId,
      uek: request.uek,
      verified: false,
      expectedState: request.expectedState,
      observedState: { error: reason },
      verifierId: this.verifierId,
      timestamp: Date.now(),
      verificationProof: createHash('sha256').update(reason).digest('hex'),
      mismatchReason: reason
    };
  }
}

/**
 * Blockchain Verifier - Binds to immutable external ledger
 */
export class BlockchainVerifier extends BaseRealityVerifier {
  private rpcUrl: string;
  private contractAddress: string;

  constructor(verifierId: string, rpcUrl: string, contractAddress: string) {
    super(verifierId, 'blockchain');
    this.rpcUrl = rpcUrl;
    this.contractAddress = contractAddress;
  }

  async verify(request: VerificationRequest): Promise<VerificationResult> {
    console.log(`   [${this.verifierId}] 🔍 Verifying BLOCKCHAIN transaction: ${request.executionId}`);
    
    const txHash = request.expectedState.transactionHash;
    
    if (!txHash) {
      return this.createFailureResult(request, 'No transaction hash provided');
    }

    // Query ACTUAL blockchain
    const txData = await this.queryBlockchain(txHash);
    
    const verified = txData.exists && 
                    txData.status === 'confirmed' &&
                    txData.contractAddress === this.contractAddress;

    const result: VerificationResult = {
      executionId: request.executionId,
      uek: request.uek,
      verified,
      expectedState: request.expectedState,
      observedState: {
        ...txData,
        verifiedAt: Date.now(),
        source: 'blockchain'
      },
      verifierId: this.verifierId,
      timestamp: Date.now(),
      verificationProof: ''
    };

    result.verificationProof = this.generateProof(result);

    if (!verified) {
      result.mismatchReason = txData.exists ? 
        `Transaction ${txHash} not confirmed` : 
        `Transaction ${txHash} not found`;
    }

    console.log(`   [${this.verifierId}] ${verified ? '✅' : '❌'} BLOCKCHAIN: ${verified ? 'CONFIRMED' : 'NOT FOUND'}`);
    
    return result;
  }

  private async queryBlockchain(txHash: string): Promise<any> {
    try {
      // This would use web3.js or ethers.js in real implementation
      // For now, simulate the call
      const response = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_getTransactionReceipt',
          params: [txHash],
          id: 1
        })
      });

      const data = await response.json();
      
      if (data.error) {
        return { exists: false, error: data.error.message };
      }

      const receipt = data.result;
      
      return {
        exists: !!receipt,
        status: receipt && receipt.status === '0x1' ? 'confirmed' : 'failed',
        blockNumber: receipt ? parseInt(receipt.blockNumber, 16) : null,
        gasUsed: receipt ? parseInt(receipt.gasUsed, 16) : null,
        contractAddress: receipt?.to
      };
    } catch (error) {
      console.error(`   [${this.verifierId}] Blockchain error:`, error);
      return { exists: false, error: (error as Error).message };
    }
  }

  private createFailureResult(request: VerificationRequest, reason: string): VerificationResult {
    return {
      executionId: request.executionId,
      uek: request.uek,
      verified: false,
      expectedState: request.expectedState,
      observedState: { error: reason },
      verifierId: this.verifierId,
      timestamp: Date.now(),
      verificationProof: createHash('sha256').update(reason).digest('hex'),
      mismatchReason: reason
    };
  }
}

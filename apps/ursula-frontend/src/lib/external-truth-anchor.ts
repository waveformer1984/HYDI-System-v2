// EXTERNAL TRUTH ANCHOR - No More Internal Witnesses
// Binds verification to authoritative external sources

import { BaseRealityVerifier, VerificationRequest, VerificationResult } from './reality-verifier.js';
import { PaymentProcessorVerifier } from './external-verifiers.js';
import { HardwareSensorVerifier } from './external-verifiers.js';
import { BlockchainVerifier } from './external-verifiers.js';

export interface TruthAnchorConfig {
  paymentProcessors: {
    stripe?: { apiKey: string };
    paypal?: { apiKey: string; secret: string };
    square?: { accessToken: string };
  };
  sensors: {
    [sensorId: string]: {
      endpoint: string;
      type: 'temperature' | 'pressure' | 'position' | 'custom';
    };
  };
  blockchain?: {
    rpcUrl: string;
    contractAddress: string;
  };
}

/**
 * External Truth Anchor - Routes to authoritative external verifiers
 */
export class ExternalTruthAnchor {
  private verifiers: Map<string, BaseRealityVerifier> = new Map();
  private config: TruthAnchorConfig;

  constructor(config: TruthAnchorConfig) {
    this.config = config;
    this.initializeVerifiers();
  }

  private initializeVerifiers(): void {
    // Initialize payment verifiers
    if (this.config.paymentProcessors.stripe) {
      const stripeVerifier = new PaymentProcessorVerifier(
        'stripe_verifier',
        { stripe: this.config.paymentProcessors.stripe.apiKey }
      );
      this.verifiers.set('stripe', stripeVerifier);
    }

    if (this.config.paymentProcessors.paypal) {
      const paypalVerifier = new PaymentProcessorVerifier(
        'paypal_verifier',
        { paypal: this.config.paymentProcessors.paypal.apiKey }
      );
      this.verifiers.set('paypal', paypalVerifier);
    }

    if (this.config.paymentProcessors.square) {
      const squareVerifier = new PaymentProcessorVerifier(
        'square_verifier',
        { square: this.config.paymentProcessors.square.accessToken }
      );
      this.verifiers.set('square', squareVerifier);
    }

    // Initialize hardware sensor verifiers
    Object.entries(this.config.sensors).forEach(([sensorId, sensor]) => {
      const sensorVerifier = new HardwareSensorVerifier(
        `${sensorId}_verifier`,
        { [sensorId]: sensor.endpoint }
      );
      this.verifiers.set(sensorId, sensorVerifier);
    });

    // Initialize blockchain verifier
    if (this.config.blockchain) {
      const blockchainVerifier = new BlockchainVerifier(
        'blockchain_verifier',
        this.config.blockchain.rpcUrl,
        this.config.blockchain.contractAddress
      );
      this.verifiers.set('blockchain', blockchainVerifier);
    }
  }

  /**
   * Verify using EXTERNAL truth source
   */
  async verify(request: VerificationRequest): Promise<VerificationResult> {
    console.log(`\n   🏛️  EXTERNAL TRUTH ANCHOR: ${request.executionId}`);
    console.log(`   Determining authoritative source...`);

    const verifierType = this.determineVerifierType(request);
    const verifier = this.verifiers.get(verifierType);

    if (!verifier) {
      return this.createNoVerifierResult(request, verifierType);
    }

    console.log(`   → Using external verifier: ${verifierType}`);

    // Delegate to EXTERNAL verifier
    const result = await verifier.verify(request);

    // Add external truth metadata
    result.observedState = {
      ...result.observedState,
      externalTruth: {
        source: verifierType,
        authoritative: true,
        internallyGenerated: false
      }
    };

    return result;
  }

  private determineVerifierType(request: VerificationRequest): string {
    const expectedState = request.expectedState;

    // Payment verification
    if (expectedState.processor || expectedState.transactionId) {
      return expectedState.processor || 'stripe';
    }

    // Hardware sensor verification
    if (expectedState.sensorId) {
      return expectedState.sensorId;
    }

    // Blockchain verification
    if (expectedState.transactionHash) {
      return 'blockchain';
    }

    // Default to no verifier
    return 'none';
  }

  private createNoVerifierResult(request: VerificationRequest, type: string): VerificationResult {
    return {
      executionId: request.executionId,
      uek: request.uek,
      verified: false,
      expectedState: request.expectedState,
      observedState: {
        error: `No external verifier available for type: ${type}`,
        internalOnly: true
      },
      verifierId: 'external_truth_anchor',
      timestamp: Date.now(),
      verificationProof: '',
      mismatchReason: `Cannot verify ${type} externally - no authoritative source configured`
    };
  }

  /**
   * Check if verification is external or internal
   */
  async checkVerificationAuthority(executionId: string): Promise<{
    isExternal: boolean;
    source?: string;
    confidence: number;
  }> {
    // This would query the verification results
    // For now, return a placeholder
    return {
      isExternal: false,
      source: 'internal',
      confidence: 0.5
    };
  }

  /**
   * Get verification statistics by source
   */
  async getAuthorityStats(): Promise<{
    external: number;
    internal: number;
    failed: number;
    bySource: Record<string, number>;
  }> {
    // This would aggregate verification results
    // For now, return placeholder
    return {
      external: 0,
      internal: 0,
      failed: 0,
      bySource: {}
    };
  }
}

/**
 * Factory for creating configured truth anchors
 */
export class TruthAnchorFactory {
  static createForProtoForge(): ExternalTruthAnchor {
    const config: TruthAnchorConfig = {
      paymentProcessors: {
        stripe: {
          apiKey: process.env.STRIPE_API_KEY || 'sk_test_placeholder'
        }
      },
      sensors: {
        '3d_printer': {
          endpoint: 'http://localhost:8080/api/printer/status',
          type: 'custom'
        },
        'temperature_sensor': {
          endpoint: 'http://localhost:8081/api/temperature',
          type: 'temperature'
        }
      },
      blockchain: {
        rpcUrl: process.env.ETHEREUM_RPC_URL || 'https://mainnet.infura.io/v3/placeholder',
        contractAddress: process.env.CONTRACT_ADDRESS || '0x0000000000000000000000000000000000000000'
      }
    };

    return new ExternalTruthAnchor(config);
  }

  static createForProduction(env: 'development' | 'staging' | 'production'): ExternalTruthAnchor {
    const configs = {
      development: {
        paymentProcessors: {
          stripe: { apiKey: 'sk_test_dev_key' }
        },
        sensors: {
          'test_sensor': {
            endpoint: 'http://localhost:3000/test',
            type: 'custom' as const
          }
        }
      },
      staging: {
        paymentProcessors: {
          stripe: { apiKey: process.env.STRIPE_STAGING_KEY || 'sk_test_staging' }
        },
        sensors: {
          'staging_printer': {
            endpoint: 'https://staging-api.example.com/printer',
            type: 'custom' as const
          }
        }
      },
      production: {
        paymentProcessors: {
          stripe: { apiKey: process.env.STRIPE_LIVE_KEY || 'REQUIRED' },
          paypal: {
            apiKey: process.env.PAYPAL_LIVE_KEY || 'REQUIRED',
            secret: process.env.PAYPAL_LIVE_SECRET || 'REQUIRED'
          }
        },
        sensors: {
          'production_printer_1': {
            endpoint: 'https://api.prod.com/printer/1',
            type: 'custom' as const
          },
          'production_printer_2': {
            endpoint: 'https://api.prod.com/printer/2',
            type: 'custom' as const
          }
        },
        blockchain: {
          rpcUrl: process.env.PRODUCTION_ETH_RPC || 'REQUIRED',
          contractAddress: process.env.PRODUCTION_CONTRACT || 'REQUIRED'
        }
      }
    };

    return new ExternalTruthAnchor(configs[env]);
  }
}

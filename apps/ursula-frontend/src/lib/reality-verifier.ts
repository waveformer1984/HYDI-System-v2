// REALITY VERIFICATION ENGINE - Independent verification of external state
// The 4th Phase: Don't trust, verify

import { ExecutionReceipt } from './reality-adapter.js';
import { createHash } from 'crypto';

export interface VerificationRequest {
  executionId: string;
  uek: string;
  expectedState: any;
  receipt: ExecutionReceipt;
  verifierType: string;
}

export interface VerificationResult {
  executionId: string;
  uek: string;
  verified: boolean;
  expectedState: any;
  observedState: any;
  mismatchReason?: string;
  verifierId: string;
  timestamp: number;
  verificationProof: string;
}

export interface RealityState {
  execution_id: string;
  expected: string;
  observed: string;
  verified: boolean;
  verifier: string;
  timestamp: number;
  proof_hash: string;
}

export abstract class BaseRealityVerifier {
  readonly verifierId: string;
  readonly verifierType: string;

  constructor(verifierId: string, verifierType: string) {
    this.verifierId = verifierId;
    this.verifierType = verifierType;
  }

  /**
   * Verify that the expected state matches observed reality
   */
  abstract verify(request: VerificationRequest): Promise<VerificationResult>;

  /**
   * Generate verification proof
   */
  protected generateProof(result: VerificationResult): string {
    const proofData = {
      executionId: result.executionId,
      uek: result.uek,
      verified: result.verified,
      expected: result.expectedState,
      observed: result.observedState,
      verifier: result.verifierId,
      timestamp: result.timestamp
    };
    return createHash('sha256').update(JSON.stringify(proofData)).digest('hex');
  }
}

// 3D Printer Specific Verifier
export class Printer3DVerifier extends BaseRealityVerifier {
  private printerApi: any; // Mock printer API

  constructor(verifierId: string, printerApi: any) {
    super(verifierId, '3d_printer');
    this.printerApi = printerApi;
  }

  async verify(request: VerificationRequest): Promise<VerificationResult> {
    console.log(`   [${this.verifierId}] 🔍 Verifying execution: ${request.executionId}`);

    const observedState = await this.queryPrinterState(request.executionId);
    const verified = this.compareStates(request.expectedState, observedState);

    const result: VerificationResult = {
      executionId: request.executionId,
      uek: request.uek,
      verified,
      expectedState: request.expectedState,
      observedState,
      verifierId: this.verifierId,
      timestamp: Date.now(),
      verificationProof: ''
    };

    result.verificationProof = this.generateProof(result);

    if (!verified) {
      result.mismatchReason = this.getMismatchReason(request.expectedState, observedState);
    }

    console.log(`   [${this.verifierId}] ${verified ? '✅' : '❌'} Verification: ${verified ? 'PASSED' : 'FAILED'}`);
    if (!verified) {
      console.log(`   [${this.verifierId}] Mismatch: ${result.mismatchReason}`);
    }

    return result;
  }

  private async queryPrinterState(executionId: string): Promise<any> {
    // In reality, this would query the actual printer
    // For testing, we simulate state checking
    await new Promise(resolve => setTimeout(resolve, 200)); // Simulate API call

    // Mock observed state - in real implementation, this would be actual printer state
    return {
      jobId: executionId,
      status: 'printing', // or 'completed', 'error'
      progress: Math.floor(Math.random() * 100),
      temperature: {
        nozzle: 210,
        bed: 60
      },
      fileOnSD: true,
      startTime: Date.now() - 30000
    };
  }

  private compareStates(expected: any, observed: any): boolean {
    // Define verification rules
    if (expected.jobId && observed.jobId !== expected.jobId) return false;
    if (expected.fileOnSD && !observed.fileOnSD) return false;
    if (expected.status && observed.status !== expected.status) return false;
    
    // Temperature checks
    if (expected.minTemp && observed.temperature.nozzle < expected.minTemp) return false;
    
    return true;
  }

  private getMismatchReason(expected: any, observed: any): string {
    if (expected.jobId && observed.jobId !== expected.jobId) {
      return `Job ID mismatch: expected ${expected.jobId}, got ${observed.jobId}`;
    }
    if (expected.fileOnSD && !observed.fileOnSD) {
      return 'File not found on SD card';
    }
    if (expected.status && observed.status !== expected.status) {
      return `Status mismatch: expected ${expected.status}, got ${observed.status}`;
    }
    return 'Unknown mismatch';
  }
}

// API Call Verifier
export class ApiCallVerifier extends BaseRealityVerifier {
  private apiClient: any;

  constructor(verifierId: string, apiClient: any) {
    super(verifierId, 'api_call');
    this.apiClient = apiClient;
  }

  async verify(request: VerificationRequest): Promise<VerificationResult> {
    console.log(`   [${this.verifierId}] 🔍 Verifying API call: ${request.executionId}`);

    // Query the API to verify the resource was actually created/modified
    const observedState = await this.queryApiState(request.expectedState);
    const verified = this.compareApiStates(request.expectedState, observedState);

    const result: VerificationResult = {
      executionId: request.executionId,
      uek: request.uek,
      verified,
      expectedState: request.expectedState,
      observedState,
      verifierId: this.verifierId,
      timestamp: Date.now(),
      verificationProof: ''
    };

    result.verificationProof = this.generateProof(result);

    console.log(`   [${this.verifierId}] ${verified ? '✅' : '❌'} API verification: ${verified ? 'PASSED' : 'FAILED'}`);

    return result;
  }

  private async queryApiState(expected: any): Promise<any> {
    // Idempotent GET to check resource state
    await new Promise(resolve => setTimeout(resolve, 150));
    
    // Mock response - in reality, would make actual API call
    return {
      resourceId: expected.resourceId,
      exists: true,
      state: expected.expectedState || 'active',
      lastModified: Date.now()
    };
  }

  private compareApiStates(expected: any, observed: any): boolean {
    return observed.exists && observed.state === expected.expectedState;
  }
}

// File System Verifier
export class FileSystemVerifier extends BaseRealityVerifier {
  constructor(verifierId: string) {
    super(verifierId, 'file_system');
  }

  async verify(request: VerificationRequest): Promise<VerificationResult> {
    console.log(`   [${this.verifierId}] 🔍 Verifying file operation: ${request.executionId}`);

    const fs = await import('fs/promises');
    const observedState = await this.queryFileState(request.expectedState);
    const verified = this.compareFileStates(request.expectedState, observedState);

    const result: VerificationResult = {
      executionId: request.executionId,
      uek: request.uek,
      verified,
      expectedState: request.expectedState,
      observedState,
      verifierId: this.verifierId,
      timestamp: Date.now(),
      verificationProof: ''
    };

    result.verificationProof = this.generateProof(result);

    console.log(`   [${this.verifierId}] ${verified ? '✅' : '❌'} File verification: ${verified ? 'PASSED' : 'FAILED'}`);

    return result;
  }

  private async queryFileState(expected: any): Promise<any> {
    try {
      const fs = await import('fs/promises');
      const stats = await fs.stat(expected.filePath);
      
      return {
        exists: true,
        size: stats.size,
        modified: stats.mtime.getTime(),
        checksum: await this.calculateChecksum(expected.filePath)
      };
    } catch {
      return { exists: false };
    }
  }

  private async calculateChecksum(filePath: string): Promise<string> {
    try {
      const fs = await import('fs/promises');
      const data = await fs.readFile(filePath);
      return createHash('sha256').update(data).digest('hex');
    } catch {
      return '';
    }
  }

  private compareFileStates(expected: any, observed: any): boolean {
    if (!observed.exists) return false;
    if (expected.minSize && observed.size < expected.minSize) return false;
    if (expected.checksum && observed.checksum !== expected.checksum) return false;
    return true;
  }
}

/**
 * EXECUTION MEMORY SNAPSHOT
 * 
 * Freeze the decision state before acting
 */

export interface ExecutionSnapshot {
  id: string;
  timestamp: Date;
  input: {
    original: string;
    normalized: string;
    hash: string;
  };
  classification: {
    status: string;
    confidence: number;
    detectedIntents: string[];
    signals: {
      keywordHits: number;
      ambiguity: number;
      uncertainty: number;
      qualityScore: number;
    };
  };
  decision: {
    allow: boolean;
    reason: string;
    requiresConfirmation: boolean;
    confidenceThreshold: number;
    riskLevel: string;
  };
  recovery: {
    status: string;
    type: string;
    suggestions: string[];
    bestGuess?: any;
  };
  integrity: {
    checksum: string;
    lockedAt: Date;
    anyChanges: boolean;
  };
}

export function createExecutionSnapshot(
  input: string,
  classification: any,
  decision: any,
  recovery: any
): ExecutionSnapshot {
  
  const timestamp = new Date();
  const id = `exec_${timestamp.getTime()}_${Math.random().toString(36).substr(2, 9)}`;
  
  // Create checksum of the entire decision state
  const stateString = JSON.stringify({
    input,
    classification,
    decision,
    recovery
  });
  
  const checksum = simpleHash(stateString);
  
  return {
    id,
    timestamp,
    input: {
      original: input,
      normalized: input.toLowerCase().trim(),
      hash: simpleHash(input)
    },
    classification: {
      status: classification.status,
      confidence: classification.confidence,
      detectedIntents: classification.meta?.detectedIntents || [],
      signals: classification.meta?.signals || {}
    },
    decision: {
      allow: decision.allow,
      reason: decision.reason,
      requiresConfirmation: decision.requiresConfirmation,
      confidenceThreshold: decision.confidenceThreshold,
      riskLevel: decision.riskLevel || 'medium'
    },
    recovery: {
      status: (recovery as any).status || 'none',
      type: (recovery as any).recovery?.type || 'none',
      suggestions: (recovery as any).recovery?.suggestions || [],
      bestGuess: (recovery as any).recovery?.bestGuess
    },
    integrity: {
      checksum,
      lockedAt: timestamp,
      anyChanges: false
    }
  };
}

export function verifySnapshotIntegrity(snapshot: ExecutionSnapshot): {
  valid: boolean;
  changes: string[];
} {
  const changes: string[] = [];
  
  // Recreate checksum from current state
  const currentState = JSON.stringify({
    input: snapshot.input,
    classification: snapshot.classification,
    decision: snapshot.decision,
    recovery: snapshot.recovery
  });
  
  const currentChecksum = simpleHash(currentState);
  
  if (currentChecksum !== snapshot.integrity.checksum) {
    changes.push('State checksum mismatch - possible mid-flight changes');
  }
  
  // Check for time-based anomalies
  const now = new Date();
  const timeDiff = now.getTime() - snapshot.integrity.lockedAt.getTime();
  
  if (timeDiff > 30000) { // 30 seconds
    changes.push(`Snapshot is ${Math.round(timeDiff/1000)}s old - possible stale state`);
  }
  
  return {
    valid: changes.length === 0,
    changes
  };
}

export function freezeSnapshot(snapshot: ExecutionSnapshot): ExecutionSnapshot {
  return {
    ...snapshot,
    integrity: {
      ...snapshot.integrity,
      lockedAt: new Date(),
      anyChanges: false
    }
  };
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString(36);
}

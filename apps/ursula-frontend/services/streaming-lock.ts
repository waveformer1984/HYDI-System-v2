/**
 * STREAMING STATUS LOCK
 * 
 * Prevents mid-stream decision changes that feel like instability
 */

export interface StreamingLock {
  lockedStatus: string;
  lockedConfidence: number;
  lockedTimestamp: Date;
  allowUpdates: boolean;
}

export function createStreamingLock(response: any): StreamingLock {
  return {
    lockedStatus: response.status,
    lockedConfidence: response.confidence,
    lockedTimestamp: new Date(),
    allowUpdates: false // Lock decisions immediately
  };
}

export function canStreamContent(lock: StreamingLock, currentResponse: any): boolean {
  // Allow streaming content, but not status changes
  if (lock.allowUpdates) return true;
  
  // Only allow if status and confidence haven't changed
  return (
    currentResponse.status === lock.lockedStatus &&
    Math.abs(currentResponse.confidence - lock.lockedConfidence) < 0.01
  );
}

export function formatStreamingChunk(
  content: any,
  lock: StreamingLock
): {
  type: 'content' | 'status_change' | 'error';
  data: any;
  shouldContinue: boolean;
} {
  
  // Try to detect if this is a status change
  const isStatusChange = content.status !== lock.lockedStatus;
  const isConfidenceChange = Math.abs((content.confidence || 0) - lock.lockedConfidence) > 0.01;
  
  if (isStatusChange || isConfidenceChange) {
    return {
      type: 'status_change',
      data: {
        message: "Decision changed mid-stream - stopping to prevent instability",
        previousStatus: lock.lockedStatus,
        newStatus: content.status,
        previousConfidence: lock.lockedConfidence,
        newConfidence: content.confidence
      },
      shouldContinue: false
    };
  }
  
  // Safe to stream content
  return {
    type: 'content',
    data: content,
    shouldContinue: true
  };
}

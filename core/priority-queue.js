require('dotenv').config();

class PriorityEventQueue {
  constructor(maxSize = 1000) {
    this.queues = {
      high: [],
      normal: [],
      low: []
    };
    this.maxSize = maxSize;
    this.processing = false;
    this.stats = {
      processed: 0,
      dropped: 0,
      throttled: 0
    };
  }

  // Add event to appropriate priority queue
  enqueue(event, priority) {
    // Check if we're at capacity and need to shed load
    if (this.getTotalSize() >= this.maxSize) {
      return this.shedLoad(event, priority);
    }

    this.queues[priority].push(event);
    return { enqueued: true, priority };
  }

  // Load shedding: drop low priority events first
  shedLoad(event, priority) {
    // Always accept high priority events
    if (priority === 'high') {
      // Drop oldest low priority event to make room
      if (this.queues.low.length > 0) {
        this.queues.low.shift();
        this.queues.high.push(event);
        this.stats.dropped++;
        return { enqueued: true, priority, action: 'dropped_low_priority' };
      }
    }

    // Throttle normal priority events under load
    if (priority === 'normal' && Math.random() < 0.5) {
      this.stats.throttled++;
      return { enqueued: false, reason: 'throttled', priority };
    }

    // Drop low priority events under load
    if (priority === 'low') {
      this.stats.dropped++;
      return { enqueued: false, reason: 'dropped', priority };
    }

    // Try to enqueue anyway if we can't shed
    if (this.getTotalSize() < this.maxSize * 1.1) { // 10% buffer
      this.queues[priority].push(event);
      return { enqueued: true, priority };
    }

    this.stats.dropped++;
    return { enqueued: false, reason: 'capacity_exceeded', priority };
  }

  // Get next event by priority
  dequeue() {
    // Process high priority first, then normal, then low
    for (const priority of ['high', 'normal', 'low']) {
      if (this.queues[priority].length > 0) {
        const event = this.queues[priority].shift();
        this.stats.processed++;
        return { event, priority };
      }
    }
    return null;
  }

  getTotalSize() {
    return this.queues.high.length + this.queues.normal.length + this.queues.low.length;
  }

  getQueueStats() {
    return {
      high: this.queues.high.length,
      normal: this.queues.normal.length,
      low: this.queues.low.length,
      total: this.getTotalSize(),
      stats: this.stats
    };
  }

  // Clear all queues (for testing)
  clear() {
    this.queues = { high: [], normal: [], low: [] };
    this.processing = false;
  }
}

module.exports = { PriorityEventQueue };

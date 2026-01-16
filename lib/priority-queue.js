/**
 * GoodFlows Priority Queue
 *
 * Ensures critical findings are processed before lower-priority ones.
 * Integrates with SessionContextManager for state persistence.
 *
 * @module goodflows/lib/priority-queue
 */

/**
 * Priority levels (lower number = higher priority)
 */
export const PRIORITY = {
  URGENT: 1,      // P1 - Critical security issues
  HIGH: 2,        // P2 - Potential bugs
  NORMAL: 3,      // P3 - Refactoring, performance
  LOW: 4,         // P4 - Documentation
};

/**
 * Map finding types to priority levels
 */
export const TYPE_TO_PRIORITY = {
  critical_security: PRIORITY.URGENT,
  potential_issue: PRIORITY.HIGH,
  refactor_suggestion: PRIORITY.NORMAL,
  performance: PRIORITY.NORMAL,
  documentation: PRIORITY.LOW,
};

/**
 * Queue item states
 */
export const ITEM_STATE = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  SKIPPED: 'skipped',
};

/**
 * PriorityQueue - Processes findings in priority order
 *
 * ## How It Works
 *
 * The Priority Queue ensures that critical security issues are always
 * handled before lower-priority items like documentation fixes.
 *
 * ```
 * Without Priority Queue:
 *   [doc, bug, SECURITY, perf, bug] → processed in discovery order
 *                  ↓
 *   SECURITY issue processed 3rd (too late!)
 *
 * With Priority Queue:
 *   [doc, bug, SECURITY, perf, bug]
 *                  ↓ sorted
 *   [SECURITY, bug, bug, perf, doc] → critical first!
 * ```
 *
 * ## Features
 *
 * - **Auto-sorting** - Items automatically sorted by priority on enqueue
 * - **Batch processing** - Process multiple items with configurable concurrency
 * - **Throttling** - Rate limiting to avoid overwhelming APIs
 * - **State tracking** - Track pending, processing, completed, failed items
 * - **Session integration** - Persists state to session context
 *
 * ## Usage Example
 *
 * ```javascript
 * const queue = new PriorityQueue();
 *
 * // Add findings (auto-sorted by priority)
 * queue.enqueue({ type: 'documentation', file: 'README.md' });
 * queue.enqueue({ type: 'critical_security', file: 'auth.js' });
 * queue.enqueue({ type: 'potential_issue', file: 'api.js' });
 *
 * // Process in priority order
 * while (!queue.isEmpty()) {
 *   const item = queue.dequeue();
 *   // item.type === 'critical_security' (first!)
 *   // then 'potential_issue', then 'documentation'
 * }
 * ```
 */
export class PriorityQueue {
  constructor(options = {}) {
    this.items = [];
    this.processed = [];
    this.failed = [];
    this.skipped = [];

    // Configuration
    this.throttleMs = options.throttleMs || 0;        // Delay between items
    this.maxRetries = options.maxRetries || 3;        // Retry failed items
    this.batchSize = options.batchSize || 1;          // Items per batch
    this.priorityThreshold = options.priorityThreshold || PRIORITY.LOW;  // Filter
    this.maxSize = options.maxSize || 0;              // Max queue size (0 = unlimited)
    this.evicted = [];                                // Evicted items when maxSize exceeded

    // State
    this.isProcessing = false;
    this.isPaused = false;
    this.currentItem = null;

    // Session integration
    this.sessionManager = options.sessionManager || null;

    // Callbacks
    this.onProcess = options.onProcess || null;       // Called for each item
    this.onComplete = options.onComplete || null;     // Called when queue empty
    this.onError = options.onError || null;           // Called on error
  }

  /**
   * Get priority for a finding
   */
  getPriority(item) {
    if (typeof item.priority === 'number') {
      return item.priority;
    }
    return TYPE_TO_PRIORITY[item.type] || PRIORITY.LOW;
  }

  /**
   * Add an item to the queue (auto-sorted by priority)
   */
  enqueue(item) {
    const priority = this.getPriority(item);

    // Filter by threshold
    if (priority > this.priorityThreshold) {
      this.skipped.push({
        ...item,
        _queueMeta: {
          skippedAt: new Date().toISOString(),
          reason: `Priority ${priority} below threshold ${this.priorityThreshold}`,
        },
      });
      return false;
    }

    const queueItem = {
      ...item,
      _queueMeta: {
        id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        priority,
        enqueuedAt: new Date().toISOString(),
        state: ITEM_STATE.PENDING,
        attempts: 0,
      },
    };

    // Insert in priority order (binary search for efficiency)
    const insertIndex = this._findInsertIndex(priority);
    this.items.splice(insertIndex, 0, queueItem);

    // Evict lowest priority items if maxSize exceeded
    if (this.maxSize > 0 && this.items.length > this.maxSize) {
      const evictCount = this.items.length - this.maxSize;
      const evictedItems = this.items.splice(this.maxSize, evictCount);
      for (const evictedItem of evictedItems) {
        evictedItem._queueMeta.state = ITEM_STATE.SKIPPED;
        evictedItem._queueMeta.evictedAt = new Date().toISOString();
        evictedItem._queueMeta.evictReason = 'Queue maxSize exceeded';
        this.evicted.push(evictedItem);
      }
    }

    // Update session context
    this._syncToSession();

    return true;
  }

  /**
   * Add multiple items at once
   */
  enqueueAll(items) {
    const results = items.map((item) => this.enqueue(item));
    return {
      added: results.filter(Boolean).length,
      skipped: results.filter((r) => !r).length,
    };
  }

  /**
   * Binary search to find insert position
   */
  _findInsertIndex(priority) {
    let low = 0;
    let high = this.items.length;

    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (this.items[mid]._queueMeta.priority <= priority) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }

    return low;
  }

  /**
   * Remove and return the highest priority item
   */
  dequeue() {
    if (this.isEmpty()) return null;

    const item = this.items.shift();
    item._queueMeta.state = ITEM_STATE.PROCESSING;
    item._queueMeta.startedAt = new Date().toISOString();
    this.currentItem = item;

    this._syncToSession();
    return item;
  }

  /**
   * Peek at the next item without removing it
   */
  peek() {
    return this.items[0] || null;
  }

  /**
   * Check if queue is empty
   */
  isEmpty() {
    return this.items.length === 0;
  }

  /**
   * Get queue length
   */
  size() {
    return this.items.length;
  }

  /**
   * Mark current item as completed
   */
  markCompleted(result = {}, item = null) {
    const targetItem = item || this.currentItem;
    if (!targetItem) return;

    targetItem._queueMeta.state = ITEM_STATE.COMPLETED;
    targetItem._queueMeta.completedAt = new Date().toISOString();
    targetItem._queueMeta.result = result;

    this.processed.push(targetItem);
    if (!item) {
      this.currentItem = null;
    }

    this._syncToSession();
  }

  /**
   * Mark current item as failed (may retry)
   */
  markFailed(error, item = null) {
    const targetItem = item || this.currentItem;
    if (!targetItem) return;

    targetItem._queueMeta.attempts++;
    targetItem._queueMeta.lastError = error instanceof Error ? error.message : error;

    if (targetItem._queueMeta.attempts < this.maxRetries) {
      // Re-queue for retry (at same priority position)
      targetItem._queueMeta.state = ITEM_STATE.PENDING;
      const insertIndex = this._findInsertIndex(targetItem._queueMeta.priority);
      this.items.splice(insertIndex, 0, targetItem);
    } else {
      // Max retries exceeded
      targetItem._queueMeta.state = ITEM_STATE.FAILED;
      targetItem._queueMeta.failedAt = new Date().toISOString();
      this.failed.push(targetItem);
    }

    if (!item) {
      this.currentItem = null;
    }
    this._syncToSession();
  }

  /**
   * Skip current item
   */
  markSkipped(reason) {
    if (!this.currentItem) return;

    this.currentItem._queueMeta.state = ITEM_STATE.SKIPPED;
    this.currentItem._queueMeta.skippedAt = new Date().toISOString();
    this.currentItem._queueMeta.skipReason = reason;

    this.skipped.push(this.currentItem);
    this.currentItem = null;

    this._syncToSession();
  }

  /**
   * Process all items in queue with optional handler
   */
  async processAll(handler) {
    const processor = handler || this.onProcess;
    if (!processor) {
      throw new Error('No handler provided for processAll');
    }

    this.isProcessing = true;
    const results = [];

    while (!this.isEmpty() && !this.isPaused) {
      const item = this.dequeue();

      try {
        // Throttle if configured
        if (this.throttleMs > 0 && results.length > 0) {
          await this._sleep(this.throttleMs);
        }

        const result = await processor(item);
        this.markCompleted(result);
        results.push({ item, status: 'completed', result });

      } catch (error) {
        this.markFailed(error);
        results.push({ item, status: 'failed', error: error.message });

        if (this.onError) {
          this.onError(error, item);
        }
      }
    }

    this.isProcessing = false;

    if (this.onComplete && this.isEmpty()) {
      this.onComplete(this.getStats());
    }

    return results;
  }

  /**
   * Process items in batches
   */
  async processBatch(handler, batchSize = this.batchSize) {
    const processor = handler || this.onProcess;
    if (!processor) {
      throw new Error('No handler provided for processBatch');
    }

    const batch = [];
    const batchCount = Math.min(batchSize, this.items.length);

    for (let i = 0; i < batchCount; i++) {
      batch.push(this.dequeue());
    }

    const results = await Promise.allSettled(
      batch.map(async (item) => {
        try {
          const result = await processor(item);
          this.markCompleted(result, item);
          return { item, status: 'completed', result };
        } catch (error) {
          this.markFailed(error, item);
          return { item, status: 'failed', error: error.message };
        }
      }),
    );

    return results.map((r, i) =>
      r.status === 'fulfilled'
        ? r.value
        : { item: batch[i], status: 'failed', error: r.reason?.message || String(r.reason) },
    );
  }

  /**
   * Pause processing
   */
  pause() {
    this.isPaused = true;
  }

  /**
   * Resume processing
   */
  resume() {
    this.isPaused = false;
  }

  /**
   * Clear the queue
   */
  clear() {
    this.items = [];
    this.currentItem = null;
    this._syncToSession();
  }

  /**
   * Get items grouped by priority
   */
  getByPriority() {
    const groups = {
      [PRIORITY.URGENT]: [],
      [PRIORITY.HIGH]: [],
      [PRIORITY.NORMAL]: [],
      [PRIORITY.LOW]: [],
    };

    for (const item of this.items) {
      const priority = item._queueMeta.priority;
      if (groups[priority]) {
        groups[priority].push(item);
      }
    }

    return groups;
  }

  /**
   * Get queue statistics
   */
  getStats() {
    const byPriority = this.getByPriority();

    return {
      pending: this.items.length,
      processing: this.currentItem ? 1 : 0,
      completed: this.processed.length,
      failed: this.failed.length,
      skipped: this.skipped.length,
      evicted: this.evicted.length,
      maxSize: this.maxSize,
      total: this.items.length + this.processed.length + this.failed.length + this.skipped.length + this.evicted.length,
      byPriority: {
        urgent: byPriority[PRIORITY.URGENT].length,
        high: byPriority[PRIORITY.HIGH].length,
        normal: byPriority[PRIORITY.NORMAL].length,
        low: byPriority[PRIORITY.LOW].length,
      },
    };
  }

  /**
   * Get all items in a specific state
   */
  getItems(state = null) {
    if (!state) {
      return {
        pending: this.items,
        completed: this.processed,
        failed: this.failed,
        skipped: this.skipped,
        evicted: this.evicted,
      };
    }

    switch (state) {
      case ITEM_STATE.PENDING:
        return this.items;
      case ITEM_STATE.COMPLETED:
        return this.processed;
      case ITEM_STATE.FAILED:
        return this.failed;
      case ITEM_STATE.SKIPPED:
        return this.skipped;
      case 'evicted':
        return this.evicted;
      default:
        return [];
    }
  }

  /**
   * Retry all failed items
   */
  retryFailed() {
    const toRetry = this.failed.splice(0);

    for (const item of toRetry) {
      item._queueMeta.attempts = 0;
      item._queueMeta.state = ITEM_STATE.PENDING;
      delete item._queueMeta.failedAt;
      delete item._queueMeta.lastError;
      this.enqueue(item);
    }

    return toRetry.length;
  }

  /**
   * Sync queue state to session context
   */
  _syncToSession() {
    if (!this.sessionManager) return;

    this.sessionManager.set('queue.pending', this.items.length);
    this.sessionManager.set('queue.completed', this.processed.length);
    this.sessionManager.set('queue.failed', this.failed.length);
    this.sessionManager.set('queue.stats', this.getStats());
  }

  /**
   * Load queue state from session context
   */
  loadFromSession(sessionManager) {
    this.sessionManager = sessionManager;

    const pendingItems = sessionManager.get('queue.items', []);
    if (pendingItems.length > 0) {
      this.enqueueAll(pendingItems);
    }
  }

  /**
   * Sleep helper for throttling
   */
  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Create a priority queue from an array of findings
   */
  static fromFindings(findings, options = {}) {
    const queue = new PriorityQueue(options);
    queue.enqueueAll(findings);
    return queue;
  }
}

/**
 * Create a priority queue with default settings
 */
export function createPriorityQueue(options = {}) {
  return new PriorityQueue(options);
}

/**
 * Quick sort findings by priority without using queue
 */
export function sortByPriority(findings) {
  return [...findings].sort((a, b) => {
    const priorityA = TYPE_TO_PRIORITY[a.type] || PRIORITY.LOW;
    const priorityB = TYPE_TO_PRIORITY[b.type] || PRIORITY.LOW;
    return priorityA - priorityB;
  });
}

/**
 * Filter findings by priority threshold
 */
export function filterByPriority(findings, threshold = PRIORITY.LOW) {
  return findings.filter((f) => {
    const priority = TYPE_TO_PRIORITY[f.type] || PRIORITY.LOW;
    return priority <= threshold;
  });
}

/**
 * Group findings by priority level
 */
export function groupByPriority(findings) {
  const groups = {
    urgent: [],   // P1
    high: [],     // P2
    normal: [],   // P3
    low: [],      // P4
  };

  for (const finding of findings) {
    const priority = TYPE_TO_PRIORITY[finding.type] || PRIORITY.LOW;
    switch (priority) {
      case PRIORITY.URGENT:
        groups.urgent.push(finding);
        break;
      case PRIORITY.HIGH:
        groups.high.push(finding);
        break;
      case PRIORITY.NORMAL:
        groups.normal.push(finding);
        break;
      case PRIORITY.LOW:
        groups.low.push(finding);
        break;
    }
  }

  return groups;
}

export default {
  PriorityQueue,
  createPriorityQueue,
  sortByPriority,
  filterByPriority,
  groupByPriority,
  PRIORITY,
  TYPE_TO_PRIORITY,
  ITEM_STATE,
};

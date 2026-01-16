/**
 * Unit tests for PriorityQueue
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  PriorityQueue,
  createPriorityQueue,
  sortByPriority,
  filterByPriority,
  groupByPriority,
  PRIORITY,
  TYPE_TO_PRIORITY,
  ITEM_STATE,
} from '../../lib/priority-queue.js';

describe('PriorityQueue', () => {
  let queue;

  beforeEach(() => {
    queue = new PriorityQueue();
  });

  describe('constructor', () => {
    it('should create empty queue', () => {
      expect(queue.isEmpty()).toBe(true);
      expect(queue.size()).toBe(0);
    });

    it('should use default priority threshold', () => {
      expect(queue.priorityThreshold).toBe(PRIORITY.LOW);
    });
  });

  describe('enqueue', () => {
    it('should add items and sort by priority', () => {
      queue.enqueue({ type: 'documentation', description: 'Docs' }); // P4
      queue.enqueue({ type: 'critical_security', description: 'Critical' }); // P1
      queue.enqueue({ type: 'potential_issue', description: 'Bug' }); // P2

      expect(queue.size()).toBe(3);

      const first = queue.peek();
      expect(first.type).toBe('critical_security');
    });

    it('should use explicit priority when provided', () => {
      queue.enqueue({ description: 'Low', priority: 4 });
      queue.enqueue({ description: 'Urgent', priority: 1 });
      queue.enqueue({ description: 'High', priority: 2 });

      expect(queue.peek()._queueMeta.priority).toBe(1);
    });

    it('should return true when item is added', () => {
      const result = queue.enqueue({ type: 'bug', description: 'Test' });
      expect(result).toBe(true);
    });

    it('should skip items below priority threshold', () => {
      queue = new PriorityQueue({ priorityThreshold: PRIORITY.HIGH });

      queue.enqueue({ type: 'critical_security' }); // P1 - added
      queue.enqueue({ type: 'potential_issue' });   // P2 - added
      queue.enqueue({ type: 'documentation' });     // P4 - skipped

      expect(queue.size()).toBe(2);
      expect(queue.skipped).toHaveLength(1);
    });

    it('should evict lowest priority items when maxSize exceeded', () => {
      queue = new PriorityQueue({ maxSize: 2 });

      queue.enqueue({ type: 'documentation', id: 'low' });     // P4
      queue.enqueue({ type: 'critical_security', id: 'urgent' }); // P1
      queue.enqueue({ type: 'potential_issue', id: 'high' });   // P2 - evicts 'low'

      expect(queue.size()).toBe(2);
      expect(queue.evicted).toHaveLength(1);
      expect(queue.evicted[0].id).toBe('low');
      expect(queue.evicted[0]._queueMeta.evictReason).toBe('Queue maxSize exceeded');
    });

    it('should evict multiple items to maintain maxSize', () => {
      queue = new PriorityQueue({ maxSize: 2 });

      // Add 4 items - 2 should be evicted
      queue.enqueue({ type: 'documentation', id: '1' });      // P4 - will be evicted
      queue.enqueue({ type: 'performance', id: '2' });        // P3 - will be evicted
      queue.enqueue({ type: 'potential_issue', id: '3' });    // P2 - kept
      queue.enqueue({ type: 'critical_security', id: '4' });  // P1 - kept

      expect(queue.size()).toBe(2);
      expect(queue.evicted).toHaveLength(2);
      // Evicted items should be lowest priority
      expect(queue.evicted.map(e => e.id).sort()).toEqual(['1', '2']);
    });

    it('should not evict when maxSize is 0 (unlimited)', () => {
      queue = new PriorityQueue({ maxSize: 0 });

      for (let i = 0; i < 100; i++) {
        queue.enqueue({ type: 'documentation', id: i });
      }

      expect(queue.size()).toBe(100);
      expect(queue.evicted).toHaveLength(0);
    });
  });

  describe('dequeue', () => {
    it('should return and remove highest priority item', () => {
      queue.enqueue({ type: 'documentation', description: 'Low' });
      queue.enqueue({ type: 'critical_security', description: 'Urgent' });

      const item = queue.dequeue();

      expect(item.type).toBe('critical_security');
      expect(queue.size()).toBe(1);
    });

    it('should return null when empty', () => {
      expect(queue.dequeue()).toBeNull();
    });
  });

  describe('peek', () => {
    it('should return highest priority without removing', () => {
      queue.enqueue({ type: 'bug', description: 'Bug' });

      const first = queue.peek();
      const second = queue.peek();

      expect(first.description).toBe(second.description);
      expect(queue.size()).toBe(1);
    });

    it('should return null when empty', () => {
      expect(queue.peek()).toBeNull();
    });
  });

  describe('markCompleted', () => {
    it('should move item to processed list', () => {
      queue.enqueue({ type: 'bug', description: 'Test' });
      queue.dequeue(); // sets currentItem

      queue.markCompleted({ result: 'fixed' }); // operates on currentItem

      expect(queue.processed).toHaveLength(1);
      expect(queue.processed[0]._queueMeta.result.result).toBe('fixed');
    });
  });

  describe('markFailed', () => {
    it('should requeue item up to max retries', () => {
      queue = new PriorityQueue({ maxRetries: 2 });
      queue.enqueue({ type: 'bug', description: 'Test' });

      queue.dequeue(); // sets currentItem
      queue.markFailed('First failure'); // operates on currentItem

      // Should be requeued
      expect(queue.size()).toBe(1);
      expect(queue.peek()._queueMeta.attempts).toBe(1);

      // Dequeue and fail again
      queue.dequeue();
      queue.markFailed('Second failure');

      // Max retries reached, should be in failed list
      expect(queue.size()).toBe(0);
      expect(queue.failed).toHaveLength(1);
    });
  });

  describe('getStats', () => {
    it('should return accurate statistics', () => {
      queue.enqueue({ type: 'critical_security', description: 'P1' });
      queue.enqueue({ type: 'potential_issue', description: 'P2' });
      queue.enqueue({ type: 'refactor_suggestion', description: 'P3' });
      queue.enqueue({ type: 'documentation', description: 'P4' });

      queue.dequeue(); // sets currentItem
      queue.markCompleted(); // operates on currentItem

      const stats = queue.getStats();

      expect(stats.pending).toBe(3);
      expect(stats.completed).toBe(1); // API uses 'completed' not 'processed'
      expect(stats.total).toBe(4);
    });

    it('should include evicted count in stats', () => {
      queue = new PriorityQueue({ maxSize: 2 });

      queue.enqueue({ type: 'documentation' });      // P4 - evicted
      queue.enqueue({ type: 'potential_issue' });    // P2
      queue.enqueue({ type: 'critical_security' });  // P1

      const stats = queue.getStats();

      expect(stats.pending).toBe(2);
      expect(stats.evicted).toBe(1);
      expect(stats.maxSize).toBe(2);
      expect(stats.total).toBe(3); // 2 pending + 1 evicted
    });
  });

  describe('isEmpty', () => {
    it('should return true when empty', () => {
      expect(queue.isEmpty()).toBe(true);
    });

    it('should return false when has items', () => {
      queue.enqueue({ type: 'bug' });
      expect(queue.isEmpty()).toBe(false);
    });
  });

  describe('size', () => {
    it('should return number of pending items', () => {
      queue.enqueue({ type: 'bug' });
      queue.enqueue({ type: 'security' });
      expect(queue.size()).toBe(2);

      queue.dequeue();
      expect(queue.size()).toBe(1);
    });
  });
});

describe('PRIORITY constants', () => {
  it('should have correct values', () => {
    expect(PRIORITY.URGENT).toBe(1);
    expect(PRIORITY.HIGH).toBe(2);
    expect(PRIORITY.NORMAL).toBe(3);
    expect(PRIORITY.LOW).toBe(4);
  });
});

describe('TYPE_TO_PRIORITY mapping', () => {
  it('should map security to urgent', () => {
    expect(TYPE_TO_PRIORITY.critical_security).toBe(PRIORITY.URGENT);
  });

  it('should map bugs to high', () => {
    expect(TYPE_TO_PRIORITY.potential_issue).toBe(PRIORITY.HIGH);
  });

  it('should map refactoring to normal', () => {
    expect(TYPE_TO_PRIORITY.refactor_suggestion).toBe(PRIORITY.NORMAL);
    expect(TYPE_TO_PRIORITY.performance).toBe(PRIORITY.NORMAL);
  });

  it('should map docs to low', () => {
    expect(TYPE_TO_PRIORITY.documentation).toBe(PRIORITY.LOW);
  });
});

describe('ITEM_STATE constants', () => {
  it('should have correct values', () => {
    expect(ITEM_STATE.PENDING).toBe('pending');
    expect(ITEM_STATE.PROCESSING).toBe('processing');
    expect(ITEM_STATE.COMPLETED).toBe('completed');
    expect(ITEM_STATE.FAILED).toBe('failed');
    expect(ITEM_STATE.SKIPPED).toBe('skipped');
  });
});

describe('sortByPriority', () => {
  it('should sort items by priority', () => {
    const items = [
      { type: 'documentation' },
      { type: 'critical_security' },
      { type: 'potential_issue' },
    ];

    const sorted = sortByPriority(items);

    expect(sorted[0].type).toBe('critical_security');
    expect(sorted[1].type).toBe('potential_issue');
    expect(sorted[2].type).toBe('documentation');
  });
});

describe('filterByPriority', () => {
  it('should filter items at or above threshold', () => {
    const items = [
      { type: 'critical_security' },
      { type: 'potential_issue' },
      { type: 'refactor_suggestion' },
      { type: 'documentation' },
    ];

    const filtered = filterByPriority(items, PRIORITY.HIGH);

    expect(filtered).toHaveLength(2);
    expect(filtered.every(i => TYPE_TO_PRIORITY[i.type] <= PRIORITY.HIGH)).toBe(true);
  });
});

describe('groupByPriority', () => {
  it('should group items by priority level', () => {
    const items = [
      { type: 'critical_security' },
      { type: 'potential_issue' },
      { type: 'potential_issue' },
      { type: 'documentation' },
    ];

    const groups = groupByPriority(items);

    // API uses string keys: urgent, high, normal, low
    expect(groups.urgent).toHaveLength(1);
    expect(groups.high).toHaveLength(2);
    expect(groups.low).toHaveLength(1);
  });
});

describe('createPriorityQueue', () => {
  it('should create queue with default options', () => {
    const queue = createPriorityQueue();
    expect(queue).toBeInstanceOf(PriorityQueue);
    expect(queue.isEmpty()).toBe(true);
  });

  it('should accept options', () => {
    const queue = createPriorityQueue({
      priorityThreshold: PRIORITY.HIGH,
      maxRetries: 5,
    });

    expect(queue.priorityThreshold).toBe(PRIORITY.HIGH);
    expect(queue.maxRetries).toBe(5);
  });
});

describe('processBatch race condition fixes', () => {
  let queue;

  beforeEach(() => {
    queue = new PriorityQueue();
  });

  describe('concurrent item processing', () => {
    it('should handle multiple items in parallel without race conditions', async () => {
      // Add 3 items to process in batch
      queue.enqueue({ type: 'critical_security', description: 'Security issue 1' });
      queue.enqueue({ type: 'potential_issue', description: 'Bug issue 2' });
      queue.enqueue({ type: 'refactor_suggestion', description: 'Refactor issue 3' });

      expect(queue.size()).toBe(3);

      // Handler that simulates async processing with different completion times
      const processedItems = [];
      const handler = async (item) => {
        // Simulate variable processing time
        const delay = item.type === 'critical_security' ? 50 :
                      item.type === 'potential_issue' ? 30 : 10;
        await new Promise((resolve) => setTimeout(resolve, delay));
        processedItems.push(item.description);
        return { processed: item.description };
      };

      // Process batch with concurrency
      const results = await queue.processBatch(handler, 3);

      // Verify all items completed
      expect(results).toHaveLength(3);
      expect(results.every((r) => r.status === 'completed')).toBe(true);

      // Verify queue is empty (all items dequeued)
      expect(queue.isEmpty()).toBe(true);

      // Verify all items moved to processed list
      expect(queue.processed).toHaveLength(3);

      // Verify each item has correct metadata
      for (const processedItem of queue.processed) {
        expect(processedItem._queueMeta.state).toBe(ITEM_STATE.COMPLETED);
        expect(processedItem._queueMeta.completedAt).toBeDefined();
        expect(processedItem._queueMeta.result).toBeDefined();
      }

      // Verify no items failed
      expect(queue.failed).toHaveLength(0);

      // Verify all 3 items were processed
      expect(processedItems).toHaveLength(3);
    });

    it('should process items with correct individual results', async () => {
      queue.enqueue({ type: 'critical_security', id: 'item1' });
      queue.enqueue({ type: 'potential_issue', id: 'item2' });
      queue.enqueue({ type: 'refactor_suggestion', id: 'item3' });

      // Handler that returns item-specific results
      const handler = async (item) => {
        return { itemId: item.id, processed: true };
      };

      const results = await queue.processBatch(handler, 3);

      // Verify each result matches the correct item
      expect(results[0].result.itemId).toBe('item1');
      expect(results[1].result.itemId).toBe('item2');
      expect(results[2].result.itemId).toBe('item3');

      // Verify results are stored in processed items
      expect(queue.processed[0]._queueMeta.result.itemId).toBe('item1');
      expect(queue.processed[1]._queueMeta.result.itemId).toBe('item2');
      expect(queue.processed[2]._queueMeta.result.itemId).toBe('item3');
    });
  });

  describe('error handling in batch', () => {
    it('should properly capture failures for individual items in batch', async () => {
      queue.enqueue({ type: 'critical_security', id: 'item1' });
      queue.enqueue({ type: 'potential_issue', id: 'item2' }); // This will fail
      queue.enqueue({ type: 'refactor_suggestion', id: 'item3' });

      // Handler that throws error for item2
      const handler = async (item) => {
        if (item.id === 'item2') {
          throw new Error('Processing failed for item2');
        }
        return { processed: item.id };
      };

      const results = await queue.processBatch(handler, 3);

      // Verify we got 3 results
      expect(results).toHaveLength(3);

      // Verify item1 succeeded
      expect(results[0].status).toBe('completed');
      expect(results[0].item.id).toBe('item1');

      // Verify item2 failed
      expect(results[1].status).toBe('failed');
      expect(results[1].item.id).toBe('item2');
      expect(results[1].error).toBe('Processing failed for item2');

      // Verify item3 succeeded
      expect(results[2].status).toBe('completed');
      expect(results[2].item.id).toBe('item3');

      // Verify processed list only contains successful items
      expect(queue.processed).toHaveLength(2);
      expect(queue.processed.map((p) => p.id).sort()).toEqual(['item1', 'item3']);

      // Verify failed item is NOT in processed list
      expect(queue.processed.find((p) => p.id === 'item2')).toBeUndefined();

      // Note: Failed items are requeued if under maxRetries, not immediately in failed list
      // Since default maxRetries is 3, item2 should be requeued
      expect(queue.items.find((i) => i.id === 'item2')).toBeDefined();
      expect(queue.items.find((i) => i.id === 'item2')._queueMeta.attempts).toBe(1);
    });

    it('should track error messages correctly for each failed item', async () => {
      queue.enqueue({ type: 'critical_security', id: 'item1' }); // Will fail
      queue.enqueue({ type: 'potential_issue', id: 'item2' }); // Will fail
      queue.enqueue({ type: 'refactor_suggestion', id: 'item3' }); // Will succeed

      const handler = async (item) => {
        if (item.id === 'item1') {
          throw new Error('Error A for item1');
        }
        if (item.id === 'item2') {
          throw new Error('Error B for item2');
        }
        return { success: true };
      };

      const results = await queue.processBatch(handler, 3);

      // Verify error messages are item-specific
      expect(results[0].error).toBe('Error A for item1');
      expect(results[1].error).toBe('Error B for item2');
      expect(results[2].status).toBe('completed');

      // Verify error metadata is stored correctly
      const requeuedItem1 = queue.items.find((i) => i.id === 'item1');
      const requeuedItem2 = queue.items.find((i) => i.id === 'item2');

      expect(requeuedItem1._queueMeta.lastError).toBe('Error A for item1');
      expect(requeuedItem2._queueMeta.lastError).toBe('Error B for item2');
    });

    it('should handle mixed success and failures without corruption', async () => {
      // Add 5 items with alternating success/failure pattern
      queue.enqueue({ type: 'critical_security', id: 'pass1' });
      queue.enqueue({ type: 'potential_issue', id: 'fail1' });
      queue.enqueue({ type: 'refactor_suggestion', id: 'pass2' });
      queue.enqueue({ type: 'performance', id: 'fail2' });
      queue.enqueue({ type: 'documentation', id: 'pass3' });

      const handler = async (item) => {
        // Simulate random async delays
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 50));

        if (item.id.startsWith('fail')) {
          throw new Error(`Failure for ${item.id}`);
        }
        return { itemId: item.id };
      };

      const results = await queue.processBatch(handler, 5);

      // Verify correct count
      expect(results).toHaveLength(5);

      // Verify successful items
      const successful = results.filter((r) => r.status === 'completed');
      expect(successful).toHaveLength(3);
      expect(successful.map((s) => s.item.id).sort()).toEqual(['pass1', 'pass2', 'pass3']);

      // Verify failed items
      const failed = results.filter((r) => r.status === 'failed');
      expect(failed).toHaveLength(2);
      expect(failed.map((f) => f.item.id).sort()).toEqual(['fail1', 'fail2']);

      // Verify state consistency
      expect(queue.processed.map((p) => p.id).sort()).toEqual(['pass1', 'pass2', 'pass3']);
      expect(queue.items.filter((i) => i.id.startsWith('fail'))).toHaveLength(2);
    });
  });
});

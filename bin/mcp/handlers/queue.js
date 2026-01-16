/**
 * GoodFlows MCP Priority Queue Handlers
 *
 * Handles queue operations: create, next, complete, fail, stats
 *
 * @module goodflows/bin/mcp/handlers/queue
 */

import { PriorityQueue } from '../../../lib/priority-queue.js';
import { mcpResponse, mcpError } from '../tool-registry.js';

/**
 * Priority Queue Tool Definitions
 */
export const tools = [
  {
    name: 'goodflows_queue_create',
    description: `Create a priority queue from findings. Items are auto-sorted by priority.

Priority order: P1 (critical_security) -> P2 (potential_issue) -> P3 (refactor/perf) -> P4 (docs)`,
    inputSchema: {
      type: 'object',
      properties: {
        queueId: { type: 'string', description: 'Queue identifier' },
        findings: { type: 'array', description: 'Array of findings to queue' },
        priorityThreshold: { type: 'number', description: 'Only include items at or above this priority (1-4)' },
      },
      required: ['queueId', 'findings'],
    },
  },
  {
    name: 'goodflows_queue_next',
    description: 'Get next highest priority item from queue',
    inputSchema: {
      type: 'object',
      properties: {
        queueId: { type: 'string' },
      },
      required: ['queueId'],
    },
  },
  {
    name: 'goodflows_queue_complete',
    description: 'Mark current item as completed',
    inputSchema: {
      type: 'object',
      properties: {
        queueId: { type: 'string' },
        result: { type: 'object', description: 'Completion result data' },
      },
      required: ['queueId'],
    },
  },
  {
    name: 'goodflows_queue_fail',
    description: 'Mark current item as failed (will be retried up to 3x)',
    inputSchema: {
      type: 'object',
      properties: {
        queueId: { type: 'string' },
        error: { type: 'string', description: 'Error message' },
      },
      required: ['queueId'],
    },
  },
  {
    name: 'goodflows_queue_stats',
    description: 'Get queue statistics',
    inputSchema: {
      type: 'object',
      properties: {
        queueId: { type: 'string' },
      },
      required: ['queueId'],
    },
  },
];

/**
 * Priority Queue Handlers
 */
export const handlers = {
  async goodflows_queue_create(args, services) {
    const { activeQueues } = services;

    const queue = new PriorityQueue({
      priorityThreshold: args.priorityThreshold,
    });
    for (const finding of args.findings) {
      queue.enqueue(finding);
    }
    activeQueues.set(args.queueId, queue);

    return mcpResponse({
      queueId: args.queueId,
      stats: queue.getStats(),
    });
  },

  async goodflows_queue_next(args, services) {
    const { activeQueues } = services;

    const queue = activeQueues.get(args.queueId);
    if (!queue) {
      return mcpError('Queue not found', 'QUEUE_NOT_FOUND');
    }
    const item = queue.peek();
    if (!item) {
      return mcpResponse({ empty: true, stats: queue.getStats() });
    }
    return mcpResponse({ item, stats: queue.getStats() });
  },

  async goodflows_queue_complete(args, services) {
    const { activeQueues } = services;

    const queue = activeQueues.get(args.queueId);
    if (!queue) {
      return mcpError('Queue not found', 'QUEUE_NOT_FOUND');
    }
    queue.dequeue();
    return mcpResponse({ success: true, stats: queue.getStats() });
  },

  async goodflows_queue_fail(args, services) {
    const { activeQueues } = services;

    const queue = activeQueues.get(args.queueId);
    if (!queue) {
      return mcpError('Queue not found', 'QUEUE_NOT_FOUND');
    }
    const item = queue.peek();
    if (item) {
      item._retries = (item._retries || 0) + 1;
      if (item._retries >= 3) {
        queue.dequeue(); // Give up after 3 retries
        return mcpResponse({ exhausted: true, item, stats: queue.getStats() });
      }
    }
    return mcpResponse({ retrying: true, attempt: item?._retries, stats: queue.getStats() });
  },

  async goodflows_queue_stats(args, services) {
    const { activeQueues } = services;

    const queue = activeQueues.get(args.queueId);
    if (!queue) {
      return mcpError('Queue not found', 'QUEUE_NOT_FOUND');
    }
    return mcpResponse(queue.getStats());
  },
};

export default { tools, handlers };

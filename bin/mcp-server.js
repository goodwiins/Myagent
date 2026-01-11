#!/usr/bin/env node
/**
 * GoodFlows MCP Server
 *
 * Exposes GoodFlows features to Claude agents via Model Context Protocol.
 *
 * Tools provided:
 * - goodflows_context_query: Query findings from context store
 * - goodflows_context_add: Add finding to context store
 * - goodflows_context_export: Export findings to markdown
 * - goodflows_session_start: Start a new session
 * - goodflows_session_resume: Resume existing session
 * - goodflows_session_checkpoint: Create checkpoint
 * - goodflows_session_rollback: Rollback to checkpoint
 * - goodflows_pattern_recommend: Get fix pattern recommendations
 * - goodflows_pattern_record: Record fix pattern result
 * - goodflows_queue_create: Create priority queue from findings
 * - goodflows_queue_next: Get next highest priority item
 * - goodflows_stats: Get store statistics
 *
 * Usage:
 *   npx goodflows-mcp-server
 *
 * Or add to Claude settings:
 *   "mcpServers": {
 *     "goodflows": {
 *       "command": "npx",
 *       "args": ["goodflows-mcp-server"]
 *     }
 *   }
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { ContextStore } from '../lib/context-store.js';
import { SessionContextManager } from '../lib/session-context.js';
import { PatternTracker } from '../lib/pattern-tracker.js';
import { PriorityQueue, PRIORITY, TYPE_TO_PRIORITY } from '../lib/priority-queue.js';

// Initialize GoodFlows components
const contextStore = new ContextStore({ basePath: '.goodflows/context' });
const patternTracker = new PatternTracker({ basePath: '.goodflows/context/patterns' });

// Active sessions and queues (in-memory for current process)
const activeSessions = new Map();
const activeQueues = new Map();

// Create MCP server
const server = new Server(
  {
    name: 'goodflows',
    version: '1.1.5',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define all GoodFlows tools
const TOOLS = [
  // ========== Context Store Tools ==========
  {
    name: 'goodflows_context_query',
    description: `Query findings from GoodFlows context store. Use this to check for existing findings before creating issues.

Examples:
- Query all open bugs: { "type": "bug", "status": "open" }
- Query by file: { "file": "src/api/auth.js" }
- Query security issues: { "type": "critical_security" }`,
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: 'Finding type: critical_security, potential_issue, refactor_suggestion, performance, documentation',
        },
        file: {
          type: 'string',
          description: 'File path to filter by (substring match)',
        },
        status: {
          type: 'string',
          description: 'Status: open, in_progress, fixed, wont_fix',
        },
        limit: {
          type: 'number',
          description: 'Max results (default: 20)',
        },
      },
    },
  },
  {
    name: 'goodflows_context_add',
    description: `Add a finding to the context store. Returns hash for deduplication and linking.

The store automatically:
- Deduplicates by content hash
- Indexes by file and type
- Checks similarity to existing findings`,
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'File path' },
        lines: { type: 'string', description: 'Line range (e.g., "45-52")' },
        type: { type: 'string', description: 'Finding type' },
        description: { type: 'string', description: 'Finding description' },
        severity: { type: 'string', description: 'Severity level' },
        proposedFix: { type: 'string', description: 'Suggested fix' },
      },
      required: ['file', 'type', 'description'],
    },
  },
  {
    name: 'goodflows_context_update',
    description: 'Update a finding status (e.g., mark as fixed, link to issue)',
    inputSchema: {
      type: 'object',
      properties: {
        hash: { type: 'string', description: 'Finding hash' },
        status: { type: 'string', description: 'New status' },
        issueId: { type: 'string', description: 'Linear issue ID (e.g., GOO-31)' },
      },
      required: ['hash'],
    },
  },
  {
    name: 'goodflows_context_export',
    description: 'Export findings to markdown format for reporting',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Filter by type' },
        status: { type: 'string', description: 'Filter by status' },
        outputPath: { type: 'string', description: 'Output file (default: .goodflows/export.md)' },
      },
    },
  },
  {
    name: 'goodflows_context_check_duplicate',
    description: 'Check if a finding already exists (by hash or similarity)',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string' },
        type: { type: 'string' },
        description: { type: 'string' },
        similarityThreshold: { type: 'number', description: 'Similarity threshold 0-1 (default: 0.85)' },
      },
      required: ['description'],
    },
  },

  // ========== Session Tools ==========
  {
    name: 'goodflows_session_start',
    description: `Start a new workflow session. Sessions enable context sharing between agents.

Returns sessionId that should be passed to other agents for context propagation.`,
    inputSchema: {
      type: 'object',
      properties: {
        trigger: { type: 'string', description: 'What triggered this session (e.g., code-review, fix-issue)' },
        metadata: { type: 'object', description: 'Additional metadata (branch, PR number, etc.)' },
      },
    },
  },
  {
    name: 'goodflows_session_resume',
    description: 'Resume an existing session to access shared context',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Session ID to resume' },
      },
      required: ['sessionId'],
    },
  },
  {
    name: 'goodflows_session_get_context',
    description: 'Get value from session context (dot notation supported)',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        path: { type: 'string', description: 'Context path (e.g., findings.all, issues.created)' },
      },
      required: ['sessionId', 'path'],
    },
  },
  {
    name: 'goodflows_session_set_context',
    description: 'Set value in session context for other agents to read',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        path: { type: 'string', description: 'Context path' },
        value: { description: 'Value to store (any JSON type)' },
      },
      required: ['sessionId', 'path', 'value'],
    },
  },
  {
    name: 'goodflows_session_checkpoint',
    description: 'Create a checkpoint for potential rollback',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        name: { type: 'string', description: 'Checkpoint name (e.g., before_fixes)' },
      },
      required: ['sessionId', 'name'],
    },
  },
  {
    name: 'goodflows_session_rollback',
    description: 'Rollback session to a checkpoint',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        checkpointId: { type: 'string' },
      },
      required: ['sessionId', 'checkpointId'],
    },
  },
  {
    name: 'goodflows_session_end',
    description: 'End session and persist final state',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        status: { type: 'string', description: 'completed, failed, partial' },
        summary: { type: 'object', description: 'Final summary data' },
      },
      required: ['sessionId'],
    },
  },

  // ========== Pattern Tracker Tools ==========
  {
    name: 'goodflows_pattern_recommend',
    description: `Get recommended fix patterns based on finding type and description.

Returns patterns sorted by confidence score. Only apply patterns with confidence > 0.7.`,
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Finding type' },
        description: { type: 'string', description: 'Finding description for similarity matching' },
        minConfidence: { type: 'number', description: 'Minimum confidence (default: 0.5)' },
      },
      required: ['type'],
    },
  },
  {
    name: 'goodflows_pattern_record_success',
    description: 'Record successful fix to improve pattern confidence',
    inputSchema: {
      type: 'object',
      properties: {
        patternId: { type: 'string' },
        file: { type: 'string' },
        issueId: { type: 'string' },
        context: { type: 'string', description: 'Additional context' },
      },
      required: ['patternId'],
    },
  },
  {
    name: 'goodflows_pattern_record_failure',
    description: 'Record failed fix to decrease pattern confidence',
    inputSchema: {
      type: 'object',
      properties: {
        patternId: { type: 'string' },
        file: { type: 'string' },
        issueId: { type: 'string' },
        reason: { type: 'string', description: 'Why the fix failed' },
      },
      required: ['patternId', 'reason'],
    },
  },
  {
    name: 'goodflows_pattern_add',
    description: 'Add a new reusable fix pattern',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Pattern ID (e.g., env-var-secret)' },
        type: { type: 'string', description: 'Finding type this pattern fixes' },
        description: { type: 'string' },
        template: { type: 'string', description: 'Code template for the fix' },
        keywords: { type: 'array', items: { type: 'string' }, description: 'Keywords for matching' },
      },
      required: ['id', 'type', 'description'],
    },
  },

  // ========== Priority Queue Tools ==========
  {
    name: 'goodflows_queue_create',
    description: `Create a priority queue from findings. Items are auto-sorted by priority.

Priority order: P1 (critical_security) → P2 (potential_issue) → P3 (refactor/perf) → P4 (docs)`,
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

  // ========== Stats Tool ==========
  {
    name: 'goodflows_stats',
    description: 'Get overall GoodFlows statistics',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

// Handle list tools request
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      // ========== Context Store Handlers ==========
      case 'goodflows_context_query': {
        const results = contextStore.query({
          type: args.type,
          file: args.file,
          status: args.status,
          limit: args.limit || 20,
        });
        return {
          content: [{ type: 'text', text: JSON.stringify({ count: results.length, findings: results }, null, 2) }],
        };
      }

      case 'goodflows_context_add': {
        const result = contextStore.addFinding({
          file: args.file,
          lines: args.lines,
          type: args.type,
          description: args.description,
          severity: args.severity,
          proposedFix: args.proposedFix,
          status: 'open',
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'goodflows_context_update': {
        const result = contextStore.updateFinding(args.hash, {
          status: args.status,
          issueId: args.issueId,
        });
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true, updated: result }, null, 2) }],
        };
      }

      case 'goodflows_context_export': {
        const markdown = contextStore.exportToMarkdown({
          type: args.type,
          status: args.status,
        });
        const outputPath = args.outputPath || '.goodflows/export.md';
        const { writeFileSync } = await import('fs');
        writeFileSync(outputPath, markdown);
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true, path: outputPath, preview: markdown.slice(0, 500) + '...' }, null, 2) }],
        };
      }

      case 'goodflows_context_check_duplicate': {
        const existing = contextStore.findSimilar(args.description, {
          threshold: args.similarityThreshold || 0.85,
          file: args.file,
          type: args.type,
        });
        return {
          content: [{ type: 'text', text: JSON.stringify({
            isDuplicate: existing.length > 0,
            similarFindings: existing,
          }, null, 2) }],
        };
      }

      // ========== Session Handlers ==========
      case 'goodflows_session_start': {
        const session = new SessionContextManager();
        const sessionId = session.start({
          trigger: args.trigger || 'manual',
          ...args.metadata,
        });
        activeSessions.set(sessionId, session);
        return {
          content: [{ type: 'text', text: JSON.stringify({ sessionId, status: 'started' }, null, 2) }],
        };
      }

      case 'goodflows_session_resume': {
        let session = activeSessions.get(args.sessionId);
        if (!session) {
          session = SessionContextManager.resume(args.sessionId);
          if (session) {
            activeSessions.set(args.sessionId, session);
          }
        }
        if (!session) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'Session not found', sessionId: args.sessionId }, null, 2) }],
            isError: true,
          };
        }
        return {
          content: [{ type: 'text', text: JSON.stringify({ sessionId: args.sessionId, status: 'resumed', context: session.getAll() }, null, 2) }],
        };
      }

      case 'goodflows_session_get_context': {
        const session = activeSessions.get(args.sessionId);
        if (!session) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'Session not found' }, null, 2) }],
            isError: true,
          };
        }
        const value = session.get(args.path);
        return {
          content: [{ type: 'text', text: JSON.stringify({ path: args.path, value }, null, 2) }],
        };
      }

      case 'goodflows_session_set_context': {
        const session = activeSessions.get(args.sessionId);
        if (!session) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'Session not found' }, null, 2) }],
            isError: true,
          };
        }
        session.set(args.path, args.value);
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true, path: args.path }, null, 2) }],
        };
      }

      case 'goodflows_session_checkpoint': {
        const session = activeSessions.get(args.sessionId);
        if (!session) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'Session not found' }, null, 2) }],
            isError: true,
          };
        }
        const checkpointId = session.checkpoint(args.name);
        return {
          content: [{ type: 'text', text: JSON.stringify({ checkpointId, name: args.name }, null, 2) }],
        };
      }

      case 'goodflows_session_rollback': {
        const session = activeSessions.get(args.sessionId);
        if (!session) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'Session not found' }, null, 2) }],
            isError: true,
          };
        }
        session.rollback(args.checkpointId);
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true, rolledBackTo: args.checkpointId }, null, 2) }],
        };
      }

      case 'goodflows_session_end': {
        const session = activeSessions.get(args.sessionId);
        if (!session) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'Session not found' }, null, 2) }],
            isError: true,
          };
        }
        session.complete(args.summary || {});
        activeSessions.delete(args.sessionId);
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true, status: args.status || 'completed' }, null, 2) }],
        };
      }

      // ========== Pattern Tracker Handlers ==========
      case 'goodflows_pattern_recommend': {
        const patterns = patternTracker.recommend(args.type, args.description || '', {
          minConfidence: args.minConfidence || 0.5,
        });
        return {
          content: [{ type: 'text', text: JSON.stringify({ patterns }, null, 2) }],
        };
      }

      case 'goodflows_pattern_record_success': {
        patternTracker.recordSuccess(args.patternId, {
          file: args.file,
          issueId: args.issueId,
          context: args.context,
        });
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true, patternId: args.patternId }, null, 2) }],
        };
      }

      case 'goodflows_pattern_record_failure': {
        patternTracker.recordFailure(args.patternId, {
          file: args.file,
          issueId: args.issueId,
          reason: args.reason,
        });
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true, patternId: args.patternId }, null, 2) }],
        };
      }

      case 'goodflows_pattern_add': {
        patternTracker.addPattern({
          id: args.id,
          type: args.type,
          description: args.description,
          template: args.template,
          applicability: {
            keywords: args.keywords || [],
          },
        });
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true, patternId: args.id }, null, 2) }],
        };
      }

      // ========== Priority Queue Handlers ==========
      case 'goodflows_queue_create': {
        const queue = new PriorityQueue({
          priorityThreshold: args.priorityThreshold,
        });
        for (const finding of args.findings) {
          queue.enqueue(finding);
        }
        activeQueues.set(args.queueId, queue);
        return {
          content: [{ type: 'text', text: JSON.stringify({
            queueId: args.queueId,
            stats: queue.getStats(),
          }, null, 2) }],
        };
      }

      case 'goodflows_queue_next': {
        const queue = activeQueues.get(args.queueId);
        if (!queue) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'Queue not found' }, null, 2) }],
            isError: true,
          };
        }
        const item = queue.peek();
        if (!item) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ empty: true, stats: queue.getStats() }, null, 2) }],
          };
        }
        return {
          content: [{ type: 'text', text: JSON.stringify({ item, stats: queue.getStats() }, null, 2) }],
        };
      }

      case 'goodflows_queue_complete': {
        const queue = activeQueues.get(args.queueId);
        if (!queue) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'Queue not found' }, null, 2) }],
            isError: true,
          };
        }
        queue.dequeue();
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true, stats: queue.getStats() }, null, 2) }],
        };
      }

      case 'goodflows_queue_fail': {
        const queue = activeQueues.get(args.queueId);
        if (!queue) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'Queue not found' }, null, 2) }],
            isError: true,
          };
        }
        const item = queue.peek();
        if (item) {
          item._retries = (item._retries || 0) + 1;
          if (item._retries >= 3) {
            queue.dequeue(); // Give up after 3 retries
            return {
              content: [{ type: 'text', text: JSON.stringify({ exhausted: true, item, stats: queue.getStats() }, null, 2) }],
            };
          }
        }
        return {
          content: [{ type: 'text', text: JSON.stringify({ retrying: true, attempt: item?._retries, stats: queue.getStats() }, null, 2) }],
        };
      }

      case 'goodflows_queue_stats': {
        const queue = activeQueues.get(args.queueId);
        if (!queue) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'Queue not found' }, null, 2) }],
            isError: true,
          };
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(queue.getStats(), null, 2) }],
        };
      }

      // ========== Stats Handler ==========
      case 'goodflows_stats': {
        const contextStats = contextStore.getStats();
        const patternStats = patternTracker.getStats();
        return {
          content: [{ type: 'text', text: JSON.stringify({
            context: contextStats,
            patterns: patternStats,
            activeSessions: activeSessions.size,
            activeQueues: activeQueues.size,
          }, null, 2) }],
        };
      }

      default:
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: `Unknown tool: ${name}` }, null, 2) }],
          isError: true,
        };
    }
  } catch (error) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: error.message, stack: error.stack }, null, 2) }],
      isError: true,
    };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('GoodFlows MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

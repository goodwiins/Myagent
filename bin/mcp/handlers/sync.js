/**
 * GoodFlows MCP Sync Handlers
 *
 * Handles cross-CLI synchronization for multi-LLM collaboration.
 * Enables Claude, Gemini, GPT-4, etc. to share context via file-based sync.
 *
 * @module goodflows/bin/mcp/handlers/sync
 */

import { SyncManager } from '../../../lib/sync-manager.js';
import { mcpResponse, mcpError } from '../tool-registry.js';

/**
 * Sync Tool Definitions
 */
export const tools = [
  {
    name: 'goodflows_sync',
    description: `Sync context between LLMs. Export or import handoff files.

Directions:
- "export": Export context for another LLM to import
- "import": Import context from another LLM

Role filters (for export): frontend, backend, testing, devops

Examples:
- Export: { "direction": "export", "llm": "claude", "role": "backend" }
- Import: { "direction": "import", "llm": "gemini" }`,
    inputSchema: {
      type: 'object',
      properties: {
        direction: {
          type: 'string',
          enum: ['export', 'import'],
          description: 'Operation direction (default: export)',
        },
        llm: {
          type: 'string',
          description: 'LLM identifier (claude, gemini, gpt4, copilot, cursor, windsurf)',
        },
        // For export
        sessionId: {
          type: 'string',
          description: 'Session ID to export (for export)',
        },
        role: {
          type: 'string',
          enum: ['frontend', 'backend', 'testing', 'devops'],
          description: 'Role preset for filtering (for export)',
        },
        includeFiles: {
          type: 'array',
          items: { type: 'string' },
          description: 'Custom include glob patterns (for export)',
        },
        excludeFiles: {
          type: 'array',
          items: { type: 'string' },
          description: 'Custom exclude glob patterns (for export)',
        },
        includeFindings: {
          type: 'boolean',
          description: 'Include findings (for export, default: true)',
        },
        message: {
          type: 'string',
          description: 'Message for receiving LLM (for export)',
        },
        // For import
        content: {
          type: 'string',
          description: 'Direct JSON content (for import, alternative to file)',
        },
      },
    },
  },
  {
    name: 'goodflows_sync_merge',
    description: `Merge contexts from multiple LLMs into a shared state.

Combines handoff files from multiple LLMs, handling conflicts based on strategy:
- "latest-wins": Most recent export wins (default)
- "manual": Reports conflicts without resolving
- "theirs": Prefer other LLM's changes
- "ours": Prefer current LLM's changes

Example: { "sources": ["claude", "gemini"], "strategy": "latest-wins" }`,
    inputSchema: {
      type: 'object',
      properties: {
        sources: {
          type: 'array',
          items: { type: 'string' },
          description: 'LLMs to merge (auto-detects available if empty)',
        },
        strategy: {
          type: 'string',
          enum: ['latest-wins', 'manual', 'theirs', 'ours'],
          description: 'Merge strategy for conflicts',
        },
      },
    },
  },
  {
    name: 'goodflows_sync_status',
    description: `Get sync status - what's available and when it was last updated.

Shows:
- Available handoff files from each LLM
- When each was exported
- Any pending conflicts
- Shared state if merged

Example: {} - Get full status, or { "llm": "gemini" } for specific LLM`,
    inputSchema: {
      type: 'object',
      properties: {
        llm: {
          type: 'string',
          description: 'Check specific LLM status',
        },
      },
    },
  },
  {
    name: 'goodflows_sync_activity',
    description: `Get activity log for cross-LLM collaboration.

Shows timeline of sync events (exports, imports, merges) across all LLMs.
Use this to understand collaboration history and see what other LLMs have done.

Freshness levels:
- "fresh": Activity within last 5 minutes
- "recent": Activity within last 30 minutes
- "stale": Activity within last hour
- "old": Activity within last day
- "outdated": Activity older than a day

Example: { "llm": "gemini" } - Check Gemini's activity status`,
    inputSchema: {
      type: 'object',
      properties: {
        llm: {
          type: 'string',
          description: 'Filter activity by specific LLM',
        },
        type: {
          type: 'string',
          enum: ['export', 'import', 'merge', 'session_start', 'session_end', 'work_completed'],
          description: 'Filter by event type',
        },
        limit: {
          type: 'number',
          description: 'Maximum events to return (default: 10)',
        },
        since: {
          type: 'string',
          description: 'ISO timestamp to filter events from',
        },
        summary: {
          type: 'boolean',
          description: 'Return summary by LLM instead of event list (default: false)',
        },
      },
    },
  },
];

/**
 * Sync Handlers
 */
export const handlers = {
  async goodflows_sync(args, services) {
    const { activeSessions, contextStore, getProjectContext } = services;
    const direction = args.direction || 'export';

    try {
      const syncManager = new SyncManager({ basePath: process.cwd() });

      if (direction === 'export') {
        const projectContext = getProjectContext();

        // Get session data
        let session = null;
        if (args.sessionId) {
          session = activeSessions.get(args.sessionId);
        } else {
          // Get first active session
          for (const [, sess] of activeSessions) {
            session = sess;
            break;
          }
        }

        // Get findings if requested
        let findings = [];
        if (args.includeFindings !== false) {
          findings = contextStore.query({ limit: 50 });
        }

        const result = syncManager.export({
          llm: args.llm,
          session,
          findings,
          projectContext,
          role: args.role,
          includeFiles: args.includeFiles,
          excludeFiles: args.excludeFiles,
          message: args.message,
        });

        return mcpResponse(result);
      } else if (direction === 'import') {
        const result = syncManager.import({
          llm: args.llm,
          content: args.content,
        });

        return mcpResponse({
          ...result,
          nextSteps: [
            result.session
              ? `Resume session: goodflows_session_resume({ sessionId: "${result.session.id}" })`
              : 'Start new session: goodflows_session_start({ trigger: "sync-import" })',
            `${result.findings?.length || 0} findings available`,
            result.message ? `Message from ${result.importedFrom}: ${result.message}` : null,
          ].filter(Boolean),
        });
      } else {
        return mcpError(`Unknown direction: ${direction}. Valid: export, import`, 'INVALID_DIRECTION');
      }
    } catch (error) {
      return mcpError(`Sync ${direction} failed: ${error.message}`, 'SYNC_ERROR');
    }
  },

  async goodflows_sync_merge(args, _services) {
    try {
      const syncManager = new SyncManager({ basePath: process.cwd() });

      const result = syncManager.merge({
        sources: args.sources,
        strategy: args.strategy,
      });

      if (!result.success) {
        return mcpError(result.error, 'SYNC_MERGE_ERROR');
      }

      return mcpResponse({
        ...result,
        nextSteps: result.conflicts
          ? [
              `${result.conflicts.length} conflicts detected`,
              `Review conflicts at: ${result.conflictsPath}`,
              'Resolve manually or re-merge with different strategy',
            ]
          : ['Merge complete - shared state ready', 'Use goodflows_sync_status() to verify'],
      });
    } catch (error) {
      return mcpError(`Sync merge failed: ${error.message}`, 'SYNC_MERGE_ERROR');
    }
  },

  async goodflows_sync_status(args, _services) {
    try {
      const syncManager = new SyncManager({ basePath: process.cwd() });
      const result = syncManager.status({ llm: args.llm });

      return mcpResponse({
        ...result,
        summary:
          result.available.length > 0
            ? `${result.available.length} LLM(s) have exported context`
            : 'No sync data available yet',
        hint: result.available.length === 0
          ? 'Export with: goodflows_sync_export({ llm: "claude" })'
          : null,
      });
    } catch (error) {
      return mcpError(`Sync status failed: ${error.message}`, 'SYNC_STATUS_ERROR');
    }
  },

  async goodflows_sync_activity(args, _services) {
    try {
      const syncManager = new SyncManager({ basePath: process.cwd() });

      // Return summary by LLM if requested
      if (args.summary) {
        const summary = syncManager.getActivitySummary();
        const llmList = Object.keys(summary);

        return mcpResponse({
          summary,
          llmCount: llmList.length,
          totalEvents: llmList.reduce((sum, llm) => sum + summary[llm].totalEvents, 0),
          hint: llmList.length === 0
            ? 'No activity recorded yet. Export/import to create activity.'
            : null,
        });
      }

      // If specific LLM requested, also return freshness
      if (args.llm) {
        const freshness = syncManager.getActivityFreshness(args.llm);
        const activity = syncManager.getActivity({
          limit: args.limit || 10,
          llm: args.llm,
          type: args.type,
          since: args.since,
        });

        return mcpResponse({
          llm: args.llm,
          freshness,
          events: activity,
          eventCount: activity.length,
        });
      }

      // Return general activity log
      const activity = syncManager.getActivity({
        limit: args.limit || 10,
        type: args.type,
        since: args.since,
      });

      return mcpResponse({
        events: activity,
        eventCount: activity.length,
        hint: activity.length === 0
          ? 'No activity recorded yet. Use goodflows_sync_export/import to start collaborating.'
          : 'Use { llm: "name" } to check specific LLM freshness',
      });
    } catch (error) {
      return mcpError(`Sync activity failed: ${error.message}`, 'SYNC_ACTIVITY_ERROR');
    }
  },
};

export default { tools, handlers };

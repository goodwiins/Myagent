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
    name: 'goodflows_sync_export',
    description: `Export context for another LLM to import.

Creates a handoff file at .goodflows/sync/handoff-{llm}.json that can be
imported by another LLM (Gemini, GPT-4, etc.) to resume work.

Supports role-based filtering to export only relevant context:
- "frontend": Components, pages, styles, hooks
- "backend": API, server, database, lib
- "testing": Test files and configs
- "devops": Docker, CI/CD, scripts

Example: { "llm": "claude", "role": "backend", "message": "API ready for frontend" }`,
    inputSchema: {
      type: 'object',
      properties: {
        llm: {
          type: 'string',
          description: 'LLM identifier (claude, gemini, gpt4, copilot, cursor, windsurf)',
        },
        sessionId: {
          type: 'string',
          description: 'Session ID to export (uses active session if not specified)',
        },
        role: {
          type: 'string',
          enum: ['frontend', 'backend', 'testing', 'devops'],
          description: 'Role preset for filtering context',
        },
        includeFiles: {
          type: 'array',
          items: { type: 'string' },
          description: 'Custom include glob patterns (e.g., ["src/api/**", "lib/**"])',
        },
        excludeFiles: {
          type: 'array',
          items: { type: 'string' },
          description: 'Custom exclude glob patterns',
        },
        includeFindings: {
          type: 'boolean',
          description: 'Include findings from context store (default: true)',
        },
        message: {
          type: 'string',
          description: 'Message for the receiving LLM',
        },
      },
      required: ['llm'],
    },
  },
  {
    name: 'goodflows_sync_import',
    description: `Import context from another LLM.

Reads the handoff file from .goodflows/sync/handoff-{llm}.json and returns
the context for resuming work.

Example: { "llm": "gemini" } - Import Gemini's exported context`,
    inputSchema: {
      type: 'object',
      properties: {
        llm: {
          type: 'string',
          description: 'LLM to import from (reads .goodflows/sync/handoff-{llm}.json)',
        },
        content: {
          type: 'string',
          description: 'Direct JSON content (alternative to reading from file)',
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
];

/**
 * Sync Handlers
 */
export const handlers = {
  async goodflows_sync_export(args, services) {
    const { activeSessions, contextStore, getProjectContext, goodflowsBasePath } = services;

    try {
      const syncManager = new SyncManager({ basePath: process.cwd() });
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
    } catch (error) {
      return mcpError(`Sync export failed: ${error.message}`, 'SYNC_EXPORT_ERROR');
    }
  },

  async goodflows_sync_import(args, services) {
    try {
      const syncManager = new SyncManager({ basePath: process.cwd() });

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
    } catch (error) {
      return mcpError(`Sync import failed: ${error.message}`, 'SYNC_IMPORT_ERROR');
    }
  },

  async goodflows_sync_merge(args, services) {
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

  async goodflows_sync_status(args, services) {
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
};

export default { tools, handlers };
